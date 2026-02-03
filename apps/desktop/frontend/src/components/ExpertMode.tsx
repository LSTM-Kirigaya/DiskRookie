import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { Folder, Cpu, MessageSquare, Copy, CheckCircle2, AlertCircle, Settings, Clock, FileStack, HardDrive, Sparkles } from 'lucide-react'
import { Button, TextField, Typography, Fade, Tooltip, LinearProgress } from '@mui/material'
import { Treemap, type TreemapNode } from './Treemap'
import { formatBytes, formatDuration } from '../utils/format'
import { loadSettings } from '../services/ai'
import { analyzeWithAI, deleteItem, type AnalysisResult } from '../services/ai-analysis'
import { SuggestionCard } from './SuggestionCard'

interface ScanResult {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
}

const PROMPT_INSTRUCTION_KEY = 'ai-disk-analyzer-prompt-instruction'

function loadPromptInstruction(): string {
    try {
        const stored = localStorage.getItem(PROMPT_INSTRUCTION_KEY)
        return stored || '请根据以上占用，简要指出可安全清理或迁移的大项，并给出 1～3 条操作建议。'
    } catch { return '请根据以上占用，简要指出可安全清理或迁移的大项，并给出 1～3 条操作建议。' }
}

function savePromptInstruction(instruction: string): void {
    try {
        localStorage.setItem(PROMPT_INSTRUCTION_KEY, instruction)
    } catch {
        // ignore storage errors
    }
}

