<script setup lang="ts">
import { inject, useAttrs } from 'vue'
import { formFieldKey } from './formFieldContext'

defineOptions({ inheritAttrs: false })

defineProps<{
  modelValue: string
  resize?: 'none' | 'vertical'
}>()

defineEmits<{
  'update:modelValue': [value: string]
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
</script>

<template>
  <textarea
    v-bind="attrs"
    :id="controlId()"
    :value="modelValue"
    :aria-describedby="describedBy()"
    :aria-invalid="invalid()"
    class="base-textarea"
    :class="resize === 'none' ? 'base-textarea--fixed' : ''"
    @input="$emit('update:modelValue', ($event.currentTarget as HTMLTextAreaElement).value)"
  />
</template>

<style scoped>
.base-textarea {
  width: 100%;
  min-width: 0;
  min-height: 96px;
  padding: 10px 12px;
  resize: vertical;
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-surface, #fff);
  border: 1px solid var(--lexi-control-border, #d4d9e2);
  border-radius: 9px;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.base-textarea--fixed {
  resize: none;
}

.base-textarea:hover:not(:disabled) {
  border-color: var(--lexi-control-border-hover, #aeb6c3);
}

.base-textarea:focus {
  border-color: var(--lexi-accent, #2f6fed);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lexi-accent, #2f6fed) 14%, transparent);
}

.base-textarea[aria-invalid="true"] {
  border-color: var(--lexi-danger, #c2483c);
}

.base-textarea:disabled {
  color: var(--lexi-ink-muted, #697384);
  background: var(--lexi-disabled-bg, #f1f3f6);
  cursor: not-allowed;
  opacity: 0.72;
}

.base-textarea::placeholder {
  color: var(--lexi-placeholder, #697384);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .base-textarea {
    transition: none;
  }
}
</style>
