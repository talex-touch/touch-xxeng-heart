<script setup lang="ts">
import { inject, useAttrs } from 'vue'
import { formFieldKey } from './formFieldContext'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  modelValue: boolean
  label?: string
  hint?: string
  disabled?: boolean
  compact?: boolean
}>(), {
  label: '',
  hint: '',
  disabled: false,
  compact: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const attrs = useAttrs()
const field = inject(formFieldKey, undefined)

function inputAttrs() {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => !['class', 'style', 'id', 'aria-describedby'].includes(key)))
}

function controlId() {
  return String(field?.controlId.value || attrs.id || '') || undefined
}

function describedBy() {
  return [attrs['aria-describedby'], field?.describedBy.value].filter(Boolean).join(' ') || undefined
}
</script>

<template>
  <label class="base-checkbox" :class="[attrs.class, { 'base-checkbox--compact': compact, 'is-disabled': disabled }]" :style="attrs.style">
    <input
      v-bind="inputAttrs()"
      :id="controlId()"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-describedby="describedBy()"
      class="base-checkbox__native"
      @change="emit('update:modelValue', ($event.currentTarget as HTMLInputElement).checked)"
    >
    <span class="base-checkbox__box" aria-hidden="true">
      <span class="i-lucide-check" />
    </span>
    <span v-if="label || $slots.default" class="base-checkbox__copy">
      <span class="base-checkbox__label"><slot>{{ label }}</slot></span>
      <span v-if="hint" class="base-checkbox__hint">{{ hint }}</span>
    </span>
  </label>
</template>

<style scoped>
.base-checkbox {
  min-width: 0;
  display: inline-flex;
  align-items: flex-start;
  gap: 9px;
  color: var(--lexi-ink, #171a20);
  cursor: pointer;
}

.base-checkbox__native {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.base-checkbox__box {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  margin-top: 1px;
  color: transparent;
  background: var(--lexi-surface, #fff);
  border: 1px solid var(--lexi-control-border-hover, #aeb6c3);
  border-radius: 5px;
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}

.base-checkbox__box > span {
  width: 13px;
  height: 13px;
}

.base-checkbox__native:checked + .base-checkbox__box {
  color: #fff;
  background: var(--lexi-accent, #2f6fed);
  border-color: var(--lexi-accent, #2f6fed);
}

.base-checkbox__native:focus-visible + .base-checkbox__box {
  border-color: var(--lexi-accent, #2f6fed);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lexi-accent, #2f6fed) 16%, transparent);
}

.base-checkbox__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.base-checkbox__label {
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.45;
}

.base-checkbox__hint {
  color: var(--lexi-ink-muted, #697384);
  font-size: 11.5px;
  line-height: 1.5;
  text-wrap: pretty;
}

.base-checkbox--compact {
  align-items: center;
  gap: 7px;
}

.base-checkbox--compact .base-checkbox__box {
  width: 16px;
  height: 16px;
  margin-top: 0;
  border-radius: 4px;
}

.base-checkbox--compact .base-checkbox__label {
  font-size: 11.5px;
}

.base-checkbox.is-disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

@media (prefers-reduced-motion: reduce) {
  .base-checkbox__box {
    transition: none;
  }
}
</style>
