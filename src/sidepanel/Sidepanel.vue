<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sendTabRuntimeMessage } from '~/logic/runtimeMessaging'
import { estimateStorageBytes, formatBytes } from '~/logic/format'
import { openOptionsPage } from '~/logic/browserActions'
import { festivalThemeDetails, resolveFestivalTheme } from '~/logic/festivalTheme'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import { pageTranslationAutoSiteOptions } from '~/logic/pageTranslationSites'
import { densityTiers, formatDensityPercent, getEffectiveDensity, maxReplacementLevel, minReplacementLevel, resolveDensityTier, resolveReplacementLevel } from '~/logic/replacementLevels'
import type { DensityTierId } from '~/logic/replacementLevels'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations, getTodayReviewCount, reviewVocabularyRecord } from '~/logic/vocabularyRecords'
import { exportVocabularyRecords, importVocabularyRecords } from '~/logic/vocabularyTransfer'
import { maxVocabularyLimit, minVocabularyLimit } from '~/logic/defaults'
import type { VocabularyReviewResult } from '~/logic/vocabularyRecords'
import { entityDomainColors } from '~/logic/entityDomains'
import type { PageStats } from '~/contentScripts/pageEnhancer'
import type { PageEntitySummary } from '~/contentScripts/pageEntities'
import type { EntityDomain, PageTranslationAutoSite, PageTranslationDirection, PageTranslationScope, TranslationDirection } from '~/logic/types'

type SidepanelTab = 'common' | 'advanced' | 'history'
type PageContextStatus = 'loading' | 'supported' | 'unsupported'

const tabItems: Array<{ value: SidepanelTab, label: string }> = [
  { value: 'common', label: '本页' },
  { value: 'advanced', label: '全局' },
  { value: 'history', label: '记录' },
]
const activeTab = ref<SidepanelTab>('common')

const translationDirections: Array<{ value: TranslationDirection, label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'zh-to-en', label: '译成英文' },
  { value: 'en-to-zh', label: '译成中文' },
]
// Named by target, not by pair: the engine detects the source itself, so `en-to-zh` also
// covers a Japanese or Korean page. Labelling it 英文 → 中文 would be a promise we break.
const pageTranslationDirections: Array<{ value: PageTranslationDirection, label: string }> = [
  { value: 'en-to-zh', label: '译成中文' },
  { value: 'zh-to-en', label: '译成英文' },
]
const cleanupDays = ref(30)
const importMessage = ref('')
const hostLabel = ref('')
const pageContextStatus = ref<PageContextStatus>('loading')
const pageContextSupported = computed(() => pageContextStatus.value === 'supported')
const pageContextMessage = ref('正在读取当前页面…')
const pageTranslationLoading = ref(false)
const pageTranslationMessage = ref('')
const pageTranslationFailed = ref(false)
const pageTranslationStatus = ref({
  ok: false,
  enabled: false,
  running: false,
  origin: undefined as 'manual' | 'restored' | 'auto' | undefined,
  scope: undefined as PageTranslationScope | undefined,
  autoSite: undefined as PageTranslationAutoSite | undefined,
  blocks: 0,
  cached: false,
  bytes: 0,
})
const pageStats = ref<PageStats>({
  replacements: 0,
  records: 0,
  enabled: false,
  showFloatingStatus: false,
})

function createEmptyEntitySummary(): PageEntitySummary {
  return {
    domain: { primary: undefined, confidence: 0, scores: { tech: 0, finance: 0, product: 0, medical: 0, legal: 0, academic: 0 } },
    entities: [],
    aiAssisted: false,
    primaryLabel: '',
    domainCounts: [],
  }
}

const pageEntities = ref<PageEntitySummary>(createEmptyEntitySummary())
const visibleEntities = computed(() => pageEntities.value.entities.slice(0, 8))

function domainInk(domain: EntityDomain) {
  return entityDomainColors[domain].ink
}

function domainChipStyle(domain: EntityDomain) {
  return { background: entityDomainColors[domain].soft, color: entityDomainColors[domain].ink }
}

const activeLevel = computed(() => resolveReplacementLevel(lexiSettings.value.replacement.level))
const festivalTheme = computed(() => resolveFestivalTheme(undefined, lexiSettings.value.ui.festivalTheme))
const festivalThemeDetail = computed(() => festivalThemeDetails[festivalTheme.value])
const difficulty = computed(() => getProgressDifficulty(
  vocabularyRecords.value,
  activeLevel.value.maxDifficulty,
))

const dueRecords = computed(() => getDueRecords(vocabularyRecords.value).slice(0, 8))
const reviewedToday = computed(() => getTodayReviewCount(vocabularyRecords.value))
const reviewGoal = computed(() => Math.max(1, lexiSettings.value.study.dailyGoal))
const reviewGoalCompleted = computed(() => reviewedToday.value >= reviewGoal.value)
const reviewProgress = computed(() => `${Math.min(100, Math.round(reviewedToday.value / reviewGoal.value * 100))}%`)
const reviewMessage = ref('')
const manualRecords = computed(() => vocabularyRecords.value.filter(record => record.source === 'manual').slice(0, 8))
const autoRecords = computed(() => vocabularyRecords.value.filter(record => record.source === 'auto').slice(0, 8))
const storageSize = computed(() => formatBytes(estimateStorageBytes(vocabularyRecords.value)))
const densityTierOptions = densityTiers.map(tier => ({ value: tier.id, label: tier.label }))
const activeDensityTier = computed(() => resolveDensityTier(lexiSettings.value.replacement.density))
const effectiveDensityLabel = computed(() => formatDensityPercent(getEffectiveDensity(lexiSettings.value.replacement)))
type PageTranslationStartScope = 'session' | PageTranslationScope
type PageTranslationMode = 'idle' | 'manual' | 'restored' | 'auto'

