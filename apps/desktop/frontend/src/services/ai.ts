// AI 服务层 - OpenAI 兼容协议

export interface AISettings {
  apiUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionChoice {
  index: number
  message: ChatMessage
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

const STORAGE_KEY = 'ai-disk-analyzer-settings'

// 加载设置
export function loadSettings(): AISettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.error('Failed to load AI settings:', e)
  }
  return DEFAULT_SETTINGS
}

// 保存设置
export function saveSettings(settings: AISettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save AI settings:', e)
  }
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

// 系统提示词
export const SYSTEM_PROMPT = `你是一个专业的磁盘分析和文件管理助手。你可以帮助用户：

1. 分析磁盘空间占用情况
2. 识别大文件和无用文件
3. 提供文件清理建议
4. 解释各种文件类型的用途
5. 提供数据备份和迁移建议

请用简洁、专业的语言回答用户问题。如果用户询问与磁盘分析无关的问题，请礼貌地将话题引导回磁盘管理相关内容。`
