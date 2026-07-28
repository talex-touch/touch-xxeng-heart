<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  hint?: string
}>()
</script>

<!-- Label + value tile, repeated across the options and side panel dashboards. -->
<template>
  <div class="rounded-2 bg-neutral-50 px-3 py-2">
    <div class="text-11px text-neutral-500">
      {{ label }}
    </div>
    <div class="mt-0.5 text-15px text-neutral-950 font-semibold">
      {{ value }}
    </div>
    <div v-if="hint" class="mt-0.5 text-11px text-neutral-400">
      {{ hint }}
    </div>
  </div>
</template>