/** AI 提示面板 */
function AIPromptPanel({ result, buildPrompt }: { result: ScanResult; buildPrompt: (r: ScanResult) => string }) {
    const fileListSummary = useMemo(() => buildPrompt(result), [result, buildPrompt])
    const [instruction, setInstruction] = useState(loadPromptInstruction())
    const [copied, setCopied] = useState(false)
    
    useEffect(() => { savePromptInstruction(instruction) }, [instruction])
    
    const copy = useCallback(() => {
        const fullPrompt = fileListSummary + '\n' + instruction
        void navigator.clipboard.writeText(fullPrompt).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }, [fileListSummary, instruction])
    
    return (
        <div className="flex flex-col p-6 gap-6 bg-white dark:bg-gray-800 rounded-3xl h-full animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                        <MessageSquare size={20} />
                    </div>
                    <div>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'secondary.main' }}>AI 分析建议生成</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>数据流已就绪</Typography>
                    </div>
                </div>
                <Button
                    onClick={copy}
                    variant="contained"
                    size="small"
                    startIcon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    sx={{
                        borderRadius: '10px', px: 3, py: 0.9, textTransform: 'none',
                        bgcolor: copied ? '#4caf50' : 'primary.main', color: 'secondary.main',
                        fontWeight: 700, fontSize: '12px', boxShadow: 'none',
                        '&:hover': { bgcolor: copied ? '#45a049' : 'primary.dark' }
                    }}
                >
                    {copied ? '已复制' : '复制全文本'}
                </Button>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">磁盘占用摘要</span>
                    <div className="bg-slate-50 dark:bg-gray-700/50 rounded-2xl p-4 border border-slate-100 dark:border-gray-600 flex-1 overflow-auto">
                        <pre className="text-xs text-slate-600 dark:text-gray-300 font-mono leading-relaxed whitespace-pre-wrap">{fileListSummary}</pre>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-gray-400 uppercase tracking-widest ml-1">分析指令定制</span>
                    <TextField
                        multiline fullWidth value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="请输入分析指令..."
                        sx={{
                            flex: 1,
                            '& .MuiInputBase-root': {
                                height: '100%', borderRadius: '20px', bgcolor: '#fff', fontSize: '14px',
                                '& fieldset': { borderColor: '#e2e8f0' },
                            },
                            '& textarea': { height: '100% !important' }
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

function buildFileListSummary(result: ScanResult): string {
    const nodes: { path: string; size: number; modified?: number | null }[] = []
    function collect(n: TreemapNode, depth: number) {
        if (depth > 2) return
        if (!n.is_dir) nodes.push({ path: n.path || n.name, size: n.size, modified: n.modified })
        if (n.children?.length) {
            [...n.children].sort((a, b) => b.size - a.size).slice(0, 10).forEach((c) => collect(c, depth + 1))
        }
    }
    collect(result.root, 0)
    const items = nodes.sort((a, b) => b.size - a.size).slice(0, 20)
    const header = '| 路径 | 大小 | 最近修改时间 |\n| --- | --- | --- |\n'
    const rows = items.map(n => `| ${displayPath(n.path)} | ${formatBytes(n.size)} | ${formatModified(n.modified)} |`).join('\n')
    return `[磁盘分析结果]\n总大小: ${formatBytes(result.total_size)}，文件数: ${result.file_count}\n\n${header}${rows}`
}

export function ExpertMode({ onOpenSettings }: { onOpenSettings?: () => void }) {
    const [path, setPath] = useState('')
    const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [result, setResult] = useState<ScanResult | null>(null)
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [hoverNode, setHoverNode] = useState<TreemapNode | null>(null)
    const [progressFiles, setProgressFiles] = useState(0)
    const [viewMode, setViewMode] = useState<'disk' | 'ai-prompt'>('disk')
    const [shallowDirs, setShallowDirs] = useState(true)
    const openedSettingsForStandardRef = useRef(false)
    
    // 标准模式 AI 分析状态
    const [aiAnalyzing, setAiAnalyzing] = useState(false)
    const [aiProgress, setAiProgress] = useState('')
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
    const [deletedPaths, setDeletedPaths] = useState<Set<string>>(new Set())

    // 核心：权限检查
    const checkAdmin = useCallback(async () => {
        try {
            const ok = await invoke<boolean>('check_admin_permission')
            setIsAdmin(ok)
            return ok
        } catch {
            setIsAdmin(false)
            return false
        }
    }, [])

    useEffect(() => {
        const t = setTimeout(() => { void checkAdmin() }, 0)
        let unlisten: (() => void) | undefined
        getCurrentWindow().listen<[number, string]>('scan-progress', (ev) => setProgressFiles(ev.payload[0]))
            .then((fn) => { unlisten = fn })
        return () => {
            clearTimeout(t)
            unlisten?.()
        }
    }, [checkAdmin])

    const runScan = useCallback(async (targetPath: string) => {
        if (!targetPath) return
        setStatus('scanning'); setErrorMsg(''); setResult(null); setProgressFiles(0); setAnalysisResult(null);
        try {
            const res = await invoke<ScanResult>('scan_path_command', { path: targetPath, shallow_dirs: shallowDirs })
            setResult(res); setStatus('done');
            
            // 标准模式：扫描完成后自动调用 AI 分析
            if (isAdmin === false) {
                setAiAnalyzing(true)
                setAiProgress('准备 AI 分析...')
                try {
                    const summary = buildFileListSummary(res)
                    const aiResult = await analyzeWithAI(summary, (msg) => setAiProgress(msg))
                    setAnalysisResult(aiResult)
                } catch (aiError) {
                    setErrorMsg(`AI 分析失败: ${aiError}`)
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
    }, [])

    const handleMove = useCallback(async (_itemPath: string) => {
        // 预留迁移接口
        throw new Error('迁移功能正在开发中')
    }, [])

    // 核心：API 配置校验
    const standardModeNoApi = isAdmin === false && !loadSettings().apiKey?.trim()

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
                            placeholder="输入或选择路径开始分析..."
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
                            sx={{ borderRadius: '10px', px: 2, py: 0.9, borderColor: '#D1D5DB', color: 'secondary.main', textTransform: 'none', fontWeight: 600, fontSize: '12px' }}
                        >
                            选择文件夹
                        </Button>
                        <Button
                            onClick={() => runScan(path)}
                            disabled={status === 'scanning' || standardModeNoApi || !path}
                            variant="contained"
                            size="small"
                            sx={{
                                borderRadius: '10px', px: 3, py: 0.9, bgcolor: 'primary.main', color: 'secondary.main',
                                fontWeight: 700, fontSize: '12px', textTransform: 'none', boxShadow: 'none',
                                '&:hover': { bgcolor: 'primary.dark' }
                            }}
                        >
                            {status === 'scanning' ? '分析中...' : '开始扫描'}
                        </Button>
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
                            <span className="text-[11px] font-medium text-slate-500 dark:text-gray-400 group-hover:text-secondary">对于 node_modules 等目录，只计大小不递归</span>
                        </label>
                        <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />
                        <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                            <button
                                onClick={() => setIsAdmin(false)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${!isAdmin ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                标准模式
                            </button>
                            <button
                                onClick={() => setIsAdmin(true)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${isAdmin ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}
                            >
                                开发者模式
                            </button>
                        </div>
                    </div>
                    {result && (() => {
                        const stats = [
                            { label: '处理时耗', val: formatDuration(result.scan_time_ms), Icon: Clock },
                            { label: '文件总计', val: result.file_count.toLocaleString(), Icon: FileStack },
                            { label: '占用空间', val: formatBytes(result.total_size), Icon: HardDrive }
                        ]
                        const tooltipTitle = stats.map(({ label, val }) => `${label}: ${val}`).join(' · ')
                        return (
                            <Tooltip title={tooltipTitle} arrow placement="bottom">
                                <div className="flex items-center gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-gray-600 bg-slate-50/50 dark:bg-gray-700/30 cursor-default">
                                    {stats.map(({ label, val, Icon }, idx) => (
                                        <span key={label} className="flex items-center gap-2">
                                            {idx > 0 && <div className="w-px h-5 bg-slate-200 dark:bg-gray-600 shrink-0" aria-hidden />}
                                            <Icon size={14} className="text-slate-400 dark:text-gray-400 shrink-0" />
                                            <span className="text-[11px] font-semibold text-secondary tabular-nums">{val}</span>
                                        </span>
                                    ))}
                                </div>
                            </Tooltip>
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
                                    <span className="font-medium">标准模式需先配置 API。</span>
                                </div>
                                <Button size="small" onClick={onOpenSettings} sx={{ fontWeight: 600, fontSize: '11px', color: 'inherit', textDecoration: 'underline', minWidth: 'auto', px: 1 }}>
                                    去设置
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
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 2 }}>已处理文件对象</Typography>
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
                <div className="bg-white dark:bg-gray-800 px-6 py-8 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm">
                    <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                            <Sparkles className="text-primary animate-pulse" size={40} />
                            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                        </div>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }} className="dark:text-gray-200">
                            {aiProgress || 'AI 正在分析...'}
                        </Typography>
                        <LinearProgress sx={{ width: '100%', borderRadius: 1 }} />
                    </div>
                </div>
            )}

            {/* 扫描结果展示 */}
            {result && !aiAnalyzing && (
                <div className="flex-1 flex flex-col gap-4 min-h-0 animate-in slide-in-from-bottom-8 duration-700">
                    {/* 标准模式：显示 AI 建议列表 */}
                    {isAdmin === false ? (
                        analysisResult ? (
                            <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-auto">
                                {/* AI 分析摘要 */}
                                <div className="bg-white dark:bg-gray-800 px-4 py-3 rounded-xl border border-slate-200 dark:border-gray-600 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Sparkles size={18} className="text-primary" />
                                            <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">
                                                {analysisResult.summary}
                                            </span>
                                        </div>
                                        {analysisResult.tokenUsage && (
                                            <Tooltip title={`Prompt: ${analysisResult.tokenUsage.prompt_tokens} | Completion: ${analysisResult.tokenUsage.completion_tokens}`} arrow>
                                                <span className="text-[10px] text-slate-400 dark:text-gray-500 font-mono">
                                                    Token: {analysisResult.tokenUsage.total_tokens}
                                                </span>
                                            </Tooltip>
                                        )}
                                    </div>
                                </div>

                                {/* 建议列表 */}
                                {analysisResult.suggestions.length > 0 ? (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                        {analysisResult.suggestions
                                            .filter(s => !deletedPaths.has(s.path))
                                            .map((suggestion, idx) => (
                                                <SuggestionCard
                                                    key={idx}
                                                    suggestion={suggestion}
                                                    onDelete={handleDelete}
                                                    onMove={handleMove}
                                                />
                                            ))}
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500">
                                        <CheckCircle2 size={48} className="mb-2" />
                                        <Typography variant="body2">暂无清理建议，磁盘空间使用良好</Typography>
                                    </div>
                                )}
                            </div>
                        ) : null
                    ) : (
                        /* 开发者模式：显示原有的分布视图和 AI 指令 */
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-slate-100 dark:border-gray-600 overflow-hidden">
                            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100 dark:border-gray-600 shrink-0">
                                <div className="bg-slate-200/50 dark:bg-gray-600/50 p-0.5 rounded-lg flex gap-0.5 border border-slate-200/80 dark:border-gray-600">
                                    <button onClick={() => setViewMode('disk')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'disk' ? 'bg-white dark:bg-gray-600 text-secondary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>分布视窗</button>
                                    <button onClick={() => setViewMode('ai-prompt')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-all ${viewMode === 'ai-prompt' ? 'bg-secondary text-primary shadow-sm' : 'text-slate-500 dark:text-gray-400'}`}>AI 指令集</button>
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
                                        <AIPromptPanel result={result} buildPrompt={buildFileListSummary} />
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
                        <span className="text-sm font-medium">选择文件夹</span>
                    </button>
                    <p className="mt-2 text-xs text-slate-400 dark:text-gray-500">分析磁盘占用</p>
                </div>
            )}
        </div>
    );
}