<script setup lang="ts" generic="T extends string">
import { inject, useAttrs } from 'vue'
import { formFieldKey } from './formFieldContext'

defineOptions({ inheritAttrs: false })

defineProps<{
  modelValue: T
  size?: 'sm' | 'md'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const attrs = useAttrs()
const field = inject(formFieldKey, undefined)

function controlId() {
  return String(field?.controlId.value || attrs.id || '') || undefined
}

function describedBy() {
  return [attrs['aria-describedby'], field?.describedBy.value].filter(Boolean).join(' ') || undefined
}

function invalid() {
  return attrs['aria-invalid'] ?? (field?.invalid.value || undefined)
}

function updateValue(event: Event) {
  emit('update:modelValue', (event.currentTarget as HTMLSelectElement).value as T)
}
</script>

<template>
  <span class="base-select-wrap">
    <select
      v-bind="attrs"
      :id="controlId()"
      :value="modelValue"
      :aria-describedby="describedBy()"
      :aria-invalid="invalid()"
      class="base-select"
      :class="[`base-select--${size ?? 'md'}`]"
      @change="updateValue"
    >
      <slot />
    </select>
    <span class="i-lucide-chevron-down base-select__icon" aria-hidden="true" />
  </span>
</template>

<style scoped>
.base-select-wrap {
  position: relative;
  display: block;
  min-width: 0;
}

.base-select {
  width: 100%;
  min-width: 0;
  appearance: none;
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-surface, #fff);
  border: 1px solid var(--lexi-control-border, #d4d9e2);
  border-radius: 9px;
  font: inherit;
  line-height: 1.4;
  outline: none;
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.base-select--md {
  min-height: 40px;
  padding: 8px 36px 8px 12px;
  font-size: 13.5px;
}

.base-select--sm {
  min-height: 36px;
  padding: 7px 32px 7px 10px;
  font-size: 12.5px;
}

.base-select:hover:not(:disabled) {
  border-color: var(--lexi-control-border-hover, #aeb6c3);
}

.base-select:focus {
  border-color: var(--lexi-accent, #2f6fed);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lexi-accent, #2f6fed) 14%, transparent);
}

.base-select[aria-invalid="true"] {
  border-color: var(--lexi-danger, #c2483c);
}

.base-select:disabled {
  color: var(--lexi-ink-muted, #697384);
  background: var(--lexi-disabled-bg, #f1f3f6);
  cursor: not-allowed;
  opacity: 0.72;
}

.base-select__icon {
  position: absolute;
  top: 50%;
  right: 12px;
  width: 15px;
  height: 15px;
  color: var(--lexi-ink-muted, #697384);
  pointer-events: none;
  transform: translateY(-50%);
}

@media (prefers-reduced-motion: reduce) {
  .base-select {
    transition: none;
  }
}
</style>
