<script setup lang="ts">
import { sendMessage } from 'webext-bridge/popup'
import { computed, onMounted, ref } from 'vue'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations } from '~/logic/vocabularyRecords'
import type { TranslationDirection, VocabularyRecord } from '~/logic/types'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

const translationDirections: Array<{ value: TranslationDirection, label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'zh-to-en', label: '中译英' },
  { value: 'en-to-zh', label: '英译中' },
]
const cleanupDays = ref(30)
const importMessage = ref('')
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
    const text = await input.files[0].text()
    const records = JSON.parse(text) as VocabularyRecord[]
    if (!Array.isArray(records))
      throw new Error('导入文件不是数组')

    const merged = new Map(vocabularyRecords.value.map(record => [record.id, record]))
    for (const record of records) {
      if (record?.id && record?.original && record?.replacement)
        merged.set(record.id, record)
    }
    vocabularyRecords.value = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    importMessage.value = `已导入 ${records.length} 条`
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
          难度 {{ difficulty }} · 已记录 {{ vocabularyRecords.length }}
        </div>
      </div>
      <button class="rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="openOptionsPage">
        配置
      </button>
    </header>

    <section class="mt-4 rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-14px font-600">
          快速配置
        </h2>
        <button class="border-0 bg-transparent p-0 text-12px text-neutral-500 underline cursor-pointer" @click="openOptionsPage">
          完整配置
        </button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <label class="flex items-center justify-between gap-2 rounded-2 bg-white px-3 py-2 text-12px">
          <span>总开关</span>
          <input v-model="lexiSettings.siteRules.enabled" type="checkbox" class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between gap-2 rounded-2 bg-white px-3 py-2 text-12px">
          <span>网页替换</span>
          <input v-model="lexiSettings.replacement.enabled" type="checkbox" class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between gap-2 rounded-2 bg-white px-3 py-2 text-12px">
          <span>划词翻译</span>
          <input v-model="lexiSettings.selection.enabled" type="checkbox" class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between gap-2 rounded-2 bg-white px-3 py-2 text-12px">
          <span>状态浮标</span>
          <input v-model="lexiSettings.ui.showFloatingStatus" type="checkbox" class="h-4 w-4">
        </label>
        <label class="flex items-center justify-between gap-2 rounded-2 bg-white px-3 py-2 text-12px">
          <span>保存历史</span>
          <input v-model="lexiSettings.history.enabled" type="checkbox" class="h-4 w-4">
        </label>
      </div>
      <label class="mt-3 block">
        <span class="text-12px text-neutral-500">翻译方向</span>
        <select v-model="lexiSettings.selection.translationDirection" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
          <option v-for="item in translationDirections" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </label>
      <label class="mt-3 block">
        <span class="text-12px text-neutral-500">替换密度 {{ Math.round(lexiSettings.replacement.density * 100) }}%</span>
        <input v-model.number="lexiSettings.replacement.density" type="range" min="0.02" max="0.25" step="0.01" class="mt-1 w-full accent-neutral-950">
      </label>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-12px text-neutral-500">难度</span>
          <input v-model.number="lexiSettings.replacement.difficulty" type="number" min="1" max="5" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
        </label>
        <label class="block">
          <span class="text-12px text-neutral-500">单页上限</span>
          <input v-model.number="lexiSettings.replacement.maxPerPage" type="number" min="1" max="40" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
        </label>
      </div>
      <label class="mt-3 block">
        <span class="text-12px text-neutral-500">最多保存记录</span>
        <input v-model.number="lexiSettings.history.maxRecords" type="number" min="50" max="5000" class="mt-1 h-9 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
      </label>
    </section>

    <section class="mt-4 border border-neutral-200 bg-white px-3 py-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-14px font-600">
            当前页面自动翻译
          </h2>
          <p class="mt-1 text-12px text-neutral-500">
            自动保存当前页翻译，下次打开同一链接会读取并恢复。
          </p>
        </div>
        <span class="shrink-0 text-12px" :class="pageTranslationStatus.enabled ? 'text-blue-600' : 'text-neutral-500'">
          {{ pageTranslationStatus.enabled ? '启用' : '停止' }}
        </span>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-2">
        <button class="border border-neutral-950 bg-neutral-950 px-2 py-1.5 text-12px text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" :disabled="pageTranslationLoading" @click="controlPageTranslation('start')">
          启用
        </button>
        <button class="border border-neutral-200 bg-white px-2 py-1.5 text-12px cursor-pointer hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="pageTranslationLoading" @click="controlPageTranslation('stop')">
          停止
        </button>
        <button class="border border-neutral-200 bg-white px-2 py-1.5 text-12px cursor-pointer hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="pageTranslationLoading" @click="refreshPageTranslationStatus">
          刷新
        </button>
      </div>
      <div class="mt-3 flex items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-12px text-neutral-500">
        <span>已缓存 {{ pageTranslationStatus.blocks }} 段</span>
        <span>{{ pageTranslationStatus.cached ? `可恢复 · ${formatBytes(pageTranslationStatus.bytes)}` : '未保存' }}</span>
      </div>
      <p v-if="pageTranslationMessage" class="mt-2 text-12px leading-5 text-neutral-500">
        {{ pageTranslationMessage }}
      </p>
    </section>

    <section class="mt-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-14px font-600">
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
        <button class="rounded-2 border border-neutral-200 bg-white px-3 py-1.5 text-12px cursor-pointer hover:bg-neutral-50" @click="cleanupOldRecords">
          清理 {{ cleanupDays }} 天前
        </button>
        <button class="rounded-2 border border-red-200 bg-white px-3 py-1.5 text-12px text-red-600 cursor-pointer hover:bg-red-50" @click="clearRecords">
          清空
        </button>
      </div>
      <input v-model.number="cleanupDays" type="number" min="1" max="365" class="mt-2 h-8 w-full rounded-2 border border-neutral-200 bg-white px-2 text-12px outline-none focus:border-neutral-950">
      <p v-if="importMessage" class="mt-2 text-12px text-neutral-500">
        {{ importMessage }}
      </p>
    </section>

    <section class="mt-5">
      <h2 class="text-14px font-600">
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

    <section class="mt-5">
      <h2 class="text-14px font-600">
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

    <section class="mt-5">
      <h2 class="text-14px font-600">
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

    <section class="mt-6">
      <h2 class="text-14px font-600">
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
  </main>
</template>
