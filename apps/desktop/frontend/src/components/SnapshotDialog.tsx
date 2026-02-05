import { useState, useMemo, useEffect } from 'react'
import { showNotification } from '../services/notification'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Tooltip,
  InputAdornment,
  CircularProgress,
} from '@mui/material'
import { X, Search, Trash2, FolderOpen, Clock, HardDrive, FileStack } from 'lucide-react'
import { loadSnapshots, deleteSnapshot, getSnapshot, type Snapshot, type SnapshotMetadata } from '../services/snapshot'
import { formatBytes } from '../utils/format'

interface Props {
  open: boolean
  onClose: () => void
  onLoadSnapshot: (snapshot: Snapshot) => void
}

export function SnapshotDialog({ open, onClose, onLoadSnapshot }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([])
  const [loading, setLoading] = useState(true)

  // 加载快照列表
  useEffect(() => {
    if (open) {
      setLoading(true)
      loadSnapshots().then(data => {
        setSnapshots(data)
        setLoading(false)
      })
    }
  }, [open])

  const filteredSnapshots = useMemo(() => {
    if (!searchQuery.trim()) return snapshots
    const query = searchQuery.toLowerCase()
    return snapshots.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.path.toLowerCase().includes(query)
    )
  }, [snapshots, searchQuery])

  const handleDelete = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (confirm('确定要删除这个快照吗？')) {
      await deleteSnapshot(id)
      const updated = await loadSnapshots()
      setSnapshots(updated)
    }
  }

  const handleLoad = async (metadata: SnapshotMetadata) => {
    setLoading(true)
    try {
      const snapshot = await getSnapshot(metadata.id)
      if (snapshot) {
        onLoadSnapshot(snapshot)
        onClose()
      } else {
        showNotification('加载快照失败', '快照数据不存在')
      }
    } catch (error) {
      showNotification('加载快照失败', String(error))
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
    
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '20px',
          maxHeight: '80vh',
        }
      }}
    >
      <DialogTitle sx={{ pb: 2, pt: 3, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: '12px',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FolderOpen size={20} style={{ color: '#1A1A1A' }} />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '18px' }}>
                快照管理
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                共 {snapshots.length} 个快照
              </Typography>
            </Box>
          </Box>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <X size={20} />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pb: 3 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索快照名称或路径..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{
            mb: 2,
            '& .MuiOutlinedInput-root': {
              borderRadius: '12px',
              bgcolor: 'background.paper',
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={18} />
              </InputAdornment>
            ),
          }}
        />

        {loading ? (
          <Box
            sx={{
              py: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <CircularProgress size={48} sx={{ mb: 2 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              加载快照中...
            </Typography>
          </Box>
        ) : filteredSnapshots.length === 0 ? (
          <Box
            sx={{
              py: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            <FolderOpen size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {searchQuery ? '未找到匹配的快照' : '还没有保存任何快照'}
            </Typography>
            <Typography variant="caption" sx={{ mt: 0.5 }}>
              {!searchQuery && '扫描完成后可以保存快照以便后续查看'}
            </Typography>
          </Box>
        ) : (
          <List sx={{ p: 0 }}>
            {filteredSnapshots.map((snapshot, index) => (
              <ListItem
                key={snapshot.id}
                disablePadding
                sx={{
                  mb: index < filteredSnapshots.length - 1 ? 1 : 0,
                }}
                secondaryAction={
                  <Tooltip title="删除快照" arrow>
                    <IconButton
                      edge="end"
                      onClick={(e) => handleDelete(snapshot.id, e)}
                      size="small"
                      sx={{
                        color: 'error.main',
                        '&:hover': {
                          bgcolor: 'error.main',
                          color: 'white',
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton
                  onClick={() => handleLoad(snapshot)}
                  sx={{
                    borderRadius: '12px',
                    border: '1px solid',
                    borderColor: 'divider',
                    px: 2,
                    py: 1.5,
                    '&:hover': {
                      bgcolor: 'action.hover',
                      borderColor: 'primary.main',
                    }
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: 600,
                          mb: 0.5,
                          pr: 4,
                        }}
                      >
                        {snapshot.name}
                      </Typography>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            color: 'text.secondary',
                          }}
                        >
                          <FolderOpen size={12} />
                          {snapshot.path}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              color: 'text.secondary',
                            }}
                          >
                            <Clock size={12} />
                            {formatDate(snapshot.timestamp)}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              color: 'text.secondary',
                            }}
                          >
                            <HardDrive size={12} />
                            {formatBytes(snapshot.total_size)}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              color: 'text.secondary',
                            }}
                          >
                            <FileStack size={12} />
                            {snapshot.file_count.toLocaleString()} 个文件
                          </Typography>
                        </Box>
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  )
}
