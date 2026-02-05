import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-shell'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Settings, Github, Mail, ExternalLink, Sun, Moon, Monitor, Minus, Copy, X, ListTodo } from 'lucide-react'
import { ThemeProvider, createTheme, CssBaseline, IconButton, Box, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Button, Badge } from '@mui/material'
import { ExpertMode } from './components/ExpertMode'
import { AISettings } from './components/AISettings'
import { SnapshotDialog } from './components/SnapshotDialog'
import { TaskQueueDialog } from './components/TaskQueueDialog'
import type { Snapshot } from './services/snapshot'
import { readStorageFile, writeStorageFile } from './services/storage'
import { type Task, createMigrateTask } from './services/taskQueue'
import type { CloudStorageConfig } from './services/settings'
import { notifyMigrateSuccess, notifyMigrateFailed } from './services/notification'

// 上传进度事件类型
interface UploadProgressEvent {
  task_id: string
  provider: string
  progress: number
  uploaded_bytes: number
  total_bytes: number
}

const THEME_STORAGE_FILE = 'theme.txt'

function App() {
  const win = getCurrentWindow()
  const [showSettings, setShowSettings] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [loadedSnapshot, setLoadedSnapshot] = useState<Snapshot | null>(null)
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux'>('windows')
  const [themePreference, setThemePreference] = useState<'light' | 'dark' | 'system'>('system')
  const [themeMenuAnchor, setThemeMenuAnchor] = useState<null | HTMLElement>(null)
  const [language, setLanguage] = useState<string>('en')
  const [settingsSavedTrigger, setSettingsSavedTrigger] = useState(0)
  // 任务队列状态
  const [showTaskQueue, setShowTaskQueue] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const processingRef = useRef(false)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  // 活跃任务数量
  const activeTaskCount = tasks.filter(t => t.status === 'pending' || t.status === 'uploading').length

  // 添加任务到队列
  const addTask = useCallback((task: Task) => {
    setTasks(prev => [...prev, task])
  }, [])

  // 文件删除通知回调（供子组件调用）
  const onFileDeletedRef = useRef<((path: string) => void) | null>(null)

  // 设置文件删除通知回调
  const setOnFileDeleted = useCallback((callback: ((path: string) => void) | null) => {
    onFileDeletedRef.current = callback
  }, [])

  // 添加迁移任务（供子组件调用）
  const addMigrateTask = useCallback((
    sourcePath: string,
    fileSize: number,
    targetConfigs: CloudStorageConfig[],
    targetPath: string,
    deleteSource: boolean = true  // 默认上传成功后删除源文件
  ) => {
    const task = createMigrateTask(sourcePath, fileSize, targetConfigs, targetPath, deleteSource)
    addTask(task)
    return task.id
  }, [addTask])

  // 更新任务状态
  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    ))
  }, [])

  // 取消任务
  const cancelTask = useCallback((taskId: string) => {
    const controller = abortControllersRef.current.get(taskId)
    if (controller) {
      controller.abort()
      abortControllersRef.current.delete(taskId)
    }
    updateTask(taskId, { status: 'cancelled' })
  }, [updateTask])

  // 重试任务
  const retryTask = useCallback((taskId: string) => {
    updateTask(taskId, { status: 'pending', progress: 0, error: undefined })
  }, [updateTask])

  // 清除已完成的任务
  const clearCompleted = useCallback(() => {
    setTasks(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'cancelled'))
  }, [])

  // 暂停所有任务
  const pauseAll = useCallback(() => {
    setIsPaused(true)
  }, [])

  // 继续所有任务
  const resumeAll = useCallback(() => {
    setIsPaused(false)
  }, [])

  // 监听上传进度事件
  useEffect(() => {
    const unlisten = listen<UploadProgressEvent>('upload-progress', (event) => {
      const { task_id, progress, uploaded_bytes } = event.payload
      const now = Date.now()
      
      // 更新对应任务的进度，并计算上传速度
      setTasks(prev => prev.map(t => {
        if (t.id !== task_id) return t
        
        // 计算上传速度
        let uploadSpeed = t.uploadSpeed || 0
        if (t.lastProgressTime && t.lastUploadedBytes !== undefined) {
          const timeDiff = (now - t.lastProgressTime) / 1000 // 秒
          const bytesDiff = uploaded_bytes - t.lastUploadedBytes
          if (timeDiff > 0 && bytesDiff > 0) {
            // 使用移动平均来平滑速度显示
            const newSpeed = bytesDiff / timeDiff
            uploadSpeed = uploadSpeed > 0 ? uploadSpeed * 0.3 + newSpeed * 0.7 : newSpeed
          }
        }
        
        return {
          ...t,
          progress,
          uploadedBytes: uploaded_bytes,
          uploadSpeed,
          lastProgressTime: now,
          lastUploadedBytes: uploaded_bytes,
        }
      }))
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // 处理队列中的任务
  useEffect(() => {
    const processNextTask = async () => {
      if (processingRef.current || isPaused) return

      const pendingTask = tasks.find(t => t.status === 'pending')
      if (!pendingTask) return

      processingRef.current = true
      const taskId = pendingTask.id
      const abortController = new AbortController()
      abortControllersRef.current.set(taskId, abortController)

      // 开始上传
      updateTask(taskId, { status: 'uploading', startedAt: Date.now(), progress: 0 })

      try {
        const config = pendingTask.targetConfigs[0]
        if (!config || !config.accessToken) {
          throw new Error('未找到有效的云存储配置')
        }

        // 动态导入 refreshGoogleToken
        const { refreshGoogleToken } = await import('./services/settings')

        let accessToken = config.accessToken

        // 检查 token 是否即将过期
        if (config.tokenExpiry) {
          const expiryBuffer = 5 * 60 * 1000
          if (config.tokenExpiry - Date.now() < expiryBuffer) {
            if (!config.refreshToken) {
              throw new Error(`${config.name} 登录已过期，请重新登录`)
            }
            try {
              const newTokenData = await refreshGoogleToken(config.refreshToken)
              accessToken = newTokenData.access_token
            } catch (e) {
              // token 刷新失败，可能是网络问题或 token 已失效
              const errorMsg = String(e)
              if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('invalid_grant')) {
                throw new Error(`${config.name} 登录已过期，请重新登录`)
              }
              throw new Error(`${config.name} token 刷新失败: ${errorMsg}`)
            }
          }
        }

        // 准备上传配置
        const uploadConfigs = [{
          provider: config.provider,
          name: config.name,
          access_token: accessToken,
          target_path: pendingTask.targetPath,
        }]

        // 调用 Tauri 后端上传（传递是否删除源文件的参数和任务ID用于进度回调）
        interface UploadResult {
          success: boolean
          provider: string
          file_id: string | null
          message: string
          source_deleted: boolean
        }

        const results = await invoke<UploadResult[]>('upload_to_cloud', {
          filePath: pendingTask.sourcePath,
          configs: uploadConfigs,
          deleteSource: pendingTask.deleteSource ?? true,  // 默认删除源文件
          taskId: taskId,  // 传递任务ID用于进度事件关联
        })
        
        if (!abortController.signal.aborted) {
          // 检查是否所有上传都成功
          const allSuccess = results.every(r => r.success)
          const anySourceDeleted = results.some(r => r.source_deleted)

          if (allSuccess) {
            // 直接更新状态和进度到100%，确保状态同步
            updateTask(taskId, { 
              status: 'completed', 
              progress: 100, 
              completedAt: Date.now(),
              sourceDeleted: anySourceDeleted,
            })
            // 如果源文件已被删除，通知 ExpertMode 组件更新文件列表
            if (anySourceDeleted && onFileDeletedRef.current) {
              onFileDeletedRef.current(pendingTask.sourcePath)
            }
            // 发送系统通知
            notifyMigrateSuccess(
              pendingTask.fileName,
              config.name || config.provider,
              anySourceDeleted
            )
          } else {
            const failedResults = results.filter(r => !r.success)
            throw new Error(failedResults.map(r => r.message).join('; '))
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          updateTask(taskId, { 
            status: 'failed', 
            error: String(error),
            completedAt: Date.now()
          })
          // 发送失败通知
          notifyMigrateFailed(pendingTask.fileName, String(error))
        }
      } finally {
        abortControllersRef.current.delete(taskId)
        processingRef.current = false
      }
    }

    processNextTask()
  }, [tasks, isPaused, updateTask])

  // 检测系统主题
  const systemTheme = useMemo(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  }, [])

  // 计算实际使用的主题
  const themeMode = themePreference === 'system' ? systemTheme : themePreference

  // 监听系统主题变化
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        if (themePreference === 'system') {
          document.documentElement.classList.toggle('dark', mediaQuery.matches)
        }
      }
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
  }, [themePreference])

  // 加载主题设置
  useEffect(() => {
    readStorageFile(THEME_STORAGE_FILE).then(stored => {
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        setThemePreference(stored)
      }
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeMode === 'dark')
    void writeStorageFile(THEME_STORAGE_FILE, themePreference)
  }, [themeMode, themePreference])

  // 检测语言
  useEffect(() => {
    const detectLanguage = () => {
      const browserLang = navigator.language.toLowerCase()
      setLanguage(browserLang.startsWith('zh') ? 'zh' : 'en')
    }
    detectLanguage()
  }, [])

  const theme = useMemo(() => createTheme({
    palette: {
      mode: themeMode,
      primary: {
        main: '#FFD200',
      },
      secondary: {
        main: themeMode === 'dark' ? '#FFD200' : '#1A1A1A',
      },
      background: {
        default: themeMode === 'dark' ? '#111827' : '#FFFFFF',
        paper: themeMode === 'dark' ? '#1F2937' : '#F5F5F5',
      },
    },
    shape: {
      borderRadius: 12,
    },
  }), [themeMode])

  useEffect(() => {
    const detectPlatform = () => {
      // 使用 navigator.platform 检测操作系统
      const platformName = navigator.platform.toLowerCase()
      const userAgent = navigator.userAgent.toLowerCase()
      
      if (platformName.includes('mac') || userAgent.includes('mac')) {
        setPlatform('macos')
      } else if (platformName.includes('win') || userAgent.includes('win')) {
        setPlatform('windows')
      } else {
        setPlatform('linux')
      }
    }
    detectPlatform()
  }, [])

  const handleTitleBarMouseDown = () => {
    win.startDragging()
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className={`min-h-screen flex flex-col overflow-hidden ${themeMode === 'dark' ? 'bg-gray-900 text-gray-100' : 'bg-white text-text-main'}`} style={{ height: '100%', boxSizing: 'border-box' }}>
      {/* 菜单栏固定顶部，向下滚动时始终可见 */}
      <header className={`sticky top-0 z-50 shrink-0 h-10 flex items-center border-b select-none ${themeMode === 'dark' ? 'border-gray-700 bg-gray-900' : 'border-border bg-white'} ${platform === 'macos' ? 'pl-16' : ''}`}>
        {/* macOS 窗口控制按钮（左上角） */}
        {platform === 'macos' && (
          <Box
            sx={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              zIndex: 1000,
            }}
          >
            {/* 关闭按钮（红色） */}
            <Box
              component="button"
              onClick={() => win.close()}
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: '#ff5f57',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': {
                  bgcolor: '#ff3b30',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              title="关闭"
            />
            {/* 最小化按钮（黄色） */}
            <Box
              component="button"
              onClick={() => win.minimize()}
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: '#ffbd2e',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': {
                  bgcolor: '#ff9500',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              title="最小化"
            />
            {/* 全屏按钮（绿色） */}
            <Box
              component="button"
              onClick={() => win.toggleMaximize()}
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: '#28c840',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': {
                  bgcolor: '#1fb82e',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              title="全屏"
            />
          </Box>
        )}

        {/* 左侧：应用图标和名称 */}
        <div
          data-tauri-drag-region
          onMouseDown={handleTitleBarMouseDown}
          className="flex items-center px-4 h-full cursor-default gap-2"
          style={{ flex: '0 0 auto' }}
        >
          {platform !== 'macos' && (
            <img 
              src="/app-icon.png" 
              alt="App Icon" 
              className="w-6 h-6 rounded-md mr-5"
              style={{ imageRendering: 'crisp-edges' }}
            />
          )}
          <span className={`text-sm font-semibold ${platform === 'macos' ? '' : 'mr-16'} ${themeMode === 'dark' ? 'text-gray-100' : 'text-secondary'}`}>
            {language === 'zh' ? '磁盘菜鸟' : 'DiskRookie'}
          </span>
        </div>
        
        {/* 中间：快照按钮（居中） */}
        <div
          data-tauri-drag-region
          onMouseDown={handleTitleBarMouseDown}
          className="flex-1 flex items-center justify-center h-full cursor-default px-4"
        >
          <Button
            onClick={() => setShowSnapshots(true)}
            sx={(theme) => ({
              minWidth: '280px',
              maxWidth: '400px',
              height: '28px',
              px: 1.5,
              py: 0.5,
              textTransform: 'none',
              borderRadius: '6px',
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: theme.palette.mode === 'dark' 
                ? 'rgba(30, 30, 30, 0.5)' 
                : 'rgba(255, 255, 255, 0.5)',
              backdropFilter: 'blur(8px)',
              color: 'text.secondary',
              fontSize: '12px',
              fontWeight: 500,
              justifyContent: 'center',
              '&:hover': {
                bgcolor: theme.palette.mode === 'dark'
                  ? 'rgba(40, 40, 40, 0.7)'
                  : 'rgba(255, 255, 255, 0.7)',
                borderColor: 'primary.main',
                color: 'primary.main',
              },
            })}
          >
            {loadedSnapshot ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                <span style={{ fontSize: '11px', fontWeight: 600, lineHeight: 1.2 }}>
                  {loadedSnapshot.name}
                </span>
                <span style={{ fontSize: '9px', opacity: 0.6, lineHeight: 1.2 }}>
                  {new Date(loadedSnapshot.timestamp).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </Box>
            ) : (
              '快照管理'
            )}
          </Button>
        </div>
        
        {/* 项目信息链接 */}
        <div className={`flex items-center h-full px-2 gap-0.5 border-r mr-1 ${themeMode === 'dark' ? 'border-gray-700' : 'border-border'}`}>
          <Tooltip title="GitHub 仓库" arrow>
            <IconButton
              size="small"
              onClick={() => open('https://github.com/LSTM-Kirigaya/DiskRookie')}
              sx={{
                width: '24px',
                height: '24px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <Github className="w-3.5 h-3.5" />
            </IconButton>
          </Tooltip>
          <Tooltip title="邮箱：zhelonghuang@qq.com" arrow>
            <IconButton
              size="small"
              onClick={() => open('mailto:zhelonghuang@qq.com')}
              sx={{
                width: '24px',
                height: '24px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <Mail className="w-3.5 h-3.5" />
            </IconButton>
          </Tooltip>
          <Tooltip title="个人主页" arrow>
            <IconButton
              size="small"
              onClick={() => open('https://kirigaya.cn/about')}
              sx={{
                width: '24px',
                height: '24px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                },
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        
        {/* 功能按钮 */}
        <div className="flex items-center h-full px-2 gap-1">
          {/* 工作队列按钮 */}
          <Tooltip title="处理队列" arrow>
            <IconButton
              size="small"
              onClick={() => setShowTaskQueue(true)}
              sx={{
                width: '28px',
                height: '28px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <Badge 
                badgeContent={activeTaskCount} 
                color="primary"
                max={99}
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: '10px',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 4px',
                    bgcolor: 'primary.main',
                    color: '#1A1A1A',
                    fontWeight: 700,
                  }
                }}
              >
                <ListTodo className="w-4 h-4" />
              </Badge>
            </IconButton>
          </Tooltip>
          <Tooltip title="主题设置" arrow>
            <IconButton
              size="small"
              onClick={(e) => setThemeMenuAnchor(e.currentTarget)}
              sx={{
                width: '28px',
                height: '28px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              {themePreference === 'system' ? (
                <Monitor className="w-4 h-4" />
              ) : themeMode === 'dark' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={themeMenuAnchor}
            open={Boolean(themeMenuAnchor)}
            onClose={() => setThemeMenuAnchor(null)}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            <MenuItem
              selected={themePreference === 'light'}
              onClick={() => {
                setThemePreference('light')
                setThemeMenuAnchor(null)
              }}
            >
              <ListItemIcon>
                <Sun className="w-4 h-4" />
              </ListItemIcon>
              <ListItemText>浅色</ListItemText>
            </MenuItem>
            <MenuItem
              selected={themePreference === 'dark'}
              onClick={() => {
                setThemePreference('dark')
                setThemeMenuAnchor(null)
              }}
            >
              <ListItemIcon>
                <Moon className="w-4 h-4" />
              </ListItemIcon>
              <ListItemText>深色</ListItemText>
            </MenuItem>
            <MenuItem
              selected={themePreference === 'system'}
              onClick={() => {
                setThemePreference('system')
                setThemeMenuAnchor(null)
              }}
            >
              <ListItemIcon>
                <Monitor className="w-4 h-4" />
              </ListItemIcon>
              <ListItemText>跟随系统</ListItemText>
            </MenuItem>
          </Menu>
          <IconButton
            size="small"
            onClick={() => setShowSettings(true)}
            title="设置"
            sx={{
              width: '28px',
              height: '28px',
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <Settings className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Windows/Linux 窗口控制按钮（右上角） */}
        {platform !== 'macos' && (
          <div className={`flex items-center border-l ${themeMode === 'dark' ? 'border-gray-700' : 'border-border'}`}>
            <IconButton
              size="small"
              onClick={() => win.minimize()}
              title="最小化"
              sx={{
                width: '40px',
                height: '40px',
                borderRadius: 0,
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <Minus className="w-4 h-4" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => win.toggleMaximize()}
              title="最大化 / 还原"
              sx={{
                width: '40px',
                height: '40px',
                borderRadius: 0,
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <Copy className="w-4 h-4" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => win.close()}
              title="关闭"
              sx={{
                width: '40px',
                height: '40px',
                borderRadius: 0,
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'error.main',
                  color: 'white',
                },
              }}
            >
              <X className="w-4 h-4" />
            </IconButton>
          </div>
        )}
      </header>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        <main className={`flex-1 flex flex-col min-h-0 overflow-y-auto p-4 ${themeMode === 'dark' ? 'bg-gray-800' : 'bg-surface'}`}>
          <ExpertMode 
            onOpenSettings={() => setShowSettings(true)} 
            loadedSnapshot={loadedSnapshot}
            onSnapshotLoaded={() => setLoadedSnapshot(null)}
            settingsSavedTrigger={settingsSavedTrigger}
            onAddMigrateTask={addMigrateTask}
            onFileDeleted={setOnFileDeleted}
            tasks={tasks}
          />
        </main>
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <AISettings 
          onClose={() => setShowSettings(false)} 
          onSaved={() => setSettingsSavedTrigger(prev => prev + 1)}
        />
      )}
      
      {/* 快照管理对话框 */}
      <SnapshotDialog 
        open={showSnapshots} 
        onClose={() => setShowSnapshots(false)}
        onLoadSnapshot={(snapshot) => setLoadedSnapshot(snapshot)}
      />

      {/* 任务队列对话框 */}
      <TaskQueueDialog
        open={showTaskQueue}
        onClose={() => setShowTaskQueue(false)}
        tasks={tasks}
        onCancelTask={cancelTask}
        onRetryTask={retryTask}
        onClearCompleted={clearCompleted}
        onPauseAll={pauseAll}
        onResumeAll={resumeAll}
        isPaused={isPaused}
      />
      </div>
    </ThemeProvider>
  )
}

export default App
