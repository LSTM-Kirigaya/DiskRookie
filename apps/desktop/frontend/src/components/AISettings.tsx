import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Check, AlertCircle, ChevronDown, ChevronUp, Brain, Cloud } from 'lucide-react'
import { showNotification } from '../services/notification'
import {
  TextField,
  Select,
  MenuItem,
  Button,
  IconButton,
  InputAdornment,
  FormControl,
  FormHelperText,
  Box,
  Typography,
  Slider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Tabs,
  Tab,
} from '@mui/material'
import {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  MODEL_PRESETS,
  API_URL_PRESETS,
  fetchAvailableModels,
  type AISettings as AISettingsType,
  type ModelInfo,
} from '../services/ai'
import { loadAppSettings, saveAppSettings, type AppSettings } from '../services/settings'
import { CloudStorageSettings } from './CloudStorageSettings'

interface Props {
  onClose: () => void
  initialTab?: number  // 允许外部指定初始 Tab
  onSaved?: () => void  // 保存成功后的回调
}

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
      style={{ height: '100%', overflow: 'auto' }}
    >
      {value === index && (
        <Box sx={{ p: 2.5 }}>
          {children}
        </Box>
      )}
    </div>
  )
}

export function AISettings({ onClose, initialTab = 0, onSaved }: Props) {
  const [settings, setSettings] = useState<AISettingsType>(DEFAULT_SETTINGS)
  const [appSettings, setAppSettings] = useState<AppSettings>({ promptFileCount: 100 })
  const [showApiKey, setShowApiKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState(initialTab)

  useEffect(() => {
    loadSettings().then(loaded => {
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
    })
    
    loadAppSettings().then(loaded => {
      setAppSettings(loaded)
    })
  }, [])

  // 当 API Key 和 URL 都填写后，自动获取模型列表；加载完成后默认选中第一个模型
  useEffect(() => {
    const loadModels = async () => {
      if (settings.apiKey && settings.apiUrl) {
        setLoadingModels(true)
        try {
          const models = await fetchAvailableModels(settings.apiUrl, settings.apiKey)
          setAvailableModels(models)
          if (models.length > 0) {
            const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id))
            setSettings(s => ({ ...s, model: sorted[0].id }))
            setCustomModel('')
          }
        } catch (error) {
          console.error('Failed to load models:', error)
          setAvailableModels([])
        } finally {
          setLoadingModels(false)
        }
      } else {
        setAvailableModels([])
      }
    }

    // 延迟加载，避免频繁请求
    const timer = setTimeout(loadModels, 500)
    return () => clearTimeout(timer)
  }, [settings.apiKey, settings.apiUrl])

  const handleSave = async () => {
    try {
      await saveSettings(settings)
      await saveAppSettings(appSettings)
      setSaved(true)
      // 通知父组件保存成功
      onSaved?.()
      // 保存成功后短暂显示「已保存」再自动关闭对话框
      setTimeout(() => {
        setSaved(false)
        onClose()
      }, 400)
    } catch (error) {
      showNotification('保存设置失败', String(error))
    }
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center rounded-[12px] z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-transparent dark:border-gray-600">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded"></div>
            <h2 className="text-lg font-semibold text-secondary dark:text-gray-100">设置</h2>
          </div>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          >
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs 导航 */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }} className="dark:!border-gray-600">
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            variant="fullWidth"
            sx={{
              minHeight: 44,
              '& .MuiTab-root': {
                minHeight: 44,
                textTransform: 'none',
                fontSize: '13px',
                fontWeight: 600,
              },
              '& .Mui-selected': {
                color: 'primary.main',
              },
              '& .MuiTabs-indicator': {
                bgcolor: 'primary.main',
              },
            }}
          >
            <Tab
              icon={<Brain size={16} />}
              iconPosition="start"
              label="AI 模型"
              id="settings-tab-0"
              aria-controls="settings-tabpanel-0"
            />
            <Tab
              icon={<Cloud size={16} />}
              iconPosition="start"
              label="数据迁移"
              id="settings-tab-1"
              aria-controls="settings-tabpanel-1"
            />
          </Tabs>
        </Box>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          {/* AI 模型设置 Tab */}
          <TabPanel value={activeTab} index={0}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* API URL */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  API 地址
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={isCustomUrl ? 'custom' : settings.apiUrl}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    sx={{ fontSize: '14px' }}
                  >
                    {API_URL_PRESETS.map((preset) => (
                      <MenuItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {isCustomUrl && (
                  <TextField
                    fullWidth
                    size="small"
                    value={settings.apiUrl}
                    onChange={(e) => setSettings(s => ({ ...s, apiUrl: e.target.value }))}
                    placeholder="输入自定义 API URL..."
                    sx={{ fontSize: '14px' }}
                  />
                )}
              </Box>

              {/* API Key */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  API Key
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))}
                  placeholder="输入您的 API Key..."
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowApiKey(!showApiKey)}
                          edge="end"
                          size="small"
                          sx={{ color: 'text.secondary' }}
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{ fontSize: '14px' }}
                />
                <FormHelperText sx={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: 0.5, m: 0 }}>
                  <AlertCircle className="w-3 h-3" />
                  API Key 仅保存在本地，不会上传到任何服务器
                </FormHelperText>
              </Box>

              {/* 模型选择 - 只有填写了 API Key 才显示 */}
              {settings.apiKey && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                    模型
                  </Typography>
                  {loadingModels ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '12px' }}>
                        正在加载可用模型...
                      </Typography>
                    </Box>
                  ) : (
                    <FormControl fullWidth size="small">
                      <Select
                        value={isCustomModel ? 'custom' : settings.model}
                        onChange={(e) => handleModelChange(e.target.value)}
                        sx={{ fontSize: '14px' }}
                      >
                        {/* 显示从 API 获取的模型 */}
                        {availableModels.length > 0 ? (
                          availableModels
                            .sort((a, b) => a.id.localeCompare(b.id))
                            .map((model) => (
                              <MenuItem key={model.id} value={model.id}>
                                {model.id}
                              </MenuItem>
                            ))
                        ) : (
                          // 如果没有获取到模型，显示预设模型
                          MODEL_PRESETS.map((preset) => (
                            <MenuItem key={preset.value} value={preset.value}>
                              {preset.provider ? `${preset.label} (${preset.provider})` : preset.label}
                            </MenuItem>
                          ))
                        )}
                        <MenuItem value="custom">自定义</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                  {isCustomModel && (
                    <TextField
                      fullWidth
                      size="small"
                      value={settings.model}
                      onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                      placeholder="输入自定义模型名称..."
                      sx={{ fontSize: '14px' }}
                    />
                  )}
                </Box>
              )}

              {/* 高级设置 - 使用 Accordion 实现折叠 */}
              <Accordion
                expanded={advancedExpanded}
                onChange={(_, expanded) => setAdvancedExpanded(expanded)}
                sx={{
                  boxShadow: 'none',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:before': {
                    display: 'none',
                  },
                }}
              >
                <AccordionSummary
                  expandIcon={advancedExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  sx={{
                    minHeight: 40,
                    '& .MuiAccordionSummary-content': {
                      my: 1,
                    },
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                    高级设置
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 2 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Temperature */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>温度 (Temperature)</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {settings.temperature.toFixed(1)}
                        </Typography>
                      </Box>
                      <Slider
                        min={0}
                        max={2}
                        step={0.1}
                        value={settings.temperature}
                        onChange={(_, value) => setSettings(s => ({ ...s, temperature: value as number }))}
                        sx={{ color: 'primary.main' }}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        较低的值使输出更确定，较高的值使输出更有创意
                      </FormHelperText>
                    </Box>

                    {/* Max Tokens */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>最大令牌数 (Max Tokens)</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {settings.maxTokens}
                        </Typography>
                      </Box>
                      <Slider
                        min={256}
                        max={8192}
                        step={256}
                        value={settings.maxTokens}
                        onChange={(_, value) => setSettings(s => ({ ...s, maxTokens: value as number }))}
                        sx={{ color: 'primary.main' }}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        控制 AI 回复的最大长度
                      </FormHelperText>
                    </Box>

                    {/* Prompt File Count */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>Prompt 文件数量</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                          {appSettings.promptFileCount}
                        </Typography>
                      </Box>
                      <Slider
                        min={20}
                        max={200}
                        step={10}
                        value={appSettings.promptFileCount}
                        onChange={(_, value) => setAppSettings(s => ({ ...s, promptFileCount: value as number }))}
                        sx={{ color: 'primary.main' }}
                        marks={[
                          { value: 20, label: '20' },
                          { value: 100, label: '100' },
                          { value: 200, label: '200' },
                        ]}
                      />
                      <FormHelperText sx={{ fontSize: '10px', m: 0 }}>
                        控制发送给 AI 的文件列表数量（更多文件会消耗更多 Token）
                      </FormHelperText>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          </TabPanel>

          {/* 数据迁移设置 Tab */}
          <TabPanel value={activeTab} index={1}>
            <CloudStorageSettings />
          </TabPanel>
        </div>

        {/* 底部按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }} className="dark:!bg-gray-700/50 dark:!border-gray-600">
          {activeTab === 0 ? (
            <Button
              onClick={() => {
                setSettings(DEFAULT_SETTINGS)
                setAppSettings({ promptFileCount: 100 })
                setCustomUrl('')
                setCustomModel('')
              }}
              variant="text"
              size="small"
              sx={{
                textTransform: 'none',
                fontSize: '14px',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'background.paper',
                },
              }}
            >
              重置为默认
            </Button>
          ) : (
            <Box />
          )}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={onClose}
              variant="outlined"
              size="small"
              sx={{
                textTransform: 'none',
                fontSize: '14px',
                color: 'text.secondary',
                borderColor: 'divider',
                '&:hover': {
                  bgcolor: 'background.paper',
                  borderColor: 'divider',
                },
              }}
            >
              取消
            </Button>
            {activeTab === 0 && (
              <Button
                onClick={handleSave}
                variant="contained"
                size="small"
                startIcon={saved ? <Check className="w-4 h-4" /> : null}
                sx={{
                  textTransform: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '10px',
                  px: 3,
                  py: 0.9,
                  bgcolor: 'primary.main',
                  color: '#1A1A1A',
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                    color: '#1A1A1A',
                  },
                }}
              >
                {saved ? '已保存' : '保存设置'}
              </Button>
            )}
          </Box>
        </Box>
      </div>
    </div>
  )
}
