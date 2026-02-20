import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { showNotification } from '../services/notification'
import { Folder, Cpu, MessageSquare, Copy, CheckCircle2, AlertCircle, Settings, Clock, FileStack, HardDrive, Sparkles, Save, Cloud, Play, Shield } from 'lucide-react'
import { Button, TextField, Typography, Fade, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Slider, Box, FormHelperText, Checkbox, FormControlLabel } from '@mui/material'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Treemap, type TreemapNode } from './Treemap'
import { formatBytes, formatDuration } from '../utils/format'
import { loadSettings } from '../services/ai'
import { analyzeWithAI, deleteItem, type AnalysisResult } from '../services/ai-analysis'
import { SuggestionCard } from './SuggestionCard'
import { saveSnapshot, type Snapshot } from '../services/snapshot'
import { readStorageFile, writeStorageFile } from '../services/storage'
import { loadAppSettings, saveAppSettings, getEnabledCloudStorageConfigs, CLOUD_STORAGE_PROVIDERS, type CloudStorageConfig } from '../services/settings'
import { loadSafeListPaths, isPathInSafeList, addToSafeList } from '../services/safeList'
import { CloudStorageSelector } from './CloudStorageSelector'
import type { Task } from '../services/taskQueue'

/** 按大小排序的前 N 大文件条目（MFT 扫描时由后端填充） */
interface TopFileEntry {
    path: string
    size: number
    modified?: number | null
}

interface ScanResult {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
    /** 当 MFT 扫描失败并回退到普通扫描时，后端会设置此字段，前端用于标注「此磁盘的扫描有错误」 */
    scan_warning?: string | null
    /** 卷总容量（字节），由操作系统 API 获取 */
    volume_total_bytes?: number | null
    /** 卷剩余可用空间（字节） */
    volume_free_bytes?: number | null
    /** 按大小排序的前 N 大文件，供摘要与 AI 分析用，避免遍历整棵树 */
    top_files?: TopFileEntry[] | null
}

const PROMPT_INSTRUCTION_FILE = 'prompt-instruction.txt'

