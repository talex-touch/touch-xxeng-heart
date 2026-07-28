<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<!-- The "nothing here yet" paragraph, previously duplicated across seven call sites. -->
<template>
  <p class="rounded-2 border border-neutral-200 bg-neutral-50 px-3 py-3 text-13px text-neutral-500">
    {{ text }}
  </p>
</template>
