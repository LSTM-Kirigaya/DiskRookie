import { useState } from 'react'
import { Trash2, MoveRight, File, FolderOpen, Clock, HardDrive, AlertCircle, Check, X } from 'lucide-react'
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Typography, Box, Chip } from '@mui/material'
import type { CleanupSuggestion } from '../services/ai-analysis'

interface Props {
  suggestion: CleanupSuggestion
  onDelete: (path: string) => Promise<void>
  onMove: (path: string) => Promise<void>
}

export function SuggestionCard({ suggestion, onDelete, onMove }: Props) {
  const [showDetail, setShowDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleAction = async () => {
    setLoading(true)
    setError('')
    
    try {
      if (suggestion.action === 'delete') {
        await onDelete(suggestion.path)
        setSuccess(true)
        setTimeout(() => setShowDetail(false), 1500)
      } else {
        await onMove(suggestion.path)
        setSuccess(true)
        setTimeout(() => setShowDetail(false), 1500)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const ActionIcon = suggestion.action === 'delete' ? Trash2 : MoveRight
  const TypeIcon = suggestion.type === 'file' ? File : FolderOpen
  const actionColor = suggestion.action === 'delete' ? '#ef4444' : '#3b82f6'
  const actionLabel = suggestion.action === 'delete' ? '删除' : '迁移'

  return (
    <>
      <div 
        onClick={() => setShowDetail(true)}
        className="bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-600 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <div 
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${actionColor}15` }}
          >
            <ActionIcon size={20} style={{ color: actionColor }} />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <TypeIcon size={14} className="text-slate-400 dark:text-gray-400 shrink-0" />
              <span className="text-sm font-medium text-slate-600 dark:text-gray-300 truncate">
                {suggestion.path.split(/[/\\]/).pop()}
              </span>
              <Chip 
                label={actionLabel}
                size="small"
                sx={{ 
                  height: '20px',
                  fontSize: '10px',
                  fontWeight: 600,
                  bgcolor: actionColor,
                  color: 'white'
                }}
              />
            </div>
            
            <p className="text-xs text-slate-500 dark:text-gray-400 line-clamp-2 mb-2">
              {suggestion.message}
            </p>
            
            <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-gray-500">
              <span className="flex items-center gap-1">
                <HardDrive size={10} />
                {suggestion.size}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {suggestion.updateTime}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Dialog 
        open={showDetail} 
        onClose={() => !loading && setShowDetail(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle className="dark:bg-gray-800 dark:text-gray-100">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <ActionIcon size={24} style={{ color: actionColor }} />
            <Typography variant="h6" component="span">
              {actionLabel}建议
            </Typography>
          </Box>
        </DialogTitle>
        
        <DialogContent className="dark:bg-gray-800 dark:text-gray-100" sx={{ py: 3 }}>
          {success ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 4 }}>
              <Check size={48} className="text-green-500" />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                操作成功！
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, bgcolor: 'action.hover', borderRadius: 2 }} className="dark:!bg-gray-700">
                <TypeIcon size={16} className="text-slate-500 dark:text-gray-400" />
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }} className="dark:text-gray-300">
                  {suggestion.path}
                </Typography>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 2, alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }} className="dark:text-gray-400">
                  类型：
                </Typography>
                <Typography variant="body2" className="dark:text-gray-200">
                  {suggestion.type === 'file' ? '文件' : '目录'}
                </Typography>

                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }} className="dark:text-gray-400">
                  大小：
                </Typography>
                <Typography variant="body2" className="dark:text-gray-200">
                  {suggestion.size}
                </Typography>

                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }} className="dark:text-gray-400">
                  修改时间：
                </Typography>
                <Typography variant="body2" className="dark:text-gray-200">
                  {suggestion.updateTime}
                </Typography>
              </Box>

              <Box sx={{ p: 2, bgcolor: 'primary.main', color: 'secondary.main', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontSize: '13px', lineHeight: 1.6 }}>
                  <strong>建议说明：</strong> {suggestion.message}
                </Typography>
              </Box>

              {suggestion.action === 'move' && (
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 1, p: 2, bgcolor: 'info.main', color: 'white', borderRadius: 2, opacity: 0.9 }}>
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <Typography variant="caption" sx={{ fontSize: '11px' }}>
                    迁移功能正在开发中，后续将支持自动迁移到网盘
                  </Typography>
                </Box>
              )}

              {error && (
                <Box sx={{ display: 'flex', alignItems: 'start', gap: 1, p: 2, bgcolor: 'error.main', color: 'white', borderRadius: 2 }}>
                  <X size={16} className="shrink-0 mt-0.5" />
                  <Typography variant="caption" sx={{ fontSize: '11px' }}>
                    {error}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        {!success && (
          <DialogActions className="dark:bg-gray-800 dark:border-gray-600" sx={{ borderTop: 1, borderColor: 'divider', p: 2, gap: 1 }}>
            <Button 
              onClick={() => setShowDetail(false)} 
              disabled={loading}
              variant="outlined"
              size="small"
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                fontSize: '12px'
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleAction}
              disabled={loading || (suggestion.action === 'move')}
              variant="contained"
              size="small"
              sx={{
                textTransform: 'none',
                borderRadius: '10px',
                bgcolor: actionColor,
                color: 'white',
                fontSize: '12px',
                fontWeight: 700,
                '&:hover': {
                  bgcolor: actionColor,
                  filter: 'brightness(0.9)'
                },
                '&.Mui-disabled': {
                  bgcolor: 'action.disabledBackground'
                }
              }}
            >
              {loading ? '处理中...' : `确认${actionLabel}`}
            </Button>
          </DialogActions>
        )}
      </Dialog>
    </>
  )
}
