// 应用设置服务
import { readJSON, writeJSON } from './storage'
import { invoke } from '@tauri-apps/api/core'

export interface AppSettings {
  promptFileCount: number  // AI Prompt 中显示的文件数量
}

// OAuth Token 响应
export interface OAuthTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

// Google 用户信息
export interface GoogleUserInfo {
  id: string
  email: string
  name: string
  picture?: string
}

// 百度网盘用户信息
export interface BaiduUserInfo {
  openid: string
  unionid?: string
  username?: string
  portrait?: string
  userdetail?: string
  birthday?: string
  sex?: string
}

// 阿里云盘用户信息
export interface AliyunUserInfo {
  user_id?: string
  user_name?: string
  nick_name?: string
  avatar?: string
  phone?: string
  email?: string
}

// Dropbox 用户信息
export interface DropboxUserInfo {
  account_id: string
  name: {
    given_name: string
    surname: string
    display_name: string
  }
  email: string
  profile_photo_url?: string
}

// 云存储服务类型
export type CloudStorageProvider = 
  | 'google_drive'
  | 'onedrive'
  | 'dropbox'
  | 'aliyun_drive'
  | 'baidu_netdisk'
  | 'webdav'

// 云存储服务配置
export interface CloudStorageConfig {
  provider: CloudStorageProvider
  name: string  // 用户自定义名称
  enabled: boolean
  
  // OAuth 相关（用于 Google Drive, OneDrive, Dropbox, 阿里云盘, 百度网盘）
  clientId?: string
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  tokenExpiry?: number
  
  // WebDAV 相关（用于坚果云等）
  webdavUrl?: string
  webdavUsername?: string
  webdavPassword?: string
  
  // 通用配置
  targetFolder?: string  // 迁移目标文件夹
}

// 云存储设置
export interface CloudStorageSettings {
  configs: CloudStorageConfig[]
  defaultProvider?: CloudStorageProvider
}

// 云存储服务提供商信息
export interface CloudStorageProviderInfo {
  id: CloudStorageProvider
  name: string
  icon: string
  description: string
  authType: 'oauth' | 'webdav' | 'api_key'
  available: boolean  // 是否已实现
  oauthUrl?: string
  docUrl?: string
}

// 支持的云存储服务列表
export const CLOUD_STORAGE_PROVIDERS: CloudStorageProviderInfo[] = [
  {
    id: 'google_drive',
    name: 'Google Drive',
    icon: 'google-drive',
    description: '谷歌云端硬盘，支持 OAuth 2.0 认证',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    docUrl: 'https://developers.google.com/drive/api/guides/about-sdk',
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    icon: 'onedrive',
    description: '微软云存储，支持 OAuth 2.0 认证',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    docUrl: 'https://learn.microsoft.com/en-us/onedrive/developer/',
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    icon: 'dropbox',
    description: 'Dropbox 云存储，支持 OAuth 2.0 认证',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://www.dropbox.com/oauth2/authorize',
    docUrl: 'https://www.dropbox.com/developers/documentation',
  },
  {
    id: 'aliyun_drive',
    name: '阿里云盘',
    icon: 'aliyun',
    description: '阿里云盘，支持 OAuth 认证',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://openapi.alipan.com/oauth/authorize',
    docUrl: 'https://www.yuque.com/aliyundrive/zpfszx',
  },
  {
    id: 'baidu_netdisk',
    name: '百度网盘',
    icon: 'baidu',
    description: '百度网盘，支持 OAuth 认证',
    authType: 'oauth',
    available: true,
    oauthUrl: 'https://openapi.baidu.com/oauth/2.0/authorize',
    docUrl: 'https://pan.baidu.com/union/doc/',
  },
  {
    id: 'webdav',
    name: 'WebDAV',
    icon: 'webdav',
    description: '通用 WebDAV 协议（支持坚果云、群晖 NAS 等）',
    authType: 'webdav',
    available: true,
    docUrl: 'https://help.jianguoyun.com/?p=2064',
  },
]

