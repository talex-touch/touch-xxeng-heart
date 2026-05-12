<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { defaultSettings, featureLabels } from '~/logic/defaults'
import { testAiScene } from '~/logic/aiClient'
import { formatDomainList, normalizeSiteRuleDomain, parseDomainList } from '~/logic/siteRules'
import { aiCallLogs, lexiSettings, pageVisitLogs, vocabularyRecords } from '~/logic/storage'
import { summarizeByDay } from '~/logic/analytics'
import type { AiTestResult, FeatureScene, SiteSceneRule, SpecialSiteProfile, TranslationDirection } from '~/logic/types'

type OptionsTab = 'settings' | 'special' | 'vocabulary' | 'ai' | 'diagnostics' | 'about'

const scenes: FeatureScene[] = ['replacement', 'selection', 'daily']
const tabs: Array<{ id: OptionsTab, label: string }> = [
  { id: 'settings', label: '基础设置' },
  { id: 'special', label: '特殊场景' },
  { id: 'vocabulary', label: '词库记录' },
  { id: 'ai', label: 'AI 场景' },
  { id: 'diagnostics', label: '诊断记录' },
  { id: 'about', label: '关于' },
]
const translationDirections: Array<{ value: TranslationDirection, label: string }> = [
  { value: 'auto', label: '自动判断' },
  { value: 'zh-to-en', label: '中译英' },
  { value: 'en-to-zh', label: '英译中' },
]

const activeTab = ref<OptionsTab>('settings')
const newSceneRuleDomain = ref('')
const vocabularySearchQuery = ref('')
const domainText = computed({
  get: () => formatDomainList(lexiSettings.value.siteRules.domains),
  set: value => lexiSettings.value.siteRules.domains = parseDomainList(value),
})

const visitTrend = computed(() => summarizeByDay(pageVisitLogs.value))
const aiTrend = computed(() => summarizeByDay(aiCallLogs.value))
const maxVisitTrend = computed(() => Math.max(1, ...visitTrend.value.map(item => item.value)))
const maxAiTrend = computed(() => Math.max(1, ...aiTrend.value.map(item => item.value)))
const recentAiLogs = computed(() => aiCallLogs.value)
const aiTokenTrend = computed(() => summarizeTokensByDay(aiCallLogs.value))
const maxAiTokenTrend = computed(() => Math.max(1, ...aiTokenTrend.value.map(item => item.value)))
const totalAiTokens = computed(() => aiCallLogs.value.reduce((sum, log) => sum + (log.totalTokens ?? 0), 0))
const aiSceneTokenStats = computed(() => scenes.map(scene => ({
  scene,
  calls: aiCallLogs.value.filter(log => log.scene === scene).length,
  tokens: aiCallLogs.value
    .filter(log => log.scene === scene)
    .reduce((sum, log) => sum + (log.totalTokens ?? 0), 0),
})))
const recentPageVisits = computed(() => pageVisitLogs.value)
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
const storageStats = computed(() => {
  const items = [
    { label: '词库', bytes: estimateStorageBytes(vocabularyRecords.value) },
    { label: 'AI 日志', bytes: estimateStorageBytes(aiCallLogs.value) },
    { label: '访问日志', bytes: estimateStorageBytes(pageVisitLogs.value) },
    { label: '设置', bytes: estimateStorageBytes(lexiSettings.value) },
  ]

  return {
    items,
    total: items.reduce((sum, item) => sum + item.bytes, 0),
  }
})
const testingScenes = ref<Partial<Record<FeatureScene, boolean>>>({})
const sceneTestResults = ref<Partial<Record<FeatureScene, string>>>({})
const sceneTestDetails = ref<Partial<Record<FeatureScene, AiTestResult>>>({})

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

function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
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

function barHeight(value: number, max: number) {
  return `${Math.max(4, Math.round((value / max) * 112))}px`
}

function estimateStorageBytes(value: unknown) {
  return new Blob([JSON.stringify(value)]).size
}

function formatBytes(bytes: number) {
  const kb = bytes / 1024
  if (kb > 1024)
    return `${(kb / 1024).toFixed(2)} MB`

  return `${kb.toFixed(1)} KB`
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
  const result = new Map<string, number>()
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - index)
    result.set(formatter.format(date), 0)
  }

  for (const log of logs) {
    const key = formatter.format(new Date(log.createdAt))
    if (result.has(key))
      result.set(key, (result.get(key) ?? 0) + (log.totalTokens ?? 0))
  }

  return Array.from(result.entries()).map(([label, value]) => ({ label, value }))
}

