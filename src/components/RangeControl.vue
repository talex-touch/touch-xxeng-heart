<script setup lang="ts">
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  step?: number
  label: string
  hint?: string
  displayValue?: string
  disabled?: boolean
}>(), {
  step: 1,
  hint: '',
  displayValue: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const attrs = useAttrs()

function inputAttrs() {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !['class', 'style'].includes(key)))
}

const progress = computed(() => {
  if (props.max <= props.min)
    return 0
  return Math.min(100, Math.max(0, ((props.modelValue - props.min) / (props.max - props.min)) * 100))
})
const rangeStyle = computed(() => ({ '--range-progress': `${progress.value}%` }))
</script>

<template>
  <label class="range-control" :class="[attrs.class, { 'is-disabled': disabled }]" :style="attrs.style">
    <span class="range-control__head">
      <span>
        <strong>{{ label }}</strong>
        <small v-if="hint">{{ hint }}</small>
      </span>
      <output>{{ displayValue || modelValue }}</output>
    </span>
    <input
      v-bind="inputAttrs()"
      type="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :style="rangeStyle"
      @input="emit('update:modelValue', Number(($event.currentTarget as HTMLInputElement).value))"
    >
  </label>
</template>

<style scoped>
.range-control {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.range-control__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.range-control__head > span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.range-control strong {
  color: var(--lexi-ink, #171a20);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.range-control small {
  color: var(--lexi-ink-muted, #697384);
  font-size: 11.5px;
  line-height: 1.5;
  text-wrap: pretty;
}

.range-control output {
  min-width: 50px;
  padding: 4px 8px;
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-subtle, #f1f3f6);
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.range-control input {
  width: 100%;
  height: 20px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.range-control input::-webkit-slider-runnable-track {
  height: 6px;
  background: linear-gradient(to right, var(--lexi-accent, #2f6fed) 0 var(--range-progress), var(--lexi-track, #e3e6ec) var(--range-progress) 100%);
  border-radius: 999px;
}

.range-control input::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  margin-top: -6px;
  appearance: none;
  background: #fff;
  border: 2px solid var(--lexi-accent, #2f6fed);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(23, 26, 32, 0.18);
  transition: box-shadow 150ms ease, transform 150ms ease;
}

.range-control input:hover::-webkit-slider-thumb {
  transform: scale(1.06);
}

.range-control input:focus-visible {
  outline: none;
}

.range-control input:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--lexi-accent, #2f6fed) 18%, transparent);
}

.range-control.is-disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.range-control.is-disabled input {
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .range-control input::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
