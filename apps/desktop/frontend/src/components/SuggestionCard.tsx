import { useState, useEffect } from 'react'
import { Trash2, MoveRight, File, FolderOpen, Clock, HardDrive, Check, X, Info, Cloud, Settings } from 'lucide-react'
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, Box, Chip, Checkbox, FormControlLabel, TextField, CircularProgress, LinearProgress, Snackbar, Alert } from '@mui/material'
import type { CleanupSuggestion } from '../services/ai-analysis'
import { readStorageFile } from '../services/storage'
import { hasCloudStorageConfig, getDefaultCloudStorageConfig, getEnabledCloudStorageConfigs, CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'
import { CloudStorageSelector } from './CloudStorageSelector'

const SKIP_CONFIRM_KEY = 'skip-action-confirm'

interface Props {
  suggestion: CleanupSuggestion
  onDelete: (path: string) => Promise<void>
  onMove: (path: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => Promise<void>
  onOpenCloudSettings?: () => void
  selected?: boolean
  onSelectChange?: (path: string, selected: boolean) => void
}

// 解析文件大小字符串为字节数
function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i)
  if (!match) return 0
  
  const value = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  
  const units: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  }
  
  return Math.floor(value * (units[unit] || 1))
}

export function SuggestionCard({ suggestion, onDelete, onMove, onOpenCloudSettings, selected = false, onSelectChange }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [skipConfirm, setSkipConfirm] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [hasCloudConfig, setHasCloudConfig] = useState(false)
  const [cloudConfigName, setCloudConfigName] = useState<string | null>(null)
  const [showNoConfigDialog, setShowNoConfigDialog] = useState(false)
  const [showCloudSelector, setShowCloudSelector] = useState(false)
  const [availableConfigs, setAvailableConfigs] = useState<CloudStorageConfig[]>([])
  const [selectedConfigs, setSelectedConfigs] = useState<CloudStorageConfig[]>([])
  const [cloudTargetPath, setCloudTargetPath] = useState('/备份')
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    readStorageFile(SKIP_CONFIRM_KEY).then(val => {
      setSkipConfirm(val === 'true')
    })
  }, [])

  // 检查云存储配置
  useEffect(() => {
    const checkCloudConfig = async () => {
      const hasConfig = await hasCloudStorageConfig()
      setHasCloudConfig(hasConfig)
      
      if (hasConfig) {
        const config = await getDefaultCloudStorageConfig()
        if (config) {
          const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === config.provider)
          setCloudConfigName(config.name || providerInfo?.name || config.provider)
        }
      }
    }
    checkCloudConfig()
  }, [])

  const handleActionClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    // 如果是迁移操作，先检查云存储配置
    if (suggestion.action === 'move') {
      const configs = await getEnabledCloudStorageConfigs()
      
      if (configs.length === 0) {
        setShowNoConfigDialog(true)
        return
      }
      
      // 如果有多个云存储配置，显示选择对话框
      if (configs.length > 1) {
        setAvailableConfigs(configs)
        setShowCloudSelector(true)
        return
      }
      
      // 如果只有一个，直接使用
      setSelectedConfigs(configs)
    }
    
    if (skipConfirm) {
      await executeAction()
    } else {
      setShowConfirm(true)
    }
  }

  const executeAction = async () => {
    setLoading(true)
    setError('')
    
    try {
      if (suggestion.action === 'delete') {
        await onDelete(suggestion.path)
      } else {
        await onMove(
          suggestion.path, 
          selectedConfigs.length > 0 ? selectedConfigs : undefined,
          cloudTargetPath,
          parseSizeToBytes(suggestion.size)
        )
      }
      // 成功后直接关闭对话框，不显示成功界面
      setShowConfirm(false)
      setSuccess(true)
    } catch (err) {
      // 失败时显示 toast
      setToastMessage(String(err))
      setToastOpen(true)
      setShowConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  const handleCloudStorageSelected = (configs: CloudStorageConfig[]) => {
    setSelectedConfigs(configs)
    setShowCloudSelector(false)
    
    // 选择完成后，继续执行确认流程
    if (skipConfirm) {
      executeAction()
    } else {
      setShowConfirm(true)
    }
  }

  const handleConfirm = async () => {
    // "本次不再提醒"：只在当前会话有效，不持久化
    if (dontAskAgain) {
      setSkipConfirm(true)
    }
    await executeAction()
  }

  const ActionIcon = suggestion.action === 'delete' ? Trash2 : MoveRight
  const TypeIcon = suggestion.type === 'file' ? File : FolderOpen
  const actionColor = suggestion.action === 'delete' ? '#ef4444' : '#3b82f6'
  const actionLabel = suggestion.action === 'delete' ? '删除' : '迁移'
  const fileName = suggestion.path.split(/[/\\]/).pop() || suggestion.path

  return (
    <>
      {/* 简化的卡片 */}
      <div className="bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl p-3 hover:border-slate-300 dark:hover:border-gray-600 transition-all">
        <div className="flex items-center gap-3">
          {/* 左侧复选框 */}
          {onSelectChange && (
            <Checkbox
              size="small"
              checked={selected}
              onChange={(e) => {
                e.stopPropagation()
                onSelectChange(suggestion.path, e.target.checked)
              }}
              onClick={(e) => e.stopPropagation()}
              sx={{
                p: 0.5,
                color: 'text.secondary',
                '&.Mui-checked': {
                  color: actionColor,
                },
              }}
            />
          )}
          {/* 左侧图标 */}
          <div 
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${actionColor}15` }}
          >
            <TypeIcon size={18} style={{ color: actionColor }} />
          </div>
          
          {/* 中间信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 dark:text-gray-200 truncate">
                {fileName}
              </span>
              <Chip 
                label={suggestion.size}
                size="small"
                sx={{ 
                  height: '18px',
                  fontSize: '10px',
                  fontWeight: 600,
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                }}
                className="dark:!bg-gray-700 dark:!text-gray-300"
              />
            </div>
            <p className="text-xs text-slate-500 dark:text-gray-400 truncate mt-0.5">
              {suggestion.message}
            </p>
          </div>
          
          {/* 右侧按钮组 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setShowDetail(true)
              }}
              sx={{
                minWidth: 'auto',
                px: 1.5,
                py: 0.5,
                fontSize: '11px',
                textTransform: 'none',
                color: 'text.secondary',
                borderRadius: '6px',
                '&:hover': {
                  bgcolor: 'action.hover',
                }
              }}
            >
              <Info size={14} />
            </Button>
            <Button
              size="small"
              onClick={handleActionClick}
              disabled={loading}
              sx={{
                minWidth: 'auto',
                px: 1.5,
                py: 0.5,
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: actionColor,
                color: 'white',
                borderRadius: '6px',
                '&:hover': {
                  bgcolor: actionColor,
                  filter: 'brightness(0.9)',
                },
                '&.Mui-disabled': {
                  bgcolor: 'action.disabledBackground',
                  color: 'text.disabled',
                }
              }}
            >
              {loading ? '...' : actionLabel}
            </Button>
          </div>
        </div>
      </div>

      {/* 确认对话框 */}
      <Dialog 
        open={showConfirm} 
        onClose={() => !loading && setShowConfirm(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            bgcolor: 'background.paper',
          },
          className: 'dark:!bg-gray-800'
        }}
      >
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                bgcolor: `${actionColor}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActionIcon size={20} style={{ color: actionColor }} />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
              确认{actionLabel}
            </Typography>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          {loading && suggestion.action === 'move' ? (
            // 上传进度显示
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 3 }}>
              <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                <CircularProgress size={60} thickness={4} />
                <Box
                  sx={{
                    top: 0,
                    left: 0,
                    bottom: 0,
                    right: 0,
                    position: 'absolute',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Cloud size={24} className="text-primary" />
                </Box>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                正在上传到云存储...
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                {selectedConfigs.length === 1 
                  ? `上传到 ${selectedConfigs[0].name}` 
                  : `上传到 ${selectedConfigs.length} 个云存储`}
              </Typography>
              <LinearProgress 
                sx={{ 
                  width: '100%', 
                  borderRadius: 2,
                  height: 6,
                  bgcolor: 'action.hover',
                }} 
              />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1.5, 
                  p: 2, 
                  bgcolor: 'action.hover', 
                  borderRadius: '10px' 
                }}
                className="dark:!bg-gray-700"
              >
                <TypeIcon size={16} className="text-slate-500 dark:text-gray-400 shrink-0" />
                <Typography 
                  variant="body2" 
                  sx={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}
                  className="dark:text-gray-300"
                >
                  {suggestion.path}
                </Typography>
              </Box>

              {suggestion.action === 'move' && selectedConfigs.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'start', 
                      gap: 1, 
                      p: 1.5, 
                      bgcolor: 'primary.main', 
                      color: '#1A1A1A', 
                      borderRadius: '8px',
                    }}
                  >
                    <Cloud size={14} className="shrink-0 mt-0.5" />
                    <Typography variant="caption" sx={{ fontSize: '11px' }}>
                      将迁移到：{selectedConfigs.length === 1 ? selectedConfigs[0].name : `${selectedConfigs.length} 个云存储`}
                    </Typography>
                  </Box>
                  
                  <TextField
                    fullWidth
                    size="small"
                    label="云存储目标路径"
                    value={cloudTargetPath}
                    onChange={(e) => setCloudTargetPath(e.target.value)}
                    placeholder="例如：/备份/文档"
                    helperText="文件将上传到云存储的此路径下"
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: '8px',
                        fontSize: '12px',
                        mt: 1,
                      },
                      '& .MuiInputLabel-root': {
                        fontSize: '12px',
                        mt: 1,
                      },
                      '& .MuiFormHelperText-root': {
                        fontSize: '10px',
                        mt: 0.5,
                      }
                    }}
                  />
                </Box>
              )}

              {error && (
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'start', 
                    gap: 1, 
                    p: 1.5, 
                    bgcolor: 'error.main', 
                    color: 'white', 
                    borderRadius: '8px' 
                  }}
                >
                  <X size={14} className="shrink-0 mt-0.5" />
                  <Typography variant="caption" sx={{ fontSize: '11px' }}>
                    {error}
                  </Typography>
                </Box>
              )}

              <FormControlLabel
                control={
                  <Checkbox 
                    size="small" 
                    checked={dontAskAgain}
                    onChange={(e) => setDontAskAgain(e.target.checked)}
                    sx={{ 
                      p: 0.5,
                      '&.Mui-checked': {
                        color: 'primary.main',
                      }
                    }}
                  />
                }
                label={
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }} className="dark:text-gray-400">
                    本次不再提醒
                  </Typography>
                }
                sx={{ ml: 0, mt: 1 }}
              />
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button 
            onClick={() => setShowConfirm(false)} 
            disabled={loading}
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
            onClick={handleConfirm}
            disabled={loading}
            variant="contained"
            size="small"
            sx={{
              textTransform: 'none',
              borderRadius: '8px',
              bgcolor: actionColor,
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              boxShadow: 'none',
              '&:hover': {
                bgcolor: actionColor,
                filter: 'brightness(0.9)',
                boxShadow: 'none',
              },
              '&.Mui-disabled': {
                bgcolor: 'action.disabledBackground'
              }
            }}
          >
            {loading ? '处理中...' : `确认${actionLabel}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 详情对话框 */}
      <Dialog 
        open={showDetail} 
        onClose={() => setShowDetail(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            bgcolor: 'background.paper',
          },
          className: 'dark:!bg-gray-800'
        }}
      >
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '12px',
                bgcolor: `${actionColor}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActionIcon size={22} style={{ color: actionColor }} />
            </Box>
            <Box>
              <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
                {actionLabel}建议详情
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }} className="dark:text-gray-400">
                {suggestion.type === 'file' ? '文件' : '目录'}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        
        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* 路径 */}
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }} className="dark:text-gray-400">
                路径
              </Typography>
              <Box 
                sx={{ 
                  mt: 0.75,
                  p: 1.5, 
                  bgcolor: 'action.hover', 
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
                className="dark:!bg-gray-700/50 dark:!border-gray-600"
              >
                <Typography 
                  variant="body2" 
                  sx={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', lineHeight: 1.5 }}
                  className="dark:text-gray-200"
                >
                  {suggestion.path}
                </Typography>
              </Box>
            </Box>

            {/* 信息网格 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <Box 
                sx={{ 
                  p: 2, 
                  bgcolor: 'action.hover', 
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
                className="dark:!bg-gray-700/50 dark:!border-gray-600"
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <HardDrive size={14} className="text-slate-400 dark:text-gray-500" />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px' }} className="dark:text-gray-400">
                    大小
                  </Typography>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 700, fontSize: '18px' }} className="dark:text-gray-100">
                  {suggestion.size}
                </Typography>
              </Box>

              <Box 
                sx={{ 
                  p: 2, 
                  bgcolor: 'action.hover', 
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
                className="dark:!bg-gray-700/50 dark:!border-gray-600"
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Clock size={14} className="text-slate-400 dark:text-gray-500" />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '10px' }} className="dark:text-gray-400">
                    修改时间
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '13px' }} className="dark:text-gray-100">
                  {suggestion.updateTime}
                </Typography>
              </Box>
            </Box>

            {/* 建议说明 */}
            <Box 
              sx={{ 
                p: 2, 
                bgcolor: 'primary.main', 
                borderRadius: '10px' 
              }}
            >
              <Typography variant="caption" sx={{ color: 'rgba(0,0,0,0.6)', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                建议说明
              </Typography>
              <Typography variant="body2" sx={{ color: '#1A1A1A', fontSize: '13px', lineHeight: 1.6, mt: 0.5, fontWeight: 500 }}>
                {suggestion.message}
              </Typography>
            </Box>

            {suggestion.action === 'move' && (
              hasCloudConfig ? (
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'start', 
                    gap: 1.5, 
                    p: 2, 
                    bgcolor: 'primary.main', 
                    color: '#1A1A1A', 
                    borderRadius: '10px', 
                  }}
                >
                  <Cloud size={16} className="shrink-0 mt-0.5" />
                  <Box>
                    <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 600 }}>
                      将迁移到：{cloudConfigName}
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: '11px', opacity: 0.8 }}>
                      文件将被移动到云存储
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'start', 
                    gap: 1.5, 
                    p: 2, 
                    bgcolor: 'warning.main', 
                    color: '#1A1A1A', 
                    borderRadius: '10px', 
                  }}
                >
                  <Settings size={16} className="shrink-0 mt-0.5" />
                  <Box>
                    <Typography variant="body2" sx={{ fontSize: '12px', fontWeight: 600 }}>
                      尚未配置云存储
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: '11px', opacity: 0.8 }}>
                      请先在设置中配置网盘服务
                    </Typography>
                  </Box>
                </Box>
              )
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button 
            onClick={() => setShowDetail(false)} 
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
            关闭
          </Button>
          <Button
            onClick={handleActionClick}
            variant="contained"
            size="small"
            sx={{
              textTransform: 'none',
              borderRadius: '8px',
              bgcolor: actionColor,
              color: 'white',
              fontSize: '12px',
              fontWeight: 700,
              boxShadow: 'none',
              '&:hover': {
                bgcolor: actionColor,
                filter: 'brightness(0.9)',
                boxShadow: 'none',
              },
              '&.Mui-disabled': {
                bgcolor: 'action.disabledBackground'
              }
            }}
          >
            {actionLabel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 未配置云存储提示对话框 */}
      <Dialog
        open={showNoConfigDialog}
        onClose={() => setShowNoConfigDialog(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            bgcolor: 'background.paper',
          },
          className: 'dark:!bg-gray-800'
        }}
      >
        <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '12px',
                bgcolor: 'warning.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cloud size={22} className="text-white" />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
              配置云存储
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ py: 2, px: 3 }} className="dark:text-gray-100">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.6 }} className="dark:text-gray-300">
              迁移功能需要先配置云存储服务。支持以下网盘：
            </Typography>
            
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label="Google Drive" size="small" sx={{ fontSize: '11px' }} />
              <Chip label="OneDrive" size="small" sx={{ fontSize: '11px' }} />
              <Chip label="Dropbox" size="small" sx={{ fontSize: '11px' }} />
              <Chip label="阿里云盘" size="small" sx={{ fontSize: '11px' }} />
              <Chip label="百度网盘" size="small" sx={{ fontSize: '11px' }} />
              <Chip label="WebDAV" size="small" sx={{ fontSize: '11px' }} />
            </Box>

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
                NAS 用户可通过 WebDAV 协议连接
              </Typography>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
          <Button
            onClick={() => setShowNoConfigDialog(false)}
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
            稍后
          </Button>
          <Button
            onClick={() => {
              setShowNoConfigDialog(false)
              onOpenCloudSettings?.()
            }}
            variant="contained"
            size="small"
            startIcon={<Settings size={14} />}
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
            去配置
          </Button>
        </DialogActions>
      </Dialog>

      {/* 云存储选择对话框 */}
      <CloudStorageSelector
        open={showCloudSelector}
        onClose={() => setShowCloudSelector(false)}
        onConfirm={handleCloudStorageSelected}
        availableConfigs={availableConfigs}
        fileName={suggestion.path.split('/').pop() || suggestion.path}
      />

      {/* 错误提示 Toast */}
      <Snackbar
        open={toastOpen}
        autoHideDuration={5000}
        onClose={() => setToastOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setToastOpen(false)} 
          severity="error" 
          variant="filled"
          sx={{ 
            width: '100%',
            borderRadius: '10px',
          }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>
    </>
  )
}
