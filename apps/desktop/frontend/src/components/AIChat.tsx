import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Trash2, AlertCircle } from 'lucide-react'
import {
  loadSettings,
  sendChatRequest,
  SYSTEM_PROMPT,
  type ChatMessage,
} from '../services/ai'

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export function AIChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 自动调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [input])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const settings = loadSettings()
    if (!settings.apiKey) {
      setError('请先在设置中配置 API Key')
      return
    }

    const userMessage: DisplayMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setError(null)
    setIsLoading(true)

    // 准备发送给 API 的消息
    const apiMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage.content },
    ]

    // 创建助手消息占位
    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }])

    try {
      await sendChatRequest(
        apiMessages,
        settings,
        // 流式更新
        (chunk) => {
          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + chunk }
              : m
          ))
        }
      )

      // 标记流式结束
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, isStreaming: false }
          : m
      ))
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : '请求失败'
      setError(errorMsg)
      // 移除失败的助手消息
      setMessages(prev => prev.filter(m => m.id !== assistantId))
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearMessages = () => {
    setMessages([])
    setError(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-primary rounded"></div>
          <span className="text-sm font-semibold text-secondary">AI 助手</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearMessages}
            className="p-1.5 text-muted hover:text-secondary hover:bg-surface rounded transition-colors"
            title="清空对话"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-sm">有什么可以帮助您的？</p>
            <p className="text-xs mt-1">我可以帮您分析磁盘空间、识别大文件等</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-secondary text-white'
                    : 'bg-surface text-secondary border border-border'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {msg.content}
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 输入区 */}
      <div className="p-3 border-t border-border">
        <div className="flex items-end gap-2 bg-surface rounded-lg border border-border p-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，按 Enter 发送..."
            rows={1}
            className="flex-1 bg-transparent resize-none text-sm text-secondary placeholder:text-muted/60 focus:outline-none"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="shrink-0 p-2 bg-primary text-secondary rounded-lg hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1.5 text-center">
          Shift + Enter 换行 · Enter 发送
        </p>
      </div>
    </div>
  )
}
