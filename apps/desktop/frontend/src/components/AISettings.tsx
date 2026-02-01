import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Check, AlertCircle } from 'lucide-react'
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  MODEL_PRESETS,
  API_URL_PRESETS,
  type AISettings as AISettingsType,
} from '../services/ai'

interface Props {
  onClose: () => void
}

export function AISettings({ onClose }: Props) {
  const [settings, setSettings] = useState<AISettingsType>(DEFAULT_SETTINGS)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customModel, setCustomModel] = useState('')

  useEffect(() => {
    const loaded = loadSettings()
    setSettings(loaded)
    
    // 检查是否是自定义 URL
    const urlPreset = API_URL_PRESETS.find(p => p.value === loaded.apiUrl)
    if (!urlPreset) {
      setCustomUrl(loaded.apiUrl)
    }
    
    // 检查是否是自定义模型
    const modelPreset = MODEL_PRESETS.find(p => p.value === loaded.model)
    if (!modelPreset) {
      setCustomModel(loaded.model)
    }
  }, [])

  const handleSave = () => {
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleUrlChange = (value: string) => {
    if (value === 'custom') {
      setSettings(s => ({ ...s, apiUrl: customUrl || '' }))
    } else {
      setSettings(s => ({ ...s, apiUrl: value }))
      setCustomUrl('')
    }
  }

  const handleModelChange = (value: string) => {
    if (value === 'custom') {
      setSettings(s => ({ ...s, model: customModel || '' }))
    } else {
      setSettings(s => ({ ...s, model: value }))
      setCustomModel('')
    }
  }

  const isCustomUrl = !API_URL_PRESETS.some(p => p.value === settings.apiUrl && p.value !== 'custom')
  const isCustomModel = !MODEL_PRESETS.some(p => p.value === settings.model && p.value !== 'custom')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded"></div>
            <h2 className="text-lg font-semibold text-secondary">AI 设置</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-secondary hover:bg-surface rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4 space-y-5">
          {/* API URL */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
              API 地址
            </label>
            <select
              value={isCustomUrl ? 'custom' : settings.apiUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded bg-white text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {API_URL_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            {isCustomUrl && (
              <input
                type="text"
                value={settings.apiUrl}
                onChange={(e) => setSettings(s => ({ ...s, apiUrl: e.target.value }))}
                placeholder="输入自定义 API URL..."
                className="w-full px-3 py-2 border border-border rounded bg-surface text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            )}
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                placeholder="输入您的 API Key..."
                className="w-full px-3 py-2 pr-10 border border-border rounded bg-white text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-secondary"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-muted flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              API Key 仅保存在本地，不会上传到任何服务器
            </p>
          </div>

          {/* 模型选择 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
              模型
            </label>
            <select
              value={isCustomModel ? 'custom' : settings.model}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded bg-white text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {MODEL_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.provider ? `${preset.label} (${preset.provider})` : preset.label}
                </option>
              ))}
            </select>
            {isCustomModel && (
              <input
                type="text"
                value={settings.model}
                onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                placeholder="输入自定义模型名称..."
                className="w-full px-3 py-2 border border-border rounded bg-surface text-secondary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            )}
          </div>

          {/* 高级设置 */}
          <div className="space-y-4 pt-2 border-t border-border">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider">高级设置</p>
            
            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-secondary">温度 (Temperature)</label>
                <span className="text-sm text-muted tabular-nums">{settings.temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.temperature}
                onChange={(e) => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-[10px] text-muted">
                较低的值使输出更确定，较高的值使输出更有创意
              </p>
            </div>

            {/* Max Tokens */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm text-secondary">最大令牌数 (Max Tokens)</label>
                <span className="text-sm text-muted tabular-nums">{settings.maxTokens}</span>
              </div>
              <input
                type="range"
                min="256"
                max="8192"
                step="256"
                value={settings.maxTokens}
                onChange={(e) => setSettings(s => ({ ...s, maxTokens: parseInt(e.target.value) }))}
                className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-[10px] text-muted">
                控制 AI 回复的最大长度
              </p>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-surface/50">
          <button
            onClick={() => {
              setSettings(DEFAULT_SETTINGS)
              setCustomUrl('')
              setCustomModel('')
            }}
            className="px-4 py-2 text-sm text-muted hover:text-secondary hover:bg-white rounded transition-colors"
          >
            重置为默认
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted hover:text-secondary border border-border rounded hover:bg-white transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-secondary bg-primary hover:brightness-105 rounded transition-all flex items-center gap-1.5"
            >
              {saved ? (
                <>
                  <Check className="w-4 h-4" />
                  已保存
                </>
              ) : (
                '保存设置'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
