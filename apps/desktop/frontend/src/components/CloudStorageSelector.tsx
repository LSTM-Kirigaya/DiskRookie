import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  Link,
} from '@mui/material'
import { Cloud, Check, Settings } from 'lucide-react'
import { CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (selectedConfigs: CloudStorageConfig[]) => void
  availableConfigs: CloudStorageConfig[]
  fileName?: string
  preselectedConfigs?: CloudStorageConfig[]  // 预选中的配置
  onOpenSettings?: () => void  // 打开设置对话框的回调
}

// 获取提供商图标
function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const iconMap: Record<string, React.ReactNode> = {
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
    webdav: <Cloud size={size} />,
  }
  return <>{iconMap[provider] || <Cloud size={size} />}</>
}

export function CloudStorageSelector({ open, onClose, onConfirm, availableConfigs, fileName, preselectedConfigs, onOpenSettings }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  // 初始化选中状态
  useEffect(() => {
    if (open && preselectedConfigs && preselectedConfigs.length > 0) {
      const preselectedIds = new Set(
        preselectedConfigs.map(c => `${c.provider}-${c.name}`)
      )
      setSelectedIds(preselectedIds)
      setSelectAll(preselectedIds.size === availableConfigs.length)
    } else if (open) {
      // 对话框打开但没有预选时，清空选择
      setSelectedIds(new Set())
      setSelectAll(false)
    }
  }, [open, preselectedConfigs, availableConfigs])

  const handleToggle = (config: CloudStorageConfig) => {
    const configId = `${config.provider}-${config.name}`
    const newSelected = new Set(selectedIds)
    
    if (newSelected.has(configId)) {
      newSelected.delete(configId)
    } else {
      newSelected.add(configId)
    }
    
    setSelectedIds(newSelected)
    setSelectAll(newSelected.size === availableConfigs.length)
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedIds(new Set())
      setSelectAll(false)
    } else {
      const allIds = new Set(availableConfigs.map(c => `${c.provider}-${c.name}`))
      setSelectedIds(allIds)
      setSelectAll(true)
    }
  }

  const handleConfirm = () => {
    const selected = availableConfigs.filter(c => 
      selectedIds.has(`${c.provider}-${c.name}`)
    )
    onConfirm(selected)
    setSelectedIds(new Set())
    setSelectAll(false)
  }

  const handleCancel = () => {
    setSelectedIds(new Set())
    setSelectAll(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: '16px', bgcolor: 'background.paper' },
        className: 'dark:!bg-gray-800',
      }}
    >
      <DialogTitle sx={{ pb: 1 }} className="dark:text-gray-100">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Cloud size={22} className="text-blue-500" />
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '16px' }}>
            选择云存储目标
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ py: 2 }} className="dark:text-gray-100">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* 文件名提示 */}
          {fileName && (
            <Box
              sx={{
                p: 1.5,
                borderRadius: '8px',
                bgcolor: 'action.hover',
              }}
              className="dark:!bg-gray-700/50"
            >
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                将要迁移：<strong>{fileName}</strong>
              </Typography>
            </Box>
          )}

          {/* 如果没有可用的配置，显示提示和链接 */}
          {availableConfigs.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                py: 4,
              }}
            >
              <Cloud size={48} className="text-gray-400" />
              <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                尚未配置云存储服务
              </Typography>
              {onOpenSettings && (
                <Link
                  component="button"
                  onClick={() => {
                    onClose()
                    onOpenSettings()
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    cursor: 'pointer',
                    color: 'primary.main',
                    textDecoration: 'none',
                    fontSize: '14px',
                    fontWeight: 600,
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                  className="dark:!text-blue-400"
                >
                  <Settings size={16} />
                  前往设置配置云存储
                </Link>
              )}
            </Box>
          ) : (
            <>
              {/* 全选选项 */}
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: selectAll ? 'primary.main' : 'divider',
                  bgcolor: selectAll ? 'primary.main' : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                  },
                }}
                onClick={handleSelectAll}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectAll}
                      onChange={handleSelectAll}
                      sx={{
                        color: selectAll ? '#1A1A1A' : 'inherit',
                        '&.Mui-checked': {
                          color: selectAll ? '#1A1A1A' : 'primary.main',
                        },
                      }}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: selectAll ? '#1A1A1A' : 'text.primary',
                      }}
                    >
                      全部迁移（{availableConfigs.length} 个云存储）
                    </Typography>
                  }
                />
              </Box>

              {/* 云存储列表 */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {availableConfigs.map((config) => {
                  const configId = `${config.provider}-${config.name}`
                  const isSelected = selectedIds.has(configId)
                  const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === config.provider)

                  return (
                    <Box
                      key={configId}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        p: 1.5,
                        borderRadius: '10px',
                        border: '1px solid',
                        borderColor: isSelected ? 'primary.main' : 'divider',
                        bgcolor: isSelected ? 'primary.main' : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        '&:hover': {
                          borderColor: 'primary.main',
                        },
                      }}
                      onClick={() => handleToggle(config)}
                    >
                      <Checkbox
                        checked={isSelected}
                        sx={{
                          color: isSelected ? '#1A1A1A' : 'inherit',
                          '&.Mui-checked': {
                            color: isSelected ? '#1A1A1A' : 'primary.main',
                          },
                        }}
                      />
                      
                      <ProviderIcon provider={config.provider} size={24} />
                      
                      <Box sx={{ flex: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            color: isSelected ? '#1A1A1A' : 'text.primary',
                          }}
                        >
                          {config.name || providerInfo?.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: isSelected ? 'rgba(0,0,0,0.6)' : 'text.secondary',
                            fontSize: '10px',
                          }}
                        >
                          {config.targetFolder || '/'}
                        </Typography>
                      </Box>

                      {isSelected && (
                        <Check size={18} style={{ color: '#1A1A1A' }} />
                      )}
                    </Box>
                  )
                })}
              </Box>

              {/* 提示信息 */}
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px', textAlign: 'center' }}>
                文件将同时上传到所有选中的云存储
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }} className="dark:!border-gray-700">
        <Button
          onClick={handleCancel}
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
          disabled={selectedIds.size === 0 || availableConfigs.length === 0}
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
          确认迁移 ({selectedIds.size})
        </Button>
      </DialogActions>
    </Dialog>
  )
}
