<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { computed, defineAsyncComponent, ref, watchEffect } from 'vue'
import { defaultSettings, featureLabels, maxVocabularyLimit, minVocabularyLimit, promptDefaults } from '~/logic/defaults'
import { fetchProviderModels, testAiProvider, testAiScene } from '~/logic/aiClient'
import { runAiScene } from '~/logic/aiTransport'
import { getProtocolLabel, protocolOptions } from '~/logic/providers'
import { formatDomainList, normalizeSiteRuleDomain, parseDomainList } from '~/logic/siteRules'
import { aiCallLogs, contentDigestCache, forumDigestCache, githubDigestCache, lexiSettings, pageVisitLogs, vocabularyRecords } from '~/logic/storage'
import { summarizeByDay } from '~/logic/analytics'
import { estimateStorageBytes, formatBytes, formatDateTime, formatTime } from '~/logic/format'
import { normalizeForumCacheHistory } from '~/logic/forumDigestCache'
import { approveHttpEndpoint, assertEndpointAllowed, isHttpEndpoint, normalizeEndpointApproval, revokeHttpEndpoint } from '~/logic/endpointPolicy'
import { densityTiers, formatDensityPercent, getEffectiveDensity, maxReplacementLevel, minReplacementLevel, replacementLevels, resolveDensityTier, resolveReplacementLevel } from '~/logic/replacementLevels'
import { getSyncQuota, pullSettingsFromSync, pushSettingsToSync } from '~/logic/settingsSync'
import { exportVocabularyRecords, importVocabularyRecords } from '~/logic/vocabularyTransfer'
import { testConfiguredTranslationEngine } from '~/logic/translationClient'
import type { DensityTierId } from '~/logic/replacementLevels'
import type { ProviderModel } from '~/logic/providers'
import type { AiProviderConfig, AiTestResult, FeatureScene, ForumDigestCacheEntry, ForumDigestResult, PageTranslationScope, SiteSceneRule, SpecialSiteProfile, TranslationDirection, TranslationEngineConfig, TranslationEngineKind } from '~/logic/types'

type OptionsTab = 'settings' | 'customization' | 'vocabulary' | 'ai' | 'diagnostics' | 'about'
type VocabularyTab = 'overview' | 'settings'
type SettingsSection = 'learning' | 'sites' | 'translation' | 'digest' | 'sync'
type AiSection = 'special' | 'translation' | 'providers'

const scenes: Exclude<FeatureScene, 'vocabulary'>[] = ['replacement', 'selection', 'daily', 'digest', 'omni']
const aiScenes: FeatureScene[] = [...scenes, 'vocabulary']
const tabs: Array<{ id: OptionsTab, label: string, icon: string, description: string }> = [
  { id: 'settings', label: '基础设置', icon: 'i-lucide-sliders-horizontal', description: '控制 Lexi 在哪些网页生效、替换多少词，以及划词与翻译的行为。' },
  { id: 'customization', label: '自定义', icon: 'i-lucide-palette', description: '调整页面控件、快捷键、翻译卡样式与自定义 CSS。' },
  { id: 'ai', label: '供应商与功能', icon: 'i-lucide-sparkles', description: '统一管理通用 AI Provider、内置翻译服务与特殊站点功能。' },
  { id: 'vocabulary', label: '词库记录', icon: 'i-lucide-book-open', description: '查看网页替换、划词翻译与 AI 补充形成的本地词库。' },
  { id: 'diagnostics', label: '诊断记录', icon: 'i-lucide-activity', description: '检查最近的 AI 调用、网页访问与速读缓存状态。' },
  { id: 'about', label: '关于', icon: 'i-lucide-info', description: '查看版本、项目与开发者信息。' },
]
const aiSections: Array<{ id: AiSection, label: string }> = [
  { id: 'special', label: '特殊场景' },
  { id: 'translation', label: '内置翻译' },
  { id: 'providers', label: 'Provider 与功能' },
]
const settingsSections: Array<{ id: SettingsSection, label: string }> = [
  { id: 'learning', label: '词汇替换' },
  { id: 'sites', label: '网页范围' },
  { id: 'translation', label: '划词翻译' },
  { id: 'digest', label: '内容速读' },
  { id: 'sync', label: '同步' },
]
const translationDirections: Array<{ value: TranslationDirection, label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'zh-to-en', label: '中译英' },
  { value: 'en-to-zh', label: '英译中' },
]
const pageTranslationScopes: Array<{ value: PageTranslationScope, label: string }> = [
  { value: 'url', label: '当前链接' },
  { value: 'site', label: '当前站点' },
  { value: 'regex', label: '自定义 Regex' },
]
const densityTierOptions = densityTiers.map(tier => ({ value: tier.id, label: tier.label }))
const replacementDisplayOptions = [
  { value: 'english', label: '英语' },
  { value: 'chinese', label: '中文' },
  { value: 'bilingual', label: '中英双语' },
]
const translationCardStyleOptions = [
  { value: 'calm', label: '清醒蓝' },
  { value: 'contrast', label: '高对比' },
  { value: 'compact', label: '紧凑' },
]
const vocabularyAiSearchLoading = ref(false)
const vocabularyAiSearchResult = ref('')
const activeVocabularyTab = ref<VocabularyTab>('overview')

const appVersion = __VERSION__
const activeTab = ref<OptionsTab>('settings')
const activeSettingsSection = ref<SettingsSection>('learning')
const activeAiSection = ref<AiSection>('special')
const isCompactLayout = useMediaQuery('(max-width: 860px)')
const activeTabMeta = computed(() => tabs.find(tab => tab.id === activeTab.value) ?? tabs[0])
const newSceneRuleDomain = ref('')
const translationCardStyle = ref('calm')
const vocabularySearchQuery = ref('')
const DevFestivalPreview = __DEV__ ? defineAsyncComponent(() => import('./DevFestivalPreview.vue')) : null
const domainText = computed({
  get: () => formatDomainList(lexiSettings.value.siteRules.domains),
  set: value => lexiSettings.value.siteRules.domains = parseDomainList(value),
})

const activeLevel = computed(() => resolveReplacementLevel(lexiSettings.value.replacement.level))
const activeDensityTier = computed(() => resolveDensityTier(lexiSettings.value.replacement.density))
const effectiveDensityLabel = computed(() => formatDensityPercent(getEffectiveDensity(lexiSettings.value.replacement)))
const densityTaperLabel = computed(() => `×${activeLevel.value.densityScale}`)

const visitTrend = computed(() => summarizeByDay(pageVisitLogs.value))
const aiTrend = computed(() => summarizeByDay(aiCallLogs.value))
const aiTokenTrend = computed(() => summarizeTokensByDay(aiCallLogs.value))
const totalAiTokens = computed(() => aiCallLogs.value.reduce((sum, log) => sum + (log.totalTokens ?? 0), 0))
const aiSceneTokenStats = computed(() => aiScenes.map(scene => ({
  scene,
  calls: aiCallLogs.value.filter(log => log.scene === scene).length,
  tokens: aiCallLogs.value
    .filter(log => log.scene === scene)
    .reduce((sum, log) => sum + (log.totalTokens ?? 0), 0),
})))
const aiSuccessRate = computed(() => {
  if (!aiCallLogs.value.length)
    return 0
  return Math.round(aiCallLogs.value.filter(log => log.ok).length / aiCallLogs.value.length * 100)
})
const averageAiDuration = computed(() => {
  if (!aiCallLogs.value.length)
    return 0
  return Math.round(aiCallLogs.value.reduce((sum, log) => sum + log.durationMs, 0) / aiCallLogs.value.length)
})
const enabledProviderCount = computed(() => lexiSettings.value.ai.providers.filter(provider => provider.enabled).length)
const vocabularyCapacity = computed(() => Math.min(100, Math.round(vocabularyRecords.value.length / lexiSettings.value.history.maxRecords * 100)))
const contentDigestEntries = computed(() => Object.entries(contentDigestCache.value)
  .map(([key, entry]) => ({ key, ...entry }))
  .sort((a, b) => b.updatedAt - a.updatedAt))
const contentDigestStats = computed(() => ({
  total: contentDigestEntries.value.length,
  bytes: estimateStorageBytes(contentDigestCache.value),
}))
const githubDigestEntries = computed(() => Object.entries(githubDigestCache.value)
  .map(([key, entry]) => ({ key, ...entry }))
  .sort((a, b) => b.updatedAt - a.updatedAt))
const githubDigestStats = computed(() => ({
  total: githubDigestEntries.value.length,
  quick: githubDigestEntries.value.filter(entry => entry.quickDigest).length,
  detail: githubDigestEntries.value.filter(entry => entry.digest).length,
  bytes: estimateStorageBytes(githubDigestCache.value),
}))
const forumDigestEntries = computed(() => Object.entries(forumDigestCache.value)
  .map(([key, entry]) => ({ key, ...entry }))
  .sort((a, b) => b.updatedAt - a.updatedAt))
const forumDigestStats = computed(() => ({
  total: forumDigestEntries.value.length,
  bytes: estimateStorageBytes(forumDigestCache.value),
}))
const filteredVocabularyRecords = computed(() => {
  const query = normalizeSearchText(vocabularySearchQuery.value)
  if (!query)
    return vocabularyRecords.value

  return vocabularyRecords.value.filter(record => normalizeSearchText([
    record.original,
    record.replacement,
    record.meaning,
    record.example,
    record.tags.join(' '),
    record.context,
    record.pageTitle,
    record.pageUrl,
    record.source,
  ].filter(Boolean).join(' ')).includes(query))
})
const recentVocabularyRecords = computed(() => filteredVocabularyRecords.value.slice(0, 120))
const todayStudySummary = computed(() => createTodayStudySummary(vocabularyRecords.value))
const productVocabularyCount = computed(() => vocabularyRecords.value.filter(record => record.tags.includes('product')).length)
const storageStats = computed(() => {
  const vocabulary = estimateStorageBytes(vocabularyRecords.value)
  const items = [
    { label: '词库', bytes: vocabulary },
    { label: 'AI 日志', bytes: estimateStorageBytes(aiCallLogs.value) },
    { label: '访问日志', bytes: estimateStorageBytes(pageVisitLogs.value) },
    { label: '设置', bytes: estimateStorageBytes(lexiSettings.value) },
    { label: '多平台摘要缓存', bytes: estimateStorageBytes(contentDigestCache.value) },
    { label: 'GitHub 摘要缓存', bytes: estimateStorageBytes(githubDigestCache.value) },
    { label: '论坛摘要缓存', bytes: estimateStorageBytes(forumDigestCache.value) },
  ]

  return {
    items,
    // Named rather than read as items[0], which silently mislabelled three call sites
    // if the array order ever changed.
    vocabulary,
    others: items.slice(1),
    total: items.reduce((sum, item) => sum + item.bytes, 0),
  }
})
const testingScenes = ref<Partial<Record<FeatureScene, boolean>>>({})
const sceneTestResults = ref<Partial<Record<FeatureScene, string>>>({})
const sceneTestDetails = ref<Partial<Record<FeatureScene, AiTestResult>>>({})
const httpApprovalDialog = ref<HTMLDialogElement>()
const resetSettingsDialog = ref<HTMLDialogElement>()
let pendingHttpConnection: { endpoint: string } | undefined
let pendingHttpInput: HTMLInputElement | undefined
const pendingHttpEndpoint = ref('')

const providerPageSize = 8
const providerSearchQuery = ref('')
const providerPage = ref(1)
const providerDialog = ref<HTMLDialogElement>()
const translationEngineDialog = ref<HTMLDialogElement>()
const translationEngineDraft = ref<TranslationEngineConfig>()
const translationEngineDraftIsNew = ref(false)
const translationEngineRowTests = ref<Record<string, { loading: boolean, ok: boolean, message: string }>>({})
const providerDraft = ref<AiProviderConfig>()
const providerDraftIsNew = ref(false)
const providerModels = ref<ProviderModel[]>([])
const providerModelsError = ref('')
const loadingProviderModels = ref(false)
const providerTestResult = ref<AiTestResult>()
const providerTestMessage = ref('')
const testingProvider = ref(false)
const providerRowTests = ref<Record<string, { loading: boolean, ok: boolean, message: string }>>({})
const vocabularyImportInput = ref<HTMLInputElement>()
const vocabularyTransferMessage = ref('')
const syncMessage = ref('')
const syncBusy = ref(false)
const syncQuota = ref<{ used: number, total: number }>()

