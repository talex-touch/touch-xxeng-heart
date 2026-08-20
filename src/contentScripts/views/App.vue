<script setup lang="ts">
import 'uno.css'
import { onMounted, onUnmounted, ref } from 'vue'
import { subscribePageStats } from '../pageEnhancerRuntime'
import type { PageStats } from '../pageEnhancer'

const stats = ref<PageStats>({
  replacements: 0,
  records: 0,
  enabled: false,
  showFloatingStatus: false,
})
let unsubscribeStats: (() => void) | undefined

function requestQuickTranslation() {
  document.dispatchEvent(new CustomEvent('lexi-quick-translate'))
}

onMounted(() => {
  unsubscribeStats = subscribePageStats(value => stats.value = value)
})

onUnmounted(() => {
  unsubscribeStats?.()
})
</script>

<template>
  <div v-if="stats.showFloatingStatus" class="lexi-root fixed right-0 top-1/2 z-2147483647 -translate-y-1/2 font-sans select-none">
    <button
      type="button"
      class="group flex translate-x-[calc(100%-18px)] items-center gap-2 rounded-l-xl border border-r-0 bg-white/95 px-3 py-2 text-left text-12px text-neutral-700 shadow-lg backdrop-blur transition-transform duration-180 hover:translate-x-0 focus:translate-x-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
      :class="stats.enabled ? 'border-emerald-500' : 'border-neutral-300'"
      :aria-label="stats.enabled ? '已启用 Lexi，点击开始页面翻译' : 'Lexi 当前页未启用'"
      @click="requestQuickTranslation"
    >
      <span class="h-2.5 w-2.5 rounded-full" :class="stats.enabled ? 'bg-emerald-500' : 'bg-neutral-300'" />
      <span class="whitespace-nowrap font-600">{{ stats.enabled ? '翻译当前页' : 'Lexi 未启用' }}</span>
    </button>
  </div>
</template>