const startChooserOpen = ref(false)
const startScope = ref<PageTranslationStartScope>('session')
const startRegex = ref('')
const startDirection = ref<PageTranslationDirection>('en-to-zh')
const startScopeOptions: Array<{ value: PageTranslationStartScope, label: string }> = [
  { value: 'session', label: '仅本次' },
  { value: 'url', label: '当前链接' },
  { value: 'site', label: '当前站点' },
  { value: 'regex', label: 'Regex' },
]
const startScopeHints: Record<PageTranslationStartScope, string> = {
  session: '只翻译这一次，不保存规则，关闭或刷新后不再恢复。',
  url: '保存规则：此链接下次访问自动恢复翻译。',
  site: '保存规则：该站点下的页面都自动翻译。',
  regex: '保存规则：URL 命中正则的页面自动翻译。',
}
const startScopeHint = computed(() => startScopeHints[startScope.value])
const startButtonLabel = computed(() => {
  if (startScope.value === 'session')
    return '仅本次翻译'
  if (startScope.value === 'url')
    return '保存当前链接规则并翻译'
  if (startScope.value === 'site')
    return '保存当前站点规则并翻译'

  return '保存 Regex 规则并翻译'
})
const startConfirmDisabled = computed(() =>
  pageTranslationLoading.value || (startScope.value === 'regex' && !startRegex.value.trim()),
)

const pageTranslationRunning = computed(() => pageTranslationStatus.value.running)
const pageTranslationMode = computed<PageTranslationMode>(() => {
  const status = pageTranslationStatus.value
  if (!status.running)
    return 'idle'
  if (status.autoSite)
    return 'auto'
  if (status.origin === 'restored')
    return 'restored'

  return 'manual'
})
const pageTranslationStateLabel = computed(() => ({
  idle: '未运行',
  manual: '正在翻译',
  restored: '已按规则恢复',
  auto: '平台自动翻译',
})[pageTranslationMode.value])
const pageTranslationAutoSiteLabel = computed(() => {
  const site = pageTranslationStatus.value.autoSite
  return site ? pageTranslationAutoSiteOptions.find(option => option.value === site)?.label ?? site : ''
})
const pageTranslationScopeDescription = computed(() => {
  const scope = pageTranslationStatus.value.scope
  if (scope === 'site')
    return hostLabel.value ? `${hostLabel.value} 站点` : '当前站点'
  if (scope === 'regex')
    return 'Regex 匹配页面'

  return '当前链接'
})
const pageTranslationImpactLine = computed(() => {
  const mode = pageTranslationMode.value
  if (mode === 'auto')
    return `已命中${pageTranslationAutoSiteLabel.value}自动翻译，只处理英文正文。`
  if (mode === 'restored')
    return `已按保存规则恢复：${pageTranslationScopeDescription.value}。`
  if (mode === 'manual') {
    return pageTranslationStatus.value.scope
      ? `已保存为${pageTranslationScopeDescription.value}的规则，下次访问自动恢复。`
      : '仅本次翻译；关闭或刷新后不再恢复。'
  }

  return '不会自动翻译任何页面；启动时可选择仅本次或保存为规则。'
})
const pageTranslationFeedbackLine = computed(() => {
  if (!pageTranslationRunning.value)
    return ''

  const blocks = pageTranslationStatus.value.blocks
  return blocks > 0 ? `已翻译 ${blocks} 段` : '正在处理可见内容…'
})
const dailyRecommendations = computed(() => getTodayRecommendations(
  vocabularyRecords.value,
  lexiSettings.value.study.dailyGoal,
  difficulty.value,
))

function setDensityTier(id: DensityTierId) {
  const tier = densityTiers.find(item => item.id === id)
  if (tier)
    lexiSettings.value.replacement.density = tier.value
}

function onSidepanelTabKeydown(event: KeyboardEvent, index: number) {
  let nextIndex = index
  if (event.key === 'ArrowRight')
    nextIndex = (index + 1) % tabItems.length
  else if (event.key === 'ArrowLeft')
    nextIndex = (index - 1 + tabItems.length) % tabItems.length
  else if (event.key === 'Home')
    nextIndex = 0
  else if (event.key === 'End')
    nextIndex = tabItems.length - 1
  else
    return

  event.preventDefault()
  const tab = tabItems[nextIndex]
  activeTab.value = tab.value
  requestAnimationFrame(() => document.getElementById(`sidepanel-tab-${tab.value}`)?.focus())
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id)
    throw new Error('无法读取当前标签页')

  return tab as typeof tab & { id: number }
}

function readHostLabel(url?: string) {
  if (!url)
    return ''

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return ''
  }
}

function supportsPageContext(url?: string) {
  if (!url)
    return false

  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  }
  catch {
    return false
  }
}

function resetPageContextState() {
  pageTranslationStatus.value = {
    ok: false,
    enabled: false,
    running: false,
    origin: undefined,
    scope: undefined,
    autoSite: undefined,
    blocks: 0,
    cached: false,
    bytes: 0,
  }
  pageStats.value = {
    replacements: 0,
    records: 0,
    enabled: false,
    showFloatingStatus: false,
  }
  pageEntities.value = createEmptyEntitySummary()
}

let pageContextEpoch = 0

