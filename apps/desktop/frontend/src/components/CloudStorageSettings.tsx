import { useState, useEffect } from 'react'
import { 
  Cloud, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle,
  ExternalLink,
  Server,
  FolderOpen,
  Settings2,
  HardDrive,
  User,
  LogOut,
} from 'lucide-react'
import {
  Box,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  IconButton,
  Chip,
  FormHelperText,
  InputAdornment,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Avatar,
} from '@mui/material'
import { open } from '@tauri-apps/plugin-shell'
import {
  loadCloudStorageSettings,
  saveCloudStorageSettings,
  CLOUD_STORAGE_PROVIDERS,
  startGoogleOAuth,
  getGoogleUserInfo,
  getGoogleDriveQuota,
  revokeGoogleToken,
  startBaiduOAuth,
  getBaiduUserInfo,
  getBaiduNetdiskQuota,
  revokeBaiduToken,
  startAliyunOAuth,
  getAliyunUserInfo,
  getAliyunDriveQuota,
  revokeAliyunToken,
  startDropboxOAuth,
  getDropboxUserInfo,
  getDropboxQuota,
  revokeDropboxToken,
  type CloudStorageSettings as CloudStorageSettingsType,
  type CloudStorageConfig,
  type CloudStorageProvider,
  type GoogleUserInfo,
  type GoogleDriveQuota,
  type BaiduUserInfo,
  type BaiduNetdiskQuota,
  type AliyunUserInfo,
  type AliyunDriveQuota,
  type DropboxUserInfo,
  type DropboxQuota,
} from '../services/settings'

// 统一的用户信息类型
interface UserInfo {
  id: string
  email: string
  name: string
  picture?: string
}

interface Props {
  onConfigured?: () => void
}