function formatTestRequest(result: AiTestResult) {
  return JSON.stringify(result.request, null, 2)
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
  }
  lexiSettings.value.siteRules.sceneRules = [rule, ...lexiSettings.value.siteRules.sceneRules]
  newSceneRuleDomain.value = ''
}

function removeSceneRule(index: number) {
  lexiSettings.value.siteRules.sceneRules = lexiSettings.value.siteRules.sceneRules.filter((_, current) => current !== index)
}
</script>

<template>
  <main class="min-h-screen bg-neutral-50 text-neutral-950">
    <div class="mx-auto max-w-6xl px-6 py-8">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <div class="text-24px font-700 tracking-0">
            Lexi
          </div>
          <p class="mt-2 max-w-2xl text-14px leading-6 text-neutral-600">
            配置网页启用范围、替换密度、渐进难度，以及不同场景的 AI 后端。
          </p>
        </div>
        <div class="text-right">
          <div class="text-24px font-700">
            {{ vocabularyRecords.length }}
          </div>
          <div class="text-12px text-neutral-500">
            已记录词汇
          </div>
        </div>
      </header>

      <nav class="mb-5 overflow-x-auto rounded-2 border border-neutral-200 bg-white p-1 shadow-sm">
        <div class="flex min-w-max gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="rounded-2 px-4 py-2 text-14px font-500 cursor-pointer transition-colors"
            :class="activeTab === tab.id ? 'bg-neutral-950 text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
      </nav>

      <section v-if="activeTab === 'settings'" class="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div class="max-h-[34rem] overflow-y-auto rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="min-h-0">
            <h2 class="text-16px font-600">
              网页启用范围
            </h2>
            <label class="mt-4 flex items-center justify-between gap-3">
              <span>
                <span class="block text-14px font-500">总开关</span>
                <span class="text-12px text-neutral-500">关闭后不替换、不划词翻译。</span>
              </span>
              <input v-model="lexiSettings.siteRules.enabled" type="checkbox" class="h-5 w-5">
            </label>

            <div class="mt-5">
              <label class="text-13px font-500">匹配模式</label>
              <select v-model="lexiSettings.siteRules.mode" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 bg-white px-3 text-14px outline-none focus:border-neutral-950">
                <option value="all">
                  全部网页
                </option>
                <option value="allowlist">
                  仅白名单
                </option>
                <option value="blocklist">
                  排除黑名单
                </option>
              </select>
            </div>

            <div class="mt-5">
              <label class="text-13px font-500">域名列表</label>
              <textarea
                v-model="domainText"
                class="mt-2 min-h-28 w-full resize-y rounded-2 border border-neutral-300 px-3 py-2 text-14px leading-5 outline-none focus:border-neutral-950"
                placeholder="example.com&#10;docs.example.com"
              />
            </div>

            <div class="mt-5 border-t border-neutral-100 pt-5">
              <label class="text-13px font-500">域名场景规则</label>
              <div class="mt-2 flex gap-2">
                <input v-model="newSceneRuleDomain" class="h-10 min-w-0 flex-1 rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="docs.example.com">
                <button class="rounded-2 border border-neutral-200 bg-white px-3 text-12px cursor-pointer hover:bg-neutral-50" @click="addSceneRule">
                  添加
                </button>
              </div>
              <div class="mt-3 space-y-2">
                <div v-for="(rule, index) in lexiSettings.siteRules.sceneRules" :key="rule.domain" class="rounded-2 border border-neutral-200 px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <input v-model="rule.domain" class="min-w-0 flex-1 border-0 bg-transparent text-13px font-600 outline-none">
                    <button class="border-0 bg-transparent text-12px text-neutral-500 cursor-pointer hover:text-red-600" @click="removeSceneRule(index)">
                      删除
                    </button>
                  </div>
                  <div class="mt-2 grid grid-cols-3 gap-2 text-12px text-neutral-600">
                    <label class="flex items-center gap-1">
                      <input v-model="rule.replacement" type="checkbox">
                      <span>替换</span>
                    </label>
                    <label class="flex items-center gap-1">
                      <input v-model="rule.selection" type="checkbox">
                      <span>划词</span>
                    </label>
                    <label class="flex items-center gap-1">
                      <input v-model="rule.daily" type="checkbox">
                      <span>每日</span>
                    </label>
                  </div>
                </div>
                <p v-if="!lexiSettings.siteRules.sceneRules.length" class="rounded-2 bg-neutral-50 px-3 py-2 text-12px text-neutral-500">
                  暂无精细规则，默认按总开关和匹配模式启用全部场景。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="max-h-[34rem] overflow-y-auto rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="min-h-0">
            <h2 class="text-16px font-600">
              替换与学习节奏
            </h2>
            <label class="mt-4 flex items-center justify-between">
              <span class="text-14px font-500">自动替换词汇</span>
              <input v-model="lexiSettings.replacement.enabled" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">替换密度 {{ Math.round(lexiSettings.replacement.density * 100) }}%</span>
              <input v-model.number="lexiSettings.replacement.density" type="range" min="0.04" max="0.45" step="0.01" class="mt-2 w-full accent-neutral-950">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">基础难度 {{ lexiSettings.replacement.difficulty }}</span>
              <input v-model.number="lexiSettings.replacement.difficulty" type="range" min="1" max="5" step="1" class="mt-2 w-full accent-neutral-950">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">单页最多替换</span>
              <input v-model.number="lexiSettings.replacement.maxPerPage" type="number" min="1" max="80" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 px-3 text-14px outline-none focus:border-neutral-950">
            </label>
            <label class="mt-4 flex items-center justify-between">
              <span class="text-14px font-500">划词自动翻译</span>
              <input v-model="lexiSettings.selection.autoTranslate" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 flex items-center justify-between gap-4">
              <span>
                <span class="block text-14px font-500">按住修饰键触发划词翻译</span>
                <span class="text-12px text-neutral-500">macOS 使用 Command，Windows/Linux 使用 Ctrl。</span>
              </span>
              <input v-model="lexiSettings.selection.requireModifierKey" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">划词翻译方向</span>
              <select v-model="lexiSettings.selection.translationDirection" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 bg-white px-3 text-14px outline-none focus:border-neutral-950">
                <option v-for="item in translationDirections" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </label>
            <label class="mt-4 flex items-center justify-between">
              <span>
                <span class="block text-14px font-500">右下角状态浮标</span>
                <span class="text-12px text-neutral-500">关闭后不显示“Lexi 已启用”。</span>
              </span>
              <input v-model="lexiSettings.ui.showFloatingStatus" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">快捷对话键</span>
              <input v-model.trim="lexiSettings.ui.dialogShortcut" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 px-3 text-14px outline-none focus:border-neutral-950" placeholder="mod+k">
              <span class="mt-1 block text-12px text-neutral-500">支持 mod+k、ctrl+k、meta+k、alt+l、shift+mod+k。</span>
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">每日推荐数量</span>
              <input v-model.number="lexiSettings.study.dailyGoal" type="number" min="1" max="30" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 px-3 text-14px outline-none focus:border-neutral-950">
            </label>
            <label class="mt-4 block">
              <span class="text-13px font-500">自定义样式 CSS</span>
              <textarea
                v-model="lexiSettings.ui.customCss"
                class="mt-2 min-h-36 w-full resize-y rounded-2 border border-neutral-300 px-3 py-2 font-mono text-12px leading-5 outline-none focus:border-neutral-950"
                placeholder=".lexi-selection-translation { background: #fff; }&#10;.lexi-token { color: #2563eb; }"
              />
            </label>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'special'" class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-16px font-600">
              特殊场景处理
            </h2>
            <p class="mt-1 max-w-2xl text-12px leading-5 text-neutral-500">
              信息流站点可开启动态扫描并降低替换密度；学习、考试类站点默认关闭，避免影响答题或课堂页面。
            </p>
          </div>
          <button class="rounded-2 border border-neutral-200 bg-white px-3 py-2 text-12px cursor-pointer hover:bg-neutral-50" @click="addSpecialProfile">
            添加场景
          </button>
        </div>

        <div class="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,28rem),1fr))] gap-4">
          <article v-for="profile in lexiSettings.siteRules.specialProfiles" :key="profile.id" class="min-w-0 rounded-2 border border-neutral-200 p-4">
            <div class="flex items-start justify-between gap-3">
              <label class="min-w-0 flex-1">
                <span class="text-12px font-500 text-neutral-500">名称</span>
                <input v-model="profile.label" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-14px font-600 outline-none focus:border-neutral-950">
              </label>
              <button v-if="profile.kind === 'custom'" class="mt-6 border-0 bg-transparent text-12px text-red-600 cursor-pointer" @click="removeSpecialProfile(profile.id)">
                删除
              </button>
            </div>

            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-500">域名</span>
              <textarea
                :value="formatSpecialDomains(profile)"
                class="mt-1 min-h-20 w-full resize-y rounded-2 border border-neutral-300 px-3 py-2 text-13px leading-5 outline-none focus:border-neutral-950"
                placeholder="x.com&#10;twitter.com"
                @input="updateSpecialDomains(profile, ($event.target as HTMLTextAreaElement).value)"
              />
            </label>

            <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2 text-12px">
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">启用此场景</span>
                <input v-model="profile.enabled" type="checkbox">
              </label>
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">考试安全</span>
                <input v-model="profile.examSafe" type="checkbox">
              </label>
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">网页替换</span>
                <input v-model="profile.replacement" type="checkbox">
              </label>
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">划词翻译</span>
                <input v-model="profile.selection" type="checkbox">
              </label>
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">动态扫描</span>
                <input v-model="profile.dynamicScan" type="checkbox">
              </label>
              <label class="flex min-w-0 items-center justify-between gap-2 rounded-2 bg-neutral-50 px-3 py-2">
                <span class="min-w-0 break-words">保守替换</span>
                <input v-model="profile.conservative" type="checkbox">
              </label>
            </div>

            <div class="mt-3 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-3">
              <label class="min-w-0 block">
                <span class="text-12px text-neutral-500">单页上限</span>
                <input v-model.number="profile.maxPerPage" type="number" min="0" max="20" class="mt-1 h-9 w-full rounded-2 border border-neutral-300 px-2 text-13px outline-none focus:border-neutral-950">
              </label>
              <label class="min-w-0 block">
                <span class="text-12px text-neutral-500">密度 {{ Math.round((profile.density ?? 0) * 100) }}%</span>
                <input v-model.number="profile.density" type="range" min="0" max="0.2" step="0.01" class="mt-2 w-full accent-neutral-950">
              </label>
            </div>
          </article>
        </div>
      </section>

      <section v-else-if="activeTab === 'vocabulary'" class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-16px font-600">
              词库记录
            </h2>
            <p class="mt-1 text-12px text-neutral-500">
              AI 补充、网页替换和划词翻译都会进入本地记录，后续可用于快速替换。
            </p>
          </div>
          <span class="text-12px text-neutral-500">{{ filteredVocabularyRecords.length }} / {{ vocabularyRecords.length }} 条 · {{ formatBytes(storageStats.items[0].bytes) }}</span>
        </div>
        <div class="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            v-model.trim="vocabularySearchQuery"
            class="h-10 w-full rounded-1 border border-neutral-300 bg-white px-3 text-14px outline-none focus:border-neutral-950"
            placeholder="搜索原文、翻译、解释、上下文、标签、页面标题或 URL"
          >
          <button class="rounded-1 border border-neutral-200 bg-white px-3 text-12px cursor-pointer hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!vocabularySearchQuery" @click="vocabularySearchQuery = ''">
            清空
          </button>
        </div>
        <div class="mt-4 rounded-2 border border-neutral-200 bg-neutral-50 p-4">
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
              词库 {{ formatBytes(storageStats.items[0].bytes) }}
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

      <section v-else-if="activeTab === 'ai'" class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-16px font-600">
              AI 场景配置
            </h2>
            <p class="mt-1 text-12px leading-5 text-neutral-500">
              场景留空时继承全局连接；需要不同模型或后端时再单独覆盖。
            </p>
          </div>
        </div>

        <div class="mt-4 rounded-2 border border-neutral-200 p-4">
          <h3 class="text-14px font-600">
            全局连接
          </h3>
          <div class="mt-3 grid gap-3 lg:grid-cols-3">
            <label class="block">
              <span class="text-12px font-500 text-neutral-600">Endpoint</span>
              <input v-model="lexiSettings.ai.global.endpoint" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="https://api.example.com/v1">
            </label>
            <label class="block">
              <span class="text-12px font-500 text-neutral-600">Model</span>
              <input v-model="lexiSettings.ai.global.model" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="gpt-4.1-mini">
            </label>
            <label class="block">
              <span class="text-12px font-500 text-neutral-600">API Key</span>
              <input v-model="lexiSettings.ai.global.apiKey" type="password" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="Bearer token">
            </label>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          <div v-for="scene in scenes" :key="scene" class="max-h-[42rem] overflow-y-auto rounded-2 border border-neutral-200 p-4">
            <label class="flex items-center justify-between">
              <span class="text-14px font-600">{{ featureLabels[scene] }}</span>
              <input v-model="lexiSettings.ai[scene].enabled" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 block">
              <span class="text-12px font-500 text-neutral-600">Endpoint 覆盖</span>
              <input v-model="lexiSettings.ai[scene].endpoint" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="留空继承全局">
            </label>
            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-600">Model 覆盖</span>
              <input v-model="lexiSettings.ai[scene].model" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="留空继承全局">
            </label>
            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-600">API Key 覆盖</span>
              <input v-model="lexiSettings.ai[scene].apiKey" type="password" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="留空继承全局">
            </label>
            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-600">提示词</span>
              <textarea
                v-model="lexiSettings.ai[scene].prompt"
                class="mt-1 min-h-28 w-full resize-y rounded-2 border border-neutral-300 px-3 py-2 text-13px leading-5 outline-none focus:border-neutral-950"
              />
            </label>
            <div class="mt-4 flex items-center gap-3">
              <button class="rounded-2 border border-neutral-200 bg-white px-3 py-2 text-12px cursor-pointer hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="testingScenes[scene]" @click="testScene(scene)">
                {{ testingScenes[scene] ? '测试中' : '测试' }}
              </button>
              <span v-if="sceneTestResults[scene]" class="truncate text-12px" :class="sceneTestResults[scene] === '测试成功' ? 'text-emerald-600' : 'text-red-600'">
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

      <section v-else-if="activeTab === 'diagnostics'" class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="flex h-[44rem] min-w-0 flex-col overflow-hidden rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
          <div class="flex shrink-0 items-center justify-between gap-3">
            <h2 class="text-16px font-600">
              最近 AI 调用
            </h2>
            <span class="text-12px text-neutral-500">{{ aiCallLogs.length }} 条</span>
          </div>
          <div class="mt-4 h-40 shrink-0 overflow-x-auto border-b border-neutral-100 pb-3">
            <div class="flex h-full min-w-96 items-end gap-2">
              <div v-for="item in aiTrend" :key="item.label" class="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div class="w-full rounded-1 bg-neutral-900" :style="{ height: barHeight(item.value, maxAiTrend) }" />
                <span class="shrink-0 text-10px text-neutral-500">{{ item.label }}</span>
              </div>
            </div>
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
          <div class="mt-3 h-24 shrink-0 overflow-x-auto border-b border-neutral-100 pb-3">
            <div class="flex h-full min-w-96 items-end gap-2">
              <div v-for="item in aiTokenTrend" :key="item.label" class="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div class="w-full rounded-1 bg-blue-600" :style="{ height: barHeight(item.value, maxAiTokenTrend) }" />
                <span class="shrink-0 text-10px text-neutral-500">{{ item.label }}</span>
              </div>
            </div>
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
                {{ formatBytes(storageStats.items[0].bytes) }}
              </div>
            </div>
            <div v-for="item in storageStats.items.slice(1)" :key="item.label" class="rounded-2 bg-neutral-50 px-3 py-2">
              <div class="text-neutral-500">
                {{ item.label }}
              </div>
              <div class="mt-1 font-700">
                {{ formatBytes(item.bytes) }}
              </div>
            </div>
          </div>
          <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div v-for="log in recentAiLogs" :key="log.id" class="rounded-2 border border-neutral-200 px-3 py-2">
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
            <p v-if="!recentAiLogs.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
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
          <div class="mt-4 h-40 shrink-0 overflow-x-auto border-b border-neutral-100 pb-3">
            <div class="flex h-full min-w-96 items-end gap-2">
              <div v-for="item in visitTrend" :key="item.label" class="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div class="w-full rounded-1 bg-neutral-900" :style="{ height: barHeight(item.value, maxVisitTrend) }" />
                <span class="shrink-0 text-10px text-neutral-500">{{ item.label }}</span>
              </div>
            </div>
          </div>
          <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div v-for="visit in recentPageVisits" :key="visit.id" class="rounded-2 border border-neutral-200 px-3 py-2">
              <div class="break-words text-13px font-600 leading-5">
                {{ visit.title || visit.host }}
              </div>
              <div class="mt-1 break-words text-12px leading-5 text-neutral-500">
                {{ formatTime(visit.createdAt) }} · {{ visit.host }} · 替换 {{ visit.replacements }}
              </div>
            </div>
            <p v-if="!recentPageVisits.length" class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
              暂无网页访问记录。
            </p>
          </div>
        </div>
      </section>

      <section v-else class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 class="text-16px font-600">
          关于 Lexi
        </h2>
        <div class="mt-4 space-y-3 text-14px leading-6 text-neutral-700">
          <p>
            Lexi 由 TalexDreamSoul 开发。
          </p>
          <p>
            特别感谢 XinYu Wu 101-010-000 / XinRong Liu TomHolland。
          </p>
        </div>
      </section>
    </div>
  </main>
</template>
