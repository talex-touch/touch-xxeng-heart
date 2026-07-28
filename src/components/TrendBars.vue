<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  items: ReadonlyArray<{ label: string, value: number }>
  /** Tailwind/Uno background class for the bars. */
  color?: string
  /** Track height in px; bars are scaled to fit inside it. */
  height?: number
}>(), {
  color: 'bg-neutral-900',
  height: 160,
})

const max = computed(() => Math.max(1, ...props.items.map(item => item.value)))

/**
 * Bars are sized as a fraction of the track. The previous inline version returned a
 * fixed pixel height that could exceed its own container, so max-value bars overflowed.
 */
function barHeight(value: number) {
  return `${Math.max(2, Math.round((value / max.value) * (props.height - 24)))}px`
}
</script>

<!-- Bar chart repeated three times in the options dashboard, differing only by data and colour. -->
<template>
  <div class="flex items-end gap-2 overflow-x-auto" :style="{ height: `${height}px` }">
    <div
      v-for="item in items"
      :key="item.label"
      class="flex min-w-8 flex-1 flex-col items-center justify-end gap-1"
    >
      <span class="text-10px text-neutral-500">{{ item.value }}</span>
      <div class="w-full rounded-t-1" :class="color" :style="{ height: barHeight(item.value) }" />
      <span class="text-10px text-neutral-400">{{ item.label }}</span>
    </div>
  </div>
</template>
