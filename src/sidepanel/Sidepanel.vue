<script setup lang="ts">
import { sendMessage } from 'webext-bridge/popup'
import { computed, onMounted, ref } from 'vue'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations, normalizeImportedRecord } from '~/logic/vocabularyRecords'
import type { TranslationDirection, VocabularyRecord } from '~/logic/types'

type SidepanelTab = 'common' | 'advanced' | 'history'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

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
  blocks: 0,
  cached: false,
  bytes: 0,
})

const difficulty = computed(() => getProgressDifficulty(
  vocabularyRecords.value,
  lexiSettings.value.replacement.difficulty,
))

const dueRecords = computed(() => getDueRecords(vocabularyRecords.value).slice(0, 8))
const manualRecords = computed(() => vocabularyRecords.value.filter(record => record.source === 'manual').slice(0, 8))
const autoRecords = computed(() => vocabularyRecords.value.filter(record => record.source === 'auto').slice(0, 8))
const storageBytes = computed(() => new Blob([JSON.stringify(vocabularyRecords.value)]).size)
const storageSize = computed(() => {
  return formatBytes(storageBytes.value)
})
const replacementDensityPercent = computed(() => Math.round(lexiSettings.value.replacement.density * 100))
const pageTranslationStateLabel = computed(() => pageTranslationStatus.value.enabled ? '运行中' : '已停止')
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

async function getActiveTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id)
    throw new Error('无法读取当前标签页')

  return tab.id
}

async function refreshPageTranslationStatus() {
  try {
    const tabId = await getActiveTabId()
    const status = await sendMessage('lexi-page-translate-status', {}, { context: 'content-script', tabId })
    pageTranslationStatus.value = status
    pageTranslationMessage.value = status.cached
      ? `已保存 ${status.blocks} 段，下次打开会自动恢复。`
      : '当前页暂无保存的翻译。'
  }
  catch (error) {
    pageTranslationStatus.value = {
      ok: false,
      enabled: false,
      blocks: 0,
      cached: false,
      bytes: 0,
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

function formatBytes(bytes: number) {
  const kb = bytes / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`
}

async function controlPageTranslation(action: 'start' | 'stop') {
  pageTranslationLoading.value = true
  try {
    const tabId = await getActiveTabId()
    const result = await sendMessage(
      action === 'start' ? 'lexi-page-translate-start' : 'lexi-page-translate-stop',
      {},
      { context: 'content-script', tabId },
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
          程序员英语
        </div>
        <div class="mt-1 text-12px text-neutral-500">
          难度 {{ difficulty }} · 已记录 {{ vocabularyRecords.length }} · {{ storageSize }}
        </div>
      </div>
      <button class="shrink-0 rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="openOptionsPage">
        完整配置
      </button>
    </header>

    <nav class="mt-4 grid grid-cols-3 gap-2 rounded-3 bg-neutral-100 p-1" aria-label="侧边栏标签页">
      <button
        v-for="tab in tabItems"
        :key="tab.value"
        type="button"
        class="rounded-2 px-2 py-2 text-center transition cursor-pointer"
        :class="activeTab === tab.value ? 'bg-neutral-950 text-white shadow-sm' : 'text-neutral-500 hover:bg-white hover:text-neutral-950'"
        @click="activeTab = tab.value"
      >
        <span class="block text-12px font-600">{{ tab.label }}</span>
        <span class="mt-0.5 block text-10px opacity-75">{{ tab.description }}</span>
      </button>
    </nav>

    <section v-if="activeTab === 'common'" class="mt-4 space-y-4">
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
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.siteRules.enabled ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.siteRules.enabled" @click="lexiSettings.siteRules.enabled = !lexiSettings.siteRules.enabled">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.siteRules.enabled ? 'left-5' : 'left-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">替换网页文本</span>
              <span class="text-11px text-neutral-500">将部分中文替换为英文</span>
            </span>
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.replacement.enabled ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.replacement.enabled" @click="lexiSettings.replacement.enabled = !lexiSettings.replacement.enabled">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.replacement.enabled ? 'left-5' : 'left-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">划词翻译</span>
              <span class="text-11px text-neutral-500">选中文本后快速翻译</span>
            </span>
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.selection.enabled ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.selection.enabled" @click="lexiSettings.selection.enabled = !lexiSettings.selection.enabled">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.selection.enabled ? 'left-5' : 'left-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-white px-3 py-2 text-12px">
            <span>
              <span class="block font-500">保存历史</span>
              <span class="text-11px text-neutral-500">用于复盘和导出</span>
            </span>
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.history.enabled ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.history.enabled" @click="lexiSettings.history.enabled = !lexiSettings.history.enabled">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.history.enabled ? 'left-5' : 'left-0.5'" />
            </button>
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
              自动保存当前页翻译，下次打开同一链接会读取并恢复。
            </p>
          </div>
          <span class="shrink-0 rounded-full px-2 py-1 text-11px" :class="pageTranslationStatus.enabled ? 'bg-blue-50 text-blue-600' : 'bg-neutral-100 text-neutral-500'">
            {{ pageTranslationStateLabel }}
          </span>
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

    <section v-else-if="activeTab === 'advanced'" class="mt-4 space-y-4">
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
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.ui.showFloatingStatus ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.ui.showFloatingStatus" @click="lexiSettings.ui.showFloatingStatus = !lexiSettings.ui.showFloatingStatus">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.ui.showFloatingStatus ? 'left-5' : 'left-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-2 bg-neutral-50 px-3 py-2 text-12px">
            <span>
              <span class="block font-500">按修饰键触发划词</span>
              <span class="text-11px text-neutral-500">macOS Command / Windows Ctrl</span>
            </span>
            <button type="button" class="relative h-6 w-11 shrink-0 rounded-full transition" :class="lexiSettings.selection.requireModifierKey ? 'bg-neutral-950' : 'bg-neutral-200'" :aria-pressed="lexiSettings.selection.requireModifierKey" @click="lexiSettings.selection.requireModifierKey = !lexiSettings.selection.requireModifierKey">
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition" :class="lexiSettings.selection.requireModifierKey ? 'left-5' : 'left-0.5'" />
            </button>
          </div>
        </div>

        <label class="mt-3 block">
          <span class="text-12px text-neutral-500">历史记录上限（条）</span>
          <input v-model.number="lexiSettings.history.maxRecords" type="number" min="50" max="5000" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
        </label>
      </section>
    </section>

    <section v-else class="mt-4 space-y-5">
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

      <section>
        <h2 class="text-14px font-700">
          待复盘
        </h2>
        <div v-if="dueRecords.length" class="mt-3 space-y-2">
          <div v-for="record in dueRecords" :key="record.id" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-2">
            <div class="flex items-center justify-between gap-3">
              <span class="font-600">{{ record.replacement }}</span>
              <span class="text-12px text-neutral-500">{{ record.original }}</span>
            </div>
            <div class="mt-1 text-12px text-neutral-500">
              见过 {{ record.seenCount }} 次 · 手动记录 {{ record.selectedCount }} 次
            </div>
          </div>
        </div>
        <p v-else class="mt-3 rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
          暂无到期复盘词汇。
        </p>
      </section>
    </section>
  </main>
</template>