async function refreshPageTranslationStatus() {
  const epoch = ++pageContextEpoch
  pageContextStatus.value = 'loading'
  try {
    const tab = await getActiveTab()
    if (epoch !== pageContextEpoch)
      return

    const supported = supportsPageContext(tab.url)
    hostLabel.value = supported ? readHostLabel(tab.url) : ''
    if (!supported) {
      resetPageContextState()
      pageContextStatus.value = 'unsupported'
      pageContextMessage.value = 'Lexi 管理页和浏览器内部页面不会加载网页增强脚本。'
      pageTranslationFailed.value = false
      pageTranslationMessage.value = ''
      return
    }

    pageContextStatus.value = 'supported'
    pageContextMessage.value = ''
    const [stats, status, entities] = await Promise.all([
      sendTabRuntimeMessage<PageStats>(tab.id, 'lexi-page-stats', {}),
      sendTabRuntimeMessage<typeof pageTranslationStatus.value>(tab.id, 'lexi-page-translate-status', {}),
      // A page still running an older content script has no entity listener; that is a
      // missing section, not a broken panel, so it must not fail the whole refresh.
      sendTabRuntimeMessage<PageEntitySummary>(tab.id, 'lexi-page-entities', {}).catch(() => undefined),
    ])
    if (epoch !== pageContextEpoch)
      return

    pageStats.value = stats
    pageTranslationStatus.value = status
    pageEntities.value = entities ?? createEmptyEntitySummary()
    // Cache size and block count now live in the progress row, so a healthy refresh
    // stays silent instead of restating them as a message.
    pageTranslationFailed.value = false
    pageTranslationMessage.value = ''
  }
  catch (error) {
    if (epoch !== pageContextEpoch)
      return

    resetPageContextState()
    if (pageContextStatus.value === 'loading') {
      pageContextStatus.value = 'unsupported'
      pageContextMessage.value = formatBridgeError(error)
      pageTranslationFailed.value = false
      pageTranslationMessage.value = ''
      return
    }

    pageTranslationFailed.value = true
    pageTranslationMessage.value = formatBridgeError(error)
  }
}

function formatBridgeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/No handler registered|Could not establish connection|Receiving end does not exist/i.test(message))
    return '当前页面还未加载新版 Lexi 内容脚本，请刷新页面或重新加载扩展后再试。'

  return message || '无法连接当前页面'
}

async function controlPageTranslation(action: 'start' | 'stop' | 'pause', data: Record<string, unknown> = {}) {
  let tab: Awaited<ReturnType<typeof getActiveTab>>
  try {
    tab = await getActiveTab()
  }
  catch {
    await refreshPageTranslationStatus()
    return
  }

  if (!supportsPageContext(tab.url)) {
    await refreshPageTranslationStatus()
    return
  }

  pageTranslationLoading.value = true
  try {
    const result = await sendTabRuntimeMessage<{ message: string }>(
      tab.id,
      action === 'start' ? 'lexi-page-translate-start' : action === 'pause' ? 'lexi-page-translate-pause' : 'lexi-page-translate-stop',
      data,
    )
    pageTranslationMessage.value = result.message
    await refreshPageTranslationStatus()
    pageTranslationFailed.value = false
    pageTranslationMessage.value = result.message
  }
  catch (error) {
    pageTranslationFailed.value = true
    pageTranslationMessage.value = formatBridgeError(error)
  }
  finally {
    pageTranslationLoading.value = false
  }
}

function openStartChooser() {
  // Session-only is always the default so a persistent rule never appears by accident.
  startScope.value = 'session'
  startRegex.value = lexiSettings.value.selection.pageTranslation.regex
  startDirection.value = lexiSettings.value.selection.pageTranslation.direction
  startChooserOpen.value = true
}

async function confirmStartPageTranslation() {
  const scope = startScope.value
  const persist = scope !== 'session'
  const regex = startRegex.value.trim()
  const pageTranslation = lexiSettings.value.selection.pageTranslation
  pageTranslation.direction = startDirection.value
  if (persist) {
    pageTranslation.scope = scope as PageTranslationScope
    if (scope === 'regex')
      pageTranslation.regex = regex
  }

  await controlPageTranslation('start', {
    persist,
    direction: startDirection.value,
    ...(persist ? { scope, ...(scope === 'regex' ? { regex } : {}) } : {}),
  })
  startChooserOpen.value = false
}

function stopCurrentPageTranslation() {
  return controlPageTranslation('stop')
}

function pauseCurrentPageTranslation() {
  return controlPageTranslation('pause')
}

function openTranslationSettings() {
  openOptionsPage('translation')
}

function exportRecords() {
  exportVocabularyRecords(vocabularyRecords.value)
}

function clearRecords() {
  vocabularyRecords.value = []
}

function formatReviewDelay(nextReviewAt: number, now: number) {
  const minutes = Math.max(1, Math.round((nextReviewAt - now) / (60 * 1000)))
  if (minutes < 60)
    return `${minutes} 分钟后`

  const hours = Math.round(minutes / 60)
  if (hours < 24)
    return `${hours} 小时后`

  return `${Math.max(1, Math.round(hours / 24))} 天后`
}

function reviewRecord(id: string, result: VocabularyReviewResult) {
  const now = Date.now()
  vocabularyRecords.value = reviewVocabularyRecord(vocabularyRecords.value, id, result, now)
  const reviewed = vocabularyRecords.value.find(record => record.id === id)
  if (!reviewed)
    return

  const resultLabel: Record<VocabularyReviewResult, string> = {
    forgot: '标记为不认识',
    hard: '标记为模糊',
    remembered: '标记为认识',
  }
  reviewMessage.value = `${reviewed.replacement} 已${resultLabel[result]}，${formatReviewDelay(reviewed.nextReviewAt, now)}再次复盘。`
}