const filteredProviders = computed(() => {
  const query = normalizeSearchText(providerSearchQuery.value)
  if (!query)
    return lexiSettings.value.ai.providers

  return lexiSettings.value.ai.providers.filter(provider => normalizeSearchText([
    provider.label,
    provider.endpoint,
    provider.model,
    getProtocolLabel(provider.protocol),
  ].filter(Boolean).join(' ')).includes(query))
})
const providerPageCount = computed(() => Math.max(1, Math.ceil(filteredProviders.value.length / providerPageSize)))
const pagedProviders = computed(() => {
  const start = (providerPage.value - 1) * providerPageSize
  return filteredProviders.value.slice(start, start + providerPageSize)
})
const providerRangeLabel = computed(() => {
  const total = filteredProviders.value.length
  if (!total)
    return '0 条'

  const start = (providerPage.value - 1) * providerPageSize + 1
  return `${start}-${Math.min(total, start + providerPageSize - 1)} / ${total} 条`
})
const activeProtocolHint = computed(() => protocolOptions.find(option => option.value === providerDraft.value?.protocol)?.hint ?? '')
const sceneProviderNames = computed(() => new Map(lexiSettings.value.ai.providers.map(provider => [provider.id, provider.label || provider.id])))

// Deleting or filtering can leave the cursor past the last page.
watchEffect(() => {
  if (providerPage.value > providerPageCount.value)
    providerPage.value = providerPageCount.value
})

function setDensityTier(id: DensityTierId) {
  const tier = densityTiers.find(item => item.id === id)
  if (tier)
    lexiSettings.value.replacement.density = tier.value
}

function applyTranslationCardStyle(style: string) {
  translationCardStyle.value = style
  const css = style === 'contrast'
    ? '.lexi-selection-translation { background: #111827; color: #f9fafb; border-color: #60a5fa; }'
    : style === 'compact'
      ? '.lexi-selection-translation { max-width: 30rem; padding: 10px 12px; }'
      : '.lexi-selection-translation { background: #fff; border-color: #d4d9e2; }'
  lexiSettings.value.ui.customCss = css
}

function ensureSpecialProfiles() {
  const current = new Map(lexiSettings.value.siteRules.specialProfiles.map(profile => [profile.id, profile]))
  const mergedDefaults = defaultSettings.siteRules.specialProfiles.map(profile => ({
    ...profile,
    ...current.get(profile.id),
  }))
  const customProfiles = lexiSettings.value.siteRules.specialProfiles.filter(profile => profile.kind === 'custom')
  const nextProfiles = [...mergedDefaults, ...customProfiles]
  const changed = nextProfiles.length !== lexiSettings.value.siteRules.specialProfiles.length
    || nextProfiles.some((profile, index) => profile.id !== lexiSettings.value.siteRules.specialProfiles[index]?.id)

  if (changed)
    lexiSettings.value.siteRules.specialProfiles = nextProfiles
}

watchEffect(ensureSpecialProfiles)

function createProvider(): AiProviderConfig {
  return {
    id: `provider-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: '新 Provider',
    enabled: true,
    protocol: 'auto',
    endpoint: '',
    apiKey: '',
    model: '',
    priority: lexiSettings.value.ai.providers.length + 1,
    delayMs: Math.max(0, lexiSettings.value.ai.providers.length * 350),
    updatedAt: Date.now(),
  }
}

function openProviderEditor(provider?: AiProviderConfig) {
  providerDraftIsNew.value = !provider
  providerDraft.value = provider ? { ...provider } : createProvider()
  providerModels.value = []
  providerModelsError.value = ''
  providerTestResult.value = undefined
  providerTestMessage.value = ''
  providerDialog.value?.showModal()
}

function closeProviderEditor() {
  providerDialog.value?.close()
  providerDraft.value = undefined
}

function saveProviderDraft() {
  const draft = providerDraft.value
  if (!draft)
    return

  const provider: AiProviderConfig = {
    ...draft,
    label: draft.label.trim() || '未命名 Provider',
    endpoint: draft.endpoint.trim(),
    model: draft.model.trim(),
    apiKey: draft.apiKey.trim(),
    updatedAt: Date.now(),
  }
  const providers = lexiSettings.value.ai.providers
  const index = providers.findIndex(item => item.id === provider.id)
  lexiSettings.value.ai.providers = index < 0
    ? [...providers, provider]
    : providers.map(item => (item.id === provider.id ? provider : item))

  if (index < 0)
    providerPage.value = Math.max(1, Math.ceil((filteredProviders.value.length + 1) / providerPageSize))

  closeProviderEditor()
}

function removeProvider(id: string) {
  lexiSettings.value.ai.providers = lexiSettings.value.ai.providers.filter(provider => provider.id !== id)
  for (const scene of aiScenes)
    lexiSettings.value.ai[scene].providerIds = lexiSettings.value.ai[scene].providerIds.filter(providerId => providerId !== id)
}

function toggleProviderEnabled(id: string, enabled: boolean) {
  lexiSettings.value.ai.providers = lexiSettings.value.ai.providers.map(provider => (
    provider.id === id ? { ...provider, enabled, updatedAt: Date.now() } : provider
  ))
}

function createTranslationEngine(kind: TranslationEngineKind = 'microsoft'): TranslationEngineConfig {
  const google = kind === 'google-web'
  return {
    id: `translation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: google ? 'Google Translate Web' : 'Microsoft Translator',
    kind,
    enabled: false,
    priority: lexiSettings.value.translation.engines.length + 1,
    apiKey: '',
    region: '',
    acceptedRisk: !google,
    updatedAt: Date.now(),
  }
}

function openTranslationEngineEditor(engine?: TranslationEngineConfig) {
  translationEngineDraftIsNew.value = !engine
  translationEngineDraft.value = engine ? { ...engine } : createTranslationEngine()
  translationEngineTestMessage.value = ''
  translationEngineDialog.value?.showModal()
}

function closeTranslationEngineEditor() {
  translationEngineDialog.value?.close()
  translationEngineDraft.value = undefined
}

function saveTranslationEngineDraft() {
  const draft = translationEngineDraft.value
  if (!draft)
    return

  const engine: TranslationEngineConfig = {
    ...draft,
    label: draft.label.trim() || (draft.kind === 'microsoft' ? 'Microsoft Translator' : 'Google Translate Web'),
    priority: Math.max(1, Number(draft.priority) || 1),
    apiKey: draft.apiKey.trim(),
    region: draft.region.trim(),
    acceptedRisk: draft.kind === 'google-web' ? draft.acceptedRisk : true,
    updatedAt: Date.now(),
  }
  const index = lexiSettings.value.translation.engines.findIndex(item => item.id === engine.id)
  lexiSettings.value.translation.engines = index < 0
    ? [...lexiSettings.value.translation.engines, engine]
    : lexiSettings.value.translation.engines.map(item => item.id === engine.id ? engine : item)
  closeTranslationEngineEditor()
}

function removeTranslationEngine(id: string) {
  lexiSettings.value.translation.engines = lexiSettings.value.translation.engines.filter(engine => engine.id !== id)
}

function toggleTranslationEngineEnabled(id: string, enabled: boolean) {
  lexiSettings.value.translation.engines = lexiSettings.value.translation.engines.map(engine => (
    engine.id === id ? { ...engine, enabled, updatedAt: Date.now() } : engine
  ))
}

async function testTranslationEngine(engine: TranslationEngineConfig) {
  translationEngineRowTests.value = {
    ...translationEngineRowTests.value,
    [engine.id]: { loading: true, ok: false, message: '' },
  }
  try {
    const result = await testConfiguredTranslationEngine(engine)
    translationEngineRowTests.value = {
      ...translationEngineRowTests.value,
      [engine.id]: { loading: false, ok: true, message: `成功 · ${result.engineLabel}` },
    }
  }
  catch (error) {
    translationEngineRowTests.value = {
      ...translationEngineRowTests.value,
      [engine.id]: { loading: false, ok: false, message: error instanceof Error ? error.message : '测试失败' },
    }
  }
}

async function loadProviderModels() {
  const draft = providerDraft.value
  if (!draft)
    return

  loadingProviderModels.value = true
  providerModelsError.value = ''
  try {
    providerModels.value = await fetchProviderModels(draft)
  }
  catch (error) {
    providerModels.value = []
    providerModelsError.value = error instanceof Error ? error.message : '获取模型列表失败'
  }
  finally {
    loadingProviderModels.value = false
  }
}

async function testProviderDraft() {
  const draft = providerDraft.value
  if (!draft)
    return

  testingProvider.value = true
  providerTestMessage.value = ''
  providerTestResult.value = undefined
  try {
    const result = await testAiProvider(lexiSettings.value, draft)
    providerTestResult.value = result
    providerTestMessage.value = result.ok ? `连接成功 · ${result.durationMs}ms` : `连接失败 · ${result.status ?? '网络错误'}`
  }
  catch (error) {
    providerTestMessage.value = error instanceof Error ? error.message : '连接失败'
  }
  finally {
    testingProvider.value = false
  }
}

async function testProviderRow(provider: AiProviderConfig) {
  providerRowTests.value = {
    ...providerRowTests.value,
    [provider.id]: { loading: true, ok: false, message: '' },
  }

  try {
    const result = await testAiProvider(lexiSettings.value, provider)
    providerRowTests.value = {
      ...providerRowTests.value,
      [provider.id]: {
        loading: false,
        ok: result.ok,
        message: result.ok ? `成功 · ${result.durationMs}ms` : `失败 · ${result.status ?? '网络错误'}`,
      },
    }
  }
  catch (error) {
    providerRowTests.value = {
      ...providerRowTests.value,
      [provider.id]: {
        loading: false,
        ok: false,
        message: error instanceof Error ? error.message : '测试失败',
      },
    }
  }
}

function describeProviderScenes(id: string) {
  const bound = scenes.filter(scene => lexiSettings.value.ai[scene].providerIds.includes(id))
  return bound.length ? bound.map(scene => featureLabels[scene]).join('、') : '全部启用场景'
}

function providerSelected(scene: FeatureScene, providerId: string) {
  return lexiSettings.value.ai[scene].providerIds.includes(providerId)
}

function toggleSceneProvider(scene: FeatureScene, providerId: string, enabled: boolean) {
  const current = new Set(lexiSettings.value.ai[scene].providerIds)
  if (enabled)
    current.add(providerId)
  else
    current.delete(providerId)

  lexiSettings.value.ai[scene].providerIds = [...current]
}

function confirmHttpEndpoint(connection: { endpoint: string }, input: HTMLInputElement) {
  const endpoint = normalizeEndpointApproval(input.value)
  input.setCustomValidity('')
  if (!endpoint) {
    connection.endpoint = ''
    input.value = ''
    return
  }

  if (!isHttpEndpoint(endpoint)) {
    try {
      assertEndpointAllowed(endpoint, lexiSettings.value.ai.approvedHttpEndpoints)
      connection.endpoint = endpoint
      input.value = endpoint
    }
    catch (error) {
      input.value = connection.endpoint
      input.setCustomValidity(error instanceof Error ? error.message : 'AI Endpoint 地址无效')
      input.reportValidity()
    }
    return
  }

  const approved = lexiSettings.value.ai.approvedHttpEndpoints
  if (approved.includes(endpoint)) {
    connection.endpoint = endpoint
    input.value = endpoint
    return
  }

  pendingHttpConnection = connection
  pendingHttpInput = input
  pendingHttpEndpoint.value = endpoint
  httpApprovalDialog.value?.showModal()
}

function resolveHttpEndpointApproval(approved: boolean) {
  const connection = pendingHttpConnection
  const input = pendingHttpInput
  const endpoint = pendingHttpEndpoint.value
  if (approved && connection) {
    lexiSettings.value.ai.approvedHttpEndpoints = approveHttpEndpoint(
      lexiSettings.value.ai.approvedHttpEndpoints,
      endpoint,
    )
    connection.endpoint = endpoint
    if (input)
      input.value = endpoint
  }
  else if (input) {
    input.value = connection?.endpoint ?? ''
  }

  pendingHttpConnection = undefined
  pendingHttpInput = undefined
  pendingHttpEndpoint.value = ''
  httpApprovalDialog.value?.close()
}

function revokeApprovedHttpEndpoint(endpoint: string) {
  lexiSettings.value.ai.approvedHttpEndpoints = revokeHttpEndpoint(
    lexiSettings.value.ai.approvedHttpEndpoints,
    endpoint,
  )
}

function onOptionsTabKeydown(event: KeyboardEvent, index: number) {
  let nextIndex = index
  const previousKey = isCompactLayout.value ? 'ArrowLeft' : 'ArrowUp'
  const nextKey = isCompactLayout.value ? 'ArrowRight' : 'ArrowDown'
  if (event.key === nextKey)
    nextIndex = (index + 1) % tabs.length
  else if (event.key === previousKey)
    nextIndex = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = tabs.length - 1
  else
    return

  event.preventDefault()
  const tab = tabs[nextIndex]
  activeTab.value = tab.id
  requestAnimationFrame(() => document.getElementById(`options-tab-${tab.id}`)?.focus())
}