// 获取提供商图标
function ProviderIcon({ provider, size = 20 }: { provider: CloudStorageProvider; size?: number }) {
  const iconMap: Record<CloudStorageProvider, React.ReactNode> = {
    google_drive: (
        <svg viewBox="0 0 1024 1024" width={size} height={size}>
          <path d="M459.328 659.84 288.672 955.488 853.344 955.488 1024 659.84z" fill="#FFC107" />
          <path d="M975.616 576 682.688 68.512 341.344 68.512 634.272 576z" fill="#009688" />
          <path d="M292.832 152.512 0 659.84 170.688 955.488 463.52 448.16z" fill="#2196F3" />
        </svg>
      ),
      onedrive: (
        <svg viewBox="0 0 1024 1024" width={size} height={size} fill="#0078D4">
          <path d="M209.92 749.312a134.698667 134.698667 0 0 1-71.68 19.498667c-39.253333-1.237333-71.68-14.762667-97.578667-40.576-25.898667-25.642667-39.338667-58.325333-40.661333-97.365334 0.682667-36.778667 12.416-68.010667 35.413333-93.525333 23.04-25.642667 52.266667-40.448 87.808-44.8a145.749333 145.749333 0 0 1-1.792-24.149333c1.28-48.64 17.92-88.917333 49.92-120.277334 32.170667-31.36 72.533333-48 121.258667-49.28 30.677333 0 58.197333 7.04 82.517333 21.76a240.384 240.384 0 0 1 79.402667-79.317333c33.237333-19.84 70.4-30.08 111.317333-30.762667 55.082667 1.28 101.76 18.602667 141.397334 51.84 39.68 33.28 64.682667 76.16 74.922666 129.28h-12.16c-19.84 0-37.077333 2.56-52.48 8.277334a210.986667 210.986667 0 0 0-70.997333-49.877334c-26.24-11.562667-55.04-16.64-85.802667-16.64-28.16 0-55.04 4.437333-80.64 14.08-25.6 9.6-48.64 22.997333-69.12 40.917334-17.92 15.36-32.64 32.682667-44.8 52.48s-20.48 40.96-24.96 63.36c-15.36 3.2-30.08 7.637333-43.562666 13.397333-21.76 10.197333-40.277333 24.277333-54.997334 42.88-14.08 16-25.002667 34.602667-32 55.68a206.762667 206.762667 0 0 0-10.922666 65.92c0 25.6 3.882667 49.322667 12.842666 71.082667l-2.645333-3.882667z m718.848-159.872c67.242667 16.682667 98.901333 56.32 94.933333 118.656-3.925333 62.421333-40.234667 97.578667-109.013333 105.429333H371.2c-89.770667-11.818667-133.888-58.24-132.352-139.221333 1.450667-81.28 47.104-126.037333 136.96-133.76 11.733333-87.04 56.149333-140.8 133.12-161.28 77.056-21.077333 142.592 2.602667 196.778667 71.722667 18.602667-15.36 42.069333-21.802667 70.4-19.882667 28.501333 1.92 52.650667 7.722667 72.405333 18.602667 25.6 13.397333 46.08 32.64 59.562667 57.002666 13.354667 24.234667 20.437333 51.84 20.437333 81.877334l0.256 0.853333z" />
        </svg>
      ),
      dropbox: (
        <svg viewBox="0 0 1024 1024" width={size} height={size} fill="#0061FF">
          <path d="M64 556.9l264.2 173.5L512.5 577 246.8 412.7zM960 266.6L696.8 95 512.5 248.5l265.2 164.2L512.5 577l184.3 153.4L960 558.8 777.7 412.7z" />
          <path d="M513 609.8L328.2 763.3l-79.4-51.5v57.8L513 928l263.7-158.4v-57.8l-78.9 51.5zM328.2 95L64 265.1l182.8 147.6 265.7-164.2z" />
        </svg>
      ),
      aliyun_drive: (
        <svg viewBox="0 0 1024 1024" width={size} height={size} fill="#0052FF">
          <path d="M529.397333 867.744c-44.949333 0-89.984-8.149333-133.296-24.533333-94.058667-35.530667-168.661333-105.589333-210.048-197.269334-41.370667-91.658667-44.576-193.952-9.018666-288.021333l145.712 55.082667c-20.842667 55.146667-18.965333 115.114667 5.290666 168.858666s67.989333 94.8 123.130667 115.632c55.173333 20.864 115.125333 18.992 168.858667-5.274666 53.738667-24.250667 94.810667-67.989333 115.669333-123.146667l145.712 55.093333c-35.573333 94.069333-105.632 168.661333-197.285333 210.042667-49.466667 22.32-102.037333 33.536-154.725334 33.536z" />
          <path d="M772.416 603.184l-144.165333-59.024c34.597333-84.490667-5.994667-181.36-90.464-215.952-84.464-34.586667-181.322667 6-215.909334 90.453333L177.712 359.632c67.130667-163.952 255.136-242.709333 419.104-175.594667 163.962667 67.141333 242.741333 255.168 175.6 419.146667z" />
        </svg>
      ),
      baidu_netdisk: (
        <svg viewBox="0 0 1024 1024" width={size} height={size}>
          <path d="M483.84 611.84l-7.68 7.68v-7.68h7.68z" fill="#2CA6E0" />
          <path d="M476.16 619.52v-7.68c-7.68-48.64-30.72-94.72-66.56-130.56s-84.48-58.88-130.56-66.56c-30.72-5.12-64-2.56-94.72 5.12 2.56 0 7.68-2.56 10.24-2.56 25.6 0 46.08 20.48 46.08 46.08 0 20.48-12.8 38.4-30.72 43.52 48.64-10.24 99.84 2.56 135.68 38.4 56.32 56.32 58.88 148.48 2.56 207.36l128-133.12z" fill="#E50012" />
          <path d="M1024 627.2c-5.12-53.76-28.16-104.96-69.12-145.92-38.4-38.4-89.6-61.44-140.8-69.12-23.04-2.56-43.52-2.56-66.56 0 2.56-23.04 2.56-43.52 0-66.56-5.12-51.2-28.16-99.84-69.12-140.8l-7.68-7.68-5.12-5.12-5.12-5.12c-2.56 0-2.56-2.56-5.12-2.56-2.56-2.56-5.12-2.56-7.68-5.12 0 0-2.56 0-5.12-2.56 0 0-2.56 0-2.56-2.56-2.56-2.56-5.12-2.56-7.68-5.12L601.6 153.6h-5.12c-2.56 0-2.56-2.56-5.12-2.56s-2.56 0-5.12-2.56h-2.56c-2.56 0-2.56 0-5.12-2.56-79.36-23.04-171.52-2.56-232.96 61.44-56.32 56.32-79.36 133.12-66.56 207.36 48.64 7.68 94.72 30.72 130.56 66.56-40.96-40.96-53.76-102.4-35.84-153.6 0-2.56 2.56-5.12 2.56-7.68 0 0 0-2.56 2.56-2.56 0-2.56 2.56-5.12 2.56-7.68 0 0 0-2.56 2.56-2.56 0-2.56 2.56-5.12 2.56-5.12s0-2.56 2.56-2.56c2.56-2.56 5.12-5.12 5.12-10.24 2.56-5.12 5.12-7.68 10.24-12.8l5.12-5.12c58.88-58.88 151.04-58.88 209.92 0 56.32 56.32 58.88 148.48 2.56 207.36l-2.56 2.56-2.56 2.56c-58.88 56.32-151.04 56.32-207.36-2.56 35.84 35.84 58.88 84.48 66.56 130.56h7.68l-7.68 7.68L345.6 750.08l-2.56 2.56-2.56 2.56c-58.88 56.32-151.04 56.32-207.36-2.56-58.88-58.88-58.88-151.04 0-209.92 20.48-17.92 43.52-30.72 66.56-35.84 2.56 0 5.12 0 5.12-2.56 17.92-5.12 30.72-23.04 30.72-43.52 0-25.6-20.48-46.08-46.08-46.08-5.12 0-7.68 0-10.24 2.56-40.96 10.24-79.36 30.72-110.08 64-92.16 92.16-92.16 243.2 0 337.92 38.4 38.4 89.6 61.44 140.8 69.12 69.12 7.68 143.36-15.36 197.12-69.12l140.8-140.8L678.4 547.84l-2.56 2.56 2.56-2.56 7.68-7.68-7.68 7.68c58.88-56.32 151.04-56.32 207.36 2.56 25.6 25.6 38.4 56.32 43.52 89.6v2.56c2.56 23.04 23.04 38.4 46.08 38.4 25.6 0 46.08-20.48 46.08-46.08 2.56-5.12 2.56-7.68 2.56-7.68z" fill="#409EFF" />
          <path d="M883.2 824.32a46.08 46.08 0 1 0 92.16 0 46.08 46.08 0 1 0-92.16 0z" fill="#2CA6E0" />
        </svg>
      ),
    webdav: (
      <Server size={size} className="text-gray-600 dark:text-gray-400" />
    ),
  }
  return <>{iconMap[provider]}</>
}