function cleanupOldRecords() {
  const threshold = Date.now() - cleanupDays.value * 24 * 60 * 60 * 1000
  vocabularyRecords.value = vocabularyRecords.value.filter(record => record.updatedAt >= threshold)
}

async function importRecords(event: Event) {
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
    importMessage.value = `已导入 ${result.imported} 条，跳过 ${result.skipped} 条无效记录`
  }
  catch (error) {
    importMessage.value = error instanceof Error ? error.message : '导入失败'
  }
  finally {
    input.value = ''
  }
}

function handleTabActivated() {
  void refreshPageTranslationStatus()
}

type TabUpdatedListener = Parameters<typeof browser.tabs.onUpdated.addListener>[0]
function handleTabUpdated(...[_tabId, changeInfo, tab]: Parameters<TabUpdatedListener>) {
  if (tab.active && (changeInfo.url || changeInfo.status === 'complete'))
    void refreshPageTranslationStatus()
}

onMounted(() => {
  browser.tabs.onActivated.addListener(handleTabActivated)
  browser.tabs.onUpdated.addListener(handleTabUpdated)
  void refreshPageTranslationStatus()
})

onBeforeUnmount(() => {
  browser.tabs.onActivated.removeListener(handleTabActivated)
  browser.tabs.onUpdated.removeListener(handleTabUpdated)
})
</script>

