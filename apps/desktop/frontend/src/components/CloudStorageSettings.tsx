import { useState, useEffect } from 'react'
import { 
  Cloud, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle,
  ExternalLink,
  Server,
  Key,
  FolderOpen,
  Settings2,
  HardDrive,
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
} from '@mui/material'
import { open } from '@tauri-apps/plugin-shell'
import {
  loadCloudStorageSettings,
  saveCloudStorageSettings,
  CLOUD_STORAGE_PROVIDERS,
  type CloudStorageSettings as CloudStorageSettingsType,
  type CloudStorageConfig,
  type CloudStorageProvider,
  type CloudStorageProviderInfo,
} from '../services/settings'

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
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUsername, setWebdavUsername] = useState('')
  const [webdavPassword, setWebdavPassword] = useState('')
  const [targetFolder, setTargetFolder] = useState('/DiskRookie')

  useEffect(() => {
    if (config) {
      setProvider(config.provider)
      setName(config.name)
      setClientId(config.clientId || '')
      setClientSecret(config.clientSecret || '')
      setWebdavUrl(config.webdavUrl || '')
      setWebdavUsername(config.webdavUsername || '')
      setWebdavPassword(config.webdavPassword || '')
      setTargetFolder(config.targetFolder || '/DiskRookie')
    } else {
      setProvider('google_drive')
      setName('')
      setClientId('')
      setClientSecret('')
      setWebdavUrl('')
      setWebdavUsername('')
      setWebdavPassword('')
      setTargetFolder('/DiskRookie')
    }
  }, [config, dialogOpen])

  const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === provider)
  const isWebDAV = provider === 'webdav'

  const handleSave = () => {
    const newConfig: CloudStorageConfig = {
      provider,
      name: name || providerInfo?.name || provider,
      enabled: true,
      targetFolder,
      ...(isWebDAV
        ? { webdavUrl, webdavUsername, webdavPassword }
        : { clientId, clientSecret }),
    }
    onSave(newConfig)
    onClose()
  }

  const isValid = isWebDAV
    ? webdavUrl && webdavUsername && webdavPassword
    : clientId && clientSecret

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
                onChange={(e) => setProvider(e.target.value as CloudStorageProvider)}
                sx={{ fontSize: '14px' }}
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

          {/* 自定义名称 */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
              显示名称（可选）
            </Typography>
            <TextField
              fullWidth
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={providerInfo?.name || '输入名称...'}
              sx={{ fontSize: '14px' }}
            />
          </Box>

          {/* OAuth 配置 */}
          {!isWebDAV && (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  Client ID
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="输入 OAuth Client ID..."
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Key size={14} className="text-slate-400" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ fontSize: '14px' }}
                />
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  Client Secret
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="输入 OAuth Client Secret..."
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Key size={14} className="text-slate-400" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ fontSize: '14px' }}
                />
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
                    px: 1,
                  }}
                >
                  查看如何获取 OAuth 凭据
                </Button>
              )}
            </>
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

          {/* 目标文件夹 */}
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

          {/* NAS 提示 */}
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
    
    const newSettings = {
      ...settings,
      configs: newConfigs,
      defaultProvider: newSettings.defaultProvider || config.provider,
    }
    
    setSettings({ ...settings, configs: newConfigs, defaultProvider: settings.defaultProvider || config.provider })
    await saveCloudStorageSettings({ ...settings, configs: newConfigs, defaultProvider: settings.defaultProvider || config.provider })
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
