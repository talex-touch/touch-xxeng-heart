<script setup lang="ts">
import { inject, useAttrs } from 'vue'
import { formFieldKey } from './formFieldContext'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue?: string | number
  type?: 'text' | 'number' | 'password' | 'search' | 'url'
  size?: 'sm' | 'md'
}>(), {
  modelValue: '',
  type: 'text',
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  'change': [event: Event]
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
  const input = event.currentTarget as HTMLInputElement
  if (props.type !== 'number') {
    emit('update:modelValue', input.value)
    return
  }

  if (input.value === '' || !Number.isFinite(input.valueAsNumber))
    return

  const min = input.min === '' ? Number.NEGATIVE_INFINITY : Number(input.min)
  const max = input.max === '' ? Number.POSITIVE_INFINITY : Number(input.max)
  emit('update:modelValue', Math.min(max, Math.max(min, input.valueAsNumber)))
}
</script>

<template>
  <input
    v-bind="attrs"
    :id="controlId()"
    :value="modelValue ?? ''"
    :type="type"
    :aria-describedby="describedBy()"
    :aria-invalid="invalid()"
    class="base-input"
    :class="[`base-input--${size}`]"
    @input="updateValue"
    @change="emit('change', $event)"
  >
</template>

<style scoped>
.base-input {
  width: 100%;
  min-width: 0;
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-surface, #fff);
  border: 1px solid var(--lexi-control-border, #d4d9e2);
  border-radius: 9px;
  font: inherit;
  line-height: 1.4;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
}

.base-input--md {
  min-height: 40px;
  padding: 9px 12px;
  font-size: 13.5px;
}

.base-input--sm {
  min-height: 36px;
  padding: 7px 10px;
  font-size: 12.5px;
}

.base-input:hover:not(:disabled) {
  border-color: var(--lexi-control-border-hover, #aeb6c3);
}

.base-input:focus {
  border-color: var(--lexi-accent, #2f6fed);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lexi-accent, #2f6fed) 14%, transparent);
}

.base-input[aria-invalid="true"] {
  border-color: var(--lexi-danger, #c2483c);
}

.base-input:disabled {
  color: var(--lexi-ink-muted, #697384);
  background: var(--lexi-disabled-bg, #f1f3f6);
  cursor: not-allowed;
  opacity: 0.72;
}

.base-input::placeholder {
  color: var(--lexi-placeholder, #697384);
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .base-input {
    transition: none;
  }
}
</style>
