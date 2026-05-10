<script setup lang="ts">
import 'uno.css'
import { onMounted, onUnmounted, ref } from 'vue'
import { startPageEnhancer } from '../pageEnhancer'
import type { PageStats } from '../pageEnhancer'
import type { SelectionTranslation } from '~/logic/types'

const stats = ref<PageStats>({
  replacements: 0,
  records: 0,
  enabled: false,
})
const translation = ref<SelectionTranslation>()
const translationPosition = ref({ x: 0, y: 0 })
let stopEnhancer: (() => void) | undefined
let hideTimer: number | undefined

function showTranslation(value: SelectionTranslation, position: { x: number, y: number }) {
  translation.value = value
  translationPosition.value = position

  if (hideTimer)
    window.clearTimeout(hideTimer)

  hideTimer = window.setTimeout(() => {
    translation.value = undefined
  }, 9000)
}

onMounted(() => {
  stopEnhancer = startPageEnhancer({
    onSelection: showTranslation,
    onStats: value => stats.value = value,
  })
})

onUnmounted(() => {
  stopEnhancer?.()
  if (hideTimer)
    window.clearTimeout(hideTimer)
})
</script>

<template>
  <div class="lexi-root fixed right-5 bottom-5 z-2147483647 font-sans select-none">
    <div
      class="rounded-2 border border-neutral-200 bg-white/95 px-3 py-2 text-12px text-neutral-700 shadow-lg backdrop-blur"
      :class="stats.enabled ? 'opacity-100' : 'opacity-70'"
    >
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 rounded-full" :class="stats.enabled ? 'bg-neutral-950' : 'bg-neutral-300'" />
        <span>Lexi {{ stats.enabled ? '已启用' : '未启用' }}</span>
      </div>
      <div v-if="stats.enabled" class="mt-1 text-neutral-500">
        替换 {{ stats.replacements }} · 记录 {{ stats.records }}
      </div>
    </div>

    <div
      v-if="translation"
      class="fixed max-w-80 rounded-2 border border-neutral-200 bg-white px-4 py-3 text-left text-13px text-neutral-800 shadow-xl"
      :style="{
        left: `${Math.min(Math.max(12, translationPosition.x - 160), window.innerWidth - 332)}px`,
        top: `${Math.min(Math.max(12, translationPosition.y), window.innerHeight - 180)}px`,
      }"
    >
      <div class="text-12px text-neutral-500">
        划词翻译 · {{ translation.source === 'ai' ? 'AI' : '本地' }}
      </div>
      <div class="mt-1 break-words text-15px font-600">
        {{ translation.translation }}
      </div>
      <div class="mt-2 break-words leading-5 text-neutral-600">
        {{ translation.explanation }}
      </div>
      <button class="mt-3 border-0 bg-transparent p-0 text-12px text-neutral-500 underline cursor-pointer" @click="translation = undefined">
        关闭
      </button>
    </div>
  </div>
</template>
