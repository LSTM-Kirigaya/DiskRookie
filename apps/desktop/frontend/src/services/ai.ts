// AI 服务层 - OpenAI 兼容协议

import { readJSON, writeJSON, readStorageFile, writeStorageFile } from './storage'
import { httpFetch } from './http'
import {
  KIMI_CODE_PRESET_ID,
  KIMI_CODE_API_BASE,
  ensureFreshKimiAccessToken,
  applyKimiCodingAgentHeaders,
  isKimiCodingApiUrl,
  stripBearerPrefix,
} from './kimi-oauth'

/** OpenAI 兼容 Bearer；避免 OAuth 返回已带 `Bearer ` 时重复拼接 */
export function bearerAuthorization(apiKey: string): string {
  return `Bearer ${stripBearerPrefix(apiKey)}`
}

export interface AISettings {
  apiUrl: string
  apiKey: string
  /** 按厂商/预设独立存储的 API Key，键为 getPresetId 返回的 id */
  providerApiKeys?: Record<string, string>
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
  providerApiKeys: {},
  model: 'gpt-4o-mini',
  temperature: 0,
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
  { label: 'Kimi Code', value: 'kimi-for-coding', provider: 'Kimi Code' },
  { label: '自定义', value: 'custom', provider: '' },
]

// API URL 预设（id 用于独立存储各厂商的 API Key）
export const API_URL_PRESETS = [
  { id: 'openai', label: 'OpenAI', value: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic (Claude)', value: 'https://api.anthropic.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', value: 'https://api.deepseek.com/v1' },
  { id: 'aliyun', label: '阿里云 DashScope', value: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'azure', label: 'Azure OpenAI', value: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT' },
  { id: 'ollama', label: '本地 Ollama', value: 'http://localhost:11434/v1' },
  {
    id: KIMI_CODE_PRESET_ID,
    label: 'Kimi Code (OAuth)',
    value: 'https://api.kimi.com/coding/v1',
  },
  { id: 'custom', label: '自定义', value: 'custom' },
]

/** 用户保存的自定义 API 地址预设（与 API_URL_PRESETS 结构一致） */
export interface CustomApiPresetItem {
  id: string
  label: string
  value: string
}

/** 根据 apiUrl 得到预设 id，用于读写 providerApiKeys；支持内置预设与用户自定义预设 */
export function getPresetId(apiUrl: string, customPresets: CustomApiPresetItem[] = []): string {
  if (!apiUrl || apiUrl.trim() === '') return 'custom'
  const trimmed = apiUrl.trim().replace(/\/$/, '')
  const kimiBase = KIMI_CODE_API_BASE.replace(/\/$/, '')
  if (trimmed === kimiBase) {
    return KIMI_CODE_PRESET_ID
  }
  const custom = customPresets.find(p => p.value.trim().replace(/\/$/, '') === trimmed)
  if (custom) return custom.id
  const preset = API_URL_PRESETS.find(
    p => p.value !== 'custom' && p.value.trim().replace(/\/$/, '') === trimmed
  )
  return preset ? preset.id : 'custom'
}

const SETTINGS_FILE = 'settings.json'
const SYSTEM_PROMPT_FILE = 'system-prompt.txt'

type StoredSettings = AISettings & {
  providerApiKeys?: Record<string, string>
  customApiPresets?: CustomApiPresetItem[]
}

// 加载设置（从 providerApiKeys 解析出当前 apiUrl 对应的 apiKey；兼容旧配置）
export async function loadSettings(): Promise<AISettings & { customApiPresets: CustomApiPresetItem[] }> {
  const raw = await readJSON<StoredSettings>(SETTINGS_FILE, DEFAULT_SETTINGS as StoredSettings)
  const customApiPresets = raw.customApiPresets ?? []
  let providerApiKeys = raw.providerApiKeys ?? {}

  // 兼容旧数据：若没有 providerApiKeys 但有 apiKey，按当前 apiUrl 写入对应预设
  if (Object.keys(providerApiKeys).length === 0 && (raw.apiKey ?? '').trim() !== '') {
    const presetId = getPresetId(raw.apiUrl, customApiPresets)
    providerApiKeys = { [presetId]: raw.apiKey }
  }

  const presetId = getPresetId(raw.apiUrl, customApiPresets)
  const apiKey = providerApiKeys[presetId] ?? ''

  return {
    ...raw,
    providerApiKeys,
    // apiKey 仅为当前厂商「手动填写」的 Key；Kimi Code 的 OAuth 令牌见 resolveEffectiveApiKey
    apiKey,
    customApiPresets,
  }
}

/**
 * 解析实际用于请求的凭据。
 * Kimi Coding：优先使用 OAuth（access 约 15 分钟过期，由 ensureFreshKimiAccessToken 自动 refresh）；
 * 若无令牌或刷新失败则回退手动 Key。需纯手动 Key 时可先退出 Kimi 登录。
 */
export async function resolveEffectiveApiKey(settings: AISettings): Promise<string> {
  const raw = await readJSON<StoredSettings>(SETTINGS_FILE, DEFAULT_SETTINGS as StoredSettings)
  const customApiPresets = raw.customApiPresets ?? []
  const presetId = getPresetId(settings.apiUrl, customApiPresets)
  const keys = settings.providerApiKeys ?? raw.providerApiKeys ?? {}
  const manual = keys[presetId] ?? ''

  const isKimiCoding =
    presetId === KIMI_CODE_PRESET_ID || isKimiCodingApiUrl(settings.apiUrl)

  if (isKimiCoding) {
    const oauthAccess = await ensureFreshKimiAccessToken()
    if (oauthAccess) return oauthAccess
    return manual.trim()
  }
  return manual.trim()
}

// 保存设置（会保留文件中已有的 customApiPresets）
export async function saveSettings(settings: AISettings): Promise<void> {
  const raw = await readJSON<StoredSettings>(SETTINGS_FILE, DEFAULT_SETTINGS as StoredSettings)
  await writeJSON(SETTINGS_FILE, { ...raw, ...settings, customApiPresets: raw.customApiPresets ?? [] })
}

/** 保存用户自定义 API 地址预设列表（写入 settings 文件中的 customApiPresets 字段） */
export async function saveCustomApiPresets(presets: CustomApiPresetItem[]): Promise<void> {
  const raw = await readJSON<StoredSettings>(SETTINGS_FILE, DEFAULT_SETTINGS as StoredSettings)
  await writeJSON(SETTINGS_FILE, { ...raw, customApiPresets: presets })
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
  const apiKey = await resolveEffectiveApiKey(settings)
  if (!apiKey) {
    throw new Error('请先配置 API Key，或完成 Kimi Code 账号登录')
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
    'Authorization': bearerAuthorization(apiKey),
  }

  // Anthropic 需要特殊的 header
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
      Authorization: bearerAuthorization(apiKey),
    }
    applyKimiCodingAgentHeaders(headers, apiUrl)

    // Anthropic 不支持 models 端点，返回空数组
    if (apiUrl.includes('anthropic')) {
      return []
    }

    const response = await httpFetch(url, {
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

/** 测试大模型连接：发送 Hello 并检查响应是否合理（Kimi Coding 端点走与聊天/磁盘分析相同的鉴权与请求头） */
export async function testConnection(settings: AISettings): Promise<{ ok: boolean; message: string }> {
  const raw = await readJSON<StoredSettings>(SETTINGS_FILE, DEFAULT_SETTINGS as StoredSettings)
  const presetId = getPresetId(settings.apiUrl, raw.customApiPresets ?? [])
  const isKimiCoding =
    presetId === KIMI_CODE_PRESET_ID || isKimiCodingApiUrl(settings.apiUrl)

  const apiKey = await resolveEffectiveApiKey(settings)
  if (!apiKey) {
    return {
      ok: false,
      message: isKimiCoding
        ? '请先完成 Kimi Code 登录，或填写有效 API Key'
        : '请先填写 API Key',
    }
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
