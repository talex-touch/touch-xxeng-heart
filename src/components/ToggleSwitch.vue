<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled)
    emit('update:modelValue', !props.modelValue)
}
</script>

<!--
  One switch for the whole extension. Previously three designs coexisted: a hand-rolled
  button + absolutely-positioned knob in the sidepanel, a peer/sr-only checkbox in the
  popup, and a bare `<input type="checkbox">` in the options page.
-->
<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    class="relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50"
    :class="modelValue ? 'bg-neutral-950' : 'bg-neutral-300'"
    @click="toggle"
  >
    <span
      class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all"
      :class="modelValue ? 'left-5.5' : 'left-0.5'"
    />
  </button>
</template>