/** Windows 下将 "C:" 规范为 "C:\"，便于后端识别为卷根并走 MFT 全量扫描 */
function normalizeScanPath(p: string): string {
  const s = p.trim().replace(/\//g, '\\')
  if (/^[A-Za-z]:$/.test(s)) return s + '\\'
  return s
}

const DEFAULT_PROMPT_INSTRUCTION = '请根据以上占用，简要指出可安全清理或迁移的大项，并给出操作建议。'
const SKIP_SAFELIST_CONFIRM_KEY = 'skip-add-to-safelist-confirm'

async function loadPromptInstruction(): Promise<string> {
    try {
        const stored = await readStorageFile(PROMPT_INSTRUCTION_FILE)
        return stored || DEFAULT_PROMPT_INSTRUCTION
    } catch { return DEFAULT_PROMPT_INSTRUCTION }
}

async function savePromptInstruction(instruction: string): Promise<void> {
    try {
        await writeStorageFile(PROMPT_INSTRUCTION_FILE, instruction)
    } catch {
        // ignore storage errors
    }
}

/** AI 提示面板 */
function AIPromptPanel({ result }: { result: ScanResult }) {
    const { t } = useTranslation()
    const [fileListSummary, setFileListSummary] = useState('')
    const [instruction, setInstruction] = useState(DEFAULT_PROMPT_INSTRUCTION)
    const [copied, setCopied] = useState(false)
    // 文件数量滑块值，与设置中的「Prompt 文件数量」完全共用同一配置，范围 20–2000（与设置对话框一致）
    const PROMPT_FILE_COUNT_MIN = 20
    const PROMPT_FILE_COUNT_MAX = 2000
    const [fileCount, setFileCount] = useState(100)

    // 加载保存的表格行数（与设置中的「Prompt 文件数量」共用 app-settings.json，范围 20–2000）
    useEffect(() => {
        let cancelled = false
        loadAppSettings().then(s => {
            if (!cancelled) {
                const count = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, s.promptFileCount))
                setFileCount(count)
            }
        })
        return () => {
            cancelled = true
        }
    }, [])

    // 表格行数变化时保存到应用设置（与设置对话框完全同步）
    useEffect(() => {
        if (fileCount >= PROMPT_FILE_COUNT_MIN && fileCount <= PROMPT_FILE_COUNT_MAX) {
            loadAppSettings().then(s => void saveAppSettings({ ...s, promptFileCount: fileCount }))
        }
    }, [fileCount])

    // 当 result 或 fileCount 改变时，重新生成摘要
    useEffect(() => {
        let cancelled = false
        // 使用 fileCount 参数，确保表格行数变化时能正确更新

        
        buildFileListSummary(result, fileCount).then(summary => {
            
            if (!cancelled) {
                setFileListSummary(summary)
            }
        })
        return () => {
            cancelled = true
        }
        // 明确列出所有依赖项，确保 fileCount 变化时能触发更新
    }, [result.file_count, result.total_size, result.scan_time_ms, fileCount, result])

    useEffect(() => {
        loadPromptInstruction().then(setInstruction)
    }, [])

    useEffect(() => {
        void savePromptInstruction(instruction)
    }, [instruction])

    const copy = useCallback(() => {
        const fullPrompt = fileListSummary + '\n' + instruction
        void navigator.clipboard.writeText(fullPrompt).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [fileListSummary, instruction])

    return (
        <div className="flex flex-col p-6 gap-6 bg-white dark:bg-gray-800 rounded-3xl h-full animate-in fade-in duration-500">
            <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                            <MessageSquare size={20} />
                        </div>
                        <div>
                            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'secondary.main' }}>{t('aiAnalysis.suggestionGeneration')}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('aiAnalysis.dataReady')}</Typography>
                        </div>
                    </div>
                    <Button
                        onClick={copy}
                        variant="contained"
                        size="small"
                        startIcon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                        sx={{
                            borderRadius: '10px',
                            px: 3,
                            py: 0.9,
                            textTransform: 'none',
                            bgcolor: copied ? '#4caf50' : 'primary.main',
                            color: '#1A1A1A',
                            fontWeight: 700,
                            fontSize: '12px',
                            boxShadow: 'none',
                            '&:hover': {
                                bgcolor: copied ? '#45a049' : 'primary.dark',
                                color: '#1A1A1A',
                            }
                        }}
                    >
                        {copied ? t('common.copied') : t('common.copyAll')}
                    </Button>
                </div>
                {/* 文件数量滑块 - 移动到顶部 */}
                <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }} className="dark:!bg-gray-700/30 dark:!border-gray-600">
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t('aiAnalysis.tableRows')}
                        </Typography>
                        <TextField
                            size="small"
                            value={fileCount}
                            onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                if (raw === '') {
                                    setFileCount(PROMPT_FILE_COUNT_MIN)
                                    return
                                }
                                const v = parseInt(raw, 10)
                                if (!isNaN(v)) {
                                    const clamped = Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, v))
                                    setFileCount(clamped)
                                }
                            }}
                            inputProps={{
                                inputMode: 'numeric',
                                style: { textAlign: 'right', fontSize: '12px', fontWeight: 700, width: 56 },
                            }}
                            sx={{
                                '& .MuiInputBase-root': { fontSize: '12px' },
                                '& input': { py: 0.5, fontVariantNumeric: 'tabular-nums' },
                            }}
                        />
                    </Box>
                    <Slider
                        min={PROMPT_FILE_COUNT_MIN}
                        max={PROMPT_FILE_COUNT_MAX}
                        step={10}
                        value={Math.min(PROMPT_FILE_COUNT_MAX, Math.max(PROMPT_FILE_COUNT_MIN, fileCount))}
                        onChange={(_, value) => setFileCount(value as number)}
                        sx={{ 
                            color: 'primary.main',
                            height: 4,
                            '& .MuiSlider-thumb': {
                                width: 14,
                                height: 14,
                            },
                            '& .MuiSlider-track': {
                                height: 4,
                            },
                            '& .MuiSlider-rail': {
                                height: 4,
                            },
                        }}
                        marks={[
                            { value: PROMPT_FILE_COUNT_MIN, label: '20' },
                            { value: 500, label: '500' },
                            { value: 1000, label: '1000' },
                            { value: PROMPT_FILE_COUNT_MAX, label: '2000' },
                        ]}
                    />
                    <FormHelperText sx={{ fontSize: '10px', m: 0, mt: 0.5, color: 'text.secondary' }}>
                        {t('aiAnalysis.controlTableRows', { count: result.file_count })}
                    </FormHelperText>
                </Box>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.diskUsageSummary')}</span>
                    </div>
                    <div className="bg-slate-50 dark:bg-gray-700/50 rounded-2xl p-4 border border-slate-100 dark:border-gray-600 flex-1 overflow-y-auto min-h-0 thin-scrollbar" style={{ maxHeight: '100%' }}>
                        <pre className="text-xs text-slate-600 dark:text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">{fileListSummary}</pre>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">{t('aiAnalysis.customPrompt')}</span>
                    <TextField
                        multiline fullWidth value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder={t('aiAnalysis.inputPrompt')}
                        sx={{
                            flex: 1,
                            '& .MuiInputBase-root': {
                                height: '100%',
                                borderRadius: '20px',
                                bgcolor: 'background.paper',
                                fontSize: '14px',
                                '& fieldset': {
                                    borderColor: 'divider',
                                },
                                '&:hover fieldset': {
                                    borderColor: 'primary.main',
                                },
                                '&.Mui-focused fieldset': {
                                    borderColor: 'primary.main',
                                },
                            },
                            '& textarea': {
                                height: '100% !important',
                                color: 'text.primary',
                            },
                            '& .MuiInputBase-input::placeholder': {
                                color: 'text.secondary',
                                opacity: 0.6,
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

function displayPath(raw: string): string {
    return raw.replace(/^\\\\\?\\/, '')
}

function formatModified(ts: number | undefined | null): string {
    if (ts == null) return '-'
    try {
        const d = new Date(ts * 1000)
        return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    } catch {
        return '-'
    }
}

async function buildFileListSummary(result: ScanResult, fileCount?: number): Promise<string> {
    // 如果没有指定 fileCount，则从设置中读取
    if (fileCount === undefined) {
        const settings = await loadAppSettings()
        fileCount = settings.promptFileCount
    }

    const count = fileCount
    let candidates: { path: string; size: number; modified?: number | null }[]

    // 优先使用后端提供的 top_files（MFT 扫描时已按大小排序），先取全部候选，再按安全名单过滤并补足行数
    if (result.top_files && result.top_files.length > 0) {
        candidates = result.top_files.map((n) => ({
            path: n.path,
            size: n.size,
            modified: n.modified ?? null,
        }))
    } else {
        const nodes: { path: string; size: number; modified?: number | null }[] = []
        function collect(n: TreemapNode, depth: number) {
            if (depth > 20) return
            if (!n.is_dir) nodes.push({ path: n.path || n.name, size: n.size, modified: n.modified })
            if (n.children?.length) {
                [...n.children].sort((a, b) => b.size - a.size).slice(0, 10).forEach((c) => collect(c, depth + 1))
            }
        }
        collect(result.root, 0)
        candidates = nodes.sort((a, b) => b.size - a.size)
    }

    // 排除安全名单中的路径，再取前 count 条，保证表格行数为用户设定且仍按大小从大到小
    const safeList = await loadSafeListPaths()
    const items = candidates
        .filter((n) => !isPathInSafeList(n.path, safeList))
        .slice(0, count)

    const header = '| 路径 | 大小 | 最近修改时间 |\n| --- | --- | --- |\n'
    const rows = items.map((n) => `| ${displayPath(n.path)} | ${formatBytes(n.size)} | ${formatModified(n.modified)} |`).join('\n')
    return `[磁盘分析结果]\n总大小: ${formatBytes(result.total_size)}，文件数: ${result.file_count}\n\n${header}${rows}`
}

export interface ExpertModeProps {
    onOpenSettings?: () => void
    loadedSnapshot?: Snapshot | null
    onSnapshotLoaded?: () => void
    settingsSavedTrigger?: number  // 设置保存触发器
    onAddMigrateTask?: (sourcePath: string, fileSize: number, targetConfigs: CloudStorageConfig[], targetPath: string) => string
    onFileDeleted?: (callback: ((path: string) => void) | null) => void  // 设置文件删除通知回调
    tasks?: Task[]  // 任务队列，用于同步状态
}

export function ExpertMode({ onOpenSettings, loadedSnapshot, onSnapshotLoaded, settingsSavedTrigger, onAddMigrateTask, onFileDeleted, tasks = [] }: ExpertModeProps) {
    const { t } = useTranslation()
    const [path, setPath] = useState('')
    const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [result, setResult] = useState<ScanResult | null>(null)
    const [isAdmin, setIsAdmin] = useState<boolean | null>(false)
    const [hoverNode, setHoverNode] = useState<TreemapNode | null>(null)
    const [progressFiles, setProgressFiles] = useState(0)
    const [, setProgressMessage] = useState('')
    const [viewMode, setViewMode] = useState<'disk' | 'ai-prompt'>('disk')
    const [shallowDirs, setShallowDirs] = useState(true)
    const openedSettingsForStandardRef = useRef(false)

    // 标准模式 AI 分析状态
    const [aiAnalyzing, setAiAnalyzing] = useState(false)
    const [aiProgress, setAiProgress] = useState('')
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set())
    const [actionFilter, setActionFilter] = useState<'all' | 'delete' | 'move'>('all')
    const [hoveredPieIndex, setHoveredPieIndex] = useState<number | null>(null)
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
    // 操作类型覆盖映射：允许用户手动切换删除和迁移
    const [actionOverrides, setActionOverrides] = useState<Map<string, 'delete' | 'move'>>(new Map())

    // 快照保存对话框
    const [showSaveDialog, setShowSaveDialog] = useState(false)
    const [snapshotName, setSnapshotName] = useState('')

    // 加入安全名单确认对话框
    const [safeListDialog, setSafeListDialog] = useState<{ open: boolean; path: string | null; dontRemind: boolean }>({ open: false, path: null, dontRemind: false })
    // 本页已加入安全名单的路径，从右侧列表中隐藏（不删数据，仅不展示）
    const [addedToSafeListPaths, setAddedToSafeListPaths] = useState<Set<string>>(new Set())

    // 云存储选择相关状态
    const [showCloudSelector, setShowCloudSelector] = useState(false)
    const [availableConfigs, setAvailableConfigs] = useState<CloudStorageConfig[]>([])
    const [selectedMigrationConfigs, setSelectedMigrationConfigs] = useState<CloudStorageConfig[]>([])
    const [migrationTargetNames, setMigrationTargetNames] = useState<string>('')

    useEffect(() => {
        let unlistenProgress: (() => void) | undefined
        let unlistenMftStatus: (() => void) | undefined
        getCurrentWindow().listen<[number, string]>('scan-progress', (ev) => {
            setProgressFiles(ev.payload[0])
            if (ev.payload[1]) setProgressMessage(ev.payload[1])
        })
            .then((fn) => { unlistenProgress = fn })
        getCurrentWindow().listen<[string, boolean]>('scan-mft-status', (ev) => {
            const [path, usedMft] = ev.payload
            if (usedMft) {
                console.log('[DiskRookie] 本次扫描已成功使用 MFT 技术，路径:', path)
            } else {
                console.log('[DiskRookie] 本次扫描未使用 MFT（普通目录遍历），路径:', path)
            }
        }).then((fn) => { unlistenMftStatus = fn })
        return () => {
            unlistenProgress?.()
            unlistenMftStatus?.()
        }
    }, [])

    const runScan = useCallback(async (targetPath: string) => {
        if (!targetPath) return
        const pathToScan = normalizeScanPath(targetPath)
        setStatus('scanning'); setErrorMsg(''); setResult(null); setProgressFiles(0); setProgressMessage(''); setAnalysisResult(null); setActionFilter('all'); setActionOverrides(new Map());
        try {
            const appSettings = await loadAppSettings()
            const useMft = appSettings.useMftScan !== false
            const res = await invoke<ScanResult>('scan_path_command', { path: pathToScan, shallowDirs, useMft })
            setResult(res); setStatus('done');

            // 标准模式：扫描完成后自动调用 AI 分析，表格行数使用用户设置并已保存的本地位（与设置中的「Prompt 文件数量」一致）
            if (isAdmin === false) {
                setAiAnalyzing(true)
                setAiProgress(t('aiAnalysis.preparing'))
                try {
                    const summary = await buildFileListSummary(res, appSettings.promptFileCount)
                    const aiResult = await analyzeWithAI(summary, (msg) => setAiProgress(msg))
                    setAnalysisResult(aiResult)
                    // AI分析完成后显示系统通知（Windows右下角/macOS右上角）
                    const suggestionCount = aiResult.suggestions.length
                    const notificationBody = suggestionCount > 0 
                        ? t('aiAnalysis.foundSuggestions', { count: suggestionCount })
                        : aiResult.summary || t('aiAnalysis.noSuggestions')
                    await showNotification(t('aiAnalysis.complete'), notificationBody)
                } catch (aiError) {
                    setErrorMsg(`${t('aiAnalysis.failed')}: ${aiError}`)
                    // 分析失败时也显示系统通知
                    await showNotification(t('aiAnalysis.failed'), String(aiError))
                } finally {
                    setAiAnalyzing(false)
                    setAiProgress('')
                }
            }
        } catch (e) {
            setStatus('error'); setErrorMsg(String(e));
        }
    }, [shallowDirs, isAdmin])

    const handleBrowseFolder = useCallback(async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
            const pathStr = typeof selected === 'string' ? selected : selected[0];
            setPath(pathStr); await runScan(pathStr);
        }
    }, [runScan])

    const handleDelete = useCallback(async (itemPath: string) => {
        await deleteItem(itemPath)
        setDeletedPaths(prev => new Set([...prev, itemPath]))
        // 从选中项中移除已删除的项
        setSelectedItems(prev => {
            const next = new Set(prev)
            next.delete(itemPath)
            return next
        })
    }, [])

    // 处理选中状态变化
    const handleSelectChange = useCallback((path: string, selected: boolean) => {
        setSelectedItems(prev => {
            const next = new Set(prev)
            if (selected) {
                next.add(path)
            } else {
                next.delete(path)
            }
            return next
        })
    }, [])

    // 切换操作类型（删除 <-> 迁移）
    const handleToggleAction = useCallback((path: string, currentAction: 'delete' | 'move') => {
        setActionOverrides(prev => {
            const next = new Map(prev)
            const newAction = currentAction === 'delete' ? 'move' : 'delete'
            next.set(path, newAction)
            return next
        })
    }, [])

    // 获取实际的操作类型（考虑覆盖）
    const getActualAction = useCallback((path: string, originalAction: 'delete' | 'move'): 'delete' | 'move' => {
        return actionOverrides.get(path) || originalAction
    }, [actionOverrides])

    // 点击「加入安全名单」：若用户勾选过「不再提醒」则直接加入并从列表移除，否则弹窗确认
    const handleAddToSafeListClick = useCallback(async (itemPath: string) => {
        const skipConfirm = await readStorageFile(SKIP_SAFELIST_CONFIRM_KEY)
        if (skipConfirm === 'true') {
            await addToSafeList(itemPath)
            setAddedToSafeListPaths((prev) => new Set([...prev, itemPath]))
            return
        }
        setSafeListDialog({ open: true, path: itemPath, dontRemind: false })
    }, [])

    // 安全名单确认对话框：确认后加入并可选「不再提醒」，并从右侧列表中移除该条
    const handleSafeListConfirm = useCallback(async () => {
        const { path: itemPath, dontRemind } = safeListDialog
        if (!itemPath) {
            setSafeListDialog({ open: false, path: null, dontRemind: false })
            return
        }
        await addToSafeList(itemPath)
        setAddedToSafeListPaths((prev) => new Set([...prev, itemPath]))
        if (dontRemind) {
            await writeStorageFile(SKIP_SAFELIST_CONFIRM_KEY, 'true')
        }
        setSafeListDialog({ open: false, path: null, dontRemind: false })
    }, [safeListDialog])

    // 解析文件大小字符串为字节数
    const parseSizeToBytes = (sizeStr: string): number => {
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

    // 一键全选/取消全选
    const handleSelectAll = useCallback(() => {
        if (!analysisResult) return
        
        const allPaths = analysisResult.suggestions
            .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
            .filter(s => {
                const actualAction = getActualAction(s.path, s.action)
                return actionFilter === 'all' || actualAction === actionFilter
            })
            .map(s => s.path)
        
        // 检查是否已全选，如果是则取消全选
        const allSelected = allPaths.every(p => selectedItems.has(p))
        if (allSelected) {
            setSelectedItems(new Set())
        } else {
            setSelectedItems(new Set(allPaths))
        }
    }, [analysisResult, deletedPaths, addedToSafeListPaths, actionFilter, selectedItems, getActualAction])

    const handleMove = useCallback(async (itemPath: string, configs?: CloudStorageConfig[], targetPath?: string, fileSize?: number) => {
        // 使用传入的 configs 或全局设置的 selectedMigrationConfigs
        const targetConfigs = configs || selectedMigrationConfigs
        const cloudPath = targetPath || '/'

        if (!targetConfigs || targetConfigs.length === 0) {
            throw new Error('未选择云存储目标')
        }

        // 如果有任务队列回调，则添加到队列
        if (onAddMigrateTask) {
            // 获取文件大小（如果没有传入）
            const size = fileSize || 0
            onAddMigrateTask(itemPath, size, targetConfigs, cloudPath)
            return
        }

        // 否则直接执行（兼容旧逻辑）
        console.log('迁移文件到云存储:', { itemPath, targetConfigs, cloudPath })

        // 动态导入 refreshGoogleToken
        const { refreshGoogleToken } = await import('../services/settings')

        // 构建上传配置，并检查/刷新 token
        const uploadConfigs = []
        for (const config of targetConfigs) {
            if (!config.accessToken) {
                throw new Error(`${config.name} 未登录，请先在设置中配置云存储`)
            }

            let accessToken = config.accessToken

            // 检查 token 是否即将过期（5分钟内）
            if (config.tokenExpiry) {
                const expiryBuffer = 5 * 60 * 1000 // 5 分钟
                if (config.tokenExpiry - Date.now() < expiryBuffer) {
                    if (!config.refreshToken) {
                        throw new Error(`${config.name} 登录已过期，请重新登录`)
                    }
                    // 刷新 token
                    console.log(`刷新 ${config.name} 的 token...`)
                    try {
                        const newTokens = await refreshGoogleToken(config.refreshToken)
                        accessToken = newTokens.access_token
                    } catch (e) {
                        throw new Error(`${config.name} token 刷新失败: ${e}`)
                    }
                }
            }

            uploadConfigs.push({
                provider: config.provider,
                name: config.name,
                access_token: accessToken,
                target_path: cloudPath,
            })
        }

        // 调用后端上传 API
        interface UploadResult {
            success: boolean
            provider: string
            file_id: string | null
            message: string
        }

        const results = await invoke<UploadResult[]>('upload_to_cloud', {
            filePath: itemPath,
            configs: uploadConfigs,
        })

        // 检查上传结果
        const failed = results.filter(r => !r.success)
        if (failed.length > 0) {
            throw new Error(failed.map(r => r.message).join('\n'))
        }

        console.log('上传成功:', results)
    }, [selectedMigrationConfigs, onAddMigrateTask])

    // 一键执行选中的操作
    const handleBatchExecute = useCallback(async () => {
        if (selectedItems.size === 0 || !analysisResult) return
        
        const itemsToProcess = analysisResult.suggestions.filter(s => 
            selectedItems.has(s.path) && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
        )

        // 检查是否有迁移操作且没有配置云存储（使用实际的操作类型）
        const hasMoveItems = itemsToProcess.some(item => {
            const actualAction = getActualAction(item.path, item.action)
            return actualAction === 'move'
        })
        if (hasMoveItems && selectedMigrationConfigs.length === 0) {
            // 先获取可用的云存储配置
            const configs = await getEnabledCloudStorageConfigs()
            // 打开选择云存储目标对话框（如果没有配置，对话框内会显示链接到设置）
            setAvailableConfigs(configs)
            setShowCloudSelector(true)
            return
        }
        
        let successCount = 0
        let failCount = 0

        for (const item of itemsToProcess) {
            try {
                const actualAction = getActualAction(item.path, item.action)
                if (actualAction === 'delete') {
                    await handleDelete(item.path)
                    successCount++
                } else if (actualAction === 'move') {
                    // 执行迁移操作
                    const fileSize = parseSizeToBytes(item.size)
                    await handleMove(item.path, selectedMigrationConfigs, '/', fileSize)
                    successCount++
                }
            } catch (err) {
                console.error(`处理 ${item.path} 失败:`, err)
                failCount++
            }
        }

        // 显示完成通知
        if (failCount === 0) {
            showNotification(t('batch.executeComplete'), t('batch.successCount', { count: successCount }))
        } else {
            showNotification(t('batch.executeComplete'), t('batch.successAndFailed', { success: successCount, failed: failCount }))
        }
        
        // 清空选中状态
        setSelectedItems(new Set())
    }, [selectedItems, analysisResult, deletedPaths, addedToSafeListPaths, handleDelete, handleMove, selectedMigrationConfigs, getActualAction])

    // 保存快照
    const handleSaveSnapshot = useCallback(() => {
        if (!result || !path) return

        // 默认快照名称：路径的最后一部分 + 时间
        const pathParts = path.split(/[/\\]/).filter(Boolean)
        const defaultName = `${pathParts[pathParts.length - 1] || '未命名'} - ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        setSnapshotName(defaultName)
        setShowSaveDialog(true)
    }, [result, path])

    const handleConfirmSaveSnapshot = useCallback(async () => {
        if (!result || !path || !snapshotName.trim()) return

        try {
            await saveSnapshot({
                name: snapshotName.trim(),
                path,
                scanResult: result,
            })
            setShowSaveDialog(false)
            setSnapshotName('')
            showNotification(t('snapshot.saveSuccess'), t('snapshot.savedSnapshot', { name: snapshotName.trim() }))
        } catch (e) {
            showNotification(t('snapshot.saveFailed'), String(e))
        }
    }, [result, path, snapshotName])

    // 设置迁移目标
    const handleSetMigrationTarget = useCallback(async () => {
        const configs = await getEnabledCloudStorageConfigs()
        // 打开选择云存储目标对话框（如果没有配置，对话框内会显示链接到设置）
        setAvailableConfigs(configs)
        setShowCloudSelector(true)
    }, [])

    // 处理云存储选择
    const handleCloudStorageSelected = useCallback((configs: CloudStorageConfig[]) => {
        setSelectedMigrationConfigs(configs)
        setShowCloudSelector(false)

        // 更新显示的目标名称（只显示服务商名称）
        if (configs.length === 0) {
            setMigrationTargetNames('')
        } else if (configs.length === 1) {
            // 获取服务商显示名称
            const providerInfo = CLOUD_STORAGE_PROVIDERS.find(p => p.id === configs[0].provider)
            setMigrationTargetNames(providerInfo?.name || configs[0].provider)
        } else {
            setMigrationTargetNames(`${configs.length} 个云存储`)
        }
    }, [])

    // 加载快照
    useEffect(() => {
        if (!loadedSnapshot) return

        setPath(loadedSnapshot.path)
        setResult(loadedSnapshot.scanResult)
        setStatus('done')
        setAnalysisResult(null)
        setDeletedPaths(new Set())
        setActionFilter('all')
        setActionOverrides(new Map())

        // 标准模式：加载快照后自动进行 AI 分析
        if (isAdmin === false) {
            setAiAnalyzing(true)
            setAiProgress(t('aiAnalysis.preparing'))

            const runAIAnalysis = async () => {
                try {
                    const summary = await buildFileListSummary(loadedSnapshot.scanResult)
                    const aiResult = await analyzeWithAI(summary, (msg) => setAiProgress(msg))
                    setAnalysisResult(aiResult)
                } catch (aiError) {
                    setErrorMsg(`${t('aiAnalysis.failed')}: ${aiError}`)
                } finally {
                    setAiAnalyzing(false)
                    setAiProgress('')
                }
            }

            void runAIAnalysis()
        }

        // 清除已加载的快照
        onSnapshotLoaded?.()
    }, [loadedSnapshot, isAdmin, onSnapshotLoaded])

    // 核心：API 配置校验
    const [standardModeNoApi, setStandardModeNoApi] = useState(false)

    // 根据文件路径查找对应的任务状态
    const getTaskForPath = useCallback((filePath: string): Task | undefined => {
        return tasks.find(task => task.sourcePath === filePath && (task.status === 'pending' || task.status === 'uploading'))
    }, [tasks])

    // 注册文件删除通知回调，当迁移任务完成并删除文件时调用
    useEffect(() => {
        if (onFileDeleted) {
            const handleFileDeleted = (path: string) => {
                setDeletedPaths(prev => new Set([...prev, path]))
                // 从选中项中移除已删除的项
                setSelectedItems(prev => {
                    const next = new Set(prev)
                    next.delete(path)
                    return next
                })
            }
            onFileDeleted(handleFileDeleted)
            // 清理函数：组件卸载时移除回调
            return () => {
                onFileDeleted(null)
            }
        }
    }, [onFileDeleted])

    useEffect(() => {
        if (isAdmin === false) {
            loadSettings().then(settings => {
                setStandardModeNoApi(!settings.apiKey?.trim())
            })
        }
    }, [isAdmin, settingsSavedTrigger])

    useEffect(() => {
        if (isAdmin === false && onOpenSettings && !openedSettingsForStandardRef.current && standardModeNoApi) {
            openedSettingsForStandardRef.current = true
            onOpenSettings()
        }
    }, [isAdmin, onOpenSettings, standardModeNoApi])

    return (
        <div className="flex-1 flex flex-col gap-6 p-2 min-h-0 text-slate-800 dark:text-gray-200 font-sans">
            {/* 核心操作区 */}
            <div className="space-y-3 shrink-0">
                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-600 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[260px] relative">
                        <Folder className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-400 pointer-events-none z-10" size={16} />
                        <TextField
                            fullWidth size="small" value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder={t('expertMode.inputOrSelectPath')}
                            sx={{
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '12px', pl: '32px', fontSize: '13px',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? '#374151' : '#F3F4F6',
                                    color: (theme) => theme.palette.mode === 'dark' ? '#f3f4f6' : 'inherit',
                                    '& fieldset': { borderColor: 'transparent' },
                                    '&.Mui-focused fieldset': { borderColor: 'primary.main' },
                                    '&:hover': {
                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? '#4b5563' : undefined,
                                    },
                                    '& input::placeholder': { opacity: (theme) => theme.palette.mode === 'dark' ? 0.6 : 1, color: (theme) => theme.palette.mode === 'dark' ? '#9ca3af' : 'inherit' },
                                }
                            }}
                        />
                    </div>
                    <div className="flex gap-1.5">
                        <Button
                            onClick={handleBrowseFolder}
                            disabled={standardModeNoApi}
                            variant="outlined"
                            size="small"
                            startIcon={<Folder size={14} />}
                            sx={{
                                borderRadius: '10px',
                                px: 2,
                                py: 0.9,
                                color: 'primary.main',
                                borderColor: 'primary.main',
                                textTransform: 'none',
                                fontWeight: 600,
                                fontSize: '12px',
                                '&:hover': {
                                    bgcolor: 'primary.main',
                                    color: '#1A1A1A',
                                    borderColor: 'primary.main',
                                }
                            }}
                        >
                            {t('expertMode.selectFolder')}
                        </Button>
                        <Button
                            onClick={() => runScan(path)}
                            disabled={status === 'scanning' || standardModeNoApi || !path}
                            variant="contained"
                            size="small"
                            sx={{
                                borderRadius: '10px', px: 3, py: 0.9, bgcolor: 'primary.main', color: '#1A1A1A',
                                fontWeight: 700, fontSize: '12px', textTransform: 'none', boxShadow: 'none',
                                '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                            }}
                        >
                            {status === 'scanning' ? t('expertMode.scanning') : t('expertMode.startScan')}
                        </Button>
                        {/* 只在开发者模式下显示保存快照按钮 */}
                        {result && status === 'done' && isAdmin && (
                            <Tooltip title={t('snapshot.saveSnapshot')} arrow>
                                <Button
                                    onClick={handleSaveSnapshot}
                                    variant="outlined"
                                    size="small"
                                    startIcon={<Save size={14} />}
                                    sx={{
                                        borderRadius: '10px',
                                        px: 2,
                                        py: 0.9,
                                        color: 'primary.main',
                                        borderColor: 'primary.main',
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        fontSize: '12px',
                                        '&:hover': {
                                            bgcolor: 'primary.main',
                                            color: '#1A1A1A',
                                            borderColor: 'primary.main',
                                        }
                                    }}
                                >
                                    {t('snapshot.saveSnapshot')}
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                {/* 搜索下方：左侧 group(checkbox + 标准/开发者) | 右侧 三个统计 */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30">
                        <label className="flex items-center gap-2 cursor-pointer group w-fit select-none">
                            <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${shallowDirs ? 'bg-primary border-primary' : 'border-slate-300 dark:border-gray-500'}`}>
                                {shallowDirs && <CheckCircle2 size={10} className="text-secondary" />}
                            </div>
                            <input type="checkbox" className="hidden" checked={shallowDirs} onChange={(e) => setShallowDirs(e.target.checked)} />
                            <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 group-hover:text-secondary">{t('expertMode.shallowDirs')}</span>
                        </label>
                        <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />
                        <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                            <button
                                onClick={() => setIsAdmin(false)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${!isAdmin ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                {t('expertMode.standardMode')}
                            </button>
                            <button
                                onClick={() => setIsAdmin(true)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${isAdmin ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                {t('expertMode.developerMode')}
                            </button>
                        </div>
                    </div>
                    {result && (() => {
                        const stats = [
                            { label: t('expertMode.processTime'), val: formatDuration(result.scan_time_ms), Icon: Clock },
                            { label: t('expertMode.totalFiles'), val: result.file_count.toLocaleString(), Icon: FileStack },
                            { label: t('expertMode.diskUsage'), val: formatBytes(result.total_size), Icon: HardDrive },
                            ...(result.volume_total_bytes != null && result.volume_total_bytes > 0
                                ? [{ label: t('expertMode.volumeCapacity'), val: formatBytes(result.volume_total_bytes), Icon: HardDrive }]
                                : [])
                        ]
                        const tooltipTitle = stats.map(({ label, val }) => `${label}: ${val}`).join(' · ')
                        return (
                            <div className="flex flex-col items-end gap-1">
                                {result.scan_warning && (
                                    <span className="text-amber-600 dark:text-amber-400 text-xs font-medium" title={result.scan_warning}>
                                        {t('expertMode.scanHasError')}
                                    </span>
                                )}
                                <div className="flex items-center gap-2">
                                {/* 一键全选/取消全选按钮 */}
                                {analysisResult && (() => {
                                    const visibleItems = analysisResult.suggestions
                                        .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                        .filter(s => actionFilter === 'all' || s.action === actionFilter)
                                    if (visibleItems.length === 0) return null
                                    const allSelected = visibleItems.every(s => selectedItems.has(s.path))
                                    return (
                                        <Button
                                            onClick={handleSelectAll}
                                            variant="outlined"
                                            size="small"
                                            sx={{
                                                borderRadius: '10px',
                                                px: 1.5,
                                                py: 0.8,
                                                color: 'primary.main',
                                                borderColor: 'primary.main',
                                                fontWeight: 700,
                                                fontSize: '11px',
                                                textTransform: 'none',
                                                '&:hover': {
                                                    bgcolor: 'primary.main',
                                                    color: '#1A1A1A',
                                                    borderColor: 'primary.main',
                                                }
                                            }}
                                        >
                                            {allSelected ? t('common.deselectAll') : t('common.selectAll')}
                                        </Button>
                                    )
                                })()}
                                {/* 一键执行按钮 - 当有选中项时显示 */}
                                {selectedItems.size > 0 && (
                                    <Button
                                        onClick={handleBatchExecute}
                                        variant="contained"
                                        size="small"
                                        startIcon={<Play size={14} />}
                                        sx={{
                                            borderRadius: '10px',
                                            px: 2,
                                            py: 0.8,
                                            bgcolor: 'primary.main',
                                            color: '#1A1A1A',
                                            fontWeight: 700,
                                            fontSize: '11px',
                                            textTransform: 'none',
                                            boxShadow: 'none',
                                            '&:hover': {
                                                bgcolor: 'primary.dark',
                                                boxShadow: 'none',
                                            }
                                        }}
                                    >
                                        {t('common.execute')} ({selectedItems.size})
                                    </Button>
                                )}
                                <Tooltip title={tooltipTitle} arrow placement="bottom">
                                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30 cursor-default">
                                        {stats.map(({ label, val, Icon }, idx) => (
                                            <span key={label} className="flex items-center gap-2">
                                                {idx > 0 && <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />}
                                                <Icon size={14} className="text-slate-400 dark:text-gray-400 shrink-0" />
                                                <span className="text-[11px] dark:text-gray-300 font-semibold text-secondary tabular-nums">{val}</span>
                                            </span>
                                        ))}
                                    </div>
                                </Tooltip>
                                </div>
                            </div>
                        )
                    })()}
                </div>

                {/* 错误提示与 API 警告 */}
                <Fade in={status === 'error' || standardModeNoApi}>
                    <div className="space-y-2">
                        {status === 'error' && (
                            <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-800 text-sm">
                                <AlertCircle size={16} />
                                <span className="font-medium">{errorMsg}</span>
                            </div>
                        )}
                        {standardModeNoApi && (
                            <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl border border-amber-100 dark:border-amber-800 text-sm">
                                <div className="flex items-center gap-2">
                                    <Settings size={16} />
                                    <span className="font-medium">{t('expertMode.needApiConfig')}</span>
                                </div>
                                <Button size="small" onClick={onOpenSettings} sx={{ fontWeight: 600, fontSize: '11px', color: 'inherit', textDecoration: 'underline', minWidth: 'auto', px: 1 }}>
                                    {t('common.goSettings')}
                                </Button>
                            </div>
                        )}
                    </div>
                </Fade>
            </div>

            {/* 扫描中状态：脉动动画，无进度条 */}
            {status === 'scanning' && (
                <div className="p-10 flex flex-col items-center justify-center gap-4 animate-in zoom-in-95 duration-500">
                    <div className="relative">
                        <Cpu className="text-primary animate-pulse" size={48} />
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    </div>
                    <div className="text-center">
                        <Typography variant="h4" sx={{ fontWeight: 900, color: 'secondary.main' }}>{progressFiles.toLocaleString()}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>{t('expertMode.processedFiles')}</Typography>
                    </div>
                    <div className="flex gap-1 h-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="w-4 h-full bg-primary rounded-sm animate-pulse"
                                style={{ animationDelay: `${i * 0.1}s`, animationDuration: '1.2s' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* AI 分析中状态（标准模式） */}
            {aiAnalyzing && (
                <div className="p-10 flex flex-col items-center justify-center gap-4 animate-in zoom-in-95 duration-500">
                    <div className="relative">
                        <Sparkles className="text-primary animate-pulse" size={48} />
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    </div>
                    <div className="text-center">
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }} className="dark:text-gray-200">
                            {aiProgress || t('aiAnalysis.analyzing')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>
                            {t('aiAnalysis.analyzing2')}
                        </Typography>
                    </div>
                    <div className="flex gap-1 h-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                            <div
                                key={i}
                                className="w-4 h-full bg-primary rounded-sm animate-pulse"
                                style={{ animationDelay: `${i * 0.1}s`, animationDuration: '1.2s' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* 扫描结果展示 */}
            {result && !aiAnalyzing && (
                <div className="flex-1 flex flex-col gap-4 min-h-0 animate-in slide-in-from-bottom-8 duration-700">
                    {/* 标准模式：显示 AI 建议列表 */}
                    {isAdmin === false ? (
                        analysisResult ? (
                            <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                                {/* 左侧：饼图和摘要 */}
                                <div className="w-80 flex flex-col gap-3 shrink-0 overflow-y-auto pr-2" style={{ maxHeight: '100%' }}>
                                    {/* AI 分析摘要 */}
                                    <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Sparkles size={18} className="text-primary" />
                                            <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                                                {t('aiAnalysis.result')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-gray-400 leading-relaxed">
                                            {analysisResult.summary}
                                        </p>
                                        {analysisResult.tokenUsage && (
                                            <Tooltip title={`Prompt: ${analysisResult.tokenUsage.prompt_tokens} | Completion: ${analysisResult.tokenUsage.completion_tokens}`} arrow>
                                                <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono mt-2 inline-block">
                                                    Token: {analysisResult.tokenUsage.total_tokens}
                                                </span>
                                            </Tooltip>
                                        )}

                                        {/* 迁移目标设置按钮 */}
                                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-gray-700">
                                            <Button
                                                size="small"
                                                startIcon={<Cloud size={14} />}
                                                onClick={handleSetMigrationTarget}
                                                sx={{
                                                    fontSize: '11px',
                                                    textTransform: 'none',
                                                    borderRadius: '8px',
                                                    py: 0.75,
                                                    px: 1.5,
                                                    bgcolor: 'action.hover',
                                                    color: 'text.secondary',
                                                    '&:hover': {
                                                        bgcolor: 'action.selected',
                                                    },
                                                    width: '100%',
                                                    justifyContent: 'flex-start',
                                                }}
                                                className="dark:!bg-gray-700/50 dark:!text-gray-300 dark:hover:!bg-gray-700"
                                            >
                                                {migrationTargetNames ? (
                                                    <>
                                                        <span className="text-[10px] text-slate-500 dark:text-gray-400 mr-1">{t('aiAnalysis.migrateTo')}</span>
                                                        <span className="font-medium">{migrationTargetNames}</span>
                                                    </>
                                                ) : (
                                                    t('aiAnalysis.setMigrationTarget')
                                                )}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* 饼图：删除/迁移/保留占比 */}
                                    {(() => {
                                        const deleteSuggestions = analysisResult.suggestions.filter(s => {
                                            const actualAction = getActualAction(s.path, s.action)
                                            return actualAction === 'delete' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
                                        })
                                        const moveSuggestions = analysisResult.suggestions.filter(s => {
                                            const actualAction = getActualAction(s.path, s.action)
                                            return actualAction === 'move' && !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path)
                                        })

                                        // 解析大小字符串为字节数
                                        const parseSize = (sizeStr: string): number => {
                                            const units: { [key: string]: number } = {
                                                'B': 1,
                                                'KB': 1024,
                                                'MB': 1024 * 1024,
                                                'GB': 1024 * 1024 * 1024,
                                                'TB': 1024 * 1024 * 1024 * 1024,
                                            }
                                            const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/i)
                                            if (!match) return 0
                                            const value = parseFloat(match[1])
                                            const unit = match[2].toUpperCase()
                                            return value * (units[unit] || 1)
                                        }

                                        const deleteSize = deleteSuggestions.reduce((sum, s) => sum + parseSize(s.size), 0)
                                        const moveSize = moveSuggestions.reduce((sum, s) => sum + parseSize(s.size), 0)
                                        // 与当前卷容量对比：优先用 volume_total_bytes，无卷信息时回退到扫描总大小
                                        const volumeCapacity = (result?.volume_total_bytes != null && result.volume_total_bytes > 0)
                                            ? result.volume_total_bytes
                                            : (result?.total_size || 1)
                                        const remainSize = Math.max(0, volumeCapacity - deleteSize - moveSize)
                                        // 删除/迁移/保留占比 = 各自容量 / 卷容量，展示时上限 100%
                                        const deletePercent = Math.min(100, (deleteSize / volumeCapacity) * 100).toFixed(1)
                                        const movePercent = Math.min(100, (moveSize / volumeCapacity) * 100).toFixed(1)
                                        const remainPercent = Math.min(100, (remainSize / volumeCapacity) * 100).toFixed(1)

                                        // 检测是否为暗色模式
                                        const isDarkMode = document.documentElement.classList.contains('dark')

                                        // 定义颜色常量 - 删除(红)、迁移(蓝)、保留(灰)
                                        const colors = {
                                            delete: '#ef4444',
                                            move: '#3b82f6',
                                            keep: isDarkMode ? '#4b5563' : '#e2e8f0',  // 暗色模式下用更深的灰色
                                        }

                                        // 三部分数据：删除、迁移、保留
                                        const pieData = [
                                            { name: t('aiAnalysis.delete'), value: deleteSize, count: deleteSuggestions.length, percent: deletePercent, action: 'delete' as const, color: colors.delete },
                                            { name: t('aiAnalysis.migrate'), value: moveSize, count: moveSuggestions.length, percent: movePercent, action: 'move' as const, color: colors.move },
                                            { name: t('aiAnalysis.keep'), value: remainSize, count: 0, percent: remainPercent, action: 'keep' as const, color: colors.keep },
                                        ].filter(d => d.value > 0)

                                        // 非线性缓动函数
                                        const springEasing = 'cubic-bezier(0.34, 1.56, 0.64, 1)'  // 弹性回弹
                                        const smoothEasing = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'  // 平滑减速

                                        return (
                                            <div className="bg-white dark:bg-gray-800 px-4 py-6 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm dark:shadow-gray-900/20 flex flex-col items-center gap-3">
                                                <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-200 self-start">{t('aiAnalysis.suggestedActions')}</h3>
                                                <div className="relative w-full" style={{ height: 200 }}>
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={pieData}
                                                                cx="50%"
                                                                cy="50%"
                                                                innerRadius={hoveredPieIndex !== null && pieData[hoveredPieIndex]?.action !== 'keep' ? 42 : 45}
                                                                outerRadius={65}
                                                                paddingAngle={pieData.length > 1 ? 4 : 0}
                                                                dataKey="value"
                                                                cornerRadius={6}
                                                                onClick={(_, index) => {
                                                                    const clickedAction = pieData[index].action
                                                                    if (clickedAction === 'keep') return
                                                                    if (actionFilter === clickedAction) {
                                                                        setActionFilter('all')
                                                                    } else {
                                                                        setActionFilter(clickedAction)
                                                                    }
                                                                }}
                                                                onMouseEnter={(_, index) => setHoveredPieIndex(index)}
                                                                onMouseLeave={() => setHoveredPieIndex(null)}
                                                                animationBegin={0}
                                                                animationDuration={800}
                                                                animationEasing="ease-out"
                                                            >
                                                                {pieData.map((entry, index) => {
                                                                    const isHovered = hoveredPieIndex === index
                                                                    const isActive = actionFilter === entry.action
                                                                    const isKeep = entry.action === 'keep'
                                                                    const opacity = isKeep
                                                                        ? (isDarkMode ? 0.6 : 0.4)
                                                                        : (actionFilter === 'all' || isActive ? 1 : 0.3)

                                                                    return (
                                                                        <Cell
                                                                            key={`cell-${index}`}
                                                                            fill={entry.color}
                                                                            opacity={opacity}
                                                                            stroke={isHovered && !isKeep ? (isDarkMode ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.9)') : 'none'}
                                                                            strokeWidth={isHovered && !isKeep ? 3 : 0}
                                                                            style={{
                                                                                outline: 'none',
                                                                                cursor: isKeep ? 'default' : 'pointer',
                                                                                filter: isHovered && !isKeep
                                                                                    ? `drop-shadow(0 4px 12px ${entry.color}60)`
                                                                                    : 'none',
                                                                                transition: `all 0.5s ${springEasing}`,
                                                                            }}
                                                                        />
                                                                    )
                                                                })}
                                                            </Pie>
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                    {/* 中心文字 - 根据 hover 状态显示不同内容 */}
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        <div className="text-center">
                                                            {(() => {
                                                                const hoveredAction = hoveredPieIndex !== null ? pieData[hoveredPieIndex]?.action : null
                                                                const activeAction = actionFilter !== 'all' ? actionFilter : null
                                                                const displayAction = hoveredAction && hoveredAction !== 'keep' ? hoveredAction : activeAction

                                                                if (displayAction === 'delete') {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold"
                                                                                style={{
                                                                                    color: colors.delete,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {deletePercent}%
                                                                            </div>
                                                                            <div
                                                                                className="text-xs font-medium"
                                                                                style={{
                                                                                    color: colors.delete,
                                                                                    opacity: 0.8,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {t('aiAnalysis.toDelete')}
                                                                            </div>
                                                                        </>
                                                                    )
                                                                } else if (displayAction === 'move') {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold"
                                                                                style={{
                                                                                    color: colors.move,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {movePercent}%
                                                                            </div>
                                                                            <div
                                                                                className="text-xs font-medium"
                                                                                style={{
                                                                                    color: colors.move,
                                                                                    opacity: 0.8,
                                                                                    transition: `all 0.3s ${smoothEasing}`,
                                                                                }}
                                                                            >
                                                                                {t('aiAnalysis.toMigrate')}
                                                                            </div>
                                                                        </>
                                                                    )
                                                                } else {
                                                                    return (
                                                                        <>
                                                                            <div
                                                                                className="text-2xl font-bold text-slate-700 dark:text-gray-100"
                                                                                style={{ transition: `all 0.3s ${smoothEasing}` }}
                                                                            >
                                                                                {(parseFloat(deletePercent) + parseFloat(movePercent)).toFixed(1)}%
                                                                            </div>
                                                                            <div className="text-xs text-slate-500 dark:text-gray-400">{t('aiAnalysis.cleanable')}</div>
                                                                        </>
                                                                    )
                                                                }
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-2 w-full">
                                                    {pieData.filter(d => d.action !== 'keep').map((item, index) => (
                                                        <button
                                                            key={item.action}
                                                            onClick={() => {
                                                                if (actionFilter === item.action) {
                                                                    setActionFilter('all')
                                                                } else {
                                                                    setActionFilter(item.action)
                                                                }
                                                            }}
                                                            onMouseEnter={() => setHoveredPieIndex(index)}
                                                            onMouseLeave={() => setHoveredPieIndex(null)}
                                                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 ${actionFilter === 'all' || actionFilter === item.action
                                                                    ? 'bg-slate-100 dark:bg-gray-700/80 border-transparent'
                                                                    : 'bg-slate-50 dark:bg-gray-800/50 opacity-50 border-transparent'
                                                                }`}
                                                            style={{
                                                                transform: hoveredPieIndex === index ? 'scale(1.03) translateY(-2px)' : 'scale(1) translateY(0)',
                                                                boxShadow: hoveredPieIndex === index
                                                                    ? `0 8px 24px ${item.color}40, 0 0 0 2px ${item.color}30`
                                                                    : 'none',
                                                                borderColor: hoveredPieIndex === index ? `${item.color}50` : 'transparent',
                                                                transition: `all 0.4s ${springEasing}`,
                                                            }}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="w-3 h-3 rounded-full"
                                                                    style={{
                                                                        backgroundColor: item.color,
                                                                        transform: hoveredPieIndex === index ? 'scale(1.4)' : 'scale(1)',
                                                                        boxShadow: hoveredPieIndex === index ? `0 0 8px ${item.color}80` : 'none',
                                                                        transition: `all 0.4s ${springEasing}`,
                                                                    }}
                                                                ></div>
                                                                <span className="text-sm font-medium text-slate-700 dark:text-gray-200">
                                                                    {item.name}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-col items-end">
                                                                <span
                                                                    className="text-lg font-bold text-slate-700 dark:text-gray-100"
                                                                    style={{
                                                                        color: hoveredPieIndex === index ? item.color : undefined,
                                                                        transition: `color 0.3s ${smoothEasing}`,
                                                                    }}
                                                                >
                                                                    {item.percent}%
                                                                </span>
                                                                <span className="text-xs text-slate-500 dark:text-gray-400">
                                                                    {item.count} {t('aiAnalysis.items')} · {formatBytes(item.value)}
                                                                </span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                    {/* 保留部分显示 - 使用与饼图一致的颜色 */}
                                                    {pieData.find(d => d.action === 'keep') && (
                                                        <div className="flex items-center justify-between px-3 py-2 text-slate-400 dark:text-gray-400">
                                                            <div className="flex items-center gap-2">
                                                                <div
                                                                    className="w-2 h-2 rounded-full"
                                                                    style={{ backgroundColor: colors.keep }}
                                                                ></div>
                                                                <span className="text-xs">{t('aiAnalysis.keep')}</span>
                                                            </div>
                                                            <span className="text-xs">{remainPercent}%</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {actionFilter !== 'all' && (
                                                    <button
                                                        onClick={() => setActionFilter('all')}
                                                        className="text-xs text-primary hover:underline mt-1"
                                                        style={{
                                                            transition: `all 0.3s ${smoothEasing}`,
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1.05)'
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.transform = 'scale(1)'
                                                        }}
                                                    >
                                                        {t('aiAnalysis.showAll')}
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })()}
                                </div>

                                {/* 右侧：建议列表 */}
                                <div className="flex-1 min-w-0 overflow-auto">
                                    {analysisResult.suggestions.length > 0 ? (
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pr-2">
                                            {analysisResult.suggestions
                                                .filter(s => !deletedPaths.has(s.path) && !addedToSafeListPaths.has(s.path))
                                                .filter(s => {
                                                    const actualAction = getActualAction(s.path, s.action)
                                                    return actionFilter === 'all' || actualAction === actionFilter
                                                })
                                                .map((suggestion, idx) => {
                                                    const actualAction = getActualAction(suggestion.path, suggestion.action)
                                                    // 创建修改后的建议对象，使用实际的操作类型
                                                    const modifiedSuggestion = {
                                                        ...suggestion,
                                                        action: actualAction
                                                    }
                                                    return (
                                                        <SuggestionCard
                                                            key={idx}
                                                            suggestion={modifiedSuggestion}
                                                            onDelete={handleDelete}
                                                            onMove={handleMove}
                                                            selected={selectedItems.has(suggestion.path)}
                                                            onSelectChange={handleSelectChange}
                                                            task={getTaskForPath(suggestion.path)}
                                                            onToggleAction={() => handleToggleAction(suggestion.path, actualAction)}
                                                            originalAction={suggestion.action}
                                                            onAddToSafeList={handleAddToSafeListClick}
                                                        />
                                                    )
                                                })}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-gray-500">
                                            <CheckCircle2 size={48} className="mb-2" />
                                            <Typography variant="body2">
                                                {actionFilter === 'all'
                                                    ? t('aiAnalysis.noCleanSuggestions')
                                                    : actionFilter === 'delete' 
                                                    ? t('aiAnalysis.noDeleteSuggestions')
                                                    : t('aiAnalysis.noMigrateSuggestions')
                                                }
                                            </Typography>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : null
                    ) : (
                        /* 开发者模式：显示原有的分布视图和 AI 指令 */
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-600 overflow-hidden">
                            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100 dark:border-gray-600 shrink-0">
                                <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                                    <button onClick={() => setViewMode('disk')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'disk' ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.diskView')}</button>
                                    <button onClick={() => setViewMode('ai-prompt')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'ai-prompt' ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>{t('expertMode.aiInstructions')}</button>
                                </div>
                                {hoverNode && viewMode === 'disk' && (
                                    <div className="px-3 py-1.5 bg-secondary text-primary rounded-lg text-[11px] font-semibold flex gap-2 items-center">
                                        <span className="truncate max-w-[200px] text-white/90">{hoverNode.name}</span>
                                        <span className="bg-primary/20 px-1.5 rounded text-[10px] shrink-0">{formatBytes(hoverNode.size)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-h-0 relative">
                                {viewMode === 'disk' ? (
                                    <div className="absolute inset-0 p-4">
                                        <Treemap root={result.root} width={1000} height={500} onHover={setHoverNode} />
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 overflow-auto">
                                        <AIPromptPanel result={result} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 空白页：仅图标+选择文件夹可点击，hover 仅作用于该区域 */}
            {status === 'idle' && !result && (
                <div className="flex-1 flex flex-col items-center justify-center min-h-0">
                    <button
                        type="button"
                        onClick={handleBrowseFolder}
                        disabled={standardModeNoApi}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-600 bg-slate-50 dark:bg-gray-700/50 text-slate-600 dark:text-gray-300 hover:border-primary/50 hover:bg-primary/5 hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <Folder size={18} />
                        <span className="text-sm font-medium">{t('expertMode.selectFolder')}</span>
                    </button>
                    <p className="mt-2 text-xs text-slate-400 dark:text-gray-500">{t('expertMode.analyzeDiskUsage')}</p>
                </div>
            )}

            {/* 保存快照对话框 */}
            <Dialog
                open={showSaveDialog}
                onClose={() => setShowSaveDialog(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: '16px' }
                }}
            >
                <DialogTitle sx={{ pb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Save size={20} />
                        {t('snapshot.saveSnapshot')}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label={t('snapshot.snapshotName')}
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                        placeholder={t('snapshot.inputSnapshotName')}
                        sx={{
                            mt: 1,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '12px',
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && snapshotName.trim()) {
                                handleConfirmSaveSnapshot()
                            }
                        }}
                    />
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
                        {t('snapshot.saveHint2')}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button
                        onClick={() => setShowSaveDialog(false)}
                        sx={{ borderRadius: '10px', textTransform: 'none' }}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmSaveSnapshot}
                        variant="contained"
                        disabled={!snapshotName.trim()}
                        sx={{
                            borderRadius: '10px',
                            textTransform: 'none',
                            bgcolor: 'primary.main',
                            color: '#1A1A1A',
                            '&:hover': { bgcolor: 'primary.dark', color: '#1A1A1A' }
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 加入安全名单确认对话框 */}
            <Dialog
                open={safeListDialog.open}
                onClose={() => setSafeListDialog({ open: false, path: null, dontRemind: false })}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: { borderRadius: '16px' } }}
            >
                <DialogTitle sx={{ pb: 1, pt: 2.5, px: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shield size={20} />
                        </Box>
                        <Typography variant="h6" component="span" sx={{ fontSize: '16px', fontWeight: 700 }}>
                            {t('safeList.confirmTitle')}
                        </Typography>
                    </Box>
                </DialogTitle>
                <DialogContent sx={{ px: 3 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                        {t('safeList.confirmMessage')}
                    </Typography>
                    {safeListDialog.path && (
                        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontFamily: 'monospace', wordBreak: 'break-all', bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
                            {safeListDialog.path}
                        </Typography>
                    )}
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={safeListDialog.dontRemind}
                                onChange={(_, checked) => setSafeListDialog(prev => ({ ...prev, dontRemind: checked }))}
                                size="small"
                            />
                        }
                        label={t('safeList.dontRemindAgain')}
                        sx={{ mt: 2 }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2.5 }}>
                    <Button onClick={() => setSafeListDialog({ open: false, path: null, dontRemind: false })} sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={handleSafeListConfirm} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none' }}>
                        {t('common.confirm')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 云存储选择对话框 */}
            <CloudStorageSelector
                open={showCloudSelector}
                onClose={() => setShowCloudSelector(false)}
                onConfirm={handleCloudStorageSelected}
                availableConfigs={availableConfigs}
                fileName="迁移文件"
                preselectedConfigs={selectedMigrationConfigs}
                onOpenSettings={onOpenSettings}
            />
        </div>
    );
}