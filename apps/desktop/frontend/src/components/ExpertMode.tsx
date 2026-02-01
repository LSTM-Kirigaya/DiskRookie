import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { Folder } from 'lucide-react'
import { Treemap, type TreemapNode } from './Treemap'
import { formatBytes, formatDuration } from '../utils/format'
import { loadSettings } from '../services/ai'

interface ScanResult {
    root: TreemapNode
    scan_time_ms: number
    file_count: number
    total_size: number
}

/** AI PROMPT 视图：展示生成的 prompt 与复制按钮 */
function AIPromptPanel({ result, buildPrompt }: { result: ScanResult; buildPrompt: (r: ScanResult) => string }) {
    const prompt = useMemo(() => buildPrompt(result), [result, buildPrompt])
    const copy = useCallback(() => {
        void navigator.clipboard.writeText(prompt).then(() => {
            // 可在此加 Toast
        })
    }, [prompt])
    return (
        <div className="flex-1 flex flex-col p-3 z-10 min-h-0">
            <div className="flex justify-end mb-2">
                <button
                    type="button"
                    onClick={copy}
                    className="px-3 py-1.5 text-xs font-medium bg-primary text-secondary rounded hover:brightness-105 transition-colors"
                >
                    复制到剪贴板
                </button>
            </div>
            <pre className="flex-1 overflow-auto p-3 bg-surface border border-border rounded text-sm text-secondary whitespace-pre-wrap font-sans">
                {prompt}
            </pre>
        </div>
    )
}

/** Windows 下 canonicalize 会带 \\?\ 前缀，摘要中显示为普通路径 */
function displayPath(raw: string): string {
    return raw.replace(/^\\\\\?\\/, '')
}

/** 从扫描结果生成给大模型的简短 prompt，控制总长度 */
function buildAIPrompt(result: ScanResult, maxChars = 1600): string {
    const nodes: { path: string; size: number }[] = []
    function collect(n: TreemapNode, depth: number) {
        if (depth > 2) return
        nodes.push({ path: n.path || n.name, size: n.size })
        if (n.children && n.children.length) {
            const sorted = [...n.children].sort((a, b) => b.size - a.size)
            sorted.slice(0, 12).forEach((c) => collect(c, depth + 1))
        }
    }
    if (result.root.children?.length) {
        const top = [...result.root.children].sort((a, b) => b.size - a.size).slice(0, 15)
        top.forEach((c) => collect(c, 0))
    } else {
        nodes.push({ path: result.root.path || result.root.name, size: result.root.size })
    }
    const bySize = [...nodes].sort((a, b) => b.size - a.size).slice(0, 25)
    const total = result.total_size || 1
    const lines = bySize.map(({ path, size }) => `- ${displayPath(path)} (${formatBytes(size)}, ${(100 * size / total).toFixed(1)}%)`)
    const header = `磁盘占用摘要（共 ${result.file_count} 项，${formatBytes(result.total_size)}）：\n`
    const footer = `\n请根据以上占用，简要指出可安全清理或迁移的大项，并给出 1～3 条操作建议。`
    let out = header + lines.join('\n') + footer
    if (out.length > maxChars) out = out.slice(0, maxChars - 20) + '…\n' + footer
    return out
}

