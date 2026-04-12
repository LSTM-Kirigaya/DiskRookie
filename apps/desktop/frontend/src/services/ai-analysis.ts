// AI 磁盘分析服务 - Function Calling 实现

import { invoke } from '@tauri-apps/api/core'
import {
  loadSettings,
  resolveEffectiveApiKey,
  bearerAuthorization,
  type ChatMessage,
  type FunctionTool,
  type ChatCompletionResponse,
} from './ai'
import { applyKimiCodingAgentHeaders, stripBearerPrefix } from './kimi-oauth'
import { httpFetch } from './http'
import i18n from '../i18n'

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
  const settings = await loadSettings()
  const apiKey = await resolveEffectiveApiKey(settings)
  if (!apiKey) {
    throw new Error('请先在设置中配置 API Key，或完成 Kimi Code 登录')
  }

  const systemInfo = await getSystemInfo()
  
  // 获取当前语言
  const currentLanguage = i18n.language || 'zh'
  const languageMap: Record<string, string> = {
    'zh': '简体中文',
    'en': 'English',
    'ja': '日本語'
  }
  const languageName = languageMap[currentLanguage] || '简体中文'
  
  // 根据语言构建不同的 systemPrompt
  const systemPrompt = currentLanguage === 'zh' 
    ? `你是一个专业的磁盘空间分析和清理助手。

当前系统信息：
- 操作系统：${systemInfo.os}
- 默认 Shell：${systemInfo.shell}
- 用户界面语言：${languageName}

重要：请使用 ${languageName} 回复用户，所有输出内容（包括 summary 和建议说明）都必须使用 ${languageName}。

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

重要：占比判断
- 在分析前，先计算建议删除和迁移的文件大小占总磁盘大小的百分比
- 如果删除建议的总大小占比小于 5%，且迁移建议的总大小占比小于 10%，说明当前磁盘使用健康
- 此时应该在 summary 中明确告诉用户："当前磁盘空间使用良好，删除占比 X.X%，迁移占比 X.X%，建议无需清理"
- 如果有足够的清理空间（删除 ≥ 5% 或迁移 ≥ 10%），则正常输出清理建议

请仔细分析数据，给出合理、安全的建议。所有回复必须使用 ${languageName}。`
    : currentLanguage === 'en'
    ? `You are a professional disk space analysis and cleanup assistant.

Current System Information:
- Operating System: ${systemInfo.os}
- Default Shell: ${systemInfo.shell}
- User Interface Language: ${languageName}

Important: Please respond to the user in ${languageName}. All output content (including summary and suggestion descriptions) must be in ${languageName}.

Your Tasks:
1. Analyze the disk usage data provided by the user
2. Identify files/directories that can be safely deleted or migrated
3. Reference common disk cleanup practices for ${systemInfo.os} systems
4. Use the output_suggestions function to output cleanup suggestions

Cleanup Suggestion Principles:
- Temporary files and cache files can be suggested for deletion
- Log files and old backups can be suggested for deletion or migration
- Large media files and archive files can be suggested for migration
- System files and program files must never be suggested for deletion
- Important configuration files cannot be suggested for deletion

Important: Percentage Judgment
- Before analysis, calculate the percentage of suggested deletion and migration file sizes relative to total disk size
- If deletion suggestions total less than 5% and migration suggestions total less than 10%, the current disk usage is healthy
- In this case, clearly tell the user in the summary: "Current disk space usage is good, deletion ratio X.X%, migration ratio X.X%, no cleanup recommended"
- If there is sufficient cleanup space (deletion ≥ 5% or migration ≥ 10%), output cleanup suggestions normally

Please carefully analyze the data and provide reasonable, safe suggestions. All responses must be in ${languageName}.`
    : `あなたは専門的なディスク容量分析とクリーンアップアシスタントです。

現在のシステム情報：
- オペレーティングシステム：${systemInfo.os}
- デフォルトシェル：${systemInfo.shell}
- ユーザーインターフェース言語：${languageName}

重要：${languageName}でユーザーに返信してください。すべての出力内容（要約と提案説明を含む）は${languageName}で行う必要があります。

あなたのタスク：
1. ユーザーが提供したディスク使用量データを分析する
2. 安全に削除または移行できるファイル/ディレクトリを識別する
3. ${systemInfo.os}システムの一般的なディスククリーンアップの経験を参照する
4. output_suggestions関数を使用してクリーンアップ提案を出力する

クリーンアップ提案の原則：
- 一時ファイル、キャッシュファイルは削除を提案できる
- ログファイル、古いバックアップは削除または移行を提案できる
- 大きなメディアファイル、アーカイブファイルは移行を提案できる
- システムファイル、プログラムファイルは絶対に削除を提案してはいけない
- 重要な設定ファイルは削除を提案できない

重要：割合の判断
- 分析前に、提案された削除と移行のファイルサイズが総ディスクサイズに占める割合を計算する
- 削除提案の合計サイズが5%未満で、移行提案の合計サイズが10%未満の場合、現在のディスク使用状況は良好です
- この場合、要約でユーザーに明確に伝える：「現在のディスク容量使用状況は良好です。削除割合X.X%、移行割合X.X%、クリーンアップは不要です」
- 十分なクリーンアップスペースがある場合（削除≥5%または移行≥10%）、通常通りクリーンアップ提案を出力する

データを注意深く分析し、合理的で安全な提案を提供してください。すべての返信は${languageName}で行う必要があります。`

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: currentLanguage === 'zh'
        ? `请分析以下磁盘占用数据，并使用${languageName}提供清理建议：\n\n${diskSummary}`
        : currentLanguage === 'en'
        ? `Please analyze the following disk usage data and provide cleanup suggestions in ${languageName}:\n\n${diskSummary}`
        : `以下のディスク使用量データを分析し、${languageName}でクリーンアップ提案を提供してください：\n\n${diskSummary}`
    }
  ]

  onProgress?.(i18n.t('aiAnalysis.calling'))

  try {
    const url = `${settings.apiUrl.replace(/\/$/, '')}/chat/completions`
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: bearerAuthorization(apiKey),
    }

    if (settings.apiUrl.includes('anthropic')) {
      headers['x-api-key'] = stripBearerPrefix(apiKey)
      headers['anthropic-version'] = '2023-06-01'
      delete headers['Authorization']
    } else {
      applyKimiCodingAgentHeaders(headers, settings.apiUrl)
    }

    const response = await httpFetch(url, {
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
        onProgress?.(i18n.t('aiAnalysis.parsing'))
        
        try {
          const args = JSON.parse(toolCall.function.arguments)
          const suggestions: CleanupSuggestion[] = args.suggestions || []
          
          return {
            suggestions,
            summary: i18n.t('aiAnalysis.foundSuggestions', { count: suggestions.length }),
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
export async function moveItem(_path: string, _destination: string): Promise<void> {
  // TODO: 实现迁移逻辑
  throw new Error('迁移功能正在开发中，敬请期待')
}
