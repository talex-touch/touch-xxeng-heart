<script setup lang="ts">
import { computed } from 'vue'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}

const totalRecords = computed(() => vocabularyRecords.value.length)
const enabled = computed({
  get: () => lexiSettings.value.siteRules.enabled,
  set: value => lexiSettings.value.siteRules.enabled = value,
})
</script>

<template>
  <main class="w-[320px] bg-white px-4 py-4 text-neutral-950">
    <header class="flex items-start justify-between gap-3">
      <div>
        <div class="text-15px font-700">
          Lexi
        </div>
        <div class="mt-1 text-12px text-neutral-500">
          网页英语渐进学习
        </div>
      </div>
      <label class="relative inline-flex cursor-pointer items-center">
        <input v-model="enabled" type="checkbox" class="peer sr-only">
        <span class="h-6 w-11 rounded-full bg-neutral-200 transition peer-checked:bg-neutral-950" />
        <span class="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
      </label>
    </header>

    <section class="mt-4 grid grid-cols-3 gap-2 text-center">
      <div class="rounded-2 border border-neutral-200 bg-neutral-50 px-2 py-3">
        <div class="text-18px font-700">
          {{ totalRecords }}
        </div>
        <div class="mt-1 text-11px text-neutral-500">
          词汇
        </div>
      </div>
      <div class="rounded-2 border border-neutral-200 bg-neutral-50 px-2 py-3">
        <div class="text-18px font-700">
          {{ lexiSettings.replacement.difficulty }}
        </div>
        <div class="mt-1 text-11px text-neutral-500">
          难度
        </div>
      </div>
      <div class="rounded-2 border border-neutral-200 bg-neutral-50 px-2 py-3">
        <div class="text-18px font-700">
          {{ lexiSettings.study.dailyGoal }}
        </div>
        <div class="mt-1 text-11px text-neutral-500">
          每日
        </div>
      </div>
    </section>

    <div class="mt-4 flex gap-2">
      <button class="flex-1 rounded-2 border-0 bg-neutral-950 px-3 py-2 text-white cursor-pointer" @click="openOptionsPage">
        配置
      </button>
      <button class="flex-1 rounded-2 border border-neutral-200 bg-white px-3 py-2 text-neutral-700 cursor-pointer" @click="browser.runtime.openOptionsPage()">
        AI 后端
      </button>
    </div>

    <p class="mt-3 text-12px leading-5 text-neutral-500">
      开启后会在当前网页中把少量中文术语替换为英文，并记录划词学习历史。
    </p>
  </main>
</template>
