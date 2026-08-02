<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  options: ReadonlyArray<{ value: T, label: string }>
  /** Accessible name for the whole group. */
  label?: string
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<!--
  Inline picker for 2-4 short options, used where the side panel previously had a
  <select>: every choice stays visible and switching costs one click instead of two.
-->
<template>
  <div
    role="group"
    :aria-label="label"
    class="flex gap-[2px] rounded-2 bg-neutral-100 p-[3px]"
    :class="disabled ? 'opacity-50' : ''"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="modelValue === option.value"
      :disabled="disabled"
      class="min-w-0 flex-1 truncate rounded-[6px] px-1 py-1.5 text-11px transition disabled:cursor-not-allowed"
      :class="modelValue === option.value
        ? 'bg-white text-neutral-950 font-600 shadow-sm'
        : 'text-neutral-500 font-500 hover:text-neutral-950'"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
