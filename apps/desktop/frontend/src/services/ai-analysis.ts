// AI 磁盘分析服务 - Function Calling 实现

import { invoke } from '@tauri-apps/api/core'
import { loadSettings, type ChatMessage, type FunctionTool, type ChatCompletionResponse } from './ai'

export interface CleanupSuggestion {
  action: 'delete' | 'move'
  type: 'file' | 'directory'
  path: string
  size: string
  updateTime: string
  message: string
}

export interface AnalysisResult {
  suggestions: CleanupSuggestion[]
  summary: string
  tokenUsage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface SystemInfo {
  os: string
  shell: string
}

// 获取系统信息
export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const platform = navigator.platform.toLowerCase()
    const userAgent = navigator.userAgent.toLowerCase()
    
    let os = 'unknown'
    let shell = 'unknown'
    
    if (platform.includes('win') || userAgent.includes('win')) {
      os = 'Windows'
      shell = 'PowerShell'
    } else if (platform.includes('mac') || userAgent.includes('mac')) {
      os = 'macOS'
      shell = 'zsh'
    } else if (platform.includes('linux') || userAgent.includes('linux')) {
      os = 'Linux'
      shell = 'bash'
    }
    
    return { os, shell }
  } catch {
    return { os: 'unknown', shell: 'unknown' }
  }
}

// 定义工具函数
const tools: FunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'output_suggestions',
      description: '输出磁盘清理建议列表。每个建议包含操作类型（删除/迁移）、文件/目录路径、大小、更新时间和说明。',
      parameters: {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['delete', 'move'],
                  description: '建议的操作：delete（删除）或 move（迁移）'
                },
                type: {
                  type: 'string',
                  enum: ['file', 'directory'],
                  description: '类型：file（文件）或 directory（目录）'
                },
                path: {
                  type: 'string',
                  description: '文件或目录的完整路径'
                },
                size: {
                  type: 'string',
                  description: '大小（如 "100KB", "1.5GB"）'
                },
                updateTime: {
                  type: 'string',
                  description: '最后修改时间（格式：YYYY-MM-DD HH:mm:ss）'
                },
                message: {
                  type: 'string',
                  description: '建议说明，解释为什么建议执行此操作'
                }
              },
              required: ['action', 'type', 'path', 'size', 'updateTime', 'message']
            }
          }
        },
        required: ['suggestions']
      }
    }
  }
]

// 执行 AI 分析
export async function analyzeWithAI(
  diskSummary: string,
  onProgress?: (msg: string) => void
): Promise<AnalysisResult> {
  const settings = loadSettings()
  
  if (!settings.apiKey) {
    throw new Error('请先在设置中配置 API Key')
  }

  const systemInfo = await getSystemInfo()
  
  const systemPrompt = `你是一个专业的磁盘空间分析和清理助手。

当前系统信息：
- 操作系统：${systemInfo.os}
- 默认 Shell：${systemInfo.shell}

你的任务：
1. 分析用户提供的磁盘占用数据
2. 识别可以安全删除或迁移的文件/目录
3. 参考 ${systemInfo.os} 系统的常见磁盘清理经验
4. 使用 output_suggestions 函数输出清理建议

清理建议原则：
- 临时文件、缓存文件可以建议删除
- 日志文件、旧备份可以建议删除或迁移
- 大型媒体文件、归档文件可以建议迁移
- 系统文件、程序文件绝对不能建议删除
- 重要配置文件不能建议删除

请仔细分析数据，给出合理、安全的建议。`

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: `请分析以下磁盘占用数据，并提供清理建议：\n\n${diskSummary}`
    }
  ]

  onProgress?.('正在调用 AI 分析...')

  try {
    const url = `${settings.apiUrl.replace(/\/$/, '')}/chat/completions`
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    }

    if (settings.apiUrl.includes('anthropic')) {
      headers['x-api-key'] = settings.apiKey
      headers['anthropic-version'] = '2023-06-01'
      delete headers['Authorization']
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`AI 请求失败: ${response.status} - ${errorText}`)
    }

    const data = await response.json() as ChatCompletionResponse
    const choice = data.choices[0]
    
    if (!choice) {
      throw new Error('AI 未返回有效响应')
    }

    // 处理函数调用
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      const toolCall = choice.message.tool_calls[0]
      
      if (toolCall.function.name === 'output_suggestions') {
        onProgress?.('解析 AI 建议...')
        
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const suggestions: CleanupSuggestion[] = args.suggestions || []
          
          return {
            suggestions,
            summary: `AI 分析完成，找到 ${suggestions.length} 条清理建议`,
            tokenUsage: data.usage
          }
        } catch (parseError) {
          throw new Error('解析 AI 响应失败: ' + String(parseError))
        }
      }
    }

    // 如果没有函数调用，返回文本内容
    const content = choice.message.content || ''
    return {
      suggestions: [],
      summary: content || 'AI 未提供具体建议',
      tokenUsage: data.usage
    }
  } catch (error) {
    console.error('AI 分析失败:', error)
    throw error
  }
}

// 删除文件/目录
export async function deleteItem(path: string): Promise<void> {
  try {
    await invoke('delete_item', { path })
  } catch (error) {
    throw new Error(`删除失败: ${error}`)
  }
}

// 预留：迁移文件/目录（后续接入网盘）
export async function moveItem(path: string, destination: string): Promise<void> {
  // TODO: 实现迁移逻辑
  throw new Error('迁移功能正在开发中，敬请期待')
}
