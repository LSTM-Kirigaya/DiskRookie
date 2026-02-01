import { useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Settings } from 'lucide-react'
import { ExpertMode } from './components/ExpertMode'
import { AISettings } from './components/AISettings'
import { AIChat } from './components/AIChat'

function App() {
  const win = getCurrentWindow()
  const [showSettings, setShowSettings] = useState(false)
  const [showChat, setShowChat] = useState(false)

  const handleTitleBarMouseDown = () => {
    win.startDragging()
  }

  return (
    <div className="min-h-screen bg-white text-text-main flex flex-col">
      {/* 菜单栏固定顶部，向下滚动时始终可见 */}
      <header className="sticky top-0 z-50 shrink-0 h-10 flex items-center border-b border-border bg-white select-none">
        <div
          data-tauri-drag-region
          onMouseDown={handleTitleBarMouseDown}
          className="flex-1 flex items-center px-4 h-full cursor-default"
        >
          <div className="w-1.5 h-4 bg-primary mr-3"></div>
          <span className="text-sm font-semibold text-secondary">AI 磁盘分析工具</span>
        </div>
        
        {/* 功能按钮 */}
        <div className="flex items-center h-full px-2 gap-1">
          <button
            type="button"
            onClick={() => setShowChat(!showChat)}
            className={`h-7 px-3 text-xs font-medium rounded transition-colors ${
              showChat 
                ? 'bg-primary text-secondary' 
                : 'text-muted hover:bg-surface hover:text-secondary'
            }`}
          >
            AI 助手
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="h-7 w-7 flex items-center justify-center text-muted hover:bg-surface hover:text-secondary rounded transition-colors"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* 窗口控制按钮 */}
        <div className="flex items-center border-l border-border gap-1 pr-1">
          <button
            type="button"
            onClick={() => win.minimize()}
            className="h-10 w-10 min-w-10 flex items-center justify-center text-muted hover:bg-surface hover:text-secondary transition-colors text-[14px] leading-none"
            title="最小化"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => win.toggleMaximize()}
            className="h-10 w-10 min-w-10 flex items-center justify-center text-muted hover:bg-surface hover:text-secondary transition-colors text-[14px] leading-none"
            title="最大化 / 还原"
          >
            □
          </button>
          <button
            type="button"
            onClick={() => win.close()}
            className="h-10 w-10 min-w-10 flex items-center justify-center text-muted hover:bg-red-500 hover:text-white transition-colors text-[14px] leading-none"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-auto p-4 bg-surface">
          <ExpertMode onOpenSettings={() => setShowSettings(true)} />
        </main>
        
        {/* AI 聊天侧边栏 */}
        {showChat && (
          <aside className="w-96 border-l border-border bg-white flex flex-col">
            <AIChat />
          </aside>
        )}
      </div>

      {/* 设置弹窗 */}
      {showSettings && <AISettings onClose={() => setShowSettings(false)} />}
    </div>
  )
}

export default App
