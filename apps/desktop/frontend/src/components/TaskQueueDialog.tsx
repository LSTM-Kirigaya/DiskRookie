import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  LinearProgress,
  Button,
  Chip,
  Tooltip,
} from '@mui/material'
import { X, Cloud, CheckCircle2, XCircle, Clock, Trash2, Play, Pause, RotateCcw, FileX } from 'lucide-react'
import type { Task, TaskStatus } from '../services/taskQueue'
import { formatFileSize, formatTime } from '../services/taskQueue'
import { CLOUD_STORAGE_PROVIDERS } from '../services/settings'

interface Props {
  open: boolean
  onClose: () => void
  tasks: Task[]
  onCancelTask: (taskId: string) => void
  onRetryTask: (taskId: string) => void
  onClearCompleted: () => void
  onPauseAll: () => void
  onResumeAll: () => void
  isPaused: boolean
}

// 状态颜色和标签
const statusConfig: Record<TaskStatus, { color: string; label: string; bgColor: string }> = {
  pending: { color: '#f59e0b', label: '等待中', bgColor: '#fef3c7' },
  uploading: { color: '#3b82f6', label: '上传中', bgColor: '#dbeafe' },
  completed: { color: '#22c55e', label: '已完成', bgColor: '#dcfce7' },
  failed: { color: '#ef4444', label: '失败', bgColor: '#fee2e2' },
  cancelled: { color: '#6b7280', label: '已取消', bgColor: '#f3f4f6' },
}

// 单个任务项
function TaskItem({ 
  task, 
  onCancel, 
  onRetry 
}: { 
  task: Task
  onCancel: () => void
  onRetry: () => void
}) {
  const config = statusConfig[task.status]
  const providerInfo = task.targetConfigs[0] 
    ? CLOUD_STORAGE_PROVIDERS.find(p => p.id === task.targetConfigs[0].provider)
    : null

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: '12px',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        mb: 1.5,
      }}
      className="dark:!bg-gray-700/50 dark:!border-gray-600"
    >
      {/* 顶部：文件名和状态 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
          <Cloud size={16} className="text-blue-500 shrink-0" />
          <Typography 
            variant="body2" 
            sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            className="dark:text-gray-200"
          >
            {task.fileName}
          </Typography>
        </Box>
        <Chip
          label={config.label}
          size="small"
          sx={{
            height: '20px',
            fontSize: '10px',
            fontWeight: 600,
            bgcolor: config.bgColor,
            color: config.color,
            ml: 1,
          }}
          className="dark:!bg-opacity-20"
        />
      </Box>

      {/* 进度条 */}
      {(task.status === 'uploading' || task.status === 'pending') && (
        <Box sx={{ mb: 1 }}>
          <LinearProgress
            variant={task.status === 'pending' ? 'indeterminate' : 'determinate'}
            value={task.progress}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                bgcolor: task.status === 'pending' ? '#f59e0b' : 'primary.main',
              },
            }}
          />
        </Box>
      )}

      {/* 底部：详情和操作 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {formatFileSize(task.fileSize)}
          </Typography>
          {providerInfo && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              → {providerInfo.name}
            </Typography>
          )}
          {task.status === 'uploading' && (
            <>
              <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                {task.progress}%
              </Typography>
              {task.uploadSpeed && task.uploadSpeed > 0 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {formatFileSize(task.uploadSpeed)}/s
                </Typography>
              )}
            </>
          )}
          {task.completedAt && task.startedAt && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Clock size={12} />
              {formatTime(task.completedAt - task.startedAt)}
            </Typography>
          )}
          {/* 显示源文件删除状态 */}
          {task.status === 'completed' && task.sourceDeleted && (
            <Tooltip title="源文件已删除">
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#22c55e', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 0.5,
                  fontWeight: 600,
                }}
              >
                <FileX size={12} />
                已清理
              </Typography>
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {task.status === 'failed' && (
            <Tooltip title="重试">
              <IconButton size="small" onClick={onRetry} sx={{ color: 'primary.main' }}>
                <RotateCcw size={14} />
              </IconButton>
            </Tooltip>
          )}
          {(task.status === 'pending' || task.status === 'uploading') && (
            <Tooltip title="取消">
              <IconButton size="small" onClick={onCancel} sx={{ color: 'error.main' }}>
                <X size={14} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* 错误信息 */}
      {task.error && (
        <Typography 
          variant="caption" 
          sx={{ 
            color: '#dc2626', 
            mt: 1, 
            display: 'block',
            bgcolor: '#fee2e2',
            px: 1,
            py: 0.5,
            borderRadius: 1,
          }}
          className="dark:!bg-red-900/30 dark:!text-red-400"
        >
          {task.error}
        </Typography>
      )}
    </Box>
  )
}

export function TaskQueueDialog({
  open,
  onClose,
  tasks,
  onCancelTask,
  onRetryTask,
  onClearCompleted,
  onPauseAll,
  onResumeAll,
  isPaused,
}: Props) {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true
    if (filter === 'active') return task.status === 'pending' || task.status === 'uploading'
    if (filter === 'completed') return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    return true
  })

  const activeCount = tasks.filter(t => t.status === 'pending' || t.status === 'uploading').length
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const failedCount = tasks.filter(t => t.status === 'failed').length

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          maxHeight: '80vh',
        },
        className: 'dark:!bg-gray-800',
      }}
    >
      <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }} className="dark:text-gray-100">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cloud size={20} className="text-gray-900" />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '16px' }}>
                处理队列
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {activeCount} 进行中 · {completedCount} 已完成 · {failedCount} 失败
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ color: 'text.secondary' }}>
            <X size={20} />
          </IconButton>
        </Box>
      </DialogTitle>

      {/* 工具栏 */}
      <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }} className="dark:!border-gray-700">
        {/* 筛选标签 */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {[
            { key: 'all', label: '全部' },
            { key: 'active', label: '进行中' },
            { key: 'completed', label: '已完成' },
          ].map(item => (
            <Chip
              key={item.key}
              label={item.label}
              size="small"
              onClick={() => setFilter(item.key as typeof filter)}
              sx={{
                height: '24px',
                fontSize: '11px',
                fontWeight: 600,
                bgcolor: filter === item.key ? 'primary.main' : 'action.hover',
                color: filter === item.key ? '#1A1A1A' : 'text.secondary',
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: filter === item.key ? 'primary.main' : 'action.selected',
                },
              }}
              className={filter !== item.key ? 'dark:!bg-gray-700 dark:!text-gray-300' : ''}
            />
          ))}
        </Box>

        {/* 操作按钮 */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {activeCount > 0 && (
            <Tooltip title={isPaused ? '继续全部' : '暂停全部'}>
              <IconButton 
                size="small" 
                onClick={isPaused ? onResumeAll : onPauseAll}
                sx={{ color: 'text.secondary' }}
              >
                {isPaused ? <Play size={16} /> : <Pause size={16} />}
              </IconButton>
            </Tooltip>
          )}
          {completedCount > 0 && (
            <Tooltip title="清除已完成">
              <IconButton size="small" onClick={onClearCompleted} sx={{ color: 'text.secondary' }}>
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <DialogContent sx={{ px: 3, py: 2 }}>
        {filteredTasks.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Cloud size={48} className="text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {filter === 'all' ? '暂无任务' : filter === 'active' ? '没有进行中的任务' : '没有已完成的任务'}
            </Typography>
          </Box>
        ) : (
          <Box>
            {filteredTasks.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                onCancel={() => onCancelTask(task.id)}
                onRetry={() => onRetryTask(task.id)}
              />
            ))}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
