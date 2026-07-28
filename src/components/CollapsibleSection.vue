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
  <section class="rounded-2 border border-neutral-200 bg-white shadow-sm">
    <button
      type="button"
      class="flex w-full items-center gap-3 px-5 py-4 text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="flex-1 text-14px text-neutral-950 font-medium">{{ title }}</span>
      <span v-if="hint" class="text-12px text-neutral-500">{{ hint }}</span>
      <span
        class="text-11px text-neutral-400 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
        aria-hidden="true"
      >▼</span>
    </button>
    <div v-show="open" class="border-t border-neutral-100 px-5 py-4">
      <slot />
    </div>
  </section>
</template>
