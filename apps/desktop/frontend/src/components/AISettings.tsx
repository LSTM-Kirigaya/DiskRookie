import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Eye, EyeOff, Check, AlertCircle, ChevronDown, ChevronUp, Brain, Cloud, Settings, Wifi } from 'lucide-react'
import { showNotification } from '../services/notification'
import {
  TextField,
  Select,
  MenuItem,
  Button,
  IconButton,
  InputAdornment,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Box,
  Typography,
  Slider,
  Switch,
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
  getPresetId,
  fetchAvailableModels,
  testConnection,
  type AISettings as AISettingsType,
  type ModelInfo,
} from '../services/ai'
import { loadAppSettings, saveAppSettings, type AppSettings } from '../services/settings'
import { CloudStorageSettings } from './CloudStorageSettings'
import { setLanguage, supportedLanguages } from '../i18n'
import { readStorageFile, writeStorageFile } from '../services/storage'

interface Props {
  onClose: () => void
  initialTab?: number  // 允许外部指定初始 Tab
  onSaved?: () => void  // 保存成功后的回调
  themePreference?: 'light' | 'dark' | 'system'  // 主题偏好
  onThemeChange?: (theme: 'light' | 'dark' | 'system') => void  // 主题改变回调
  currentLanguage?: string  // 当前语言
  onLanguageChange?: (lang: string) => void  // 语言改变回调
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

const THEME_STORAGE_FILE = 'theme.txt'

export function AISettings({ onClose, initialTab = 0, onSaved, themePreference: externalThemePreference, onThemeChange, currentLanguage: externalCurrentLanguage, onLanguageChange }: Props) {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<AISettingsType>(DEFAULT_SETTINGS)
  const [appSettings, setAppSettings] = useState<AppSettings>({ promptFileCount: 100, useMftScan: true })
  const [showApiKey, setShowApiKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [customUrl, setCustomUrl] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState(initialTab)
  
  // 主题和语言状态（如果外部传入则使用外部值，否则使用内部状态）
  const [internalThemePreference, setInternalThemePreference] = useState<'light' | 'dark' | 'system'>('system')
  const [internalLanguage, setInternalLanguage] = useState<string>(i18n.language)
  
  const themePreference = externalThemePreference ?? internalThemePreference
  const currentLanguage = externalCurrentLanguage ?? internalLanguage
  
  // 加载主题设置（如果没有外部传入）
  useEffect(() => {
    if (!externalThemePreference) {
      readStorageFile(THEME_STORAGE_FILE).then(stored => {
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setInternalThemePreference(stored)
        }
      })
    }
  }, [externalThemePreference])
  
  // 加载语言设置（如果没有外部传入）
  useEffect(() => {
    if (!externalCurrentLanguage) {
      try {
        const savedLang = localStorage.getItem('app-language')
        if (savedLang) {
          setInternalLanguage(savedLang)
        }
      } catch {
        // ignore
      }
    }
  }, [externalCurrentLanguage])

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

  // 当当前厂商的 API Key 和 URL 都填写后，自动获取模型列表；加载完成后默认选中第一个模型
  useEffect(() => {
    const keyForUrl = (settings.providerApiKeys ?? {})[getPresetId(settings.apiUrl)] ?? ''
    const loadModels = async () => {
      if (keyForUrl && settings.apiUrl) {
        setLoadingModels(true)
        try {
          const models = await fetchAvailableModels(settings.apiUrl, keyForUrl)
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
  }, [settings.apiUrl, settings.providerApiKeys])

  const handleSave = async () => {
    try {
      // 保存时带上按厂商解析后的 apiKey（供 loadSettings 之外使用）及 providerApiKeys
      await saveSettings({
        ...settings,
        apiKey: (settings.providerApiKeys ?? {})[getPresetId(settings.apiUrl)] ?? '',
      })
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
      showNotification(t('settings.saveFailed'), String(error))
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

  // 当前选中的厂商对应的 API Key（独立存储，切换厂商显示各自的 key）
  const currentApiKey = (settings.providerApiKeys ?? {})[getPresetId(settings.apiUrl)] ?? ''

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center rounded-[12px] z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-transparent dark:border-gray-600">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 bg-primary rounded"></div>
            <h2 className="text-lg font-semibold text-secondary dark:text-gray-100">{t('settings.title')}</h2>
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
              label={t('settings.aiModel')}
              id="settings-tab-0"
              aria-controls="settings-tabpanel-0"
            />
            <Tab
              icon={<Cloud size={16} />}
              iconPosition="start"
              label={t('settings.cloudService')}
              id="settings-tab-1"
              aria-controls="settings-tabpanel-1"
            />
            <Tab
              icon={<Settings size={16} />}
              iconPosition="start"
              label={t('settings.general')}
              id="settings-tab-2"
              aria-controls="settings-tabpanel-2"
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
                  {t('settings.apiUrl')}
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
                    placeholder={t('settings.inputCustomApiUrl')}
                    sx={{ fontSize: '14px' }}
                  />
                )}
              </Box>

              {/* API Key */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('settings.apiKey')}
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type={showApiKey ? 'text' : 'password'}
                  value={currentApiKey}
                  onChange={(e) => setSettings(s => ({
                    ...s,
                    providerApiKeys: { ...(s.providerApiKeys ?? {}), [getPresetId(s.apiUrl)]: e.target.value },
                  }))}
                  placeholder={t('settings.inputApiKey')}
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
                  {t('settings.apiKeyHint')}
                </FormHelperText>
                {/* 测试连接 - 填写了 API Key、地址和模型后显示，响应信息显示在按钮右侧 */}
                {currentApiKey && settings.apiUrl && settings.model && (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={testingConnection ? <CircularProgress size={16} /> : <Wifi className="w-4 h-4" />}
                      onClick={async () => {
                        setTestResult(null)
                        setTestingConnection(true)
                        try {
                          const result = await testConnection({ ...settings, apiKey: currentApiKey })
                          setTestResult(result)
                          if (!result.ok) {
                            showNotification(t('settings.testConnectionFailed'), result.message)
                          }
                        } finally {
                          setTestingConnection(false)
                        }
                      }}
                      disabled={testingConnection}
                    >
                      {testingConnection ? t('settings.testConnectionTesting') : t('settings.testConnection')}
                    </Button>
                    {testResult != null && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          flex: '1 1 200px',
                          minWidth: 0,
                          color: testResult.ok ? 'success.main' : 'error.main',
                          fontSize: '12px',
                          alignSelf: 'center',
                        }}
                      >
                        {testResult.message}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>

              {/* 模型选择 - 只有填写了当前厂商的 API Key 才显示 */}
              {currentApiKey && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                    {t('settings.model')}
                  </Typography>
                  {loadingModels ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '12px' }}>
                        {t('settings.loadingModels')}
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
                        <MenuItem value="custom">{t('common.custom')}</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                  {isCustomModel && (
                    <TextField
                      fullWidth
                      size="small"
                      value={settings.model}
                      onChange={(e) => setSettings(s => ({ ...s, model: e.target.value }))}
                      placeholder={t('settings.inputCustomModel')}
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
                    {t('settings.advancedSettings')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 2 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Temperature */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.temperature')}</Typography>
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
                        {t('settings.temperatureHint')}
                      </FormHelperText>
                    </Box>

                    {/* Max Tokens */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.maxTokens')}</Typography>
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
                        {t('settings.maxTokensHint')}
                      </FormHelperText>
                    </Box>

                    {/* Prompt File Count */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.primary' }}>{t('settings.promptFileCount')}</Typography>
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
                        {t('settings.promptFileCountHint')}
                      </FormHelperText>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>
            </Box>
          </TabPanel>

          {/* 云盘服务设置 Tab */}
          <TabPanel value={activeTab} index={1}>
            <CloudStorageSettings />
          </TabPanel>

          {/* 通用设置 Tab */}
          <TabPanel value={activeTab} index={2}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {/* 主题设置 */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('settings.theme')}
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={themePreference}
                    onChange={(e) => {
                      const newTheme = e.target.value as 'light' | 'dark' | 'system'
                      if (onThemeChange) {
                        onThemeChange(newTheme)
                      } else {
                        setInternalThemePreference(newTheme)
                        void writeStorageFile(THEME_STORAGE_FILE, newTheme)
                      }
                    }}
                    sx={{ fontSize: '14px' }}
                  >
                    <MenuItem value="light">{t('theme.light')}</MenuItem>
                    <MenuItem value="dark">{t('theme.dark')}</MenuItem>
                    <MenuItem value="system">{t('theme.system')}</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              {/* 语言设置 */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'text.secondary' }}>
                  {t('language.title')}
                </Typography>
                <FormControl fullWidth size="small">
                  <Select
                    value={currentLanguage}
                    onChange={(e) => {
                      const newLang = e.target.value
                      setLanguage(newLang)
                      if (onLanguageChange) {
                        onLanguageChange(newLang)
                      } else {
                        setInternalLanguage(newLang)
                      }
                    }}
                    sx={{ fontSize: '14px' }}
                  >
                    {supportedLanguages.map((lang) => (
                      <MenuItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              {/* MFT 加速扫描（仅 Windows 磁盘根路径有效） */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={appSettings.useMftScan !== false}
                      onChange={async (_, checked) => {
                        const next = { ...appSettings, useMftScan: checked }
                        setAppSettings(next)
                        await saveAppSettings(next)
                      }}
                      size="small"
                    />
                  }
                  label={t('settings.useMftScan')}
                />
                <FormHelperText sx={{ mt: -0.5, ml: 0 }}>
                  {t('settings.useMftScanHint')}
                </FormHelperText>
              </Box>
            </Box>
          </TabPanel>
        </div>

        {/* 底部按钮 */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }} className="dark:!bg-gray-700/50 dark:!border-gray-600">
          {activeTab === 0 ? (
            <Button
              onClick={() => {
                setSettings(DEFAULT_SETTINGS)
                setAppSettings({ promptFileCount: 100, useMftScan: true })
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
              {t('settings.resetDefault')}
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
              {t('common.cancel')}
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
                {saved ? t('common.saved') : t('settings.saveSettings')}
              </Button>
            )}
          </Box>
        </Box>
      </div>
    </div>
  )
}
