<script setup lang="ts">
import { computed } from 'vue'
import { openOptionsPage } from '~/logic/browserActions'
import { resolveReplacementLevel } from '~/logic/replacementLevels'
import { festivalThemeDetails, resolveFestivalTheme } from '~/logic/festivalTheme'
import { lexiSettings, vocabularyRecords } from '~/logic/storage'

const appVersion = __VERSION__

const totalRecords = computed(() => vocabularyRecords.value.length)
const activeLevel = computed(() => resolveReplacementLevel(lexiSettings.value.replacement.level))
const festivalTheme = computed(() => resolveFestivalTheme(undefined, lexiSettings.value.ui.festivalTheme))
const festivalThemeDetail = computed(() => festivalThemeDetails[festivalTheme.value])
</script>

<template>
  <main
    class="w-[320px] bg-white px-4 py-4 text-neutral-950"
    :class="festivalTheme === 'spring' ? 'bg-emerald-50' : festivalTheme === 'valentine' ? 'bg-rose-50' : festivalTheme === 'halloween' ? 'bg-orange-50' : ''"
    :data-lexi-festival="festivalTheme"
  >
    <header class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-1.5">
          <div class="text-15px font-700">
            Lexi
          </div>
          <span v-if="festivalThemeDetail.mark" class="rounded-full px-1.5 py-0.5 text-10px font-700" :class="festivalTheme === 'spring' ? 'bg-emerald-700 text-white' : festivalTheme === 'valentine' ? 'bg-rose-700 text-white' : 'bg-orange-700 text-white'">{{ festivalThemeDetail.mark }}</span>
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
          {{ activeLevel.level }}
        </div>
        <div class="mt-1 truncate text-11px text-neutral-500">
          等级 · {{ activeLevel.shortLabel }}
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
