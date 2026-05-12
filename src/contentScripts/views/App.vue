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

onMounted(() => {
  unsubscribeStats = subscribePageStats(value => stats.value = value)
})

onUnmounted(() => {
  unsubscribeStats?.()
})
</script>

<template>
  <div class="lexi-root fixed right-5 bottom-5 z-2147483647 font-sans select-none">
    <div
      v-if="stats.showFloatingStatus"
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
  </div>
</template>