const SETTINGS_FILE = 'app-settings.json'
const CLOUD_STORAGE_SETTINGS_FILE = 'cloud-storage-settings.json'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  promptFileCount: 100,
}

export const DEFAULT_CLOUD_STORAGE_SETTINGS: CloudStorageSettings = {
  configs: [],
  defaultProvider: undefined,
}

// 加载设置
export async function loadAppSettings(): Promise<AppSettings> {
  return await readJSON<AppSettings>(SETTINGS_FILE, DEFAULT_APP_SETTINGS)
}

// 保存设置
export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await writeJSON(SETTINGS_FILE, settings)
}

// 加载云存储设置
export async function loadCloudStorageSettings(): Promise<CloudStorageSettings> {
  return await readJSON<CloudStorageSettings>(CLOUD_STORAGE_SETTINGS_FILE, DEFAULT_CLOUD_STORAGE_SETTINGS)
}

// 保存云存储设置
export async function saveCloudStorageSettings(settings: CloudStorageSettings): Promise<void> {
  await writeJSON(CLOUD_STORAGE_SETTINGS_FILE, settings)
}

// 检查是否有可用的云存储配置
export async function hasCloudStorageConfig(): Promise<boolean> {
  const settings = await loadCloudStorageSettings()
  return settings.configs.some(c => c.enabled)
}

// 获取默认的云存储配置
export async function getDefaultCloudStorageConfig(): Promise<CloudStorageConfig | null> {
  const settings = await loadCloudStorageSettings()
  if (settings.defaultProvider) {
    return settings.configs.find(c => c.provider === settings.defaultProvider && c.enabled) || null
  }
  return settings.configs.find(c => c.enabled) || null
}

// 获取所有已启用的云存储配置
export async function getEnabledCloudStorageConfigs(): Promise<CloudStorageConfig[]> {
  const settings = await loadCloudStorageSettings()
  return settings.configs.filter(c => c.enabled)
}

// ===== OAuth 相关函数 =====

// 启动 Google OAuth 授权流程（打开浏览器并等待回调）
export async function startGoogleOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_google_oauth')
}

// 刷新 Google OAuth access token
export async function refreshGoogleToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_google_token', { refreshToken })
}

// 撤销 Google OAuth 授权
export async function revokeGoogleToken(token: string): Promise<void> {
  return await invoke('revoke_google_token', { token })
}

// 获取 Google 用户信息
export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  return await invoke<GoogleUserInfo>('get_google_user_info', { accessToken })
}

// Google Drive 存储配额信息
export interface GoogleDriveQuota {
  storageQuota: {
    limit: string      // 总容量（字节）
    usage: string      // 已使用（字节）
    usageInDrive: string      // Drive 中使用（字节）
    usageInDriveTrash: string // 回收站中使用（字节）
  }
  user?: {
    displayName: string
    emailAddress: string
    photoLink?: string
  }
}

// 获取 Google Drive 存储配额
export async function getGoogleDriveQuota(accessToken: string): Promise<GoogleDriveQuota> {
  return await invoke<GoogleDriveQuota>('get_google_drive_quota', { accessToken })
}

// ===== 百度网盘 OAuth 相关函数 =====

// 启动百度网盘 OAuth 授权流程（打开浏览器并等待回调）
export async function startBaiduOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_baidu_oauth')
}

// 刷新百度网盘 OAuth access token
export async function refreshBaiduToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_baidu_token', { refreshToken })
}

// 撤销百度网盘 OAuth 授权
export async function revokeBaiduToken(token: string): Promise<void> {
  return await invoke('revoke_baidu_token', { token })
}

// 获取百度网盘用户信息
export async function getBaiduUserInfo(accessToken: string): Promise<BaiduUserInfo> {
  const userInfo = await invoke<BaiduUserInfo>('get_baidu_user_info', { accessToken })
  return userInfo
}

// 百度网盘存储配额信息
export interface BaiduNetdiskQuota {
  total?: number      // 总容量（字节）
  used?: number      // 已使用（字节）
  free?: number      // 剩余容量（字节）
}

