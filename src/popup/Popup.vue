<script setup lang="ts">
import { computed } from 'vue'
import { openOptionsPage } from '~/logic/browserActions'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'

const appVersion = __VERSION__

const totalRecords = computed(() => vocabularyRecords.value.length)
</script>

<template>
  <main class="w-[320px] bg-white px-4 py-4 text-neutral-950">
    <header class="flex items-start justify-between gap-3">
      <div>
        <div class="text-15px font-700">
          Lexi
        </div>
        <div class="mt-1 text-12px text-neutral-500">
          网页英语渐进学习 · v{{ appVersion }}
        </div>
      </div>
      <ToggleSwitch v-model="lexiSettings.siteRules.enabled" label="Lexi 总开关" />
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

    <button
      class="mt-4 w-full rounded-2 border-0 bg-neutral-950 px-3 py-2 text-white cursor-pointer"
      @click="openOptionsPage"
    >
      打开设置
    </button>

    <p class="mt-3 text-12px leading-5 text-neutral-500">
      开启后会在当前网页中把少量中文术语替换为英文，并记录划词学习历史。GitHub 仓库页会显示 Lexi 速读。
    </p>
  </main>
</template>