function clearContentDigestCache() {
  contentDigestCache.value = {}
}

function removeContentDigestCacheEntry(key: string) {
  const next = { ...contentDigestCache.value }
  delete next[key]
  contentDigestCache.value = next
}

function clearGitHubDigestCache() {
  githubDigestCache.value = {}
}

function removeGitHubDigestCacheEntry(key: string) {
  const next = { ...githubDigestCache.value }
  delete next[key]
  githubDigestCache.value = next
}

function clearForumDigestCache() {
  forumDigestCache.value = {}
}

function removeForumDigestCacheEntry(key: string) {
  const next = { ...forumDigestCache.value }
  delete next[key]
  forumDigestCache.value = next
}

function formatForumDigestSummary(digest: ForumDigestResult) {
  return digest.oneLine || digest.summary[0] || '暂无摘要'
}

function getForumDigestHistoryCount(entry: ForumDigestCacheEntry) {
  return normalizeForumCacheHistory(entry).length
}

async function testScene(scene: FeatureScene) {
  testingScenes.value[scene] = true
  sceneTestResults.value[scene] = ''
  sceneTestDetails.value[scene] = undefined

  try {
    const result = await testAiScene(lexiSettings.value, scene)
    sceneTestDetails.value[scene] = result
    sceneTestResults.value[scene] = result.ok ? `测试成功 · ${result.durationMs}ms` : `测试失败 · ${result.status ?? '网络错误'}`
  }
  catch (error) {
    sceneTestResults.value[scene] = error instanceof Error ? error.message : '测试失败'
  }
  finally {
    testingScenes.value[scene] = false
  }
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function createTodayStudySummary(records: typeof vocabularyRecords.value) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const today = records.filter(record => record.updatedAt >= start.getTime())
  const technical = today.filter(record => record.tags.includes('technical'))
  const manual = today.filter(record => record.source === 'manual')
  const auto = today.filter(record => record.source === 'auto')
  const terms = [...technical, ...manual]
    .slice(0, 8)
    .map(record => `${record.original} -> ${record.replacement}`)

  return {
    total: today.length,
    manual: manual.length,
    auto: auto.length,
    technical: technical.length,
    terms,
    suggestion: today.length
      ? '建议保留高频技术词，过滤重复上下文和普通短句。'
      : '今天暂无新记录，浏览技术内容后会自动形成学习摘要。',
  }
}

function addSpecialProfile() {
  const id = `custom-${Date.now()}`
  const profile: SpecialSiteProfile = {
    id,
    label: '自定义场景',
    kind: 'custom',
    domains: [],
    enabled: false,
    replacement: false,
    selection: true,
    dynamicScan: false,
    conservative: true,
    examSafe: false,
    maxPerPage: 4,
    density: 0.05,
  }
  lexiSettings.value.siteRules.specialProfiles = [profile, ...lexiSettings.value.siteRules.specialProfiles]
}

function removeSpecialProfile(id: string) {
  lexiSettings.value.siteRules.specialProfiles = lexiSettings.value.siteRules.specialProfiles.filter(profile => profile.id !== id)
}

function formatSpecialDomains(profile: SpecialSiteProfile) {
  return profile.domains.join('\n')
}

function updateSpecialDomains(profile: SpecialSiteProfile, value: string) {
  profile.domains = parseDomainList(value)
}

function summarizeTokensByDay(logs: typeof aiCallLogs.value, days = 7) {
  return summarizeByDay(logs, days, log => log.totalTokens ?? 0)
}

function formatTestRequest(result: AiTestResult) {
  return JSON.stringify(result.request, null, 2)
}

function resetScenePrompt(scene: FeatureScene) {
  lexiSettings.value.ai[scene].prompt = promptDefaults[scene]
}

function addSceneRule() {
  const domain = normalizeSiteRuleDomain(newSceneRuleDomain.value)
  if (!domain || lexiSettings.value.siteRules.sceneRules.some(rule => rule.domain === domain))
    return

  const rule: SiteSceneRule = {
    domain,
    replacement: true,
    selection: true,
    daily: true,
    digest: true,
    omni: true,
  }
  lexiSettings.value.siteRules.sceneRules = [rule, ...lexiSettings.value.siteRules.sceneRules]
  newSceneRuleDomain.value = ''
}

function removeSceneRule(index: number) {
  lexiSettings.value.siteRules.sceneRules = lexiSettings.value.siteRules.sceneRules.filter((_, current) => current !== index)
}

function resetSettings() {
  lexiSettings.value = structuredClone(defaultSettings)
  resetSettingsDialog.value?.close()
}

async function refreshSyncQuota() {
  syncQuota.value = await getSyncQuota()
}

watchEffect(() => {
  if (activeTab.value === 'settings')
    void refreshSyncQuota()
})

async function syncNow() {
  syncBusy.value = true
  syncMessage.value = ''
  try {
    const result = await pushSettingsToSync(lexiSettings.value)
    lexiSettings.value.sync = {
      ...lexiSettings.value.sync,
      lastSyncedAt: result.updatedAt,
      lastError: '',
    }
    syncMessage.value = `已上传 ${formatBytes(result.bytes)} 到 Google 账号`
    await refreshSyncQuota()
  }
  catch (error) {
    syncMessage.value = error instanceof Error ? error.message : '同步失败'
    lexiSettings.value.sync = { ...lexiSettings.value.sync, lastError: syncMessage.value }
  }
  finally {
    syncBusy.value = false
  }
}

async function pullSyncNow() {
  syncBusy.value = true
  syncMessage.value = ''
  try {
    const settings = await pullSettingsFromSync()
    syncMessage.value = settings ? '已拉取 Google 账号中的设置' : 'Google 账号中还没有 Lexi 设置'
  }
  catch (error) {
    syncMessage.value = error instanceof Error ? error.message : '拉取失败'
  }
  finally {
    syncBusy.value = false
  }
}

function exportVocabulary() {
  exportVocabularyRecords(vocabularyRecords.value)
  vocabularyTransferMessage.value = `已导出 ${vocabularyRecords.value.length} 条记录`
}

async function importVocabulary(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files?.[0])
    return

  try {
    const result = await importVocabularyRecords(
      input.files[0],
      vocabularyRecords.value,
      lexiSettings.value.history.maxRecords,
    )

    vocabularyRecords.value = result.records
    vocabularyTransferMessage.value = `已导入 ${result.imported} 条，跳过 ${result.skipped} 条无效记录`
  }
  catch (error) {
    vocabularyTransferMessage.value = error instanceof Error ? error.message : '导入失败'
  }
  finally {
    input.value = ''
  }
}
async function searchVocabularyWithAi() {
  const query = vocabularySearchQuery.value.trim()
  if (!query || vocabularyAiSearchLoading.value)
    return

  vocabularyAiSearchLoading.value = true
  vocabularyAiSearchResult.value = ''
  try {
    const candidates = filteredVocabularyRecords.value
      .slice(0, 120)
      .map(record => ({ original: record.original, replacement: record.replacement, meaning: record.meaning, tags: record.tags }))
    const result = await runAiScene({
      scene: 'vocabulary',
      system: lexiSettings.value.ai.vocabulary.prompt,
      messages: [{
        role: 'user',
        content: JSON.stringify({ query, candidates }),
      }],
    })
    vocabularyAiSearchResult.value = result?.text?.trim() || '没有找到与该问题相关的词条。'
  }
  catch (error) {
    vocabularyAiSearchResult.value = error instanceof Error ? error.message : 'AI 词库搜索失败。'
  }
  finally {
    vocabularyAiSearchLoading.value = false
  }
}
</script>

