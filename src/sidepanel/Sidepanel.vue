<script setup lang="ts">
import { computed } from 'vue'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'
import { getDueRecords, getProgressDifficulty, getTodayRecommendations } from '~/logic/vocabularyRecords'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

const difficulty = computed(() => getProgressDifficulty(
  vocabularyRecords.value,
  lexiSettings.value.replacement.difficulty,
))

const dueRecords = computed(() => getDueRecords(vocabularyRecords.value).slice(0, 8))
const dailyRecommendations = computed(() => getTodayRecommendations(
  vocabularyRecords.value,
  lexiSettings.value.study.dailyGoal,
  difficulty.value,
))
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
