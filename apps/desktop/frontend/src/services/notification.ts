// 系统通知服务 - 使用操作系统原生通知
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

/**
 * 检查并请求通知权限
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    let permissionGranted = await isPermissionGranted()
    
    if (!permissionGranted) {
      const permission = await requestPermission()
      permissionGranted = permission === 'granted'
    }
    
    return permissionGranted
  } catch (error) {
    console.error('检查通知权限失败:', error)
    return false
  }
}

/**
 * 发送系统通知
 */
export async function showNotification(
  title: string,
  body: string,
  options?: {
    icon?: string
  }
): Promise<void> {
  try {
    const hasPermission = await ensureNotificationPermission()
    
    if (!hasPermission) {
      console.warn('没有通知权限')
      return
    }
    
    await sendNotification({
      title,
      body,
      icon: options?.icon,
    })
  } catch (error) {
    console.error('发送通知失败:', error)
  }
}

/**
 * 迁移成功通知
 */
export async function notifyMigrateSuccess(
  fileName: string,
  cloudName: string,
  sourceDeleted: boolean
): Promise<void> {
  const body = sourceDeleted
    ? `${fileName} 已上传到 ${cloudName}，本地文件已删除`
    : `${fileName} 已上传到 ${cloudName}`
  
  await showNotification('迁移完成', body)
}

/**
 * 迁移失败通知
 */
export async function notifyMigrateFailed(
  fileName: string,
  error: string
): Promise<void> {
  await showNotification('迁移失败', `${fileName}: ${error}`)
}

/**
 * 删除成功通知
 */
export async function notifyDeleteSuccess(
  fileName: string
): Promise<void> {
  await showNotification('删除完成', `${fileName} 已删除`)
}

/**
 * 批量任务完成通知
 */
export async function notifyBatchComplete(
  successCount: number,
  failedCount: number,
  totalSize?: string
): Promise<void> {
  if (failedCount === 0) {
    const body = totalSize
      ? `${successCount} 个文件处理完成，共释放 ${totalSize}`
      : `${successCount} 个文件处理完成`
    await showNotification('批量处理完成', body)
  } else {
    await showNotification(
      '批量处理完成',
      `${successCount} 个成功，${failedCount} 个失败`
    )
  }
}
