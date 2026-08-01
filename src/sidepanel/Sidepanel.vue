<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { sendTabRuntimeMessage } from '~/logic/runtimeMessaging'
import { estimateStorageBytes, formatBytes } from '~/logic/format'
import { openOptionsPage } from '~/logic/browserActions'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations, getTodayReviewCount, normalizeImportedRecord, reviewVocabularyRecord } from '~/logic/vocabularyRecords'
import type { VocabularyReviewResult } from '~/logic/vocabularyRecords'
import type { PageStats } from '~/contentScripts/pageEnhancer'
import type { PageTranslationScope, TranslationDirection, VocabularyRecord } from '~/logic/types'

type SidepanelTab = 'common' | 'advanced' | 'history'

const tabItems: Array<{ value: SidepanelTab, label: string, description: string }> = [
  { value: 'common', label: '常用操作', description: '开关与当前页' },
  { value: 'advanced', label: '高级设置', description: '密度与触发' },
  { value: 'history', label: '历史复盘', description: '记录与推荐' },
]
const activeTab = ref<SidepanelTab>('common')

const translationDirections: Array<{ value: TranslationDirection, label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'zh-to-en', label: '中译英' },
  { value: 'en-to-zh', label: '英译中' },
]
const cleanupDays = ref(30)
const importMessage = ref('')
const maxImportBytes = 2 * 1024 * 1024
const pageTranslationLoading = ref(false)
const pageTranslationMessage = ref('')
const pageTranslationStatus = ref({
  ok: false,
  enabled: false,
  scope: undefined as PageTranslationScope | undefined,
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

const difficulty = computed(() => getProgressDifficulty(
  vocabularyRecords.value,
  lexiSettings.value.replacement.difficulty,
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
const replacementDensityPercent = computed(() => Math.round(lexiSettings.value.replacement.density * 100))
const pageTranslationScopes: Array<{ value: PageTranslationScope, label: string, description: string }> = [
  { value: 'url', label: '当前链接', description: '只在当前 URL 自动恢复' },
  { value: 'site', label: '整个站点', description: '同一域名下都自动翻译' },
  { value: 'regex', label: 'Regex', description: 'URL 命中正则时自动翻译' },
]
const pageTranslationStateLabel = computed(() => pageTranslationStatus.value.enabled ? '运行中' : '已停止')
const pageTranslationScopeLabel = computed(() => {
  const scope = pageTranslationStatus.value.scope ?? lexiSettings.value.selection.pageTranslation.scope
  return pageTranslationScopes.find(item => item.value === scope)?.label ?? '当前链接'
})
const pageTranslationStorageLabel = computed(() => {
  return pageTranslationStatus.value.cached
    ? `可恢复 · ${formatBytes(pageTranslationStatus.value.bytes)}`
    : '暂无缓存'
})
const dailyRecommendations = computed(() => getTodayRecommendations(
  vocabularyRecords.value,
  lexiSettings.value.study.dailyGoal,
  difficulty.value,
))

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

async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id)
    throw new Error('无法读取当前标签页')

  return tab.id
}

async function refreshPageStats(tabId?: number) {
  const targetTabId = tabId ?? await getActiveTabId()
  pageStats.value = await sendTabRuntimeMessage<PageStats>(targetTabId, 'lexi-page-stats', {})
}

async function refreshPageTranslationStatus() {
  try {
    const tabId = await getActiveTabId()
    await refreshPageStats(tabId)
    const status = await sendTabRuntimeMessage<typeof pageTranslationStatus.value>(tabId, 'lexi-page-translate-status', {})
    pageTranslationStatus.value = status
    pageTranslationMessage.value = status.cached
      ? `已保存 ${status.blocks} 段，下次打开会自动恢复。`
      : '当前页暂无保存的翻译。'
  }
  catch (error) {
    pageTranslationStatus.value = {
      ok: false,
      enabled: false,
      scope: undefined,
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
    pageTranslationMessage.value = formatBridgeError(error)
  }
}

function formatBridgeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/No handler registered|Could not establish connection|Receiving end does not exist/i.test(message))
    return '当前页面还未加载新版 Lexi 内容脚本，请刷新页面或重新加载扩展后再试。'

  return message || '无法连接当前页面'
}

async function controlPageTranslation(action: 'start' | 'stop') {
  pageTranslationLoading.value = true
  try {
    const tabId = await getActiveTabId()
    const result = await sendTabRuntimeMessage<{ message: string }>(
      tabId,
      action === 'start' ? 'lexi-page-translate-start' : 'lexi-page-translate-stop',
      {},
    )
    pageTranslationMessage.value = result.message
    await refreshPageTranslationStatus()
    pageTranslationMessage.value = result.message
  }
  catch (error) {
    pageTranslationMessage.value = formatBridgeError(error)
  }
  finally {
    pageTranslationLoading.value = false
  }
}

function exportRecords() {
  const blob = new Blob([JSON.stringify(vocabularyRecords.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `lexi-vocabulary-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
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
    const file = input.files[0]
    if (file.size > maxImportBytes)
      throw new Error('导入文件过大，请控制在 2 MB 以内')

    const text = await file.text()
    const records = JSON.parse(text) as VocabularyRecord[]
    if (!Array.isArray(records))
      throw new Error('导入文件不是数组')

    const normalizedRecords = records
      .slice(0, lexiSettings.value.history.maxRecords)
      .map(record => normalizeImportedRecord(record))
      .filter((record): record is VocabularyRecord => Boolean(record))

    const merged = new Map(vocabularyRecords.value.map(record => [record.id, record]))
    for (const record of normalizedRecords)
      merged.set(record.id, record)

    vocabularyRecords.value = [...merged.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, lexiSettings.value.history.maxRecords)
    importMessage.value = `已导入 ${normalizedRecords.length} 条，跳过 ${records.length - normalizedRecords.length} 条无效记录`
  }
  catch (error) {
    importMessage.value = error instanceof Error ? error.message : '导入失败'
  }
  finally {
    input.value = ''
  }
}

onMounted(() => {
  refreshPageTranslationStatus()
})
</script>

<template>
  <main class="min-h-screen bg-white px-4 py-5 text-neutral-950">
    <header class="flex items-start justify-between gap-3 border-b border-neutral-200 pb-4">
      <div>
        <div class="text-18px font-700">
          Lexical
        </div>
        <div class="mt-1 text-12px text-neutral-500">
          难度 {{ difficulty }} · 已记录 {{ vocabularyRecords.length }} · {{ storageSize }}
        </div>
      </div>
      <button class="shrink-0 rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="openOptionsPage">
        完整配置
      </button>
    </header>

    <nav class="mt-4 grid grid-cols-3 gap-2 rounded-3 bg-neutral-100 p-1" role="tablist" aria-label="侧边栏标签页">
      <button
        v-for="tab in tabItems"
        :id="`sidepanel-tab-${tab.value}`"
        :key="tab.value"
        role="tab"
        :aria-selected="activeTab === tab.value"
        :aria-controls="`sidepanel-panel-${tab.value}`"
        :tabindex="activeTab === tab.value ? 0 : -1"
        type="button"
        class="rounded-2 px-2 py-2 text-center transition cursor-pointer"
        :class="activeTab === tab.value ? 'bg-neutral-950 text-white shadow-sm' : 'text-neutral-500 hover:bg-white hover:text-neutral-950'"
        @click="activeTab = tab.value"
        @keydown="onSidepanelTabKeydown($event, tabItems.indexOf(tab))"
      >
        <span class="block text-12px font-600">{{ tab.label }}</span>
        <span class="mt-0.5 block text-10px opacity-75">{{ tab.description }}</span>
      </button>
    </nav>

    <section v-if="activeTab === 'common'" id="sidepanel-panel-common" role="tabpanel" aria-labelledby="sidepanel-tab-common" class="mt-4 space-y-4">
      <section v-if="pageStats.specialProfile" class="rounded-3 border border-purple-200 bg-purple-50 px-3 py-3 text-purple-950">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              当前站点：{{ pageStats.specialProfile.label }}
            </h2>
            <p class="mt-1 text-12px leading-5 text-purple-700">
              {{ pageStats.specialProfile.detected ? '已自动识别特殊站点策略。' : '已命中特殊站点策略。' }}
              {{ pageStats.specialProfile.dynamicScan ? '动态扫描已启用。' : '动态扫描未启用。' }}
              {{ pageStats.specialProfile.conservative ? '使用保守替换密度。' : '' }}
            </p>
          </div>
          <span class="shrink-0 rounded-full bg-white px-2 py-1 text-11px text-purple-700">
            {{ pageStats.specialProfile.kind }}
          </span>
        </div>
      </section>

      <section class="rounded-3 border border-neutral-200 bg-neutral-50 px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              常用开关
            </h2>
            <p class="mt-1 text-12px text-neutral-500">
              最常用的启停、翻译方向和历史保存。
            </p>
          </div>
          <span class="rounded-full px-2 py-1 text-11px" :class="lexiSettings.siteRules.enabled ? 'bg-blue-50 text-blue-600' : 'bg-neutral-200 text-neutral-500'">
            {{ lexiSettings.siteRules.enabled ? '已启用' : '已关闭' }}
          </span>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">启用 Lexi</span>
              <span class="text-11px text-neutral-500">控制当前站点功能</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.siteRules.enabled" label="启用 Lexi" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">替换网页文本</span>
              <span class="text-11px text-neutral-500">将部分中文替换为英文</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.replacement.enabled" label="替换网页文本" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">划词翻译</span>
              <span class="text-11px text-neutral-500">选中文本后快速翻译</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.selection.enabled" label="划词翻译" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">保存历史</span>
              <span class="text-11px text-neutral-500">用于复盘和导出</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.history.enabled" label="保存历史" />
          </div>
        </div>

        <label class="mt-3 block">
          <span class="text-12px text-neutral-500">划词翻译方向</span>
          <select v-model="lexiSettings.selection.translationDirection" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
            <option v-for="item in translationDirections" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>
      </section>

      <section class="rounded-3 border border-neutral-200 bg-white px-3 py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              当前页面自动翻译
            </h2>
            <p class="mt-1 text-12px leading-5 text-neutral-500">
              可按链接、站点或 Regex 启用；滚动停止后的可视区域会最高优先级翻译，远处内容预加载。
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-1 text-11px" :class="pageTranslationStatus.enabled ? 'bg-blue-50 text-blue-600' : 'bg-neutral-100 text-neutral-500'">
            {{ pageTranslationStateLabel }} · {{ pageTranslationScopeLabel }}
          </span>
        </div>

        <div class="mt-3 grid gap-2">
          <label class="block">
            <span class="text-12px text-neutral-500">启用范围</span>
            <select v-model="lexiSettings.selection.pageTranslation.scope" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
              <option v-for="item in pageTranslationScopes" :key="item.value" :value="item.value">
                {{ item.label }} · {{ item.description }}
              </option>
            </select>
          </label>
          <label v-if="lexiSettings.selection.pageTranslation.scope === 'regex'" class="block">
            <span class="text-12px text-neutral-500">URL Regex</span>
            <input v-model.trim="lexiSettings.selection.pageTranslation.regex" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 font-mono text-12px outline-none focus:border-neutral-950" placeholder="^https://docs\\.example\\.com/">
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-12px text-neutral-500">合并请求段数</span>
              <input v-model.number="lexiSettings.selection.pageTranslation.batchSize" type="number" min="1" max="8" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
            </label>
            <label class="block">
              <span class="text-12px text-neutral-500">预加载段数</span>
              <input v-model.number="lexiSettings.selection.pageTranslation.prefetchBlocks" type="number" min="0" max="40" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
            </label>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-3 gap-2">
          <button class="rounded-2 border border-neutral-950 px-2 py-2 text-12px cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" :class="pageTranslationStatus.enabled ? 'bg-white text-neutral-950 hover:bg-neutral-50' : 'bg-neutral-950 text-white'" :disabled="pageTranslationLoading || pageTranslationStatus.enabled" @click="controlPageTranslation('start')">
            启用
          </button>
          <button class="rounded-2 border px-2 py-2 text-12px cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" :class="pageTranslationStatus.enabled ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-200 bg-white text-neutral-950 hover:bg-neutral-50'" :disabled="pageTranslationLoading || !pageTranslationStatus.enabled" @click="controlPageTranslation('stop')">
            停止
          </button>
          <button class="rounded-2 border border-neutral-200 bg-white px-2 py-2 text-12px cursor-pointer hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40" :disabled="pageTranslationLoading" @click="refreshPageTranslationStatus">
            刷新
          </button>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2 text-center">
          <div class="rounded-2 bg-neutral-50 px-2 py-2">
            <div class="text-15px font-700">
              {{ pageTranslationStatus.blocks }}
            </div>
            <div class="text-11px text-neutral-500">
              已缓存段落
            </div>
          </div>
          <div class="rounded-2 bg-neutral-50 px-2 py-2">
            <div class="text-15px font-700">
              {{ pageTranslationStatus.cached ? formatBytes(pageTranslationStatus.bytes) : '—' }}
            </div>
            <div class="text-11px text-neutral-500">
              {{ pageTranslationStorageLabel }}
            </div>
          </div>
        </div>

        <p v-if="pageTranslationMessage" class="mt-2 rounded-2 bg-neutral-50 px-3 py-2 text-12px leading-5 text-neutral-500">
          {{ pageTranslationMessage }}
        </p>
      </section>

      <section class="rounded-3 border border-neutral-200 bg-neutral-50 px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              快速入口
            </h2>
            <p class="mt-1 text-12px text-neutral-500">
              最近翻译 {{ manualRecords.length }} 条，待复盘 {{ dueRecords.length }} 条。
            </p>
          </div>
          <button class="rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="activeTab = 'history'">
            查看历史
          </button>
        </div>
      </section>
    </section>

    <section v-else-if="activeTab === 'advanced'" id="sidepanel-panel-advanced" role="tabpanel" aria-labelledby="sidepanel-tab-advanced" class="mt-4 space-y-4">
      <section class="rounded-3 border border-neutral-200 bg-neutral-50 px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-14px font-700">
              替换参数
            </h2>
            <p class="mt-1 text-12px text-neutral-500">
              控制网页文本替换的强度和数量。
            </p>
          </div>
          <button class="border-0 bg-transparent p-0 text-12px text-neutral-500 underline cursor-pointer" @click="openOptionsPage">
            更多设置
          </button>
        </div>

        <label class="mt-4 block">
          <div class="flex items-center justify-between gap-3">
            <span class="text-12px font-500 text-neutral-600">替换密度</span>
            <span class="rounded-full bg-white px-2 py-1 text-12px text-neutral-700">{{ replacementDensityPercent }}%</span>
          </div>
          <input v-model.number="lexiSettings.replacement.density" type="range" min="0.02" max="0.45" step="0.01" class="mt-2 w-full accent-neutral-950">
          <p class="mt-1 text-11px text-neutral-500">
            建议 10% - 25%，阅读压力过大时可降低。
          </p>
        </label>

        <div class="mt-3 grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-12px text-neutral-500">难度等级 1-5</span>
            <input v-model.number="lexiSettings.replacement.difficulty" type="number" min="1" max="5" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
          </label>
          <label class="block">
            <span class="text-12px text-neutral-500">单页最大替换数</span>
            <input v-model.number="lexiSettings.replacement.maxPerPage" type="number" min="1" max="40" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
          </label>
        </div>
      </section>

      <section class="rounded-3 border border-neutral-200 bg-white px-3 py-3">
        <h2 class="text-14px font-700">
          交互与显示
        </h2>
        <div class="mt-3 space-y-2">
          <div class="flex items-center justify-between gap-3 rounded-2 bg-neutral-50 px-3 py-2 text-12px">
            <span>
              <span class="block font-500">显示状态浮标</span>
              <span class="text-11px text-neutral-500">在页面上展示 Lexi 运行状态</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.ui.showFloatingStatus" label="显示状态浮标" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-neutral-50 px-3 py-2 text-12px">
            <span>
              <span class="block font-500">按修饰键触发划词</span>
              <span class="text-11px text-neutral-500">macOS Command / Windows Ctrl；媒体操作默认 meta+shift</span>
            </span>
            <ToggleSwitch v-model="lexiSettings.selection.requireModifierKey" label="按修饰键触发划词" />
          </div>
        </div>

        <label class="mt-3 block">
          <span class="text-12px text-neutral-500">历史记录上限（条）</span>
          <input v-model.number="lexiSettings.history.maxRecords" type="number" min="50" max="5000" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
        </label>
      </section>
    </section>

    <section v-else id="sidepanel-panel-history" role="tabpanel" aria-labelledby="sidepanel-tab-history" class="mt-4 space-y-5">
      <section class="rounded-3 border border-neutral-200 bg-white px-3 py-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-14px font-700">
            历史与存储
          </h2>
          <span class="text-12px text-neutral-500">{{ storageSize }}</span>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-center">
          <div class="rounded-2 border border-neutral-200 bg-neutral-50 px-2 py-2">
            <div class="text-16px font-700">
              {{ vocabularyRecords.length }}
            </div>
            <div class="text-11px text-neutral-500">
              总记录
            </div>
          </div>
          <div class="rounded-2 border border-neutral-200 bg-neutral-50 px-2 py-2">
            <div class="text-16px font-700">
              {{ manualRecords.length }}
            </div>
            <div class="text-11px text-neutral-500">
              最近翻译
            </div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="exportRecords">
            导出
          </button>
          <label class="rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50">
            导入
            <input type="file" accept="application/json" class="hidden" @change="importRecords">
          </label>
          <button class="rounded-2 border border-red-200 bg-white px-3 py-1.5 text-12px text-red-600 cursor-pointer hover:bg-red-50" @click="clearRecords">
            清空
          </button>
        </div>
        <div class="mt-3 flex items-center gap-2 rounded-2 bg-neutral-50 px-3 py-2">
          <span class="text-12px text-neutral-500">清理超过</span>
          <input v-model.number="cleanupDays" type="number" min="1" max="365" class="h-8 w-18 rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
          <span class="text-12px text-neutral-500">天的记录</span>
          <button class="ml-auto rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="cleanupOldRecords">
            清理
          </button>
        </div>
        <p v-if="importMessage" class="mt-2 text-12px text-neutral-500">
          {{ importMessage }}
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          最近翻译
        </h2>
        <div v-if="manualRecords.length" class="mt-3 space-y-2">
          <article v-for="record in manualRecords" :key="record.id" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="break-words text-13px font-600">
                  {{ record.original }}
                </div>
                <div class="mt-1 break-words text-12px text-neutral-600">
                  {{ record.replacement }}
                </div>
              </div>
              <span class="shrink-0 text-11px text-neutral-500">{{ record.selectedCount }} 次</span>
            </div>
            <p v-if="record.context" class="mt-1 line-clamp-2 text-11px leading-4 text-neutral-500">
              {{ record.context }}
            </p>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
          暂无划词翻译历史。
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          最近替换
        </h2>
        <div v-if="autoRecords.length" class="mt-3 space-y-2">
          <article v-for="record in autoRecords" :key="record.id" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <span class="font-600">{{ record.original }}</span>
              <span class="text-12px text-neutral-600">{{ record.replacement }}</span>
            </div>
            <p v-if="record.context" class="mt-1 line-clamp-2 text-11px leading-4 text-neutral-500">
              {{ record.context }}
            </p>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
          暂无网页替换历史。
        </p>
      </section>

      <section>
        <h2 class="text-14px font-700">
          今日推荐
        </h2>
        <div class="mt-3 space-y-3">
          <article v-for="item in dailyRecommendations" :key="`${item.original}:${item.replacement}`" class="border-b border-neutral-100 pb-3">
            <div class="flex items-baseline justify-between gap-3">
              <div class="text-16px font-700 text-neutral-950">
                {{ item.replacement }}
              </div>
              <div class="text-12px text-neutral-500">
                {{ item.original }}
              </div>
            </div>
            <p class="mt-1 text-13px leading-5 text-neutral-600">
              {{ item.meaning }}
            </p>
            <p class="mt-1 text-12px leading-5 text-neutral-500">
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
            <p class="mt-1 text-12px text-neutral-500">
              今日已完成 {{ reviewedToday }} / {{ reviewGoal }} 个词
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-1 text-11px" :class="reviewGoalCompleted ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-600'">
            {{ reviewGoalCompleted ? '今日完成' : '进行中' }}
          </span>
        </div>

        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
          <div class="h-full rounded-full bg-neutral-950 transition-[width] duration-200" :style="{ width: reviewProgress }" />
        </div>

        <p v-if="reviewMessage" class="mt-3 rounded-2 bg-blue-50 px-3 py-2 text-12px leading-5 text-blue-700" aria-live="polite">
          {{ reviewMessage }}
        </p>

        <div v-if="dueRecords.length" class="mt-3 space-y-3">
          <article v-for="record in dueRecords" :key="record.id" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="break-words font-600">
                  {{ record.replacement }}
                </div>
                <div class="mt-0.5 break-words text-12px text-neutral-600">
                  {{ record.original }}
                </div>
              </div>
              <span class="shrink-0 text-11px text-neutral-500">等级 {{ record.learnedLevel }}</span>
            </div>
            <p v-if="record.meaning" class="mt-2 text-12px leading-5 text-neutral-600">
              {{ record.meaning }}
            </p>
            <div class="mt-3 grid grid-cols-3 gap-2">
              <button type="button" class="rounded-2 border border-red-200 bg-white px-2 py-2 text-12px text-red-700 cursor-pointer hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500" :aria-label="`${record.replacement}：不认识`" @click="reviewRecord(record.id, 'forgot')">
                不认识
              </button>
              <button type="button" class="rounded-2 border border-neutral-300 bg-white px-2 py-2 text-12px text-neutral-700 cursor-pointer hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500" :aria-label="`${record.replacement}：有点模糊`" @click="reviewRecord(record.id, 'hard')">
                模糊
              </button>
              <button type="button" class="rounded-2 border border-neutral-950 bg-neutral-950 px-2 py-2 text-12px text-white cursor-pointer hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950" :aria-label="`${record.replacement}：认识`" @click="reviewRecord(record.id, 'remembered')">
                认识
              </button>
            </div>
          </article>
        </div>
        <p v-else class="mt-3 rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px leading-5 text-neutral-500">
          {{ reviewGoalCompleted ? '今天的复盘目标已完成，可以继续阅读积累新词。' : reviewedToday ? '当前没有更多到期词汇，晚些时候再来看看。' : '暂无到期复盘词汇，继续阅读后会在这里安排复盘。' }}
        </p>
      </section>
    </section>
  </main>
</template>
