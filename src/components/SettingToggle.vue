<script setup lang="ts">
import { createComponentId } from './componentId'

const props = withDefaults(defineProps<{
  modelValue: boolean
  label: string
  hint?: string
  disabled?: boolean
}>(), {
  hint: '',
  disabled: false,
})

defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const hintId = createComponentId('lexi-setting-hint')
</script>

<template>
  <div class="setting-toggle" :class="{ 'is-disabled': disabled }">
    <span class="setting-toggle__copy">
      <strong>{{ label }}</strong>
      <small v-if="hint" :id="hintId">{{ hint }}</small>
    </span>
    <ToggleSwitch
      :model-value="modelValue"
      :label="label"
      :disabled="disabled"
      :described-by="props.hint ? hintId : undefined"
      @update:model-value="$emit('update:modelValue', $event)"
    />
  </div>
</template>

<style scoped>
.setting-toggle {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.setting-toggle__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-top: 2px;
}

.setting-toggle__copy strong {
  color: var(--lexi-ink, #171a20);
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.35;
}

.setting-toggle__copy small {
  color: var(--lexi-ink-muted, #697384);
  font-size: 11.5px;
  line-height: 1.5;
  text-wrap: pretty;
}

.setting-toggle.is-disabled {
  opacity: 0.52;
}
</style>
