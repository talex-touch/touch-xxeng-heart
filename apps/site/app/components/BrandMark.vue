<script setup lang="ts">
withDefaults(defineProps<{
  size?: number
  hand?: number
  latin?: boolean
}>(), {
  size: 26,
  hand: 23,
  latin: true,
})
</script>

<template>
  <span class="brand">
    <img src="/assets/icon.png" :width="size" :height="size" alt="" :style="{ borderRadius: `${Math.round(size * 0.27)}px` }">
    <span class="hand brand__hand" :style="{ fontSize: `${hand}px` }">理析</span>
    <span v-if="latin" class="brand__latin">Lexi</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.brand__hand {
  color: var(--ink);
  line-height: 1.25;
}

.brand__latin {
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

:global(.section--dark) .brand__hand,
:global(.site-footer--dark) .brand__hand {
  color: var(--inverse);
}
</style>
