/**
 * Kimi Code — Device Code OAuth 令牌持久化（与 Kimi CLI 同源 auth.kimi.com）。
 * Access token 存于本地存储文件，不写入 settings.json 的 API Key 字段。
 */
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { readStorageFile, writeStorageFile, deleteStorageFile } from './storage'

export const KIMI_CODE_OAUTH_FILE = 'kimi-code-oauth.json'

export const KIMI_CODE_PRESET_ID = 'kimi-code'
export const KIMI_CODE_API_BASE = 'https://api.kimi.com/coding/v1'

/**
 * Kimi Coding API（chat/models）会校验客户端为受认可的 Coding Agent。
 * 与 Kimi CLI 一致使用 KimiCLI User-Agent，否则返回 403 access_terminated_error。
 */
export const KIMI_CODE_HTTP_USER_AGENT = 'KimiCLI/1.0.0'

export function isKimiCodingApiUrl(apiUrl: string): boolean {
  const raw = apiUrl.trim().replace(/\/$/, '')
  if (!raw) return false
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    return u.hostname === 'api.kimi.com' && u.pathname.includes('/coding')
  } catch {
    return false
  }
}

/** 对 api.kimi.com/coding 的请求必须带此头（与 OAuth 阶段 Rust 侧行为一致） */
export function applyKimiCodingAgentHeaders(
  headers: Record<string, string>,
  apiUrl: string
): void {
  if (isKimiCodingApiUrl(apiUrl)) {
    headers['User-Agent'] = KIMI_CODE_HTTP_USER_AGENT
  }
}

export interface KimiOAuthToken {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  obtained_at_ms?: number
}

export interface KimiPollTokenResult {
  status: number
  body: {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    error?: string
    error_description?: string
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function loadKimiOAuthToken(): Promise<KimiOAuthToken | null> {
  try {
    const content = await readStorageFile(KIMI_CODE_OAUTH_FILE)
    if (!content.trim()) return null
    const parsed = JSON.parse(content) as KimiOAuthToken
    if (!parsed?.access_token?.trim()) return null
    return parsed
  } catch {
    return null
  }
}

export async function saveKimiOAuthToken(token: KimiOAuthToken): Promise<void> {
  await writeStorageFile(
    KIMI_CODE_OAUTH_FILE,
    JSON.stringify({ ...token, obtained_at_ms: Date.now() }, null, 2)
  )
}

export async function clearKimiOAuthToken(): Promise<void> {
  try {
    await deleteStorageFile(KIMI_CODE_OAUTH_FILE)
  } catch {
    // ignore
  }
}

interface DeviceAuthJson {
  user_code?: string
  device_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

/**
 * 完整 Device Code 流程：请求授权 → 打开浏览器 → 轮询直到成功或超时。
 */
export async function runKimiDeviceLogin(options?: {
  openBrowser?: boolean
  onStatus?: (msg: string) => void
}): Promise<void> {
  const openBrowser = options?.openBrowser !== false
  const raw = await invoke<DeviceAuthJson>('kimi_code_request_device')
  const deviceCode = raw.device_code
  if (!deviceCode) {
    throw new Error('设备授权响应缺少 device_code')
  }
  const intervalMs = Math.max((raw.interval ?? 5) * 1000, 1000)
  const expiresMs = Math.max((raw.expires_in ?? 900) * 1000, intervalMs * 2)
  const deadline = Date.now() + expiresMs

  const verificationUrl = raw.verification_uri_complete || raw.verification_uri
  if (verificationUrl && openBrowser) {
    try {
      await open(verificationUrl)
    } catch {
      // 用户可手动打开
    }
  }

  if (raw.user_code) {
    options?.onStatus?.(`user_code:${raw.user_code}`)
  }

  while (Date.now() < deadline) {
    const result = await invoke<KimiPollTokenResult>('kimi_code_poll_token', { deviceCode })
    const { status, body } = result
    if (status === 200 && body?.access_token) {
      await saveKimiOAuthToken({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in: body.expires_in,
        token_type: body.token_type ?? 'Bearer',
      })
      return
    }
    const err = body?.error ?? ''
    if (err === 'expired_token') {
      throw new Error('device_expired')
    }
    if (err === 'authorization_pending' || err === 'slow_down' || err === '') {
      await sleep(err === 'slow_down' ? intervalMs * 2 : intervalMs)
      continue
    }
    const desc = body?.error_description ?? err
    throw new Error(desc || 'Kimi OAuth 失败')
  }
  throw new Error('authorization_timeout')
}
