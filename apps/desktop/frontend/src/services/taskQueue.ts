import { invoke } from '@tauri-apps/api/core'
import type { CloudStorageConfig } from './settings'

// 任务状态
export type TaskStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled'

// 任务类型
export type TaskType = 'migrate' | 'delete'

// 单个任务
export interface Task {
  id: string
  type: TaskType
  status: TaskStatus
  sourcePath: string
  fileName: string
  fileSize: number
  targetConfigs: CloudStorageConfig[]
  targetPath: string
  progress: number // 0-100
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  deleteSource?: boolean // 上传成功后是否删除源文件
  sourceDeleted?: boolean // 源文件是否已被删除
  // 上传进度相关
  uploadedBytes?: number // 已上传字节数
  uploadSpeed?: number // 上传速度 (bytes/s)
  lastProgressTime?: number // 上次进度更新时间
  lastUploadedBytes?: number // 上次已上传字节数
}

// 创建唯一ID
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 创建迁移任务
export function createMigrateTask(
  sourcePath: string,
  fileSize: number,
  targetConfigs: CloudStorageConfig[],
  targetPath: string,
  deleteSource: boolean = true  // 默认删除源文件
): Task {
  const fileName = sourcePath.split(/[/\\]/).pop() || sourcePath
  return {
    id: generateTaskId(),
    type: 'migrate',
    status: 'pending',
    sourcePath,
    fileName,
    fileSize,
    targetConfigs,
    targetPath,
    progress: 0,
    createdAt: Date.now(),
    deleteSource,
    sourceDeleted: false,
  }
}

// 上传结果类型
interface UploadResult {
  success: boolean
  provider: string
  file_id: string | null
  message: string
  source_deleted: boolean
}

// 执行上传任务
export async function executeUploadTask(
  task: Task,
  onProgress: (progress: number) => void,
  onStatusChange: (status: TaskStatus, error?: string, sourceDeleted?: boolean) => void
): Promise<void> {
  onStatusChange('uploading')
  
  try {
    // 准备上传配置
    const uploadConfigs = []
    for (const config of task.targetConfigs) {
      if (!config.accessToken) {
        throw new Error(`${config.name} 未登录`)
      }

      // 动态导入 refreshGoogleToken
      const { refreshGoogleToken } = await import('./settings')

      let accessToken = config.accessToken

      // 检查 token 是否即将过期（5分钟内）
      if (config.tokenExpiry) {
        const expiryBuffer = 5 * 60 * 1000
        if (config.tokenExpiry - Date.now() < expiryBuffer) {
          if (!config.refreshToken) {
            throw new Error(`${config.name} 登录已过期，请重新登录`)
          }
          // 刷新 token
          const newTokenData = await refreshGoogleToken(config.refreshToken)
          accessToken = newTokenData.access_token
        }
      }

      uploadConfigs.push({
        provider: config.provider,
        name: config.name,
        access_token: accessToken,
        target_path: task.targetPath,
      })
    }

    // 调用 Tauri 后端上传（传递是否删除源文件的参数）
    const results = await invoke<UploadResult[]>('upload_to_cloud', {
      filePath: task.sourcePath,
      configs: uploadConfigs,
      deleteSource: task.deleteSource ?? true,
    })

    // 检查上传结果
    const allSuccess = results.every(r => r.success)
    const anySourceDeleted = results.some(r => r.source_deleted)

    if (!allSuccess) {
      const failedResults = results.filter(r => !r.success)
      throw new Error(failedResults.map(r => r.message).join('; '))
    }
    
    onProgress(100)
    onStatusChange('completed', undefined, anySourceDeleted)
  } catch (error) {
    onStatusChange('failed', String(error))
    throw error
  }
}

// 模拟进度（当API不支持进度回调时使用）
export function simulateProgress(
  fileSize: number,
  onProgress: (progress: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let progress = 0
    // 根据文件大小估算上传时间，假设 1MB/s
    const estimatedTime = Math.max(2000, Math.min(fileSize / 1024 / 1024 * 1000, 30000))
    const interval = 100
    const increment = (100 / estimatedTime) * interval

    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer)
        reject(new Error('已取消'))
        return
      }

      progress = Math.min(progress + increment + Math.random() * increment * 0.5, 95)
      onProgress(Math.floor(progress))
    }, interval)

    // 存储 timer 以便在完成时清除
    signal.addEventListener('abort', () => {
      clearInterval(timer)
    })

    // 返回一个可以被外部解决的 promise
    ;(signal as any).__completeProgress = () => {
      clearInterval(timer)
      onProgress(100)
      resolve()
    }
  })
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 格式化时间
export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  
  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`
  } else {
    return `${seconds}秒`
  }
}
