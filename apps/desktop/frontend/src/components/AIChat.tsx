import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Trash2, AlertCircle } from 'lucide-react'
import { IconButton, TextField, Alert, Box } from '@mui/material'
import {
  loadSettings,
  resolveEffectiveApiKey,
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
  const textareaRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 自动调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current.querySelector('textarea') as HTMLTextAreaElement
      if (textarea) {
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
      }
    }
  }, [input])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const settings = await loadSettings()
    const key = await resolveEffectiveApiKey(settings)
    if (!key) {
      setError('请先在设置中配置 API Key，或完成 Kimi Code 登录')
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
          <IconButton
            onClick={clearMessages}
            size="small"
            title="清空对话"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'action.hover',
                color: 'text.primary',
              },
            }}
          >
            <Trash2 className="w-4 h-4" />
          </IconButton>
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
        <Box sx={{ mx: 1.5, mb: 1 }}>
          <Alert severity="error" icon={<AlertCircle className="w-4 h-4" />} sx={{ fontSize: '14px' }}>
            {error}
          </Alert>
        </Box>
      )}

      {/* 输入区 */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box ref={textareaRef} sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, bgcolor: 'action.hover', borderRadius: 1, border: 1, borderColor: 'divider', p: 1 }}>
          <TextField
            multiline
            fullWidth
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，按 Enter 发送..."
            disabled={isLoading}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                fontSize: '14px',
                color: 'text.primary',
                '&::placeholder': {
                  color: 'text.secondary',
                  opacity: 0.6,
                },
                '& textarea': {
                  resize: 'none',
                  maxHeight: '120px',
                },
              },
            }}
            sx={{
              '& .MuiInputBase-root': {
                bgcolor: 'transparent',
              },
            }}
          />
          <IconButton
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            sx={{
              bgcolor: 'primary.main',
              color: 'secondary.main',
              flexShrink: 0,
              '&:hover': {
                bgcolor: 'primary.dark',
              },
              '&.Mui-disabled': {
                opacity: 0.5,
                bgcolor: 'primary.main',
              },
            }}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </IconButton>
        </Box>
        <Box component="p" sx={{ fontSize: '10px', color: 'text.secondary', mt: 1.5, textAlign: 'center', m: 0 }}>
          Shift + Enter 换行 · Enter 发送
        </Box>
      </Box>
    </div>
  )
}
