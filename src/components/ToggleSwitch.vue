<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  label?: string
  describedBy?: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function toggle() {
  if (!props.disabled)
    emit('update:modelValue', !props.modelValue)
}
</script>

<!--
  One switch for the whole extension. Previously three designs coexisted: a hand-rolled
  button + absolutely-positioned knob in the sidepanel, a peer/sr-only checkbox in the
  popup, and a bare `<input type="checkbox">` in the options page.
-->
<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :aria-describedby="describedBy"
    :disabled="disabled"
    class="lexi-toggle"
    :class="{ 'is-on': modelValue }"
    @click="toggle"
  >
    <span class="lexi-toggle__thumb" />
  </button>
</template>

<style scoped>
.lexi-toggle {
  position: relative;
  width: 44px;
  height: 26px;
  flex: 0 0 auto;
  padding: 0;
  background: #d3d8e0;
  border: 0;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px #7d8797;
  cursor: pointer;
  transition: background-color 180ms ease;
}

.lexi-toggle.is-on {
  background: #2f6fed;
  box-shadow: none;
}

.lexi-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.lexi-toggle__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(23, 26, 32, 0.2);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.lexi-toggle.is-on .lexi-toggle__thumb {
  transform: translateX(18px);
}

@media (prefers-reduced-motion: reduce) {
  .lexi-toggle,
  .lexi-toggle__thumb {
    transition: none;
  }
}
</style>
