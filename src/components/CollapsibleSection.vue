<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  /** Short right-aligned hint, e.g. a count or status. */
  hint?: string
  /** Start collapsed. */
  collapsed?: boolean
}>(), {
  collapsed: true,
})

const open = ref(!props.collapsed)
</script>

<!--
  Collapsible panel for the settings surfaces, matching the collapse affordance the
  in-page cards use. Replaces the lone unstyled <details> in the options page and gives
  the long settings blocks somewhere to hide.
-->
<template>
  <section class="collapsible-section">
    <button
      type="button"
      class="collapsible-section__trigger"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="collapsible-section__title">{{ title }}</span>
      <span v-if="hint" class="collapsible-section__hint">{{ hint }}</span>
      <span
        class="i-lucide-chevron-down collapsible-section__icon"
        :class="{ 'is-open': open }"
        aria-hidden="true"
      />
    </button>
    <div v-show="open" class="collapsible-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.collapsible-section {
  overflow: hidden;
  background: var(--lexi-surface, #fff);
  border: 1px solid var(--lexi-border, #e1e5eb);
  border-radius: 12px;
}

.collapsible-section__trigger {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  color: var(--lexi-ink, #171a20);
  background: transparent;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 160ms ease;
}

.collapsible-section__trigger:hover {
  background: var(--lexi-subtle, #f5f7fa);
}

.collapsible-section__trigger:focus-visible {
  outline: 2px solid var(--lexi-accent, #2f6fed);
  outline-offset: -2px;
}

.collapsible-section__title {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}

.collapsible-section__hint {
  color: var(--lexi-ink-muted, #697384);
  font-size: 11.5px;
}

.collapsible-section__icon {
  width: 16px;
  height: 16px;
  color: var(--lexi-ink-muted, #697384);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.collapsible-section__icon.is-open {
  transform: rotate(180deg);
}

.collapsible-section__body {
  padding: 14px;
  border-top: 1px solid var(--lexi-border, #e1e5eb);
}

@media (prefers-reduced-motion: reduce) {
  .collapsible-section__trigger,
  .collapsible-section__icon {
    transition: none;
  }
}
</style>