// 支持 OAuth 的提供商
const OAUTH_PROVIDERS: CloudStorageProvider[] = ['google_drive', 'baidu_netdisk', 'aliyun_drive', 'dropbox']

// 添加/编辑配置对话框
function ConfigDialog({
  open: dialogOpen,
  onClose,
  config,
  onSave,
}: {
  open: boolean
  onClose: () => void
  config: CloudStorageConfig | null
  onSave: (config: CloudStorageConfig) => void
}) {
  const [provider, setProvider] = useState<CloudStorageProvider>('google_drive')
  const [name, setName] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUsername, setWebdavUsername] = useState('')
  const [webdavPassword, setWebdavPassword] = useState('')
  const [targetFolder, setTargetFolder] = useState('/DiskRookie')
  
  // OAuth 状态
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [tokens, setTokens] = useState<{ accessToken: string; refreshToken?: string; tokenExpiry: number } | null>(null)
  const [driveQuota, setDriveQuota] = useState<GoogleDriveQuota | BaiduNetdiskQuota | AliyunDriveQuota | DropboxQuota | null>(null)

  useEffect(() => {
    if (dialogOpen) {
      if (config) {
        setProvider(config.provider)
        setName(config.name)
        setWebdavUrl(config.webdavUrl || '')
        setWebdavUsername(config.webdavUsername || '')
        setWebdavPassword(config.webdavPassword || '')
        setTargetFolder(config.targetFolder || '/DiskRookie')
        
        // 如果已经有 token，尝试获取用户信息和存储配额
        if (config.accessToken) {
          setTokens({
            accessToken: config.accessToken,
            refreshToken: config.refreshToken,
            tokenExpiry: config.tokenExpiry || 0,
          })
          // 根据提供商获取用户信息和存储配额
          if (config.provider === 'baidu_netdisk') {
            getBaiduUserInfo(config.accessToken)
              .then(info => setUserInfo({
                id: info.openid || '',
                email: '',
                name: info.username || '百度网盘用户',
              }))
              .catch(() => setUserInfo(null))
            getBaiduNetdiskQuota(config.accessToken)
              .then(setDriveQuota)
              .catch(() => setDriveQuota(null))
          } else if (config.provider === 'aliyun_drive') {
            getAliyunUserInfo(config.accessToken)
              .then(info => setUserInfo({
                id: info.user_id || '',
                email: info.email || '',
                name: info.nick_name || info.user_name || '阿里云盘用户',
              }))
              .catch(() => setUserInfo(null))
            getAliyunDriveQuota(config.accessToken)
              .then(setDriveQuota)
              .catch(() => setDriveQuota(null))
          } else if (config.provider === 'dropbox') {
            getDropboxUserInfo(config.accessToken)
              .then(info => setUserInfo({
                id: info.account_id || '',
                email: info.email || '',
                name: info.name.display_name || `${info.name.given_name} ${info.name.surname}`,
                picture: info.profile_photo_url,
              }))
              .catch(() => setUserInfo(null))
            getDropboxQuota(config.accessToken)
              .then(setDriveQuota)
              .catch(() => setDriveQuota(null))
          } else if (config.provider === 'google_drive') {
            getGoogleUserInfo(config.accessToken)
              .then(setUserInfo)
              .catch(() => setUserInfo(null))
            getGoogleDriveQuota(config.accessToken)
              .then(setDriveQuota)
              .catch(() => setDriveQuota(null))
          }
        }
      } else {
        setProvider('google_drive')
        setName('')
        setWebdavUrl('')
        setWebdavUsername('')
        setWebdavPassword('')
        setTargetFolder('/DiskRookie')
        setUserInfo(null)
        setTokens(null)
        setDriveQuota(null)
      }
      setAuthError(null)
      setIsAuthenticating(false)
    }
  }, [config, dialogOpen])

  const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === provider)
  const isWebDAV = provider === 'webdav'
  const isOAuthProvider = OAUTH_PROVIDERS.includes(provider)

  // 处理 Google OAuth 登录
  const handleGoogleLogin = async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    
    try {
      const oauthTokens = await startGoogleOAuth()
      
      const now = Date.now()
      setTokens({
        accessToken: oauthTokens.access_token,
        refreshToken: oauthTokens.refresh_token,
        tokenExpiry: now + oauthTokens.expires_in * 1000,
      })
      
      // 获取用户信息（失败不影响授权成功）
      try {
        const info = await getGoogleUserInfo(oauthTokens.access_token)
        setUserInfo(info)
        
        // 自动设置名称
        if (!name && info.email) {
          setName(info.email)
        }
      } catch (userInfoErr) {
        console.warn('获取用户信息失败，但授权已成功:', userInfoErr)
        // 用户信息获取失败不影响授权成功，使用默认值
        setUserInfo({
          id: '',
          email: '',
          name: 'Google 用户',
        })
      }
      
      // 获取存储配额
      try {
        const quota = await getGoogleDriveQuota(oauthTokens.access_token)
        setDriveQuota(quota)
      } catch (quotaErr) {
        console.warn('获取存储配额失败:', quotaErr)
        setDriveQuota(null)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '授权失败')
    } finally {
      setIsAuthenticating(false)
    }
  }

  // 处理百度网盘 OAuth 登录
  const handleBaiduLogin = async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    
    try {
      const oauthTokens = await startBaiduOAuth()
      
      const now = Date.now()
      setTokens({
        accessToken: oauthTokens.access_token,
        refreshToken: oauthTokens.refresh_token,
        tokenExpiry: now + oauthTokens.expires_in * 1000,
      })
      
      // 获取用户信息（失败不影响授权成功）
      try {
        const info = await getBaiduUserInfo(oauthTokens.access_token)
        setUserInfo({
          id: info.openid || '',
          email: '',
          name: info.username || '百度网盘用户',
        })
        
        // 自动设置名称
        if (!name && info.username) {
          setName(info.username)
        }
      } catch (userInfoErr) {
        console.warn('获取用户信息失败，但授权已成功:', userInfoErr)
        // 用户信息获取失败不影响授权成功，使用默认值
        setUserInfo({
          id: '',
          email: '',
          name: '百度网盘用户',
        })
      }
      
      // 获取存储配额
      try {
        const quota = await getBaiduNetdiskQuota(oauthTokens.access_token)
        setDriveQuota(quota)
      } catch (quotaErr) {
        console.warn('获取存储配额失败:', quotaErr)
        setDriveQuota(null)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '授权失败')
    } finally {
      setIsAuthenticating(false)
    }
  }

  // 处理阿里云盘 OAuth 登录
  const handleAliyunLogin = async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    
    try {
      const oauthTokens = await startAliyunOAuth()
      
      const now = Date.now()
      setTokens({
        accessToken: oauthTokens.access_token,
        refreshToken: oauthTokens.refresh_token,
        tokenExpiry: now + oauthTokens.expires_in * 1000,
      })
      
      // 获取用户信息（失败不影响授权成功）
      try {
        const info = await getAliyunUserInfo(oauthTokens.access_token)
        setUserInfo({
          id: info.user_id || '',
          email: info.email || '',
          name: info.nick_name || info.user_name || '阿里云盘用户',
        })
        
        // 自动设置名称
        if (!name && (info.nick_name || info.user_name)) {
          setName(info.nick_name || info.user_name || '')
        }
      } catch (userInfoErr) {
        console.warn('获取用户信息失败，但授权已成功:', userInfoErr)
        setUserInfo({
          id: '',
          email: '',
          name: '阿里云盘用户',
        })
      }
      
      // 获取存储配额
      try {
        const quota = await getAliyunDriveQuota(oauthTokens.access_token)
        setDriveQuota(quota)
      } catch (quotaErr) {
        console.warn('获取存储配额失败:', quotaErr)
        setDriveQuota(null)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '授权失败')
    } finally {
      setIsAuthenticating(false)
    }
  }

  // 处理 Dropbox OAuth 登录
  const handleDropboxLogin = async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    
    try {
      const oauthTokens = await startDropboxOAuth()
      
      const now = Date.now()
      setTokens({
        accessToken: oauthTokens.access_token,
        refreshToken: oauthTokens.refresh_token,
        tokenExpiry: now + oauthTokens.expires_in * 1000,
      })
      
      // 获取用户信息（失败不影响授权成功）
      try {
        const info = await getDropboxUserInfo(oauthTokens.access_token)
        setUserInfo({
          id: info.account_id || '',
          email: info.email || '',
          name: info.name.display_name || `${info.name.given_name} ${info.name.surname}`,
          picture: info.profile_photo_url,
        })
        
        // 自动设置名称
        if (!name && info.name.display_name) {
          setName(info.name.display_name)
        }
      } catch (userInfoErr) {
        console.warn('获取用户信息失败，但授权已成功:', userInfoErr)
        setUserInfo({
          id: '',
          email: '',
          name: 'Dropbox 用户',
        })
      }
      
      // 获取存储配额
      try {
        const quota = await getDropboxQuota(oauthTokens.access_token)
        setDriveQuota(quota)
      } catch (quotaErr) {
        console.warn('获取存储配额失败:', quotaErr)
        setDriveQuota(null)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '授权失败')
    } finally {
      setIsAuthenticating(false)
    }
  }

  // 通用的 OAuth 登录处理函数
  const handleOAuthLogin = async () => {
    if (provider === 'baidu_netdisk') {
      await handleBaiduLogin()
    } else if (provider === 'aliyun_drive') {
      await handleAliyunLogin()
    } else if (provider === 'dropbox') {
      await handleDropboxLogin()
    } else if (provider === 'google_drive') {
      await handleGoogleLogin()
    }
  }

  // 处理断开连接
  const handleDisconnect = async () => {
    if (tokens?.accessToken) {
      try {
        if (provider === 'baidu_netdisk') {
          await revokeBaiduToken(tokens.accessToken)
        } else if (provider === 'aliyun_drive') {
          await revokeAliyunToken(tokens.accessToken)
        } else if (provider === 'dropbox') {
          await revokeDropboxToken(tokens.accessToken)
        } else if (provider === 'google_drive') {
          await revokeGoogleToken(tokens.accessToken)
        }
      } catch {
        // 忽略撤销错误
      }
    }
    setTokens(null)
    setUserInfo(null)
    setDriveQuota(null)
  }
  
  // 格式化存储容量
  const formatStorageSize = (bytes: string | number): string => {
    const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
    if (isNaN(num)) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = num
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
  }

  const handleSave = () => {
    const newConfig: CloudStorageConfig = {
      provider,
      name: name || userInfo?.email || providerInfo?.name || provider,
      enabled: true,
      targetFolder,
      ...(isWebDAV
        ? { webdavUrl, webdavUsername, webdavPassword }
        : isOAuthProvider && tokens
        ? {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenExpiry: tokens.tokenExpiry,
          }
        : {}),
    }
    onSave(newConfig)
    onClose()
  }

  const isValid = isWebDAV
    ? webdavUrl && webdavUsername && webdavPassword
    : isOAuthProvider
    ? !!tokens
    : false

  return (
    <Dialog
      open={dialogOpen}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: '16px', bgcolor: 'background.paper' },
        className: 'dark:!bg-gray-800',
      }}
    >
      <DialogTitle sx={{ pb: 1 }} className="dark:text-gray-100">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Cloud size={22} className="text-primary" />
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '16px' }}>
            {config ? '编辑云存储' : '添加云存储'}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ py: 2 }} className="dark:text-gray-100">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 选择提供商 */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
              云存储服务
            </Typography>
            <FormControl fullWidth size="small">
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as CloudStorageProvider)
                  setTokens(null)
                  setUserInfo(null)
                  setAuthError(null)
                }}
                sx={{ fontSize: '14px' }}
                disabled={!!config} // 编辑时不能更改提供商
              >
                {CLOUD_STORAGE_PROVIDERS.map((p) => (
                  <MenuItem key={p.id} value={p.id} disabled={!p.available}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <ProviderIcon provider={p.id} size={18} />
                      <span>{p.name}</span>
                      {!p.available && (
                        <Chip label="待定" size="small" sx={{ height: '18px', fontSize: '10px' }} />
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {providerInfo && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                {providerInfo.description}
              </Typography>
            )}
          </Box>

          {/* OAuth 登录区域 */}
          {isOAuthProvider && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                账号连接
              </Typography>
              
              {userInfo ? (
                // 已连接状态
                <>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      p: 2,
                      borderRadius: '12px',
                      bgcolor: 'success.main',
                      color: 'white',
                    }}
                  >
                    <Avatar 
                      src={userInfo.picture} 
                      sx={{ width: 40, height: 40 }}
                    >
                      <User size={20} />
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {userInfo.name}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.9 }}>
                        {userInfo.email}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={handleDisconnect}
                      sx={{ color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
                    >
                      <LogOut size={18} />
                    </IconButton>
                  </Box>
                  
                  {/* 存储容量显示 */}
                  {driveQuota && (
                    <Box
                      sx={{
                        mt: 1.5,
                        p: 2,
                        borderRadius: '10px',
                        bgcolor: 'action.hover',
                      }}
                      className="dark:!bg-gray-700/50"
                    >
                      {(() => {
                        // Google Drive 格式
                        if (driveQuota.storageQuota) {
                          const usage = parseInt(driveQuota.storageQuota.usage || '0')
                          const limit = parseInt(driveQuota.storageQuota.limit || '0')
                          const percentage = limit > 0 ? (usage / limit) * 100 : 0
                          
                          return (
                            <>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                  存储空间
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {formatStorageSize(usage)} / {formatStorageSize(limit)}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  width: '100%',
                                  height: 6,
                                  borderRadius: 3,
                                  bgcolor: 'divider',
                                  overflow: 'hidden',
                                }}
                              >
                                <Box
                                  sx={{
                                    width: `${Math.min(100, percentage)}%`,
                                    height: '100%',
                                    borderRadius: 3,
                                    bgcolor: percentage > 90 
                                      ? 'error.main' 
                                      : percentage > 70 
                                      ? 'warning.main' 
                                      : 'primary.main',
                                    transition: 'width 0.3s ease',
                                  }}
                                />
                              </Box>
                              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block', fontSize: '10px' }}>
                                可用: {formatStorageSize(limit - usage)}
                              </Typography>
                            </>
                          )
                        }
                        // 百度网盘格式
                        else if (driveQuota.total !== undefined && 'used' in driveQuota) {
                          const used = driveQuota.used || 0
                          const total = driveQuota.total || 0
                          const free = driveQuota.free || (total - used)
                          const percentage = total > 0 ? (used / total) * 100 : 0
                          
                          return (
                            <>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                  存储空间
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {formatStorageSize(used)} / {formatStorageSize(total)}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  width: '100%',
                                  height: 6,
                                  borderRadius: 3,
                                  bgcolor: 'divider',
                                  overflow: 'hidden',
                                }}
                              >
                                <Box
                                  sx={{
                                    width: `${Math.min(100, percentage)}%`,
                                    height: '100%',
                                    borderRadius: 3,
                                    bgcolor: percentage > 90 
                                      ? 'error.main' 
                                      : percentage > 70 
                                      ? 'warning.main' 
                                      : 'primary.main',
                                    transition: 'width 0.3s ease',
                                  }}
                                />
                              </Box>
                              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block', fontSize: '10px' }}>
                                可用: {formatStorageSize(free)}
                              </Typography>
                            </>
                          )
                        }
                        // 阿里云盘格式
                        else if ('total_size' in driveQuota || 'used_size' in driveQuota) {
                          const used = driveQuota.used_size || 0
                          const total = driveQuota.total_size || 0
                          const free = driveQuota.available_size || (total - used)
                          const percentage = total > 0 ? (used / total) * 100 : 0
                          
                          return (
                            <>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                  存储空间
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {formatStorageSize(used)} / {formatStorageSize(total)}
                                </Typography>
                              </Box>
                              <Box
                                sx={{
                                  width: '100%',
                                  height: 6,
                                  borderRadius: 3,
                                  bgcolor: 'divider',
                                  overflow: 'hidden',
                                }}
                              >
                                <Box
                                  sx={{
                                    width: `${Math.min(100, percentage)}%`,
                                    height: '100%',
                                    borderRadius: 3,
                                    bgcolor: percentage > 90 
                                      ? 'error.main' 
                                      : percentage > 70 
                                      ? 'warning.main' 
                                      : 'primary.main',
                                    transition: 'width 0.3s ease',
                                  }}
                                />
                              </Box>
                              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block', fontSize: '10px' }}>
                                可用: {formatStorageSize(free)}
                              </Typography>
                            </>
                          )
                        }
                        // Dropbox 格式
                        else if ('used' in driveQuota && 'allocation' in driveQuota) {
                          const used = driveQuota.used || 0
                          const total = driveQuota.allocation?.allocated || 0
                          const free = total > 0 ? (total - used) : 0
                          const percentage = total > 0 ? (used / total) * 100 : 0
                          
                          return (
                            <>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                                  存储空间
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  {formatStorageSize(used)} / {total > 0 ? formatStorageSize(total) : '无限'}
                                </Typography>
                              </Box>
                              {total > 0 && (
                                <>
                                  <Box
                                    sx={{
                                      width: '100%',
                                      height: 6,
                                      borderRadius: 3,
                                      bgcolor: 'divider',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    <Box
                                      sx={{
                                        width: `${Math.min(100, percentage)}%`,
                                        height: '100%',
                                        borderRadius: 3,
                                        bgcolor: percentage > 90 
                                          ? 'error.main' 
                                          : percentage > 70 
                                          ? 'warning.main' 
                                          : 'primary.main',
                                        transition: 'width 0.3s ease',
                                      }}
                                    />
                                  </Box>
                                  <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block', fontSize: '10px' }}>
                                    可用: {formatStorageSize(free)}
                                  </Typography>
                                </>
                              )}
                            </>
                          )
                        }
                        return null
                      })()}
                    </Box>
                  )}
                </>
              ) : (
                // 未连接状态
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Button
                    variant="contained"
                    onClick={handleOAuthLogin}
                    disabled={isAuthenticating}
                    startIcon={
                      isAuthenticating ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <ProviderIcon provider={provider} size={18} />
                      )
                    }
                    sx={{
                      textTransform: 'none',
                      borderRadius: '10px',
                      py: 1.5,
                      bgcolor: provider === 'google_drive' ? '#4285F4' 
                        : provider === 'baidu_netdisk' ? '#409EFF'
                        : provider === 'aliyun_drive' ? '#0052FF'
                        : provider === 'dropbox' ? '#0061FF'
                        : 'primary.main',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: 600,
                      '&:hover': {
                        bgcolor: provider === 'google_drive' ? '#3367D6' 
                          : provider === 'baidu_netdisk' ? '#2CA6E0'
                          : provider === 'aliyun_drive' ? '#0033CC'
                          : provider === 'dropbox' ? '#0047CC'
                          : 'primary.dark',
                      },
                    }}
                  >
                    {isAuthenticating ? '正在授权...' : `使用 ${providerInfo?.name} 登录`}
                  </Button>
                  
                  {authError && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1.5,
                        borderRadius: '8px',
                        bgcolor: 'error.main',
                        color: 'white',
                      }}
                    >
                      <AlertCircle size={14} />
                      <Typography variant="caption">{authError}</Typography>
                    </Box>
                  )}
                  
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                    点击按钮后将在浏览器中打开授权页面，请在浏览器中完成登录
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* WebDAV 配置 */}
          {isWebDAV && (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  WebDAV 地址
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  value={webdavUrl}
                  onChange={(e) => setWebdavUrl(e.target.value)}
                  placeholder="https://dav.jianguoyun.com/dav/"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Server size={14} className="text-slate-400" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ fontSize: '14px' }}
                />
                <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                  坚果云 WebDAV: https://dav.jianguoyun.com/dav/
                </FormHelperText>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  用户名
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  value={webdavUsername}
                  onChange={(e) => setWebdavUsername(e.target.value)}
                  placeholder="输入用户名或邮箱..."
                  sx={{ fontSize: '14px' }}
                />
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  密码 / 应用密码
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  value={webdavPassword}
                  onChange={(e) => setWebdavPassword(e.target.value)}
                  placeholder="输入密码或应用专用密码..."
                  sx={{ fontSize: '14px' }}
                />
                <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                  坚果云需要使用"应用密码"而非登录密码
                </FormHelperText>
              </Box>

              {providerInfo?.docUrl && (
                <Button
                  size="small"
                  onClick={() => open(providerInfo.docUrl!)}
                  startIcon={<ExternalLink size={14} />}
                  sx={{
                    textTransform: 'none',
                    fontSize: '12px',
                    color: 'primary.main',
                    justifyContent: 'flex-start',
                    px: 0,
                  }}
                >
                  查看 WebDAV 配置指南
                </Button>
              )}
            </>
          )}

          {/* 自定义名称（仅当已连接或 WebDAV 时显示） */}
          {(userInfo || isWebDAV) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                显示名称（可选）
              </Typography>
              <TextField
                fullWidth
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={userInfo?.email || providerInfo?.name || '输入名称...'}
                sx={{ fontSize: '14px' }}
              />
            </Box>
          )}

          {/* 目标文件夹（仅当已连接或 WebDAV 时显示） */}
          {(userInfo || isWebDAV) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                迁移目标文件夹
              </Typography>
              <TextField
                fullWidth
                size="small"
                value={targetFolder}
                onChange={(e) => setTargetFolder(e.target.value)}
                placeholder="/DiskRookie"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <FolderOpen size={14} className="text-slate-400" />
                    </InputAdornment>
                  ),
                }}
                sx={{ fontSize: '14px' }}
              />
              <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                文件将迁移到此目录下
              </FormHelperText>
            </Box>
          )}

          {/* NAS 提示（仅 WebDAV） */}
          {isWebDAV && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'start',
                gap: 1.5,
                p: 2,
                bgcolor: 'info.main',
                color: 'white',
                borderRadius: '10px',
                opacity: 0.9,
              }}
            >
              <HardDrive size={16} className="shrink-0 mt-0.5" />
              <Typography variant="body2" sx={{ fontSize: '12px' }}>
                NAS 服务（如群晖、威联通）可通过 WebDAV 协议连接，请在 NAS 中开启 WebDAV 服务
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
        <Button
          onClick={onClose}
          variant="outlined"
          size="small"
          sx={{
            textTransform: 'none',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'text.secondary',
            borderColor: 'divider',
          }}
          className="dark:!border-gray-600 dark:!text-gray-300"
        >
          取消
        </Button>
        <Button
          onClick={handleSave}
          disabled={!isValid}
          variant="contained"
          size="small"
          sx={{
            textTransform: 'none',
            borderRadius: '8px',
            bgcolor: 'primary.main',
            color: '#1A1A1A',
            fontSize: '12px',
            fontWeight: 700,
            boxShadow: 'none',
            '&:hover': {
              bgcolor: 'primary.dark',
              boxShadow: 'none',
            },
          }}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function CloudStorageSettings({ onConfigured }: Props) {
  const [settings, setSettings] = useState<CloudStorageSettingsType>({ configs: [] })
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingConfig, setEditingConfig] = useState<CloudStorageConfig | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadCloudStorageSettings().then(setSettings)
  }, [])

  const handleSaveConfig = async (config: CloudStorageConfig) => {
    const newConfigs = editingConfig
      ? settings.configs.map(c => 
          c.provider === editingConfig.provider && c.name === editingConfig.name 
            ? config 
            : c
        )
      : [...settings.configs, config]
    
    const newSettings: CloudStorageSettingsType = {
      ...settings,
      configs: newConfigs,
      defaultProvider: settings.defaultProvider || config.provider,
    }
    
    setSettings(newSettings)
    await saveCloudStorageSettings(newSettings)
    setEditingConfig(null)
    
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    
    onConfigured?.()
  }

  const handleDeleteConfig = async (config: CloudStorageConfig) => {
    const newConfigs = settings.configs.filter(
      c => !(c.provider === config.provider && c.name === config.name)
    )
    const newSettings = {
      ...settings,
      configs: newConfigs,
      defaultProvider: newConfigs.length > 0 ? newConfigs[0].provider : undefined,
    }
    setSettings(newSettings)
    await saveCloudStorageSettings(newSettings)
  }

  const handleToggleEnabled = async (config: CloudStorageConfig) => {
    const newConfigs = settings.configs.map(c =>
      c.provider === config.provider && c.name === config.name
        ? { ...c, enabled: !c.enabled }
        : c
    )
    const newSettings = { ...settings, configs: newConfigs }
    setSettings(newSettings)
    await saveCloudStorageSettings(newSettings)
  }

  const handleSetDefault = async (config: CloudStorageConfig) => {
    const newSettings = { ...settings, defaultProvider: config.provider }
    setSettings(newSettings)
    await saveCloudStorageSettings(newSettings)
  }

  const enabledCount = settings.configs.filter(c => c.enabled).length

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 标题栏 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Cloud size={18} className="text-blue-500" />
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
            数据迁移 · 云存储配置
          </Typography>
          {enabledCount > 0 && (
            <Chip
              label={`${enabledCount} 个已启用`}
              size="small"
              color="primary"
              sx={{ height: '20px', fontSize: '10px', ml: 'auto' }}
            />
          )}
          {saved && (
            <Chip
              icon={<Check size={12} />}
              label="已保存"
              size="small"
              color="success"
              sx={{ height: '20px', fontSize: '10px' }}
            />
          )}
        </Box>

        {/* 配置列表 */}
        {settings.configs.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {settings.configs.map((config, idx) => {
              const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === config.provider)
              const isDefault = settings.defaultProvider === config.provider
              
              return (
                <Box
                  key={`${config.provider}-${idx}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 1.5,
                    borderRadius: '10px',
                    border: '1px solid',
                    borderColor: config.enabled ? 'primary.main' : 'divider',
                    bgcolor: config.enabled ? 'primary.main' : 'transparent',
                    opacity: config.enabled ? 1 : 0.6,
                  }}
                  className={config.enabled ? '' : 'dark:!bg-gray-700/30'}
                >
                  <ProviderIcon provider={config.provider} size={24} />
                  
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontWeight: 600, 
                          color: config.enabled ? '#1A1A1A' : 'text.primary' 
                        }}
                      >
                        {config.name || providerInfo?.name}
                      </Typography>
                      {isDefault && (
                        <Chip
                          label="默认"
                          size="small"
                          sx={{ 
                            height: '16px', 
                            fontSize: '9px',
                            bgcolor: config.enabled ? 'rgba(0,0,0,0.15)' : 'action.hover',
                          }}
                        />
                      )}
                    </Box>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: config.enabled ? 'rgba(0,0,0,0.6)' : 'text.secondary',
                        fontSize: '10px',
                      }}
                    >
                      {config.provider === 'webdav' ? config.webdavUrl : `OAuth · ${config.targetFolder}`}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {!isDefault && config.enabled && (
                      <Button
                        size="small"
                        onClick={() => handleSetDefault(config)}
                        sx={{
                          minWidth: 'auto',
                          px: 1,
                          py: 0.25,
                          fontSize: '10px',
                          textTransform: 'none',
                          color: '#1A1A1A',
                        }}
                      >
                        设为默认
                      </Button>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingConfig(config)
                        setShowAddDialog(true)
                      }}
                      sx={{ 
                        width: 28, 
                        height: 28,
                        color: config.enabled ? '#1A1A1A' : 'text.secondary',
                      }}
                    >
                      <Settings2 size={14} />
                    </IconButton>
                    <Switch
                      size="small"
                      checked={config.enabled}
                      onChange={() => handleToggleEnabled(config)}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': {
                          color: '#1A1A1A',
                        },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                          bgcolor: 'rgba(0,0,0,0.3)',
                        },
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteConfig(config)}
                      sx={{ 
                        width: 28, 
                        height: 28,
                        color: config.enabled ? '#1A1A1A' : 'text.secondary',
                        '&:hover': { color: 'error.main' },
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Box>
                </Box>
              )
            })}
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              py: 4,
              color: 'text.secondary',
            }}
          >
            <Cloud size={32} className="opacity-30" />
            <Typography variant="body2" sx={{ fontSize: '13px' }}>
              尚未配置云存储服务
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '11px', opacity: 0.7 }}>
              添加云存储后即可将文件迁移到云端
            </Typography>
          </Box>
        )}

        {/* 添加按钮 */}
        <Button
          onClick={() => {
            setEditingConfig(null)
            setShowAddDialog(true)
          }}
          variant="outlined"
          size="small"
          startIcon={<Plus size={14} />}
          sx={{
            textTransform: 'none',
            borderRadius: '8px',
            fontSize: '12px',
            borderStyle: 'dashed',
            color: 'text.secondary',
            borderColor: 'divider',
            '&:hover': {
              borderColor: 'primary.main',
              color: 'primary.main',
              bgcolor: 'transparent',
            },
          }}
        >
          添加云存储
        </Button>

        {/* 提示信息 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'start',
            gap: 1,
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: '8px',
          }}
          className="dark:!bg-gray-700/50"
        >
          <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px', lineHeight: 1.5 }}>
            OAuth 凭据需要在对应云服务的开发者平台申请。WebDAV 支持坚果云、群晖 NAS 等服务。
          </Typography>
        </Box>
      </Box>

      {/* 添加/编辑对话框 */}
      <ConfigDialog
        open={showAddDialog}
        onClose={() => {
          setShowAddDialog(false)
          setEditingConfig(null)
        }}
        config={editingConfig}
        onSave={handleSaveConfig}
      />
    </>
  )
}