<template>
  <main
    class="min-h-screen bg-white px-4 py-5 text-lexi-ink"
    :class="festivalTheme === 'spring' ? 'bg-emerald-50' : festivalTheme === 'valentine' ? 'bg-rose-50' : festivalTheme === 'halloween' ? 'bg-orange-50' : ''"
    :data-lexi-festival="festivalTheme"
  >
    <header class="flex items-start justify-between gap-3 border-b border-lexi-border pb-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <div class="text-17px font-700">
            Lexical
          </div>
          <span v-if="festivalThemeDetail.mark" class="rounded-full px-1.5 py-0.5 text-10px font-700" :class="festivalTheme === 'spring' ? 'bg-emerald-700 text-white' : festivalTheme === 'valentine' ? 'bg-rose-700 text-white' : 'bg-orange-700 text-white'">{{ festivalThemeDetail.mark }}</span>
        </div>
        <div class="mt-1 truncate text-12px text-lexi-ink-3">
          等级 {{ activeLevel.level }} · {{ activeLevel.shortLabel }} · 已记录 {{ vocabularyRecords.length }} 词
        </div>
      </div>
      <button
        type="button"
        class="h-[30px] w-[30px] shrink-0 flex items-center justify-center rounded-2.5 border border-lexi-border bg-white text-lexi-ink cursor-pointer hover:bg-lexi-subtle"
        title="完整配置"
        aria-label="完整配置"
        @click="openOptionsPage"
      >
        <span class="i-lucide-sliders-horizontal block h-[15px] w-[15px]" />
      </button>
    </header>

    <nav class="mt-3.5 grid grid-cols-3 gap-[2px] rounded-2.5 bg-lexi-canvas p-[3px]" role="tablist" aria-label="侧边栏标签页">
      <button
        v-for="tab in tabItems"
        :id="`sidepanel-tab-${tab.value}`"
        :key="tab.value"
        role="tab"
        :aria-selected="activeTab === tab.value"
        :aria-controls="`sidepanel-panel-${tab.value}`"
        :tabindex="activeTab === tab.value ? 0 : -1"
        type="button"
        class="rounded-2 px-2 py-1.5 text-center text-12px font-600 transition cursor-pointer"
        :class="activeTab === tab.value ? 'bg-white text-lexi-ink shadow-sm' : 'text-lexi-ink-3 hover:text-lexi-ink'"
        @click="activeTab = tab.value"
        @keydown="onSidepanelTabKeydown($event, tabItems.indexOf(tab))"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="activeTab === 'common'" id="sidepanel-panel-common" role="tabpanel" aria-labelledby="sidepanel-tab-common" class="mt-4 space-y-4">
      <section v-if="pageContextStatus === 'loading'" class="rounded-3 border border-lexi-border bg-lexi-subtle px-3 py-3" aria-live="polite">
        <div class="flex items-center gap-2.5 text-lexi-ink-3">
          <span class="i-lucide-loader-circle h-4 w-4 animate-spin" aria-hidden="true" />
          <span class="text-12px">正在读取当前页面…</span>
        </div>
      </section>

      <section v-else-if="!pageContextSupported" class="rounded-3 bg-lexi-accent-soft px-3 py-3 text-lexi-ink">
        <div class="flex items-start gap-2.5">
          <span class="i-lucide-info mt-0.5 h-4 w-4 shrink-0 text-lexi-accent" aria-hidden="true" />
          <div class="min-w-0">
            <h2 class="text-13px font-700">
              本页功能不可用
            </h2>
            <p class="mt-1 text-11px leading-5 text-lexi-ink-2">
              {{ pageContextMessage }}
            </p>
            <button type="button" class="mt-2 border-0 bg-transparent p-0 text-11px text-lexi-accent underline underline-offset-2 cursor-pointer" @click="activeTab = 'advanced'">
              查看全局设置
            </button>
          </div>
        </div>
      </section>

      <template v-if="pageContextSupported">
        <section v-if="pageStats.specialProfile" class="rounded-3 bg-lexi-accent-soft px-3 py-3 text-lexi-ink">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-14px font-700">
                当前站点：{{ pageStats.specialProfile.label }}
              </h2>
              <p class="mt-1 text-12px leading-5 text-lexi-ink-2">
                {{ pageStats.specialProfile.detected ? '已自动识别特殊站点策略。' : '已命中特殊站点策略。' }}
                {{ pageStats.specialProfile.dynamicScan ? '动态扫描已启用。' : '动态扫描未启用。' }}
                {{ pageStats.specialProfile.conservative ? '使用保守替换密度。' : '' }}
              </p>
            </div>
            <span class="shrink-0 rounded-full bg-white px-2 py-1 text-11px text-lexi-accent">
              {{ pageStats.specialProfile.kind }}
            </span>
          </div>
        </section>

        <div class="flex items-center justify-between gap-3 rounded-3 border border-lexi-border bg-lexi-subtle px-3 py-2.5">
          <span class="min-w-0">
            <span class="block text-12px font-600">Lexi 全局总开关</span>
            <span class="mt-0.5 block truncate text-11px text-lexi-ink-3">
              {{ hostLabel ? `${hostLabel} · ` : '' }}关闭后所有网站的 Lexi 功能暂停
            </span>
          </span>
          <ToggleSwitch v-model="lexiSettings.siteRules.enabled" label="Lexi 全局总开关" />
        </div>

        <section class="rounded-3 border border-lexi-border bg-white px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-13px font-700">
              页面双语翻译
            </h2>
            <span class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-11px font-600" :class="pageTranslationRunning ? 'bg-lexi-accent-soft text-lexi-accent' : 'bg-lexi-subtle text-lexi-ink-3'">
              <span class="block h-[12px] w-[12px]" :class="pageTranslationRunning ? 'i-lucide-languages' : 'i-lucide-circle-dashed'" aria-hidden="true" />
              {{ pageTranslationStateLabel }}
            </span>
          </div>
          <p class="mt-2 text-11px leading-5 text-lexi-ink-3">
            {{ pageTranslationImpactLine }}
          </p>
          <p v-if="pageTranslationFeedbackLine" class="mt-1 text-11px leading-5 text-lexi-ink-3" aria-live="polite">
            {{ pageTranslationFeedbackLine }}
          </p>

          <template v-if="pageTranslationMode === 'idle'">
            <div v-if="!startChooserOpen" class="mt-3 flex gap-2">
              <BaseButton variant="primary" class="flex-1" :disabled="pageTranslationLoading" @click="openStartChooser">
                <template #icon>
                  <span class="i-lucide-play block h-[13px] w-[13px]" aria-hidden="true" />
                </template>
                翻译此页
              </BaseButton>
              <BaseButton icon-only :disabled="pageTranslationLoading" title="刷新状态" aria-label="刷新状态" @click="refreshPageTranslationStatus">
                <template #icon>
                  <span class="i-lucide-rotate-cw block h-[15px] w-[15px]" aria-hidden="true" />
                </template>
              </BaseButton>
            </div>
            <div v-else class="mt-3 rounded-3 bg-lexi-subtle px-2.5 py-2.5">
              <SegmentedControl v-model="startScope" :options="startScopeOptions" label="翻译范围" />
              <p class="mt-1.5 text-11px leading-5 text-lexi-ink-3">
                {{ startScopeHint }}
              </p>
              <label v-if="startScope === 'regex'" class="mt-2 block">
                <span class="text-11px text-lexi-ink-3">URL Regex</span>
                <input v-model.trim="startRegex" class="mt-1 h-10 w-full rounded-2.5 border border-lexi-border bg-white px-2.5 font-mono text-12px outline-none focus:border-lexi-accent" placeholder="^https://docs\\.example\\.com/">
              </label>
              <SegmentedControl v-model="startDirection" class="mt-2.5" :options="pageTranslationDirections" label="页面翻译方向" />
              <div class="mt-2.5 flex gap-2">
                <BaseButton variant="primary" class="flex-1" :disabled="startConfirmDisabled" @click="confirmStartPageTranslation">
                  {{ startButtonLabel }}
                </BaseButton>
                <BaseButton class="shrink-0" @click="startChooserOpen = false">
                  取消
                </BaseButton>
              </div>
            </div>
          </template>

          <div v-else class="mt-3 flex gap-2">
            <BaseButton v-if="pageTranslationMode === 'manual'" class="flex-1" :disabled="pageTranslationLoading" @click="stopCurrentPageTranslation">
              <template #icon>
                <span class="i-lucide-square block h-[13px] w-[13px]" aria-hidden="true" />
              </template>
              停止本页翻译
            </BaseButton>
            <BaseButton v-else class="flex-1" :disabled="pageTranslationLoading" @click="pauseCurrentPageTranslation">
              <template #icon>
                <span class="i-lucide-pause block h-[13px] w-[13px]" aria-hidden="true" />
              </template>
              暂停本页
            </BaseButton>
            <BaseButton v-if="pageTranslationMode !== 'manual'" variant="ghost" class="shrink-0" @click="openTranslationSettings">
              {{ pageTranslationMode === 'auto' ? '管理自动翻译' : '管理规则' }}
            </BaseButton>
            <BaseButton icon-only :disabled="pageTranslationLoading" title="刷新状态" aria-label="刷新状态" @click="refreshPageTranslationStatus">
              <template #icon>
                <span class="i-lucide-rotate-cw block h-[15px] w-[15px]" aria-hidden="true" />
              </template>
            </BaseButton>
          </div>

          <p v-if="pageTranslationMessage" class="mt-2 text-11px leading-5" :class="pageTranslationFailed ? 'text-lexi-danger' : 'text-lexi-ink-3'" aria-live="polite">
            {{ pageTranslationMessage }}
          </p>
        </section>

        <section v-if="pageEntities.entities.length" class="rounded-3 border border-lexi-border bg-white px-3 py-3">
          <div class="flex items-center justify-between gap-3">
            <span class="min-w-0">
              <span class="block text-12px font-600">本页实体</span>
              <span class="mt-0.5 block text-11px text-lexi-ink-3">
                {{ pageEntities.primaryLabel ? `按${pageEntities.primaryLabel}领域解释` : '页面领域未确定，按默认释义显示' }}
              </span>
            </span>
            <span class="shrink-0 rounded-full bg-lexi-subtle px-2 py-1 text-11px font-600">
              {{ pageEntities.entities.length }}
            </span>
          </div>

          <p v-if="pageEntities.domainCounts.length" class="mt-2.5 flex flex-wrap gap-1.5">
            <span
              v-for="item in pageEntities.domainCounts"
              :key="item.domain"
              class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-11px font-600"
              :style="domainChipStyle(item.domain)"
            >
              <i class="block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {{ item.label }} {{ item.count }}
            </span>
          </p>

          <ul class="mt-1.5">
            <li v-for="entity in visibleEntities" :key="entity.term" class="flex items-center gap-2 py-1.5">
              <i class="block h-1.5 w-1.5 shrink-0 rounded-full" :style="{ background: domainInk(entity.domain) }" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-12px font-600">{{ entity.term }}</span>
                <span class="mt-0.5 block truncate text-11px text-lexi-ink-3">{{ entity.meaning }}</span>
              </span>
            </li>
          </ul>

          <p v-if="pageEntities.entities.length > visibleEntities.length" class="mt-1 text-11px text-lexi-ink-3">
            另有 {{ pageEntities.entities.length - visibleEntities.length }} 个已在正文中标出。
          </p>
        </section>

        <div>
          <h2 class="px-0.5 text-11px text-lexi-ink-3 font-600">
            本页增强
          </h2>
          <div class="mt-2 overflow-hidden rounded-3 border border-lexi-border bg-white">
            <div class="flex items-center justify-between gap-3 px-3 py-2.5">
              <span class="min-w-0">
                <span class="block text-12px font-600">替换网页文本</span>
                <span class="mt-0.5 block text-11px text-lexi-ink-3">将部分中文替换为英文</span>
              </span>
              <ToggleSwitch v-model="lexiSettings.replacement.enabled" label="替换网页文本" />
            </div>

            <div class="border-t border-lexi-border px-3 pb-3 pt-2.5">
              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0">
                  <span class="block text-12px font-600">划词翻译</span>
                  <span class="mt-0.5 block text-11px text-lexi-ink-3">选中文本后快速翻译</span>
                </span>
                <ToggleSwitch v-model="lexiSettings.selection.enabled" label="划词翻译" />
              </div>
              <!-- The direction used to live in a separate card at the bottom of the tab. -->
              <SegmentedControl
                v-model="lexiSettings.selection.translationDirection"
                class="mt-2.5"
                :options="translationDirections"
                :disabled="!lexiSettings.selection.enabled"
                label="划词翻译方向"
              />
            </div>

            <div class="border-t border-lexi-border flex items-center justify-between gap-3 px-3 py-2.5">
              <span class="min-w-0">
                <span class="block text-12px font-600">实体检测</span>
                <span class="mt-0.5 block text-11px text-lexi-ink-3">标出专有名词及其所属领域</span>
              </span>
              <ToggleSwitch v-model="lexiSettings.entityDetection.enabled" label="实体检测" />
            </div>
          </div>
        </div>
      </template>

      <button
        type="button"
        class="w-full flex items-center justify-between gap-3 rounded-3 border border-lexi-border bg-lexi-subtle px-3 py-2.5 text-left cursor-pointer hover:bg-lexi-canvas"
        @click="activeTab = 'history'"
      >
        <span class="min-w-0">
          <span class="block text-12px font-600">记录与复盘</span>
          <span class="mt-0.5 block text-11px text-lexi-ink-3">
            最近翻译 {{ manualRecords.length }} 条 · 待复盘 {{ dueRecords.length }} 条
          </span>
        </span>
        <span class="i-lucide-chevron-right block h-4 w-4 shrink-0 text-lexi-ink-3" />
      </button>
    </section>

    <section v-else-if="activeTab === 'advanced'" id="sidepanel-panel-advanced" role="tabpanel" aria-labelledby="sidepanel-tab-advanced" class="mt-4 space-y-4">
      <section class="rounded-3 border border-lexi-border bg-lexi-subtle px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              替换参数
            </h2>
            <p class="mt-1 text-12px text-lexi-ink-3">
              控制网页文本替换的强度和数量。
            </p>
          </div>
          <button class="border-0 bg-transparent p-0 text-12px text-lexi-ink-3 underline cursor-pointer" @click="openOptionsPage">
            更多设置
          </button>
        </div>

        <label class="mt-4 block">
          <div class="flex items-center justify-between gap-3">
            <span class="text-12px font-500 text-lexi-ink-2">学习等级</span>
            <span class="rounded-full bg-white px-2 py-1 text-12px text-lexi-ink-2">{{ activeLevel.level }} · {{ activeLevel.shortLabel }}</span>
          </div>
          <input
            v-model.number="lexiSettings.replacement.level"
            type="range"
            :min="minReplacementLevel"
            :max="maxReplacementLevel"
            step="1"
            class="mt-2 w-full accent-lexi-accent"
          >
          <p class="mt-1 text-11px leading-4 text-lexi-ink-3">
            {{ activeLevel.label }} · {{ activeLevel.coverage }}。等级越低替换越多。
          </p>
        </label>

        <div class="mt-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-12px font-500 text-lexi-ink-2">替换密度</span>
            <span class="rounded-full bg-white px-2 py-1 text-12px text-lexi-ink-2">{{ activeDensityTier.label }}</span>
          </div>
          <SegmentedControl
            class="mt-2"
            :model-value="activeDensityTier.id"
            :options="densityTierOptions"
            label="替换密度"
            @update:model-value="setDensityTier"
          />
          <p class="mt-1 text-11px leading-4 text-lexi-ink-3">
            {{ activeDensityTier.hint }}；按当前等级折算后实际约 {{ effectiveDensityLabel }}。
          </p>
        </div>

        <label class="mt-3 block">
          <span class="text-12px text-lexi-ink-3">单页最大替换数</span>
          <input v-model.number="lexiSettings.replacement.maxPerPage" type="number" min="1" max="40" class="mt-1 h-9 w-full rounded-2 border border-lexi-border bg-white px-2 text-12px outline-none focus:border-lexi-accent">
        </label>
      </section>

      <section class="rounded-3 border border-lexi-border bg-white px-3 py-3">
        <h2 class="text-14px font-700">
          交互与显示
        </h2>
        <div class="mt-3 space-y-2">
          <div class="flex items-center justify-between gap-3 rounded-2 bg-lexi-subtle px-3 py-2 text-12px">
            <span>
              <span class="block font-500">显示状态浮标</span>
              <span class="text-11px text-lexi-ink-3">在页面上展示 Lexi 运行状态</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.ui.showFloatingStatus" label="显示状态浮标" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-lexi-subtle px-3 py-2 text-12px">
            <span>
              <span class="block font-500">按修饰键触发划词</span>
              <span class="text-11px text-lexi-ink-3">macOS Command / Windows Ctrl；媒体操作默认 meta+shift</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.selection.requireModifierKey" label="按修饰键触发划词" />
          </div>
        </div>
      </section>

      <!-- Page-translation tuning and record keeping moved off the 本页 tab: they are set
           once, not per page. -->
      <section class="rounded-3 border border-lexi-border bg-white px-3 py-3">
        <h2 class="text-14px font-700">
          自动翻译与记录
        </h2>
        <p class="mt-1 text-12px text-lexi-ink-3">
          整页翻译的请求节奏，以及本地记录的保存方式。
        </p>

        <div class="mt-3 flex items-center justify-between gap-3 rounded-2 bg-lexi-subtle px-3 py-2 text-12px">
          <span>
            <span class="block font-500">保存历史</span>
            <span class="text-11px text-lexi-ink-3">用于复盘和导出</span>
          </span>
          <ToggleSwitch v-model="lexiSettings.history.enabled" label="保存历史" />
        </div>

        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-12px text-lexi-ink-3">合并请求段数</span>
            <input v-model.number="lexiSettings.selection.pageTranslation.batchSize" type="number" min="1" max="8" class="mt-1 h-9 w-full rounded-2 border border-lexi-border bg-white px-2 text-12px outline-none focus:border-lexi-accent">
          </label>
          <label class="block">
            <span class="text-12px text-lexi-ink-3">预加载段数</span>
            <input v-model.number="lexiSettings.selection.pageTranslation.prefetchBlocks" type="number" min="0" max="40" class="mt-1 h-9 w-full rounded-2 border border-lexi-border bg-white px-2 text-12px outline-none focus:border-lexi-accent">
          </label>
        </div>

        <label class="mt-3 block">
          <span class="text-12px text-lexi-ink-3">词库记录上限（条）</span>
          <input v-model.number="lexiSettings.history.maxRecords" type="number" :min="minVocabularyLimit" :max="maxVocabularyLimit" class="mt-1 h-9 w-full rounded-2 border border-lexi-border bg-white px-2 text-12px outline-none focus:border-lexi-accent">
        </label>
      </section>
    </section>

    <section v-else id="sidepanel-panel-history" role="tabpanel" aria-labelledby="sidepanel-tab-history" class="mt-4 space-y-5">
      <section class="rounded-3 border border-lexi-border bg-white px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-14px font-700">
            历史与存储
          </h2>
          <span class="text-12px text-lexi-ink-3">{{ storageSize }}</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-center">
          <div class="rounded-2 border border-lexi-border bg-lexi-subtle px-2 py-2">
            <div class="text-16px font-700">
              {{ vocabularyRecords.length }}
            </div>
            <div class="text-11px text-lexi-ink-3">
              总记录
            </div>
          </div>
          <div class="rounded-2 border border-lexi-border bg-lexi-subtle px-2 py-2">
            <div class="text-16px font-700">
              {{ manualRecords.length }}
            </div>
            <div class="text-11px text-lexi-ink-3">
              最近翻译
            </div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <BaseButton size="sm" @click="exportRecords">
            导出
          </BaseButton>
          <label class="min-h-8 inline-flex items-center rounded-2 border border-lexi-border bg-white px-2.5 text-11.5px text-lexi-ink-2 font-600 cursor-pointer hover:bg-lexi-subtle">
            导入
            <input type="file" accept="application/json" class="hidden" @change="importRecords">
          </label>
          <BaseButton variant="danger" size="sm" @click="clearRecords">
            清空
          </BaseButton>
        </div>
        <div class="mt-3 flex items-center gap-2 rounded-2 bg-lexi-subtle px-3 py-2">
          <span class="text-12px text-lexi-ink-3">清理超过</span>
          <input v-model.number="cleanupDays" type="number" min="1" max="365" class="h-8 w-18 rounded-2 border border-lexi-border bg-white px-2 text-12px outline-none focus:border-lexi-accent">
          <span class="text-12px text-lexi-ink-3">天的记录</span>
          <BaseButton size="sm" class="ml-auto" @click="cleanupOldRecords">
            清理
          </BaseButton>
        </div>
        <p v-if="importMessage" class="mt-2 text-12px text-lexi-ink-3">
          {{ importMessage }}
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          最近翻译
        </h2>
        <div v-if="manualRecords.length" class="mt-3 space-y-2">
          <article v-for="record in manualRecords" :key="record.id" class="rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="break-words text-13px font-600">
                  {{ record.original }}
                </div>
                <div class="mt-1 break-words text-12px text-lexi-ink-2">
                  {{ record.replacement }}
                </div>
              </div>
              <span class="shrink-0 text-11px text-lexi-ink-3">{{ record.selectedCount }} 次</span>
            </div>
            <p v-if="record.context" class="mt-1 line-clamp-2 text-11px leading-4 text-lexi-ink-3">
              {{ record.context }}
            </p>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-3 text-13px text-lexi-ink-3">
          暂无划词翻译历史。
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          最近替换
        </h2>
        <div v-if="autoRecords.length" class="mt-3 space-y-2">
          <article v-for="record in autoRecords" :key="record.id" class="rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <span class="font-600">{{ record.original }}</span>
              <span class="text-12px text-lexi-ink-2">{{ record.replacement }}</span>
            </div>
            <p v-if="record.context" class="mt-1 line-clamp-2 text-11px leading-4 text-lexi-ink-3">
              {{ record.context }}
            </p>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-3 text-13px text-lexi-ink-3">
          暂无网页替换历史。
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          今日推荐
        </h2>
        <div class="mt-3 space-y-3">
          <article v-for="item in dailyRecommendations" :key="`${item.original}:${item.replacement}`" class="border-b border-lexi-subtle pb-3">
            <div class="flex items-baseline justify-between gap-3">
              <div class="text-16px font-700 text-lexi-ink">
                {{ item.replacement }}
              </div>
              <div class="text-12px text-lexi-ink-3">
                {{ item.original }}
              </div>
            </div>
            <p class="mt-1 text-13px leading-5 text-lexi-ink-2">
              {{ item.meaning }}
            </p>
            <p class="mt-1 text-12px leading-5 text-lexi-ink-3">
              {{ item.example }}
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="review-heading">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 id="review-heading" class="text-14px font-700">
              待复盘
            </h2>
            <p class="mt-1 text-12px text-lexi-ink-3">
              今日已完成 {{ reviewedToday }} / {{ reviewGoal }} 个词
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-1 text-11px" :class="reviewGoalCompleted ? 'bg-lexi-accent-soft text-lexi-accent' : 'bg-lexi-canvas text-lexi-ink-2'">
            {{ reviewGoalCompleted ? '今日完成' : '进行中' }}
          </span>
        </div>

        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-lexi-canvas" aria-hidden="true">
          <div class="h-full rounded-full bg-lexi-accent transition-[width] duration-200" :style="{ width: reviewProgress }" />
        </div>

        <p v-if="reviewMessage" class="mt-3 rounded-2 bg-lexi-accent-soft px-3 py-2 text-12px leading-5 text-lexi-accent" aria-live="polite">
          {{ reviewMessage }}
        </p>

        <div v-if="dueRecords.length" class="mt-3 space-y-3">
          <article v-for="record in dueRecords" :key="record.id" class="rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="break-words font-600">
                  {{ record.replacement }}
                </div>
                <div class="mt-0.5 break-words text-12px text-lexi-ink-2">
                  {{ record.original }}
                </div>
              </div>
              <span class="shrink-0 text-11px text-lexi-ink-3">等级 {{ record.learnedLevel }}</span>
            </div>
            <p v-if="record.meaning" class="mt-2 text-12px leading-5 text-lexi-ink-2">
              {{ record.meaning }}
            </p>
            <div class="mt-3 grid grid-cols-3 gap-2">
              <BaseButton variant="danger" size="sm" :aria-label="`${record.replacement}：不认识`" @click="reviewRecord(record.id, 'forgot')">
                不认识
              </BaseButton>
              <BaseButton size="sm" :aria-label="`${record.replacement}：有点模糊`" @click="reviewRecord(record.id, 'hard')">
                模糊
              </BaseButton>
              <BaseButton variant="primary" size="sm" :aria-label="`${record.replacement}：认识`" @click="reviewRecord(record.id, 'remembered')">
                认识
              </BaseButton>
            </div>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-lexi-border bg-lexi-subtle px-3 py-3 text-13px leading-5 text-lexi-ink-3">
          {{ reviewGoalCompleted ? '今天的复盘目标已完成，可以继续阅读积累新词。' : reviewedToday ? '当前没有更多到期词汇，晚些时候再来看看。' : '暂无到期复盘词汇，继续阅读后会在这里安排复盘。' }}
        </p>
      </section>
    </section>
  </main>
</template>
