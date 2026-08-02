<script setup lang="ts">
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit' | 'reset'
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  iconOnly?: boolean
}>(), {
  variant: 'secondary',
  size: 'md',
  type: 'button',
  loading: false,
  loadingLabel: '处理中',
  disabled: false,
  iconOnly: false,
})

const attrs = useAttrs()
</script>

<template>
  <button
    v-bind="attrs"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :aria-label="loading ? loadingLabel : attrs['aria-label']"
    class="base-button"
    :class="[
      `base-button--${variant}`,
      `base-button--${size}`,
      { 'base-button--icon-only': iconOnly, 'is-loading': loading },
    ]"
  >
    <slot v-if="!loading" name="icon" />
    <span v-if="!iconOnly" class="base-button__label" :class="{ 'is-loading': loading }"><slot /></span>
    <span v-if="loading" class="i-lucide-loader-circle base-button__spinner" aria-hidden="true" />
  </button>
</template>

<style scoped>
.base-button {
  position: relative;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 9px;
  font: inherit;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  cursor: pointer;
  user-select: none;
  transition: color 160ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 120ms ease;
}

.base-button--md {
  min-height: 38px;
  padding: 8px 13px;
  font-size: 12.5px;
}

.base-button--sm {
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11.5px;
}

.base-button--icon-only.base-button--md {
  width: 38px;
  padding: 0;
}

.base-button--icon-only.base-button--sm {
  width: 32px;
  padding: 0;
}

.base-button--primary {
  color: #fff;
  background: var(--lexi-accent, #2f6fed);
  border-color: var(--lexi-accent, #2f6fed);
}

.base-button--primary:hover:not(:disabled) {
  background: var(--lexi-accent-hover, #255fcf);
  border-color: var(--lexi-accent-hover, #255fcf);
}

.base-button--secondary {
  color: var(--lexi-ink-secondary, #5a6270);
  background: var(--lexi-surface, #fff);
  border-color: var(--lexi-border, #e1e5eb);
}

.base-button--secondary:hover:not(:disabled) {
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-subtle, #f5f7fa);
  border-color: var(--lexi-control-border-hover, #aeb6c3);
}

.base-button--ghost {
  color: var(--lexi-ink-secondary, #5a6270);
  background: transparent;
  border-color: transparent;
}

.base-button--ghost:hover:not(:disabled) {
  color: var(--lexi-ink, #171a20);
  background: var(--lexi-subtle, #f5f7fa);
}

.base-button--warning {
  color: #fff;
  background: #a85d12;
  border-color: #a85d12;
}

.base-button--warning:hover:not(:disabled) {
  background: #87490c;
  border-color: #87490c;
}

.base-button--danger {
  color: var(--lexi-danger, #b9382e);
  background: color-mix(in srgb, var(--lexi-danger, #b9382e) 8%, #fff);
  border-color: color-mix(in srgb, var(--lexi-danger, #b9382e) 24%, #fff);
}

.base-button--danger:hover:not(:disabled) {
  color: #fff;
  background: var(--lexi-danger, #b9382e);
  border-color: var(--lexi-danger, #b9382e);
}

.base-button:focus-visible {
  outline: 2px solid var(--lexi-accent, #2f6fed);
  outline-offset: 2px;
}

.base-button:active:not(:disabled) {
  transform: translateY(1px);
}

.base-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.base-button__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-button__label.is-loading {
  opacity: 0;
}

.base-button__spinner {
  position: absolute;
  width: 15px;
  height: 15px;
  animation: base-button-spin 800ms linear infinite;
}

@keyframes base-button-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .base-button {
    transition: none;
  }

  .base-button__spinner {
    animation-duration: 1600ms;
  }
}
</style>