<template>
  <main class="options-page">
    <a class="options-skip-link" href="#options-content">跳到主要内容</a>
    <dialog
      ref="httpApprovalDialog"
      class="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2 border border-neutral-200 bg-white p-0 text-neutral-950 shadow-xl backdrop:bg-neutral-950/60"
      aria-labelledby="http-endpoint-title"
      @cancel.prevent="resolveHttpEndpointApproval(false)"
    >
      <div class="p-5">
        <h2 id="http-endpoint-title" class="text-16px font-700">
          确认使用 HTTP Endpoint
        </h2>
        <p class="mt-3 text-13px leading-6 text-neutral-700">
          HTTP 不会加密 API Key、选中文本或页面上下文，传输途中可能被读取。许可只对下面的完整地址生效，地址变化后会重新确认。
        </p>
        <code class="mt-3 block break-all rounded-2 bg-neutral-100 px-3 py-2 text-12px text-neutral-800">{{ pendingHttpEndpoint }}</code>
        <div class="mt-5 flex justify-end gap-2">
          <BaseButton @click="resolveHttpEndpointApproval(false)">
            取消
          </BaseButton>
          <BaseButton variant="warning" @click="resolveHttpEndpointApproval(true)">
            理解风险并允许
          </BaseButton>
        </div>
      </div>
    </dialog>

    <dialog
      ref="providerDialog"
      class="options-dialog options-dialog--wide"
      aria-labelledby="provider-editor-title"
      @cancel.prevent="closeProviderEditor"
    >
      <form v-if="providerDraft" class="options-dialog__body" method="dialog" @submit.prevent="saveProviderDraft">
        <h2 id="provider-editor-title">
          {{ providerDraftIsNew ? '添加 Provider' : '编辑 Provider' }}
        </h2>
        <p>协议决定请求格式；选择“自动识别”时按 Endpoint 与模型名推断。</p>

        <div class="provider-form">
          <FormField label="名称" compact>
            <BaseInput v-model="providerDraft.label" size="sm" placeholder="OpenAI / Claude / 自建网关" />
          </FormField>
          <FormField label="协议" :hint="activeProtocolHint" compact>
            <BaseSelect v-model="providerDraft.protocol" size="sm">
              <option v-for="option in protocolOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </BaseSelect>
          </FormField>

          <FormField class="provider-form__wide" label="Endpoint" hint="填基础地址即可，例如 https://api.example.com 或 .../v1。" compact>
            <BaseInput :model-value="providerDraft.endpoint" size="sm" placeholder="https://api.example.com/v1" @change="confirmHttpEndpoint(providerDraft, $event.target as HTMLInputElement)" />
          </FormField>

          <FormField class="provider-form__wide" label="API Key" compact>
            <BaseInput v-model="providerDraft.apiKey" type="password" size="sm" placeholder="sk-..." autocomplete="off" />
          </FormField>

          <FormField class="provider-form__wide" label="模型" hint="可直接输入，或先拉取该 Endpoint 的模型列表再选择。" compact>
            <div class="provider-form__model">
              <BaseInput v-model="providerDraft.model" size="sm" list="provider-model-options" placeholder="gpt-4.1-mini" />
              <BaseButton size="sm" :loading="loadingProviderModels" loading-label="正在获取模型列表" @click="loadProviderModels">
                获取模型
              </BaseButton>
            </div>
            <datalist id="provider-model-options">
              <option v-for="model in providerModels" :key="model.id" :value="model.id">
                {{ model.label || model.id }}
              </option>
            </datalist>
          </FormField>

          <FormField label="优先级" hint="数字越小越先发起。" compact>
            <BaseInput v-model="providerDraft.priority" type="number" size="sm" :min="1" />
          </FormField>
          <FormField label="延迟 ms" hint="竞速时延后发起，用于兜底 Provider。" compact>
            <BaseInput v-model="providerDraft.delayMs" type="number" size="sm" :min="0" :step="50" />
          </FormField>
        </div>

        <p v-if="providerModelsError" class="provider-form__error">
          {{ providerModelsError }}
        </p>
        <p v-else-if="providerModels.length" class="provider-form__note">
          已获取 {{ providerModels.length }} 个模型，输入框可直接下拉选择。
        </p>

        <div class="mt-4">
          <BaseCheckbox v-model="providerDraft.enabled" label="启用此 Provider" />
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <BaseButton :loading="testingProvider" loading-label="正在测试连接" @click="testProviderDraft">
            测试连接
          </BaseButton>
          <span v-if="providerTestMessage" class="text-12px" :class="providerTestResult?.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ providerTestMessage }}
          </span>
        </div>
        <pre v-if="providerTestResult" class="mt-2 max-h-32 overflow-auto rounded-2 bg-neutral-50 p-3 text-11px leading-4 text-neutral-700">{{ providerTestResult.response || '空响应' }}</pre>

        <div class="options-dialog__actions">
          <BaseButton type="button" @click="closeProviderEditor">
            取消
          </BaseButton>
          <BaseButton type="submit" variant="primary">
            保存
          </BaseButton>
        </div>
      </form>
    </dialog>

    <dialog
      ref="translationEngineDialog"
      class="options-dialog"
      aria-labelledby="translation-engine-editor-title"
      @cancel.prevent="closeTranslationEngineEditor"
    >
      <form v-if="translationEngineDraft" class="options-dialog__body" method="dialog" @submit.prevent="saveTranslationEngineDraft">
        <h2 id="translation-engine-editor-title">
          {{ translationEngineDraftIsNew ? '添加翻译引擎' : '编辑翻译引擎' }}
        </h2>
        <p>传统翻译引擎优先于 AI 场景。启用多个时按优先级依次回退，不会同时发送相同文本。</p>
        <div class="provider-form">
          <FormField label="名称" compact>
            <BaseInput v-model="translationEngineDraft.label" size="sm" placeholder="Microsoft Translator" />
          </FormField>
          <FormField label="类型" compact>
            <BaseSelect v-model="translationEngineDraft.kind" size="sm">
              <option value="microsoft">
                Microsoft Translator F0
              </option>
              <option value="google-web">
                Google Translate Web（非官方）
              </option>
            </BaseSelect>
          </FormField>
          <FormField v-if="translationEngineDraft.kind === 'microsoft'" class="provider-form__wide" label="订阅 Key" hint="Azure Translator F0 资源的 Key，仅保存在本机或按同步设置同步。" compact>
            <BaseInput v-model="translationEngineDraft.apiKey" type="password" size="sm" autocomplete="off" />
          </FormField>
          <FormField v-if="translationEngineDraft.kind === 'microsoft'" label="Region" hint="例如 eastasia。" compact>
            <BaseInput v-model="translationEngineDraft.region" size="sm" placeholder="eastasia" />
          </FormField>
          <FormField label="优先级" hint="数字越小越先尝试。" compact>
            <BaseInput v-model="translationEngineDraft.priority" type="number" size="sm" :min="1" />
          </FormField>
          <FormField label="渠道每日上限" hint="0 表示不限制；达到上限后会改用下一优先级渠道。" compact>
            <BaseInput v-model.number="translationEngineDraft.dailyLimit" type="number" size="sm" :min="0" />
          </FormField>
        </div>
        <div v-if="translationEngineDraft.kind === 'google-web'" class="mt-4 rounded-2 border border-amber-200 bg-amber-50 p-3 text-12px leading-5 text-amber-900">
          Google Translate Web 不是官方 API，接口可能随时变化，也可能受服务条款或网络环境限制。确认后才允许启用和调度。
          <BaseCheckbox v-model="translationEngineDraft.acceptedRisk" class="mt-3" label="我理解并接受非官方接口风险" />
        </div>
        <div class="mt-4">
          <BaseCheckbox v-model="translationEngineDraft.enabled" label="启用此翻译引擎" />
        </div>
        <div class="options-dialog__actions">
          <BaseButton type="button" @click="closeTranslationEngineEditor">
            取消
          </BaseButton>
          <BaseButton type="submit" variant="primary">
            保存
          </BaseButton>
        </div>
      </form>
    </dialog>

    <dialog
      ref="resetSettingsDialog"
      class="options-dialog"
      aria-labelledby="reset-settings-title"
    >
      <div class="options-dialog__body">
        <h2 id="reset-settings-title">
          恢复默认设置
        </h2>
        <p>这会重置全部偏好，包括站点规则、速读设置、自定义 CSS、AI Provider、API Key 和提示词。词库、访问记录与缓存不会被删除。</p>
        <div class="options-dialog__actions">
          <BaseButton @click="resetSettingsDialog?.close()">
            取消
          </BaseButton>
          <BaseButton variant="danger" @click="resetSettings">
            恢复默认
          </BaseButton>
        </div>
      </div>
    </dialog>

    <aside class="options-sidebar" aria-label="Lexi 设置导航">
      <div class="options-sidebar__top">
        <div class="options-brand">
          <Logo class="options-brand__logo" />
          <div>
            <strong>Lexi</strong>
            <span>v{{ appVersion }}</span>
          </div>
        </div>

        <nav class="options-nav" role="tablist" aria-label="设置分类" :aria-orientation="isCompactLayout ? 'horizontal' : 'vertical'">
          <button
            v-for="tab in tabs"
            :id="`options-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`options-panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            class="options-nav__item"
            :class="{ 'is-active': activeTab === tab.id }"
            @click="activeTab = tab.id"
            @keydown="onOptionsTabKeydown($event, tabs.indexOf(tab))"
          >
            <span class="options-nav__icon" :class="tab.icon" aria-hidden="true" />
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </div>

      <div class="options-sidebar__summary">
        <span>已记录词汇</span>
        <strong>{{ vocabularyRecords.length }}<em>/ {{ lexiSettings.history.maxRecords }}</em></strong>
        <small>今日新增 {{ todayStudySummary.total }} · 技术词 {{ todayStudySummary.technical }}</small>
      </div>
    </aside>

    <section class="options-workspace">
      <header class="options-header">
        <span class="sr-only">Lexi</span>
        <div>
          <h1>{{ activeTabMeta.label }}</h1>
          <p>{{ activeTabMeta.description }}</p>
        </div>
        <div v-if="activeTab === 'settings'" class="options-header__actions">
          <span class="options-save-state"><span aria-hidden="true" />更改自动保存</span>
          <BaseButton @click="resetSettingsDialog?.showModal()">
            <template #icon>
              <span class="i-lucide-rotate-ccw" aria-hidden="true" />
            </template>
            恢复默认
          </BaseButton>
        </div>
      </header>

      <div id="options-content" class="options-content" tabindex="-1">
        <section v-if="activeTab === 'settings' || activeTab === 'customization'" id="options-panel-settings" role="tabpanel" aria-labelledby="options-tab-settings" class="options-panel settings-layout">
          <div v-if="activeTab === 'settings'" class="settings-section-tabs" role="tablist" aria-label="基础设置分区">
            <button
              v-for="section in settingsSections"
              :key="section.id"
              type="button"
              role="tab"
              :aria-selected="activeSettingsSection === section.id"
              :class="{ 'is-active': activeSettingsSection === section.id }"
              @click="activeSettingsSection = section.id"
            >
              {{ section.label }}
            </button>
          </div>
          <section v-show="activeTab === 'settings' && activeSettingsSection === 'learning'" class="settings-card settings-card--wide">
            <header class="settings-card__head">
              <div>
                <h2>替换强度</h2>
                <p>决定 Lexi 替换哪一档难度的词，以及一页里出现多少个。</p>
              </div>
              <SettingToggle v-model="lexiSettings.replacement.enabled" label="自动替换词汇" />
            </header>

            <div class="settings-split">
              <div class="settings-stack">
                <RangeControl
                  v-model="lexiSettings.replacement.level"
                  label="学习等级"
                  hint="按你的英语水平选择，Lexi 只替换这一档的词。"
                  :display-value="`${activeLevel.level} · ${activeLevel.shortLabel}`"
                  :min="minReplacementLevel"
                  :max="maxReplacementLevel"
                  :disabled="!lexiSettings.replacement.enabled"
                />
                <div class="level-ends">
                  <span>1 · 零基础，替换最多</span>
                  <span>9 · 母语级，替换最少</span>
                </div>

                <div class="level-detail">
                  <span class="level-detail__badge">L{{ activeLevel.level }}</span>
                  <div>
                    <strong>{{ activeLevel.label }}</strong>
                    <small>{{ activeLevel.scale }} · {{ activeLevel.coverage }}</small>
                  </div>
                </div>
              </div>

              <div class="settings-stack">
                <div class="settings-field">
                  <span class="settings-field__label">替换密度</span>
                  <SegmentedControl
                    :model-value="activeDensityTier.id"
                    :options="densityTierOptions"
                    label="替换密度"
                    :disabled="!lexiSettings.replacement.enabled"
                    @update:model-value="setDensityTier"
                  />
                  <p class="settings-field__hint">
                    {{ activeDensityTier.hint }}
                  </p>
                </div>

                <div class="settings-callout">
                  <span class="i-lucide-info" aria-hidden="true" />
                  <p>
                    等级越低，命中的都是最常见的词，一整页会被替换得很多，所以密度会按等级适度递减。
                    当前等级 {{ activeLevel.level }} 折算系数 {{ densityTaperLabel }}，实际生效约 {{ effectiveDensityLabel }}。
                  </p>
                </div>

                <div class="settings-field">
                  <span class="settings-field__label">文中显示</span>
                  <SegmentedControl
                    v-model="lexiSettings.replacement.displayMode"
                    :options="replacementDisplayOptions"
                    label="文中显示语言"
                    :disabled="!lexiSettings.replacement.enabled"
                  />
                  <p class="settings-field__hint">
                    默认只显示英语；选择中英双语后，替换词会直接附带原中文，无需悬停查看。
                  </p>
                </div>

                <FormField label="单页最多替换" hint="达到上限后停止替换，避免影响阅读。">
                  <BaseInput
                    v-model="lexiSettings.replacement.maxPerPage"
                    type="number"
                    :min="1"
                    :max="80"
                    :disabled="!lexiSettings.replacement.enabled"
                  />
                </FormField>

                <p class="settings-note">
                  信息流、论坛与学习类站点会在这个基础上进一步收敛，可在“特殊场景”里单独调整。
                </p>
              </div>
            </div>

            <CollapsibleSection class="level-guide" title="9 个等级分别对应什么" hint="点一行即可切换">
              <ul class="level-table">
                <li v-for="preset in replacementLevels" :key="preset.level">
                  <button
                    type="button"
                    :class="{ 'is-active': preset.level === activeLevel.level }"
                    :aria-pressed="preset.level === activeLevel.level"
                    :disabled="!lexiSettings.replacement.enabled"
                    @click="lexiSettings.replacement.level = preset.level"
                  >
                    <span class="level-table__no">{{ preset.level }}</span>
                    <span class="level-table__copy">
                      <strong>{{ preset.label }}</strong>
                      <small>{{ preset.scale }} · {{ preset.coverage }}</small>
                    </span>
                  </button>
                </li>
              </ul>
            </CollapsibleSection>
          </section>

          <section v-show="activeTab === 'settings' && activeSettingsSection === 'sites'" class="settings-card">
            <header class="settings-card__head">
              <div>
                <h2>网页启用范围</h2>
                <p>控制 Lexi 在哪些网页生效，以及每个域名可用的 AI 场景。</p>
              </div>
            </header>

            <div class="settings-stack">
              <SettingToggle
                v-model="lexiSettings.siteRules.enabled"
                label="总开关"
                hint="关闭后不替换、不划词翻译。"
              />

              <FormField label="匹配模式" hint="决定域名列表作为白名单还是黑名单使用。">
                <BaseSelect v-model="lexiSettings.siteRules.mode">
                  <option value="all">
                    全部网页
                  </option>
                  <option value="allowlist">
                    仅白名单
                  </option>
                  <option value="blocklist">
                    排除黑名单
                  </option>
                </BaseSelect>
              </FormField>

              <FormField label="域名列表" hint="每行一个域名，支持填写子域名。">
                <BaseTextarea
                  v-model="domainText"
                  class="min-h-28"
                  placeholder="example.com&#10;docs.example.com"
                />
              </FormField>

              <div class="settings-subcard">
                <FormField label="域名场景规则" hint="按域名单独控制可用的 AI 场景。">
                  <div class="flex gap-2">
                    <BaseInput v-model="newSceneRuleDomain" class="min-w-0 flex-1" placeholder="docs.example.com" @keydown.enter="addSceneRule" />
                    <BaseButton variant="primary" @click="addSceneRule">
                      <template #icon>
                        <span class="i-lucide-plus" aria-hidden="true" />
                      </template>
                      添加
                    </BaseButton>
                  </div>
                </FormField>
                <div class="mt-3 space-y-2">
                  <div v-for="(rule, index) in lexiSettings.siteRules.sceneRules" :key="rule.domain" class="rounded-2 border border-neutral-200 bg-white px-3 py-2">
                    <div class="flex items-center justify-between gap-2">
                      <BaseInput v-model="rule.domain" size="sm" class="min-w-0 flex-1 font-600" aria-label="规则域名" />
                      <BaseButton variant="ghost" size="sm" @click="removeSceneRule(index)">
                        删除
                      </BaseButton>
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <BaseCheckbox
                        v-for="scene in scenes"
                        :key="`${rule.domain}-${scene}`"
                        v-model="rule[scene]"
                        :label="featureLabels[scene]"
                        compact
                      />
                    </div>
                  </div>
                  <p v-if="!lexiSettings.siteRules.sceneRules.length" class="settings-note">
                    暂无精细规则，默认按总开关和匹配模式启用全部场景。
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section v-show="activeTab === 'settings' && activeSettingsSection === 'translation'" class="settings-card">
            <header class="settings-card__head">
              <div>
                <h2>划词与翻译</h2>
                <p>控制划词翻译的触发方式、翻译方向，以及整页自动翻译。</p>
              </div>
            </header>

            <div class="settings-stack">
              <SettingToggle
                v-model="lexiSettings.selection.autoTranslate"
                label="划词自动翻译"
                hint="选中文本后直接给出译文。"
              />
              <SettingToggle
                v-model="lexiSettings.selection.requireModifierKey"
                label="按住修饰键触发划词翻译"
                hint="macOS 使用 Command，Windows/Linux 使用 Ctrl。媒体点击可单独配置，默认 meta+shift。"
              />
              <FormField label="划词翻译方向" hint="自动判断会根据选中内容切换中英方向。">
                <BaseSelect v-model="lexiSettings.selection.translationDirection">
                  <option v-for="item in translationDirections" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </BaseSelect>
              </FormField>
              <div class="rounded-2 border border-blue-100 bg-blue-50 px-3 py-3 text-12px text-blue-950">
                <strong>页面双语翻译需手动确认</strong>
                <p class="mt-1 leading-5 text-blue-800">
                  请在要翻译的网页打开 Lexi 侧边栏，选择方向后保存并开始。未完成该引导时，Lexi 不会自动翻译任何页面。
                </p>
              </div>

              <div class="settings-subcard">
                <h3>页面自动翻译</h3>
                <p>启用后可按当前链接、站点或自定义 Regex 自动恢复；滚动停止后的可视区域优先翻译，其余内容预加载并缓存。</p>
                <div class="settings-stack settings-stack--tight">
                  <FormField label="启用范围">
                    <BaseSelect v-model="lexiSettings.selection.pageTranslation.scope">
                      <option v-for="item in pageTranslationScopes" :key="item.value" :value="item.value">
                        {{ item.label }}
                      </option>
                    </BaseSelect>
                  </FormField>
                  <FormField v-if="lexiSettings.selection.pageTranslation.scope === 'regex'" label="URL Regex">
                    <BaseInput v-model="lexiSettings.selection.pageTranslation.regex" class="font-mono" placeholder="^https://docs\\.example\\.com/" />
                  </FormField>
                  <div class="settings-fields">
                    <FormField label="合并请求段数" compact>
                      <BaseInput v-model="lexiSettings.selection.pageTranslation.batchSize" type="number" :min="1" :max="8" />
                    </FormField>
                    <FormField label="预加载段数" compact>
                      <BaseInput v-model="lexiSettings.selection.pageTranslation.prefetchBlocks" type="number" :min="0" :max="40" />
                    </FormField>
                    <FormField label="单页缓存上限" compact>
                      <BaseInput v-model="lexiSettings.selection.pageTranslation.maxBlocksPerPage" type="number" :min="10" :max="300" />
                    </FormField>
                    <FormField label="缓存天数" compact>
                      <BaseInput v-model="lexiSettings.selection.pageTranslation.cacheDays" type="number" :min="1" :max="90" />
                    </FormField>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section v-show="activeTab === 'settings' && activeSettingsSection === 'digest'" class="settings-card">
            <header class="settings-card__head">
              <div>
                <h2>内容速读</h2>
                <p>为主流内容平台、GitHub 仓库和论坛帖子生成带读取范围的结构化摘要。</p>
              </div>
            </header>

            <div class="settings-stack">
              <div class="settings-subcard">
                <h3>多平台内容速读</h3>
                <p>支持 Reddit、X、YouTube、Bilibili、小红书和知乎；只总结页面已公开、已加载的文字或字幕。使用前需在“AI 场景”中显式启用“内容速读”。</p>
                <div class="settings-stack settings-stack--tight">
                  <SettingToggle v-model="lexiSettings.contentDigest.enabled" label="显示多平台速读卡片" />
                  <SettingToggle v-model="lexiSettings.contentDigest.autoGenerate" label="停留后自动生成摘要" />
                  <SettingToggle
                    v-model="lexiSettings.contentDigest.allowNsfw"
                    label="允许 NSFW 内容速读"
                    hint="默认关闭；关闭时不会提取、缓存或发送检测到的 NSFW 内容。"
                  />
                  <RangeControl
                    v-model="lexiSettings.contentDigest.autoDelaySeconds"
                    label="自动生成延迟"
                    :display-value="`${lexiSettings.contentDigest.autoDelaySeconds} 秒`"
                    :min="1"
                    :max="30"
                  />
                  <FormField label="最长缓存天数" hint="动态帖子会使用更短的平台级缓存时间。">
                    <BaseInput v-model="lexiSettings.contentDigest.cacheDays" type="number" :min="1" :max="60" />
                  </FormField>
                </div>
              </div>

              <div class="settings-subcard">
                <h3>GitHub Digest</h3>
                <p>先显示基础速读；停留一段时间或点击按钮后，结合 README 和当前页面内容生成详细总览。</p>
                <div class="settings-stack settings-stack--tight">
                  <SettingToggle v-model="lexiSettings.githubDigest.enabled" label="显示速读卡片" />
                  <SettingToggle v-model="lexiSettings.githubDigest.autoGenerate" label="停留后自动生成详细总览" />
                  <SettingToggle
                    v-model="lexiSettings.githubDigest.allowPrivateAutoGenerate"
                    label="私有仓库也允许自动生成"
                    hint="默认关闭；仍可手动点击生成。"
                  />
                  <RangeControl
                    v-model="lexiSettings.githubDigest.autoDelaySeconds"
                    label="自动生成延迟"
                    :display-value="`${lexiSettings.githubDigest.autoDelaySeconds} 秒`"
                    :min="8"
                    :max="45"
                  />
                  <FormField label="缓存天数">
                    <BaseInput v-model="lexiSettings.githubDigest.cacheDays" type="number" :min="1" :max="60" />
                  </FormField>
                </div>
              </div>

              <div class="settings-subcard">
                <h3>Discourse / 论坛速读</h3>
                <p>对 linux.do、idcflare.com 以及自动识别到的 Discourse 帖子，只读取主贴和前几楼做快速总结，降低 token 消耗。</p>
                <div class="settings-stack settings-stack--tight">
                  <SettingToggle v-model="lexiSettings.forumDigest.enabled" label="显示论坛速读卡片" />
                  <SettingToggle v-model="lexiSettings.forumDigest.autoGenerate" label="自动生成整帖总结" />
                  <RangeControl
                    v-model="lexiSettings.forumDigest.autoDelaySeconds"
                    label="自动生成延迟"
                    :display-value="`${lexiSettings.forumDigest.autoDelaySeconds} 秒`"
                    :min="1"
                    :max="20"
                  />
                  <FormField label="缓存天数">
                    <BaseInput v-model="lexiSettings.forumDigest.cacheDays" type="number" :min="1" :max="60" />
                  </FormField>
                </div>
              </div>
            </div>
          </section>

          <section v-show="activeTab === 'settings' && activeSettingsSection === 'sync'" class="settings-card">
            <header class="settings-card__head">
              <div>
                <h2>同步到 Google 账号</h2>
                <p>把设置镜像到浏览器账号同步区，换设备登录同一账号后自动带上。</p>
              </div>
              <SettingToggle v-model="lexiSettings.sync.enabled" label="启用同步" />
            </header>

            <div class="settings-stack">
              <SettingToggle
                v-model="lexiSettings.sync.includeApiKeys"
                label="同步中包含 API Key"
                hint="开启后 Key 会随浏览器同步上传到 Google 服务器；建议在 Chrome 设置中启用同步密码短语。关闭时其他设备需要重新填写 Key。"
                :disabled="!lexiSettings.sync.enabled"
              />

              <div class="settings-callout">
                <span class="i-lucide-info" aria-hidden="true" />
                <p>
                  同步区配额约 100KB，只放设置：站点规则、替换强度、速读、界面、Provider 与提示词。
                  词库、AI 日志、访问记录和速读缓存体积远超配额，仍然只保存在本机；已确认的 HTTP Endpoint 属于本机授权，也不参与同步。
                </p>
              </div>

              <div class="settings-fields">
                <div class="settings-field">
                  <span class="settings-field__label">同步区占用</span>
                  <p class="settings-field__hint">
                    {{ syncQuota ? `${formatBytes(syncQuota.used)} / ${formatBytes(syncQuota.total)}` : '读取中…' }}
                  </p>
                </div>
                <div class="settings-field">
                  <span class="settings-field__label">最近上传</span>
                  <p class="settings-field__hint">
                    {{ lexiSettings.sync.lastSyncedAt ? formatDateTime(lexiSettings.sync.lastSyncedAt) : '尚未上传' }}
                  </p>
                </div>
                <div class="settings-field">
                  <span class="settings-field__label">最近拉取</span>
                  <p class="settings-field__hint">
                    {{ lexiSettings.sync.lastPulledAt ? formatDateTime(lexiSettings.sync.lastPulledAt) : '尚未拉取' }}
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <BaseButton :loading="syncBusy" loading-label="正在同步" :disabled="!lexiSettings.sync.enabled" @click="syncNow">
                  <template #icon>
                    <span class="i-lucide-cloud-upload" aria-hidden="true" />
                  </template>
                  立即上传
                </BaseButton>
                <BaseButton :loading="syncBusy" loading-label="正在拉取" :disabled="!lexiSettings.sync.enabled" @click="pullSyncNow">
                  <template #icon>
                    <span class="i-lucide-cloud-download" aria-hidden="true" />
                  </template>
                  从账号拉取
                </BaseButton>
                <span v-if="syncMessage" class="text-12px text-neutral-600">{{ syncMessage }}</span>
              </div>

              <p v-if="lexiSettings.sync.lastError" class="settings-note text-red-600">
                {{ lexiSettings.sync.lastError }}
              </p>
            </div>
          </section>

          <section v-show="activeTab === 'customization'" class="settings-card">
            <header class="settings-card__head">
              <div>
                <h2>界面与快捷键</h2>
                <p>调整页面上的提示、快捷键与自定义样式。</p>
              </div>
            </header>

            <div class="settings-stack">
              <SettingToggle
                v-model="lexiSettings.ui.showFloatingStatus"
                label="右下角状态浮标"
                hint="关闭后不显示“Lexi 已启用”。"
              />
              <FormField label="快捷对话键" hint="默认 Ctrl/Command+Shift+M；无选区时会基于整页内容提问。">
                <BaseInput v-model="lexiSettings.ui.dialogShortcut" placeholder="mod+shift+m" />
              </FormField>
              <FormField label="媒体点击修饰键" hint="按住组合键点击媒体打开操作栏；视频倍速在 macOS 使用 Command+双指点按。">
                <BaseInput v-model="lexiSettings.ui.mediaModifierShortcut" placeholder="meta+shift" />
              </FormField>
              <FormField label="每日推荐数量" hint="侧边栏每天推荐的新词数量。">
                <BaseInput v-model="lexiSettings.study.dailyGoal" type="number" :min="1" :max="30" />
              </FormField>

              <div class="settings-field">
                <span class="settings-field__label">翻译卡可视化预设</span>
                <SegmentedControl
                  :model-value="translationCardStyle"
                  :options="translationCardStyleOptions"
                  label="翻译卡样式"
                  @update:model-value="applyTranslationCardStyle"
                />
                <style v-if="lexiSettings.ui.customCss">
                  {{ lexiSettings.ui.customCss }}
                </style>
                <div
                  class="lexi-selection-translation translation-card-preview mt-3 rounded-2 border p-3 text-12px"
                  :class="`translation-card-preview--${translationCardStyle}`"
                >
                  <span class="lexi-token rounded-full px-2 py-1 font-600">Lexi 翻译</span>
                  <p class="mt-2">
                    预设和下方 CSS 会实时作用于此卡片；例如可用 <code>.lexi-token { font-size: 20px; }</code> 验证文字变化。
                  </p>
                  <div class="mt-2 border-t pt-2 text-11px">
                    已完成 · 约 42 tokens · 180ms · 96 字/秒
                  </div>
                </div>
              </div>

              <CollapsibleSection title="自定义样式 CSS" hint="仅作用于 Lexi 注入的组件">
                <BaseTextarea
                  v-model="lexiSettings.ui.customCss"
                  class="min-h-36 font-mono text-12px"
                  placeholder=".lexi-selection-translation { background: #fff; }&#10;.lexi-token { color: #2563eb; }"
                />
              </CollapsibleSection>
            </div>
          </section>
        </section>
        <div v-if="activeTab === 'ai'" class="settings-section-tabs mb-5" role="tablist" aria-label="供应商与功能分区">
          <button
            v-for="section in aiSections"
            :key="section.id"
            type="button"
            role="tab"
            :aria-selected="activeAiSection === section.id"
            :class="{ 'is-active': activeAiSection === section.id }"
            @click="activeAiSection = section.id"
          >
            {{ section.label }}
          </button>
        </div>
        <section v-if="activeTab === 'ai' && activeAiSection === 'special'" id="options-panel-special" role="region" aria-label="特殊场景" class="options-panel rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-16px font-600">
                特殊场景处理
              </h2>
              <p class="mt-1 max-w-2xl text-12px leading-5 text-neutral-500">
                信息流站点可开启动态扫描并降低替换密度；学习、考试类站点默认关闭，避免影响答题或课堂页面。
              </p>
            </div>
            <BaseButton variant="primary" @click="addSpecialProfile">
              <template #icon>
                <span class="i-lucide-plus" aria-hidden="true" />
              </template>
              添加场景
            </BaseButton>
          </div>

          <div class="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-4">
            <article v-for="profile in lexiSettings.siteRules.specialProfiles" :key="profile.id" class="min-w-0 rounded-2 border border-neutral-200 p-4">
              <div class="flex items-start justify-between gap-3">
                <FormField class="min-w-0 flex-1" label="名称" compact>
                  <BaseInput v-model="profile.label" size="sm" class="font-600" />
                </FormField>
                <BaseButton v-if="profile.kind === 'custom'" class="mt-5" variant="danger" size="sm" @click="removeSpecialProfile(profile.id)">
                  删除
                </BaseButton>
              </div>

              <FormField class="mt-4" label="域名" hint="每行一个域名。" compact>
                <BaseTextarea
                  :model-value="formatSpecialDomains(profile)"
                  class="min-h-20"
                  placeholder="x.com&#10;twitter.com"
                  @update:model-value="updateSpecialDomains(profile, $event)"
                />
              </FormField>

              <div class="mt-4 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
                <BaseCheckbox v-model="profile.enabled" class="scene-option" label="启用此场景" />
                <BaseCheckbox v-model="profile.examSafe" class="scene-option" label="考试安全" />
                <BaseCheckbox v-model="profile.replacement" class="scene-option" label="网页替换" />
                <BaseCheckbox v-model="profile.selection" class="scene-option" label="划词翻译" />
                <BaseCheckbox v-model="profile.dynamicScan" class="scene-option" label="动态扫描" />
                <BaseCheckbox v-model="profile.conservative" class="scene-option" label="保守替换" />
              </div>

              <div class="mt-4 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
                <FormField label="单页上限" compact>
                  <BaseInput v-model="profile.maxPerPage" type="number" size="sm" :min="0" :max="20" />
                </FormField>
                <RangeControl
                  :model-value="profile.density ?? 0"
                  label="替换密度"
                  :display-value="`${Math.round((profile.density ?? 0) * 100)}%`"
                  :min="0"
                  :max="0.2"
                  :step="0.01"
                  @update:model-value="profile.density = $event"
                />
              </div>
            </article>
          </div>
        </section>
        <section v-if="activeTab === 'vocabulary'" id="options-panel-vocabulary" role="tabpanel" aria-labelledby="options-tab-vocabulary" class="options-panel rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-16px font-600">
                词库记录
              </h2>
              <p class="mt-1 text-12px text-neutral-500">
                AI 补充、网页替换和划词翻译都会进入本地记录；产品名会标记为 product，只用于 hover 说明，不改写页面文字。
              </p>
            </div>
            <span class="text-12px text-neutral-500">{{ filteredVocabularyRecords.length }} / {{ vocabularyRecords.length }} 条 · 产品 {{ productVocabularyCount }} · {{ formatBytes(storageStats.vocabulary) }}</span>
          </div>
          <div class="settings-section-tabs mt-4" role="tablist" aria-label="词库记录分区">
            <button
              type="button"
              role="tab"
              :aria-selected="activeVocabularyTab === 'overview'"
              :class="{ 'is-active': activeVocabularyTab === 'overview' }"
              @click="activeVocabularyTab = 'overview'"
            >
              概览
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeVocabularyTab === 'settings'"
              :class="{ 'is-active': activeVocabularyTab === 'settings' }"
              @click="activeVocabularyTab = 'settings'"
            >
              设置
            </button>
          </div>
          <div v-show="activeVocabularyTab === 'overview'" class="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <BaseInput
              v-model="vocabularySearchQuery"
              type="search"
              placeholder="搜索原文、翻译、解释、上下文、标签、页面标题或 URL"
            />
            <div class="flex gap-2">
              <BaseButton variant="primary" :loading="vocabularyAiSearchLoading" loading-label="AI 搜索中" :disabled="!vocabularySearchQuery" @click="searchVocabularyWithAi">
                <template #icon>
                  <span class="i-lucide-sparkles" aria-hidden="true" />
                </template>
                AI 搜索
              </BaseButton>
              <BaseButton :disabled="!vocabularySearchQuery" @click="vocabularySearchQuery = ''; vocabularyAiSearchResult = ''">
                <template #icon>
                  <span class="i-lucide-x" aria-hidden="true" />
                </template>
                清空
              </BaseButton>
            </div>
          </div>
          <div v-if="activeVocabularyTab === 'overview' && vocabularyAiSearchResult" class="mt-3 rounded-2 border border-blue-100 bg-blue-50 p-3 text-12px leading-5 text-blue-950">
            <div class="font-600">
              AI 词库搜索
            </div>
            <p class="mt-1 whitespace-pre-wrap">
              {{ vocabularyAiSearchResult }}
            </p>
          </div>

          <div v-show="activeVocabularyTab === 'settings'" class="mt-4 rounded-2 border border-neutral-200 p-4">
            <div class="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <FormField label="词库上限（条）" :hint="`达到上限后按更新时间保留最新的记录，可设置 ${minVocabularyLimit} - ${maxVocabularyLimit}。`">
                <BaseInput
                  v-model="lexiSettings.history.maxRecords"
                  type="number"
                  :min="minVocabularyLimit"
                  :max="maxVocabularyLimit"
                  :step="100"
                />
              </FormField>
              <div>
                <span class="text-12px font-500 text-neutral-600">备份与迁移</span>
                <p class="mt-1 text-12px leading-5 text-neutral-500">
                  词库体积较大，不随 Google 同步；换设备时用 JSON 导入导出，同名词条会按最新记录覆盖。
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <BaseButton size="sm" @click="exportVocabulary">
                    <template #icon>
                      <span class="i-lucide-download" aria-hidden="true" />
                    </template>
                    导出 JSON
                  </BaseButton>
                  <BaseButton size="sm" @click="vocabularyImportInput?.click()">
                    <template #icon>
                      <span class="i-lucide-upload" aria-hidden="true" />
                    </template>
                    导入 JSON
                  </BaseButton>
                  <input
                    ref="vocabularyImportInput"
                    type="file"
                    accept="application/json,.json"
                    class="hidden"
                    @change="importVocabulary"
                  >
                </div>
                <p v-if="vocabularyTransferMessage" class="mt-2 text-12px text-neutral-600">
                  {{ vocabularyTransferMessage }}
                </p>
              </div>
            </div>
          </div>
          <div v-show="activeVocabularyTab === 'overview'" class="mt-4 rounded-2 border border-neutral-200 bg-neutral-50 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h3 class="text-14px font-600">
                今日学习概览
              </h3>
              <span class="text-12px text-neutral-500">新增 {{ todayStudySummary.total }} · 技术词 {{ todayStudySummary.technical }}</span>
            </div>
            <div class="mt-3 grid gap-2 text-12px lg:grid-cols-3">
              <div class="rounded-2 bg-white px-3 py-2">
                划词 {{ todayStudySummary.manual }}
              </div>
              <div class="rounded-2 bg-white px-3 py-2">
                替换 {{ todayStudySummary.auto }}
              </div>
              <div class="rounded-2 bg-white px-3 py-2">
                词库 {{ formatBytes(storageStats.vocabulary) }}
              </div>
            </div>
            <p class="mt-3 text-12px leading-5 text-neutral-600">
              {{ todayStudySummary.suggestion }}
            </p>
            <p v-if="todayStudySummary.terms.length" class="mt-2 text-12px leading-5 text-neutral-500">
              {{ todayStudySummary.terms.join('；') }}
            </p>
          </div>
          <div class="mt-4 max-h-[40rem] overflow-y-auto">
            <table class="w-full border-collapse text-left text-12px">
              <thead class="sticky top-0 bg-white text-neutral-500">
                <tr class="border-b border-neutral-200">
                  <th class="py-2 pr-3 font-500">
                    原文
                  </th>
                  <th class="py-2 pr-3 font-500">
                    替换/翻译
                  </th>
                  <th class="py-2 pr-3 font-500">
                    标签
                  </th>
                  <th class="py-2 pr-3 font-500">
                    来源
                  </th>
                  <th class="py-2 pr-3 font-500">
                    次数
                  </th>
                  <th class="py-2 pr-3 font-500">
                    页面
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in recentVocabularyRecords" :key="record.id" class="border-b border-neutral-100 align-top">
                  <td class="max-w-56 break-words py-2 pr-3 font-600">
                    {{ record.original }}
                  </td>
                  <td class="max-w-64 break-words py-2 pr-3">
                    {{ record.replacement }}
                  </td>
                  <td class="max-w-48 break-words py-2 pr-3 text-neutral-500">
                    <span v-if="record.tags.length" class="inline-flex flex-wrap gap-1">
                      <span v-for="tag in record.tags" :key="tag" class="rounded-full bg-neutral-100 px-2 py-0.5" :class="tag === 'product' ? 'bg-purple-50 text-purple-700' : ''">
                        {{ tag }}
                      </span>
                    </span>
                    <span v-else>-</span>
                  </td>
                  <td class="py-2 pr-3 text-neutral-500">
                    {{ record.source }}
                  </td>
                  <td class="py-2 pr-3 text-neutral-500">
                    {{ record.seenCount }} / {{ record.selectedCount }}
                  </td>
                  <td class="max-w-72 break-words py-2 pr-3 text-neutral-500">
                    <a v-if="record.pageUrl" :href="record.pageUrl" target="_blank" rel="noreferrer" class="text-neutral-600 underline underline-offset-2 hover:text-neutral-950">
                      {{ record.pageTitle || record.pageUrl }}
                    </a>
                    <span v-else>-</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!recentVocabularyRecords.length" class="rounded-2 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
              {{ vocabularySearchQuery ? '没有匹配的词库记录。' : '暂无词库记录。' }}
            </p>
          </div>
        </section>
        <section v-if="activeTab === 'ai' && activeAiSection === 'translation'" id="options-panel-translation" role="region" aria-label="内置翻译服务" class="options-panel rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-16px font-600">
                内置翻译服务
              </h2>
              <p class="mt-1 max-w-3xl text-12px leading-5 text-neutral-500">
                Microsoft Translator 和 Google Translate Web 只服务于划词与页面翻译；它们不是通用 Provider，不能绑定至其他功能。通用 AI Provider 可在下方“功能”中按需选择。
              </p>
            </div>
            <BaseButton variant="primary" @click="openTranslationEngineEditor()">
              <template #icon>
                <span class="i-lucide-plus" aria-hidden="true" />
              </template>
              添加引擎
            </BaseButton>
          </div>

          <section class="mt-5 rounded-2 border border-neutral-200 bg-neutral-50 p-4">
            <h3 class="text-14px font-600">
              请求限额
            </h3>
            <p class="mt-1 text-12px leading-5 text-neutral-500">
              额度在后台入队前原子预留。0 表示不限制；限制按本机时区计算，避免恢复标签页时意外消耗渠道配额。
            </p>
            <div class="mt-4 settings-fields">
              <FormField label="每日总上限" compact>
                <BaseInput v-model.number="lexiSettings.translation.rateLimit.dailyLimit" type="number" :min="0" />
              </FormField>
              <FormField label="滚动窗口（小时）" compact>
                <BaseInput v-model.number="lexiSettings.translation.rateLimit.rollingWindowHours" type="number" :min="0" :max="168" />
              </FormField>
              <FormField label="窗口内上限" compact>
                <BaseInput v-model.number="lexiSettings.translation.rateLimit.rollingWindowLimit" type="number" :min="0" />
              </FormField>
            </div>
            <div class="mt-4 flex flex-wrap items-end gap-4">
              <BaseCheckbox v-model="lexiSettings.translation.rateLimit.scheduleEnabled" label="只在指定时段翻译" />
              <template v-if="lexiSettings.translation.rateLimit.scheduleEnabled">
                <FormField label="开始时间" compact>
                  <BaseInput v-model.number="lexiSettings.translation.rateLimit.allowedStartHour" type="number" :min="0" :max="23" />
                </FormField>
                <FormField label="结束时间" compact>
                  <BaseInput v-model.number="lexiSettings.translation.rateLimit.allowedEndHour" type="number" :min="0" :max="23" />
                </FormField>
              </template>
            </div>
          </section>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full border-collapse text-left text-12px">
              <thead class="bg-white text-neutral-500">
                <tr class="border-b border-neutral-200">
                  <th scope="col" class="py-2 pr-3 font-500">
                    名称
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    类型
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    凭据状态
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    额度 / 健康
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    优先级
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    启用
                  </th>
                  <th scope="col" class="py-2 pr-0 text-right font-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="engine in lexiSettings.translation.engines" :key="engine.id" class="border-b border-neutral-100 align-top">
                  <td class="max-w-56 break-words py-3 pr-3 font-600">
                    {{ engine.label }}
                    <span v-if="translationEngineRowTests[engine.id]?.message" class="mt-1 block text-11px font-400" :class="translationEngineRowTests[engine.id]?.ok ? 'text-emerald-600' : 'text-red-600'">{{ translationEngineRowTests[engine.id]?.message }}</span>
                  </td>
                  <td class="py-3 pr-3 text-neutral-500">
                    {{ engine.kind === 'microsoft' ? 'Microsoft Translator F0' : 'Google Translate Web（非官方）' }}
                  </td>
                  <td class="py-3 pr-3 text-neutral-500">
                    {{ engine.kind === 'microsoft' ? (engine.apiKey && engine.region ? 'Key + Region 已配置' : '缺少 Key 或 Region') : (engine.acceptedRisk ? '已确认风险' : '未确认风险') }}
                  </td>
                  <td class="py-3 pr-3 text-neutral-500">
                    {{ engine.dailyLimit ? `每日 ${engine.dailyLimit} 次` : '未设渠道上限' }}
                  </td>
                  <td class="py-3 pr-3 text-neutral-500">
                    {{ engine.priority }}
                  </td>
                  <td class="py-3 pr-3">
                    <BaseCheckbox :model-value="engine.enabled" :aria-label="`启用 ${engine.label}`" compact @update:model-value="toggleTranslationEngineEnabled(engine.id, $event)" />
                  </td>
                  <td class="py-3 pr-0">
                    <div class="flex justify-end gap-2">
                      <BaseButton size="sm" :loading="translationEngineRowTests[engine.id]?.loading" loading-label="正在测试" @click="testTranslationEngine(engine)">
                        测试
                      </BaseButton>
                      <BaseButton size="sm" @click="openTranslationEngineEditor(engine)">
                        编辑
                      </BaseButton>
                      <BaseButton variant="danger" size="sm" @click="removeTranslationEngine(engine.id)">
                        删除
                      </BaseButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!lexiSettings.translation.engines.length" class="rounded-2 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
              暂无翻译引擎。添加 Microsoft Translator 或 Google Translate Web 后启用即可优先使用。
            </p>
          </div>
        </section>
        <section v-if="activeTab === 'ai' && activeAiSection === 'providers'" id="options-panel-ai" role="tabpanel" aria-labelledby="options-tab-ai" class="options-panel rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-16px font-600">
                通用 Provider
              </h2>
              <p class="mt-1 text-12px leading-5 text-neutral-500">
                添加连接后，在下方“功能”中为每项能力勾选可用 Provider；同一功能的多个 Provider 按优先级和延迟竞速，先返回的结果被采用。
              </p>
            </div>
            <BaseButton variant="primary" @click="openProviderEditor()">
              <template #icon>
                <span class="i-lucide-plus" aria-hidden="true" />
              </template>
              添加 Provider
            </BaseButton>
          </div>

          <div class="mt-4 grid gap-3 lg:grid-cols-[minmax(0,22rem)_auto] lg:items-center">
            <BaseInput
              v-model="providerSearchQuery"
              type="search"
              placeholder="搜索名称、协议、Endpoint 或模型"
            />
            <span class="text-12px text-neutral-500">{{ providerRangeLabel }}</span>
          </div>

          <div class="mt-4 overflow-x-auto">
            <table class="w-full border-collapse text-left text-12px">
              <thead class="bg-white text-neutral-500">
                <tr class="border-b border-neutral-200">
                  <th scope="col" class="py-2 pr-3 font-500">
                    名称
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    协议
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    Endpoint
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    模型
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    优先级 / 延迟
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    绑定场景
                  </th>
                  <th scope="col" class="py-2 pr-3 font-500">
                    启用
                  </th>
                  <th scope="col" class="py-2 pr-3 text-right font-500">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="provider in pagedProviders" :key="provider.id" class="border-b border-neutral-100 align-top">
                  <td class="max-w-48 break-words py-2 pr-3 font-600">
                    {{ provider.label || provider.id }}
                    <span v-if="providerRowTests[provider.id]?.message" class="mt-1 block text-11px font-400" :class="providerRowTests[provider.id]?.ok ? 'text-emerald-600' : 'text-red-600'">
                      {{ providerRowTests[provider.id]?.message }}
                    </span>
                  </td>
                  <td class="py-2 pr-3 text-neutral-500">
                    {{ getProtocolLabel(provider.protocol) }}
                  </td>
                  <td class="max-w-64 break-all py-2 pr-3 text-neutral-500">
                    {{ provider.endpoint || '未填写' }}
                  </td>
                  <td class="max-w-48 break-all py-2 pr-3 text-neutral-500">
                    {{ provider.model || '未填写' }}
                  </td>
                  <td class="py-2 pr-3 text-neutral-500">
                    {{ provider.priority }} · {{ provider.delayMs }}ms
                  </td>
                  <td class="max-w-40 break-words py-2 pr-3 text-neutral-500">
                    {{ describeProviderScenes(provider.id) }}
                  </td>
                  <td class="py-2 pr-3">
                    <BaseCheckbox
                      :model-value="provider.enabled"
                      :aria-label="`启用 ${provider.label || provider.id}`"
                      compact
                      @update:model-value="toggleProviderEnabled(provider.id, $event)"
                    />
                  </td>
                  <td class="py-2 pr-0">
                    <div class="flex justify-end gap-2">
                      <BaseButton size="sm" :loading="providerRowTests[provider.id]?.loading" loading-label="正在测试" @click="testProviderRow(provider)">
                        测试
                      </BaseButton>
                      <BaseButton size="sm" @click="openProviderEditor(provider)">
                        编辑
                      </BaseButton>
                      <BaseButton variant="danger" size="sm" @click="removeProvider(provider.id)">
                        删除
                      </BaseButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!pagedProviders.length" class="rounded-2 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
              {{ providerSearchQuery ? '没有匹配的 Provider。' : '还没有 Provider，点击右上角添加一个后即可在场景中绑定。' }}
            </p>
          </div>

          <div v-if="providerPageCount > 1" class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span class="text-12px text-neutral-500">第 {{ providerPage }} / {{ providerPageCount }} 页</span>
            <div class="flex gap-2">
              <BaseButton size="sm" :disabled="providerPage <= 1" @click="providerPage -= 1">
                上一页
              </BaseButton>
              <BaseButton size="sm" :disabled="providerPage >= providerPageCount" @click="providerPage += 1">
                下一页
              </BaseButton>
            </div>
          </div>

          <div v-if="lexiSettings.ai.approvedHttpEndpoints.length" class="mt-4 rounded-2 border border-amber-200 bg-amber-50 p-3">
            <div class="text-12px font-600 text-amber-900">
              已确认的 HTTP Endpoint
            </div>
            <p class="mt-1 text-11px leading-4 text-amber-800">
              HTTP 不加密。许可只对完整地址生效，地址变化后会重新确认；该许可只保存在本机，不会随 Google 同步。
            </p>
            <div class="mt-2 space-y-2">
              <div v-for="endpoint in lexiSettings.ai.approvedHttpEndpoints" :key="endpoint" class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2">
                <code class="min-w-0 break-all text-11px text-neutral-700">{{ endpoint }}</code>
                <BaseButton variant="danger" size="sm" :aria-label="`撤销 HTTP Endpoint ${endpoint}`" @click="revokeApprovedHttpEndpoint(endpoint)">
                  撤销
                </BaseButton>
              </div>
            </div>
          </div>

          <h3 class="mt-6 text-14px font-600">
            功能
          </h3>
          <p class="mt-1 text-12px leading-5 text-neutral-500">
            每个功能独立选择通用 Provider 和提示词。内置翻译服务固定用于划词与页面翻译；“AI 词库搜索”仅在用户主动搜索时发送筛选后的本地候选词条。
          </p>

          <div class="mt-4 grid gap-4 lg:grid-cols-3">
            <div v-for="scene in aiScenes" :key="scene" class="max-h-[42rem] overflow-y-auto rounded-2 border border-neutral-200 p-4">
              <SettingToggle v-model="lexiSettings.ai[scene].enabled" :label="featureLabels[scene]" />
              <div class="mt-4 rounded-2 bg-neutral-50 p-3">
                <div class="text-12px font-500 text-neutral-600">
                  绑定 Provider
                </div>
                <p class="mt-1 text-11px leading-4 text-neutral-500">
                  不勾选时使用全部启用 Provider；勾选后只在所选 Provider 间竞速。
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <BaseCheckbox
                    v-for="provider in lexiSettings.ai.providers"
                    :key="`${scene}-${provider.id}`"
                    class="provider-chip"
                    :model-value="providerSelected(scene, provider.id)"
                    :label="sceneProviderNames.get(provider.id) ?? provider.id"
                    compact
                    @update:model-value="toggleSceneProvider(scene, provider.id, $event)"
                  />
                  <p v-if="!lexiSettings.ai.providers.length" class="text-11px text-neutral-500">
                    还没有 Provider。
                  </p>
                </div>
              </div>
              <div class="mt-4 block">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-12px font-500 text-neutral-600">提示词</span>
                  <BaseButton variant="ghost" size="sm" @click="resetScenePrompt(scene)">
                    <template #icon>
                      <span class="i-lucide-rotate-ccw" aria-hidden="true" />
                    </template>
                    重置提示词
                  </BaseButton>
                </div>
                <BaseTextarea v-model="lexiSettings.ai[scene].prompt" class="mt-2 min-h-28" />
              </div>
              <div class="mt-4 flex items-center gap-3">
                <BaseButton :loading="testingScenes[scene]" loading-label="正在测试连接" @click="testScene(scene)">
                  测试连接
                </BaseButton>
                <span v-if="sceneTestResults[scene]" class="truncate text-12px" :class="sceneTestDetails[scene]?.ok ? 'text-emerald-600' : 'text-red-600'">
                  {{ sceneTestResults[scene] }}
                </span>
              </div>
              <div v-if="sceneTestDetails[scene]" class="mt-3 space-y-2">
                <div class="text-12px font-600 text-neutral-700">
                  请求内容
                </div>
                <pre class="max-h-44 overflow-auto rounded-2 bg-neutral-950 p-3 text-11px leading-4 text-neutral-100">{{ formatTestRequest(sceneTestDetails[scene]!) }}</pre>
                <div class="text-12px font-600 text-neutral-700">
                  返回内容
                </div>
                <pre class="max-h-36 overflow-auto rounded-2 bg-neutral-50 p-3 text-11px leading-4 text-neutral-700">{{ sceneTestDetails[scene]!.response || '空响应' }}</pre>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'diagnostics'" id="options-panel-diagnostics" role="tabpanel" aria-labelledby="options-tab-diagnostics" class="options-panel grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div class="grid gap-3 lg:col-span-2 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-2 border border-neutral-200 bg-white p-4 shadow-sm">
              <div class="text-12px text-neutral-500">
                AI 成功率
              </div>
              <div class="mt-2 text-24px font-700 tabular-nums">
                {{ aiSuccessRate }}<span class="text-13px font-500 text-neutral-500">%</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${aiSuccessRate}%` }" />
              </div>
            </div>
            <div class="rounded-2 border border-neutral-200 bg-white p-4 shadow-sm">
              <div class="text-12px text-neutral-500">
                平均响应
              </div>
              <div class="mt-2 text-24px font-700 tabular-nums">
                {{ averageAiDuration }}<span class="text-13px font-500 text-neutral-500"> ms</span>
              </div>
              <div class="mt-2 text-11px text-neutral-500">
                基于 {{ aiCallLogs.length }} 次本地调用
              </div>
            </div>
            <div class="rounded-2 border border-neutral-200 bg-white p-4 shadow-sm">
              <div class="text-12px text-neutral-500">
                可用 Provider
              </div>
              <div class="mt-2 text-24px font-700 tabular-nums">
                {{ enabledProviderCount }}<span class="text-13px font-500 text-neutral-500"> / {{ lexiSettings.ai.providers.length }}</span>
              </div>
              <div class="mt-2 text-11px text-neutral-500">
                内置翻译服务单独统计
              </div>
            </div>
            <div class="rounded-2 border border-neutral-200 bg-white p-4 shadow-sm">
              <div class="text-12px text-neutral-500">
                词库容量
              </div>
              <div class="mt-2 text-24px font-700 tabular-nums">
                {{ vocabularyCapacity }}<span class="text-13px font-500 text-neutral-500">%</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div class="h-full rounded-full bg-blue-500" :style="{ width: `${vocabularyCapacity}%` }" />
              </div>
            </div>
          </div>
          <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
            <div class="flex shrink-0 items-center justify-between gap-3">
              <h2 class="text-16px font-600">
                最近 AI 调用
              </h2>
              <span class="text-12px text-neutral-500">{{ aiCallLogs.length }} 条</span>
            </div>
            <div class="mt-4 shrink-0 border-b border-neutral-100 pb-3">
              <TrendBars :items="aiTrend" :height="160" />
            </div>
            <div class="mt-3 grid shrink-0 gap-2 border-b border-neutral-100 pb-3 text-12px lg:grid-cols-3">
              <div class="rounded-2 bg-neutral-50 px-3 py-2">
                <div class="text-neutral-500">
                  Tokens
                </div>
                <div class="mt-1 text-16px font-700">
                  {{ totalAiTokens }}
                </div>
              </div>
              <div v-for="item in aiSceneTokenStats" :key="item.scene" class="rounded-2 bg-neutral-50 px-3 py-2">
                <div class="text-neutral-500">
                  {{ featureLabels[item.scene] }}
                </div>
                <div class="mt-1 font-700">
                  {{ item.tokens }} · {{ item.calls }} 次
                </div>
              </div>
            </div>
            <div class="mt-3 shrink-0 border-b border-neutral-100 pb-3">
              <TrendBars :items="aiTokenTrend" color="bg-blue-600" :height="96" />
            </div>
            <div class="mt-3 grid shrink-0 gap-2 border-b border-neutral-100 pb-3 text-12px lg:grid-cols-2">
              <div class="rounded-2 bg-neutral-50 px-3 py-2">
                <div class="text-neutral-500">
                  本地存储估算
                </div>
                <div class="mt-1 text-16px font-700">
                  {{ formatBytes(storageStats.total) }}
                </div>
              </div>
              <div class="rounded-2 bg-neutral-50 px-3 py-2">
                <div class="text-neutral-500">
                  词库占用
                </div>
                <div class="mt-1 text-16px font-700">
                  {{ formatBytes(storageStats.vocabulary) }}
                </div>
              </div>
              <div v-for="item in storageStats.others" :key="item.label" class="rounded-2 bg-neutral-50 px-3 py-2">
                <div class="text-neutral-500">
                  {{ item.label }}
                </div>
                <div class="mt-1 font-700">
                  {{ formatBytes(item.bytes) }}
                </div>
              </div>
            </div>
            <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <div v-for="log in aiCallLogs" :key="log.id" class="rounded-2 border border-neutral-200 px-3 py-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-13px font-600">{{ featureLabels[log.scene] }}</span>
                  <span class="text-12px" :class="log.ok ? 'text-emerald-600' : 'text-red-600'">{{ log.ok ? '成功' : '失败' }}</span>
                </div>
                <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                  {{ formatTime(log.createdAt) }} · {{ log.model || '未设置模型' }} · {{ log.streamed ? '流式' : '普通' }} · {{ log.authSent ? `Key ${log.keyHint || '已发送'}` : '未发送 Key' }} · {{ log.durationMs }}ms · {{ log.totalTokens ?? 0 }} tokens{{ log.tokenEstimate ? ' 估算' : '' }}
                </div>
                <div v-if="log.error" class="mt-1 break-words text-12px leading-5 text-red-600">
                  {{ log.error }}
                </div>
              </div>
              <p v-if="!aiCallLogs.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
                暂无 AI 调用记录。
              </p>
            </div>
          </div>

          <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
            <div class="flex shrink-0 items-center justify-between gap-3">
              <h2 class="text-16px font-600">
                最近访问网页
              </h2>
              <span class="text-12px text-neutral-500">{{ pageVisitLogs.length }} 条</span>
            </div>
            <div class="mt-4 shrink-0 border-b border-neutral-100 pb-3">
              <TrendBars :items="visitTrend" :height="160" />
            </div>
            <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              <div v-for="visit in pageVisitLogs" :key="visit.id" class="rounded-2 border border-neutral-200 px-3 py-2">
                <div class="break-words text-13px font-600 leading-5">
                  {{ visit.title || visit.host }}
                </div>
                <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                  {{ formatTime(visit.createdAt) }} · {{ visit.host }} · 替换 {{ visit.replacements }}
                </div>
              </div>
              <p v-if="!pageVisitLogs.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
                暂无网页访问记录。
              </p>
            </div>
          </div>

          <div class="grid gap-5 lg:col-span-2 lg:grid-cols-2 xl:grid-cols-3">
            <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
              <div class="flex shrink-0 items-start justify-between gap-3">
                <div>
                  <h2 class="text-16px font-600">
                    多平台速读缓存
                  </h2>
                  <p class="mt-1 text-12px text-neutral-500">
                    内容级缓存 {{ contentDigestStats.total }} 个，占用 {{ formatBytes(contentDigestStats.bytes) }}，软上限 5 MB。
                  </p>
                </div>
                <BaseButton size="sm" @click="clearContentDigestCache">
                  清空缓存
                </BaseButton>
              </div>
              <div class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div v-for="entry in contentDigestEntries" :key="entry.key" class="rounded-2 border border-neutral-200 px-3 py-3">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="break-words text-14px font-700">
                        {{ entry.title || entry.key }}
                      </div>
                      <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                        {{ entry.platform }} · {{ entry.contentType }} · {{ formatDateTime(entry.updatedAt) }}
                      </div>
                    </div>
                    <BaseButton variant="danger" size="sm" @click="removeContentDigestCacheEntry(entry.key)">
                      删除
                    </BaseButton>
                  </div>
                  <p class="mt-2 break-words text-12px leading-5 text-neutral-700">
                    {{ entry.digest.oneLine }}
                  </p>
                  <p class="mt-1 break-words text-11px leading-5 text-neutral-500">
                    {{ entry.digest.coverage }}
                  </p>
                  <a :href="entry.canonicalUrl" target="_blank" rel="noreferrer" class="mt-2 inline-block break-all text-12px text-neutral-500 underline underline-offset-2 hover:text-neutral-950">
                    {{ entry.canonicalUrl }}
                  </a>
                </div>
                <p v-if="!contentDigestEntries.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
                  暂无多平台速读缓存。
                </p>
              </div>
            </div>

            <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
              <div class="flex shrink-0 items-start justify-between gap-3">
                <div>
                  <h2 class="text-16px font-600">
                    GitHub 速读缓存
                  </h2>
                  <p class="mt-1 text-12px text-neutral-500">
                    仓库级缓存 {{ githubDigestStats.total }} 个，Quick {{ githubDigestStats.quick }} 个，Detail {{ githubDigestStats.detail }} 个，占用 {{ formatBytes(githubDigestStats.bytes) }}。
                  </p>
                </div>
                <BaseButton size="sm" @click="clearGitHubDigestCache">
                  清空缓存
                </BaseButton>
              </div>
              <div class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div v-for="entry in githubDigestEntries" :key="entry.key" class="rounded-2 border border-neutral-200 px-3 py-3">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="break-words text-14px font-700">
                        {{ entry.repo || entry.key }}
                      </div>
                      <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                        {{ entry.languages?.join(' · ') || '暂无语言信息' }} · {{ formatDateTime(entry.updatedAt) }} · {{ entry.sourceHash }}
                      </div>
                    </div>
                    <BaseButton variant="danger" size="sm" @click="removeGitHubDigestCacheEntry(entry.key)">
                      删除
                    </BaseButton>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2 text-11px">
                    <span class="rounded-full px-2 py-1" :class="entry.quickDigest ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'">Quick {{ entry.quickDigest ? '已缓存' : '无' }}</span>
                    <span class="rounded-full px-2 py-1" :class="entry.digest ? 'bg-blue-50 text-blue-700' : 'bg-neutral-100 text-neutral-500'">Detail {{ entry.digest ? '已缓存' : '无' }}</span>
                    <span v-for="topic in entry.topics?.slice(0, 5)" :key="`${entry.key}-${topic}`" class="rounded-full bg-neutral-100 px-2 py-1 text-neutral-600">{{ topic }}</span>
                  </div>
                  <p v-if="entry.quickDigest?.oneLine" class="mt-2 break-words text-12px leading-5 text-neutral-700">
                    {{ entry.quickDigest.oneLine }}
                  </p>
                  <p v-if="entry.digest?.oneLine" class="mt-1 break-words text-12px leading-5 text-neutral-500">
                    详细：{{ entry.digest.oneLine }}
                  </p>
                </div>
                <p v-if="!githubDigestEntries.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
                  暂无 GitHub 速读缓存。打开 GitHub 仓库页并生成速读后会出现在这里。
                </p>
              </div>
            </div>

            <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
              <div class="flex shrink-0 items-start justify-between gap-3">
                <div>
                  <h2 class="text-16px font-600">
                    论坛 Lexi 速读缓存
                  </h2>
                  <p class="mt-1 text-12px text-neutral-500">
                    帖子级缓存 {{ forumDigestStats.total }} 个，占用 {{ formatBytes(forumDigestStats.bytes) }}。
                  </p>
                </div>
                <BaseButton size="sm" @click="clearForumDigestCache">
                  清空缓存
                </BaseButton>
              </div>
              <div class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                <div v-for="entry in forumDigestEntries" :key="entry.key" class="rounded-2 border border-neutral-200 px-3 py-3">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="break-words text-14px font-700">
                        {{ entry.title || entry.key }}
                      </div>
                      <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                        {{ entry.host }} · {{ formatDateTime(entry.updatedAt) }} · {{ entry.sourceHash }} · 历史 {{ getForumDigestHistoryCount(entry) }}
                      </div>
                    </div>
                    <BaseButton variant="danger" size="sm" @click="removeForumDigestCacheEntry(entry.key)">
                      删除
                    </BaseButton>
                  </div>
                  <p class="mt-2 break-words text-12px leading-5 text-neutral-700">
                    {{ formatForumDigestSummary(entry.digest) }}
                  </p>
                  <a :href="entry.url" target="_blank" rel="noreferrer" class="mt-2 inline-block break-all text-12px text-neutral-500 underline underline-offset-2 hover:text-neutral-950">
                    {{ entry.url }}
                  </a>
                </div>
                <p v-if="!forumDigestEntries.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
                  暂无论坛速读缓存。打开 linux.do、idcflare.com 或 Discourse 帖子后会出现在这里。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'about'" id="options-panel-about" role="tabpanel" aria-labelledby="options-tab-about" class="options-panel about-panel rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="about-hero">
            <Logo class="about-hero__logo" />
            <div class="about-hero__copy">
              <div class="about-hero__title">
                <h2>Lexi</h2>
                <span>v{{ appVersion }}</span>
              </div>
              <p>在你每天阅读的网页里自然积累英文词汇，并通过划词翻译与内容速读降低理解成本。</p>
              <div class="about-hero__actions">
                <a class="button-primary" href="https://github.com/talex-touch/touch-xxeng-heart" target="_blank" rel="noreferrer">
                  <span class="i-lucide-github" aria-hidden="true" />
                  GitHub
                </a>
              </div>
            </div>
          </div>

          <DevFestivalPreview v-if="DevFestivalPreview" />

          <dl class="about-facts">
            <div>
              <dt>开发者</dt>
              <dd>TalexDreamSoul</dd>
            </div>
            <div>
              <dt>开源协议</dt>
              <dd>MIT License</dd>
            </div>
            <div>
              <dt>安装方式</dt>
              <dd>Chrome / Edge 扩展</dd>
            </div>
            <div>
              <dt>本地存储</dt>
              <dd>{{ formatBytes(storageStats.total) }} · {{ vocabularyRecords.length }} 词</dd>
            </div>
          </dl>

          <div class="about-section">
            <h3>致谢</h3>
            <p>感谢参与开发、测试并持续帮助 Lexi 改进的伙伴。</p>
            <div class="about-people">
              <div><span>T</span><strong>TalexDreamSoul</strong><small>开发与维护</small></div>
              <div><span>X</span><strong>XinYu Wu</strong><small>101-010-000</small></div>
              <div><span>X</span><strong>XinRong Liu</strong><small>TomHolland</small></div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </main>
</template>