// 获取百度网盘存储配额
export async function getBaiduNetdiskQuota(accessToken: string): Promise<BaiduNetdiskQuota> {
  return await invoke<BaiduNetdiskQuota>('get_baidu_netdisk_quota', { accessToken })
}

// ===== 阿里云盘 OAuth 相关函数 =====

// 启动阿里云盘 OAuth 授权流程（打开浏览器并等待回调）
export async function startAliyunOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_aliyun_oauth')
}

// 刷新阿里云盘 OAuth access token
export async function refreshAliyunToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_aliyun_token', { refreshToken })
}

// 撤销阿里云盘 OAuth 授权
export async function revokeAliyunToken(token: string): Promise<void> {
  return await invoke('revoke_aliyun_token', { token })
}

// 获取阿里云盘用户信息
export async function getAliyunUserInfo(accessToken: string): Promise<AliyunUserInfo> {
  const userInfo = await invoke<AliyunUserInfo>('get_aliyun_user_info', { accessToken })
  return userInfo
}

// 阿里云盘存储配额信息
export interface AliyunDriveQuota {
  total_size?: number      // 总容量（字节）
  used_size?: number      // 已使用（字节）
  available_size?: number  // 剩余容量（字节）
}

// 获取阿里云盘存储配额
export async function getAliyunDriveQuota(accessToken: string): Promise<AliyunDriveQuota> {
  return await invoke<AliyunDriveQuota>('get_aliyun_drive_quota', { accessToken })
}

// ===== Dropbox OAuth 相关函数 =====

// 启动 Dropbox OAuth 授权流程（打开浏览器并等待回调）
export async function startDropboxOAuth(): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('complete_dropbox_oauth')
}

// 刷新 Dropbox OAuth access token
export async function refreshDropboxToken(refreshToken: string): Promise<OAuthTokens> {
  return await invoke<OAuthTokens>('refresh_dropbox_token', { refreshToken })
}

// 撤销 Dropbox OAuth 授权
export async function revokeDropboxToken(token: string): Promise<void> {
  return await invoke('revoke_dropbox_token', { token })
}

// 获取 Dropbox 用户信息
export async function getDropboxUserInfo(accessToken: string): Promise<DropboxUserInfo> {
  const userInfo = await invoke<DropboxUserInfo>('get_dropbox_user_info', { accessToken })
  return userInfo
}

// Dropbox 存储配额信息
export interface DropboxQuota {
  used: number      // 已使用（字节）
  allocation: {
    '.tag': string
    allocated?: number  // 总容量（字节）
  }
}

// 获取 Dropbox 存储配额
export async function getDropboxQuota(accessToken: string): Promise<DropboxQuota> {
  return await invoke<DropboxQuota>('get_dropbox_quota', { accessToken })
}

// 检查并刷新 token（如果快过期）
export async function ensureValidToken(config: CloudStorageConfig): Promise<CloudStorageConfig> {
  if (!config.accessToken || !config.tokenExpiry) {
    throw new Error('配置中缺少 access token')
  }

  // 如果 token 在 5 分钟内过期，刷新它
  const now = Date.now()
  const expiryBuffer = 5 * 60 * 1000 // 5 minutes
  
  if (config.tokenExpiry - now < expiryBuffer) {
    if (!config.refreshToken) {
      throw new Error('Token 已过期且没有 refresh token')
    }
    
    // 根据提供商选择不同的刷新函数
    let tokens: OAuthTokens
    if (config.provider === 'baidu_netdisk') {
      tokens = await refreshBaiduToken(config.refreshToken)
    } else if (config.provider === 'aliyun_drive') {
      tokens = await refreshAliyunToken(config.refreshToken)
    } else if (config.provider === 'dropbox') {
      tokens = await refreshDropboxToken(config.refreshToken)
    } else {
      // 默认使用 Google（或其他已实现的提供商）
      tokens = await refreshGoogleToken(config.refreshToken)
    }
    
    return {
      ...config,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || config.refreshToken,
      tokenExpiry: now + tokens.expires_in * 1000,
    }
  }

  return config
}
