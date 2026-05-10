<script setup lang="ts">
import { computed } from 'vue'
import { featureLabels } from '~/logic/defaults'
import { formatDomainList, parseDomainList } from '~/logic/siteRules'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import type { FeatureScene } from '~/logic/types'

const scenes: FeatureScene[] = ['replacement', 'selection', 'daily']

const domainText = computed({
  get: () => formatDomainList(lexiSettings.value.siteRules.domains),
  set: value => lexiSettings.value.siteRules.domains = parseDomainList(value),
})
</script>

<template>
  <main class="min-h-screen bg-neutral-50 text-neutral-950">
    <div class="mx-auto max-w-5xl px-6 py-8">
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

      <section class="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
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
        </div>

        <div class="rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
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
          <label class="mt-4 block">
            <span class="text-13px font-500">每日推荐数量</span>
            <input v-model.number="lexiSettings.study.dailyGoal" type="number" min="1" max="30" class="mt-2 h-10 w-full rounded-2 border border-neutral-300 px-3 text-14px outline-none focus:border-neutral-950">
          </label>
        </div>
      </section>

      <section class="mt-5 rounded-2 border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 class="text-16px font-600">
          AI 场景配置
        </h2>
        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          <div v-for="scene in scenes" :key="scene" class="rounded-2 border border-neutral-200 p-4">
            <label class="flex items-center justify-between">
              <span class="text-14px font-600">{{ featureLabels[scene] }}</span>
              <input v-model="lexiSettings.ai[scene].enabled" type="checkbox" class="h-5 w-5">
            </label>
            <label class="mt-4 block">
              <span class="text-12px font-500 text-neutral-600">Endpoint</span>
              <input v-model="lexiSettings.ai[scene].endpoint" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="https://api.example.com/translate">
            </label>
            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-600">Model</span>
              <input v-model="lexiSettings.ai[scene].model" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="gpt-4.1-mini">
            </label>
            <label class="mt-3 block">
              <span class="text-12px font-500 text-neutral-600">API Key</span>
              <input v-model="lexiSettings.ai[scene].apiKey" type="password" class="mt-1 h-10 w-full rounded-2 border border-neutral-300 px-3 text-13px outline-none focus:border-neutral-950" placeholder="Bearer token">
            </label>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
