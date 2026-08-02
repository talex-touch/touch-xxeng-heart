<script setup lang="ts">
import { computed, provide } from 'vue'
import { createComponentId } from './componentId'
import { formFieldKey } from './formFieldContext'

const props = withDefaults(defineProps<{
  id?: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  compact?: boolean
}>(), {
  required: false,
  compact: false,
})

const generatedId = createComponentId('lexi-field')
const controlId = computed(() => props.id || generatedId)
const hintId = computed(() => props.hint ? `${controlId.value}-hint` : undefined)
const errorId = computed(() => props.error ? `${controlId.value}-error` : undefined)
const describedBy = computed(() => [hintId.value, errorId.value].filter(Boolean).join(' ') || undefined)
const invalid = computed(() => Boolean(props.error))

provide(formFieldKey, { controlId, describedBy, invalid })
</script>

<template>
  <div class="form-field" :class="{ 'form-field--compact': compact, 'form-field--invalid': error }">
    <label class="form-field__label" :for="controlId">
      {{ label }}
      <span v-if="required" aria-hidden="true">*</span>
    </label>
    <slot />
    <p v-if="hint" :id="hintId" class="form-field__hint">
      {{ hint }}
    </p>
    <p v-if="error" :id="errorId" class="form-field__error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.form-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.form-field__label {
  color: var(--lexi-ink, #171a20);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.form-field__label span {
  margin-left: 3px;
  color: var(--lexi-danger, #c2483c);
}

.form-field__hint,
.form-field__error {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.55;
  text-wrap: pretty;
}

.form-field__hint {
  color: var(--lexi-ink-muted, #697384);
}

.form-field__error {
  color: var(--lexi-danger, #b9382e);
}

.form-field--compact {
  gap: 5px;
}

.form-field--compact .form-field__label {
  color: var(--lexi-ink-muted, #697384);
  font-size: 11.5px;
}
</style>