export function ExpertMode({ onOpenSettings }: { onOpenSettings?: () => void }) {
    const [path, setPath] = useState('C:\\')
    const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [result, setResult] = useState<ScanResult | null>(null)
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
    const [hoverNode, setHoverNode] = useState<TreemapNode | null>(null)
    const [progressFiles, setProgressFiles] = useState(0)
    const [viewMode, setViewMode] = useState<'disk' | 'ai-prompt'>('disk')
    const [shallowDirs, setShallowDirs] = useState(true) // 遇到 node_modules/.git 等只计大小不递归，默认开
    const openedSettingsForStandardRef = useRef(false)

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
        let unlisten: (() => void) | undefined
        const win = getCurrentWindow()
        win
            .listen<[number, string]>('scan-progress', (e) => {
                setProgressFiles(e.payload[0])
            })
            .then((fn) => {
                unlisten = fn
            })
        return () => {
            unlisten?.()
        }
    }, [])

    const runScan = useCallback(
        async (targetPath: string) => {
            setStatus('scanning')
            setErrorMsg('')
            setResult(null)
            setProgressFiles(0)
            // 不再在此处调用 checkAdmin()，避免覆盖用户选择的 标准/专家 模式
            try {
                const res = await invoke<ScanResult>('scan_path_command', {
                    path: targetPath,
                    shallow_dirs: shallowDirs,
                })
                setResult(res)
                setStatus('done')
                setProgressFiles(0)
            } catch (e) {
                setStatus('error')
                const err = String(e)
                setErrorMsg(
                    err.includes('Permission') || err.includes('权限')
                        ? '访问被拒绝。请以管理员身份运行后重试。'
                        : err
                )
            }
        },
        [shallowDirs]
    )

    const handleBrowseFolder = useCallback(async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: '选择要分析的文件夹',
            })
            if (selected) {
                const pathStr = typeof selected === 'string' ? selected : selected[0] ?? ''
                if (pathStr) {
                    setPath(pathStr)
                    await runScan(pathStr)
                }
            }
        } catch (e) {
            console.error('Folder picker error:', e)
        }
    }, [runScan])

    const handleScan = async () => {
        await runScan(path)
    }

    useEffect(() => {
        const id = setTimeout(() => { void checkAdmin() }, 0)
        return () => clearTimeout(id)
    }, [checkAdmin])

    // 标准模式下若未配置 API，则跳转到设置（仅自动打开一次）
    useEffect(() => {
        if (isAdmin === false && onOpenSettings && !openedSettingsForStandardRef.current) {
            const s = loadSettings()
            if (!s.apiKey?.trim()) {
                openedSettingsForStandardRef.current = true
                onOpenSettings()
            }
        }
        if (isAdmin === true) openedSettingsForStandardRef.current = false
    }, [isAdmin, onOpenSettings])

    // 标准模式下未配置 API 时不允许扫描
    const standardModeNoApi = isAdmin === false && !loadSettings().apiKey?.trim()

    return (
        <div className="flex flex-col h-full gap-5 text-text-main font-sans selection:bg-primary/30">
          
          {/* 扫描控制区 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-stretch gap-0 bg-white border border-border rounded-lg shadow-sm">
              {/* 动态状态条：黄色装饰 */}
              <div className={`w-1.5 rounded-l-lg transition-all duration-500 ${isAdmin ? 'bg-primary' : 'bg-muted/30'}`}></div>
              
              <div className="flex flex-1 items-center gap-4 p-3 pl-4">
                {/* 路径选择与模式切换组 */}
                <div className="flex flex-1 items-center gap-4">
                  <button
                    onClick={handleBrowseFolder}
                    disabled={standardModeNoApi}
                    className="group p-2 hover:bg-surface rounded transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={standardModeNoApi ? '请先在设置中配置 API' : '选择路径'}
                  >
                    <Folder className="w-5 h-5 text-primary" />
                  </button>
      
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-[10px] text-muted tracking-widest font-bold uppercase">目标路径</span>
                      
                      {/* 模式切换器 */}
                      <div 
                        onClick={() => setIsAdmin(!isAdmin)}
                        className="group flex items-center gap-0 cursor-pointer border border-border rounded overflow-hidden"
                      >
                        <div className={`px-2 py-0.5 text-[9px] transition-all ${!isAdmin ? 'bg-secondary text-white' : 'text-muted hover:bg-surface'}`}>
                          标准模式
                        </div>
                        <div className={`px-2 py-0.5 text-[9px] transition-all ${isAdmin ? 'bg-primary text-secondary font-bold' : 'text-muted hover:bg-surface'}`}>
                          专家模式
                        </div>
                      </div>

                      {/* node_modules 等只计大小不递归 */}
                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-[10px] text-muted hover:text-secondary transition-colors">
                        <input
                          type="checkbox"
                          checked={shallowDirs}
                          onChange={(e) => setShallowDirs(e.target.checked)}
                          className="rounded border-border text-primary focus:ring-primary/30"
                        />
                        <span>node_modules 等只计大小不递归</span>
                      </label>
                    </div>
                    
                    <input
                      type="text"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="请选择或输入扫描路径..."
                      className="bg-transparent border-none p-0 text-sm text-secondary focus:ring-0 placeholder:text-muted/60"
                    />
                  </div>
                </div>
      
                <button
                  onClick={handleScan}
                  disabled={status === 'scanning' || standardModeNoApi}
                  className="relative h-full px-8 py-2 bg-primary text-secondary font-bold text-sm rounded hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                >
                  {status === 'scanning' ? '正在执行' : '开始扫描'}
                </button>
              </div>
            </div>
            
            {/* 专家模式状态指引 / 标准模式未配置 API 提示 */}
            <div className="overflow-hidden">
              {isAdmin ? (
                <div className="flex items-center gap-2 px-3 transition-all duration-500">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  <span className="text-[10px] text-secondary/70 tracking-wide">已激活专家特权：支持深层目录穿透与受限文件检索</span>
                </div>
              ) : standardModeNoApi ? (
                <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted bg-surface/80 rounded">
                  <span>标准模式需先配置 API 才能使用扫描。</span>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="text-primary font-medium hover:underline"
                    >
                      去设置
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {status === 'error' && errorMsg && (
              <div className="px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded" role="alert">
                {errorMsg}
              </div>
            )}
          </div>
      
          {/* 扫描进度：呼吸感分段进度 */}
          {status === 'scanning' && (
            <div className="bg-white p-4 border border-border rounded-lg relative shadow-sm">
              <div className="flex justify-between items-end mb-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted tracking-tighter mb-1 uppercase">系统作业中...</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl text-secondary font-bold">{progressFiles.toLocaleString()}</span>
                    <span className="text-xs text-muted">已处理对象</span>
                  </div>
                </div>
                {/* 装饰性数据矩阵 */}
                <div className="hidden md:flex gap-1 text-[8px] text-muted/40">
                  <div>0101<br/>1100</div>
                  <div>0011<br/>1010</div>
                </div>
              </div>
              
              <div className="flex gap-1 h-2 bg-surface rounded overflow-hidden">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="flex-1 relative overflow-hidden">
                    <div
                      className="h-full w-full bg-primary animate-breath rounded-sm"
                      style={{ animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
      
          {/* 指标矩阵 */}
          {result && (
            <div className="grid grid-cols-3 gap-0 border border-border bg-white rounded-lg overflow-hidden shadow-sm">
              {[
                { label: '作业时耗', val: formatDuration(result.scan_time_ms), icon: '⏱' },
                { label: '扫描总数', val: result.file_count.toLocaleString(), icon: '📁' },
                { label: '存储占用', val: formatBytes(result.total_size), icon: '💾' }
              ].map((item, idx) => (
                <div key={idx} className={`p-4 ${idx !== 2 ? 'border-r border-border' : ''}`}>
                  <p className="text-[10px] text-muted mb-2 font-bold tracking-widest uppercase">{item.label}</p>
                  <p className="text-xl text-secondary font-semibold">{item.val}</p>
                </div>
              ))}
            </div>
          )}
      
          {/* 空间占用映射区（专家模式：DISK / AI PROMPT 切换） */}
          {result && (
            <div className="flex-1 min-h-[400px] flex flex-col bg-white border border-border rounded-lg overflow-hidden relative shadow-sm">
              <div className="flex justify-between items-center p-3 border-b border-border bg-surface/50 z-10 flex-wrap gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-1 h-4 bg-primary rounded shrink-0" />
                  <span className="text-[10px] text-muted tracking-widest font-bold uppercase shrink-0">
                    {viewMode === 'disk' ? '存储空间映射结构' : 'AI 分析摘要'}
                  </span>
                  {isAdmin && (
                    <div className="flex items-center gap-0 border border-border rounded overflow-hidden shrink-0">
                      <button
                        type="button"
                        onClick={() => setViewMode('disk')}
                        className={`px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'disk' ? 'bg-primary text-secondary' : 'text-muted hover:bg-surface'}`}
                      >
                        DISK
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('ai-prompt')}
                        className={`px-2 py-1 text-[10px] font-medium transition-colors ${viewMode === 'ai-prompt' ? 'bg-primary text-secondary' : 'text-muted hover:bg-surface'}`}
                      >
                        AI PROMPT
                      </button>
                    </div>
                  )}
                </div>
                {/* 预留固定空间，避免悬停信息出现/消失时挤压行高和宽度 */}
                {viewMode === 'disk' && (
                  <div className="h-7 min-w-[8rem] flex items-center justify-end shrink-0">
                    {hoverNode ? (
                      <div className="flex gap-4 text-[11px] bg-secondary px-3 py-1.5 rounded text-white max-w-full truncate">
                        <span className="text-primary font-medium truncate">{hoverNode.name}</span>
                        <span className="text-white/70 shrink-0">{formatBytes(hoverNode.size)}</span>
                      </div>
                    ) : (
                      <span className="invisible text-[11px] px-3 py-1.5" aria-hidden="true">0 B</span>
                    )}
                  </div>
                )}
              </div>

              {viewMode === 'disk' && (
                <div className="flex-1 p-3 z-10">
                  <div className="w-full h-full transition-all duration-700">
                    <Treemap
                      root={result.root}
                      width={800}
                      height={400}
                      onHover={setHoverNode}
                    />
                  </div>
                </div>
              )}

              {viewMode === 'ai-prompt' && result && (
                <AIPromptPanel result={result} buildPrompt={buildAIPrompt} />
              )}
            </div>
          )}
      
          {/* 空白状态引导 */}
          {status === 'idle' && !result && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div className="text-sm text-muted mb-2">选择文件夹开始分析</div>
              <div className="text-[10px] tracking-widest text-muted/60 uppercase">SYSTEM READY</div>
              <div className="mt-4 w-32 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent rounded"></div>
            </div>
          )}
        </div>
      );
}
