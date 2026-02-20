// 快照服务 - 保存和管理扫描快照 (使用文件系统)

import type { TreemapNode } from '../components/Treemap'
import { readJSON, writeJSON, deleteStorageFile } from './storage'

export interface Snapshot {
  id: string
  name: string
  path: string
  timestamp: number
  scanResult: {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
  }
}

// 快照元数据（不包含完整扫描结果，用于列表显示）
export interface SnapshotMetadata {
  id: string
  name: string
  path: string
  timestamp: number
  file_count: number
  total_size: number
  scan_time_ms: number
}

const SNAPSHOTS_INDEX = 'snapshots/index.json'

/**
 * 加载快照索引（仅元数据）
 */
async function loadSnapshotIndex(): Promise<SnapshotMetadata[]> {
  return await readJSON<SnapshotMetadata[]>(SNAPSHOTS_INDEX, [])
}

/**
 * 保存快照索引
 */
async function saveSnapshotIndex(index: SnapshotMetadata[]): Promise<void> {
  await writeJSON(SNAPSHOTS_INDEX, index)
}

/**
 * 加载所有快照（仅元数据）
 */
export async function loadSnapshots(): Promise<SnapshotMetadata[]> {
  return await loadSnapshotIndex()
}

/**
 * 保存快照
 */
export async function saveSnapshot(snapshot: Omit<Snapshot, 'id' | 'timestamp'>): Promise<Snapshot> {
  const index = await loadSnapshotIndex()
  
  const newSnapshot: Snapshot = {
    ...snapshot,
    id: Date.now().toString(36) + Math.random().toString(36).substring(2),
    timestamp: Date.now(),
  }
  
  // 创建元数据
  const metadata: SnapshotMetadata = {
    id: newSnapshot.id,
    name: newSnapshot.name,
    path: newSnapshot.path,
    timestamp: newSnapshot.timestamp,
    file_count: newSnapshot.scanResult.file_count,
    total_size: newSnapshot.scanResult.total_size,
    scan_time_ms: newSnapshot.scanResult.scan_time_ms,
  }
  
  // 保存完整快照到单独文件
  try {
    await writeJSON(`snapshots/${newSnapshot.id}.json`, newSnapshot)
  } catch (error) {
    throw new Error(`保存快照数据失败: ${error}`)
  }
  
  // 更新索引
  index.unshift(metadata) // 最新的放在前面
  
  // 限制最多保存 50 个快照
  if (index.length > 50) {
    const removed = index.splice(50)
    // 删除旧快照文件
    for (const old of removed) {
      try {
        await deleteStorageFile(`snapshots/${old.id}.json`)
      } catch (error) {
        console.warn(`删除旧快照失败: ${old.id}`, error)
      }
    }
  }
  
  await saveSnapshotIndex(index)
  
  return newSnapshot
}

/**
 * 删除快照
 */
export async function deleteSnapshot(id: string): Promise<void> {
  const index = await loadSnapshotIndex()
  const filtered = index.filter(s => s.id !== id)
  
  // 删除快照文件
  try {
    await deleteStorageFile(`snapshots/${id}.json`)
  } catch (error) {
    console.warn(`删除快照文件失败: ${id}`, error)
  }
  
  await saveSnapshotIndex(filtered)
}

/**
 * 获取单个快照（完整数据）
 */
export async function getSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const snapshot = await readJSON<Snapshot | null>(`snapshots/${id}.json`, null)
    return snapshot
  } catch (error) {
    console.error(`加载快照失败: ${id}`, error)
    return null
  }
}

/**
 * 更新快照名称
 */
export async function updateSnapshotName(id: string, name: string): Promise<void> {
  // 更新索引
  const index = await loadSnapshotIndex()
  const metadata = index.find(s => s.id === id)
  if (metadata) {
    metadata.name = name
    await saveSnapshotIndex(index)
  }
  
  // 更新完整快照
  const snapshot = await getSnapshot(id)
  if (snapshot) {
    snapshot.name = name
    await writeJSON(`snapshots/${id}.json`, snapshot)
  }
}
