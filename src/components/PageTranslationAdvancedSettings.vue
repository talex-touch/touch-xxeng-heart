<script setup lang="ts">
import { lexiSettings } from '~/logic/storage'
</script>

<!-- 整页翻译的调优参数；与「是否翻译」的决策分离，默认收在折叠区里。 -->
<template>
  <div class="settings-fields">
    <FormField label="合并请求段数" hint="段数越大请求越少。" compact>
      <BaseInput v-model="lexiSettings.selection.pageTranslation.batchSize" type="number" :min="1" :max="8" />
    </FormField>
    <FormField label="预加载段数" hint="可视区域外提前翻译的段数。" compact>
      <BaseInput v-model="lexiSettings.selection.pageTranslation.prefetchBlocks" type="number" :min="0" :max="40" />
    </FormField>
    <FormField label="单页缓存上限" hint="超出后不再缓存新的段落。" compact>
      <BaseInput v-model="lexiSettings.selection.pageTranslation.maxBlocksPerPage" type="number" :min="10" :max="300" />
    </FormField>
    <FormField label="缓存保留天数" hint="过期的整页翻译缓存会被清理。" compact>
      <BaseInput v-model="lexiSettings.selection.pageTranslation.cacheDays" type="number" :min="1" :max="90" />
    </FormField>
  </div>
</template>
