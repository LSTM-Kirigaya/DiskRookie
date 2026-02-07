// AI 服务层 - OpenAI 兼容协议

import { readJSON, writeJSON, readStorageFile, writeStorageFile } from './storage'

export interface AISettings {
  apiUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface FunctionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatCompletionChoice {
  index: number
  message: ChatMessage &{ tool_calls?: ToolCall[] }
  finish_reason: string
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// 默认设置
export const DEFAULT_SETTINGS: AISettings = {
  apiUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
}

// 常见模型预设
export const MODEL_PRESETS = [
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini', provider: 'OpenAI' },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'OpenAI' },
  { label: 'GPT-4 Turbo', value: 'gpt-4-turbo', provider: 'OpenAI' },
  { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo', provider: 'OpenAI' },
  { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022', provider: 'Anthropic' },
  { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229', provider: 'Anthropic' },
  { label: 'DeepSeek Chat', value: 'deepseek-chat', provider: 'DeepSeek' },
  { label: 'DeepSeek Coder', value: 'deepseek-coder', provider: 'DeepSeek' },
  { label: 'Qwen Turbo', value: 'qwen-turbo', provider: '阿里云' },
  { label: 'Qwen Plus', value: 'qwen-plus', provider: '阿里云' },
  { label: '自定义', value: 'custom', provider: '' },
]

// API URL 预设
export const API_URL_PRESETS = [
  { label: 'OpenAI', value: 'https://api.openai.com/v1' },
  { label: 'Anthropic (Claude)', value: 'https://api.anthropic.com/v1' },
  { label: 'DeepSeek', value: 'https://api.deepseek.com/v1' },
  { label: '阿里云 DashScope', value: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: 'Azure OpenAI', value: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT' },
  { label: '本地 Ollama', value: 'http://localhost:11434/v1' },
  { label: '自定义', value: 'custom' },
]

const SETTINGS_FILE = 'settings.json'
const SYSTEM_PROMPT_FILE = 'system-prompt.txt'

// 加载设置
export async function loadSettings(): Promise<AISettings> {
  return await readJSON<AISettings>(SETTINGS_FILE, DEFAULT_SETTINGS)
}

// 保存设置
export async function saveSettings(settings: AISettings): Promise<void> {
  await writeJSON(SETTINGS_FILE, settings)
}

// 加载系统提示词
export async function loadSystemPrompt(): Promise<string> {
  const prompt = await readStorageFile(SYSTEM_PROMPT_FILE)
  return prompt || SYSTEM_PROMPT
}

// 保存系统提示词
export async function saveSystemPrompt(prompt: string): Promise<void> {
  await writeStorageFile(SYSTEM_PROMPT_FILE, prompt)
}

// 发送聊天请求
export async function sendChatRequest(
  messages: ChatMessage[],
  settings: AISettings,
  onStream?: (chunk: string) => void
): Promise<string> {
  if (!settings.apiKey) {
    throw new Error('请先配置 API Key')
  }

  const url = `${settings.apiUrl.replace(/\/$/, '')}/chat/completions`
  
  const body = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: !!onStream,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.apiKey}`,
  }

  // Anthropic 需要特殊的 header
  if (settings.apiUrl.includes('anthropic')) {
    headers['x-api-key'] = settings.apiKey
    headers['anthropic-version'] = '2023-06-01'
    delete headers['Authorization']
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`)
  }

  // 流式响应处理
  if (onStream && response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            onStream(content)
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return fullContent
  }

  // 非流式响应
  const data = await response.json() as ChatCompletionResponse
  return data.choices[0]?.message?.content || ''
}

// 获取可用模型列表
export interface ModelInfo {
  id: string
  object: string
  created: number
  owned_by: string
}

export interface ModelsListResponse {
  object: string
  data: ModelInfo[]
}

export async function fetchAvailableModels(apiUrl: string, apiKey: string): Promise<ModelInfo[]> {
  if (!apiKey || !apiUrl) {
    return []
  }

  try {
    const url = `${apiUrl.replace(/\/$/, '')}/models`
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    }

    // Anthropic 不支持 models 端点，返回空数组
    if (apiUrl.includes('anthropic')) {
      return []
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      console.error('Failed to fetch models:', response.status, response.statusText)
      return []
    }

    const data = await response.json() as ModelsListResponse
    return data.data || []
  } catch (error) {
    console.error('Error fetching models:', error)
    return []
  }
}

/** 测试大模型连接：发送 Hello 并检查响应是否合理 */
export async function testConnection(settings: AISettings): Promise<{ ok: boolean; message: string }> {
  if (!settings.apiKey?.trim()) {
    return { ok: false, message: '请先填写 API Key' }
  }
  if (!settings.apiUrl?.trim()) {
    return { ok: false, message: '请先填写 API 地址' }
  }
  if (!settings.model?.trim()) {
    return { ok: false, message: '请先选择或填写模型' }
  }

  try {
    const reply = await sendChatRequest(
      [{ role: 'user', content: 'Hello' }],
      settings
    )
    const trimmed = (reply || '').trim()
    if (!trimmed) {
      return { ok: false, message: '模型返回了空响应，请检查模型与 API 配置' }
    }
    return { ok: true, message: trimmed }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message }
  }
}

// 系统提示词
export const SYSTEM_PROMPT = `你是一个专业的磁盘分析和文件管理助手。你可以帮助用户：

1. 分析磁盘空间占用情况
2. 识别大文件和无用文件
3. 提供文件清理建议
4. 解释各种文件类型的用途
5. 提供数据备份和迁移建议

请用简洁、专业的语言回答用户问题。如果用户询问与磁盘分析无关的问题，请礼貌地将话题引导回磁盘管理相关内容。`
