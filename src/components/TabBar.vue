<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  tabs: ReadonlyArray<{ key: T, label: string }>
  /** Compact sizing for the narrow side panel. */
  dense?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<!-- Shared tab switcher; the options and side panels each had their own divergent copy. -->
<template>
  <nav class="flex flex-wrap gap-2">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      :aria-current="modelValue === tab.key ? 'page' : undefined"
      class="rounded-2 border transition"
      :class="[
        dense ? 'px-3 py-1.5 text-12px' : 'px-4 py-2 text-13px',
        modelValue === tab.key
          ? 'border-neutral-950 bg-neutral-950 text-white'
          : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400',
      ]"
      @click="$emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>
