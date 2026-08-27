<script setup lang="ts">
import { pageTranslationAutoSiteOptions } from '~/logic/pageTranslationSites'
import { lexiSettings } from '~/logic/storage'
</script>

<!-- 平台自动翻译的订阅开关。全部默认关闭；命中后只走英文 → 中文，也不写入已保存的页面规则。 -->
<template>
  <section class="settings-card">
    <header class="settings-card__head">
      <div>
        <h2>受支持站点自动翻译</h2>
        <p>命中平台的结构化正文并检测到英文时自动开始，固定英文 → 中文；不扫描全网，也不会覆盖或写入你保存的页面规则。</p>
      </div>
    </header>

    <div class="settings-stack settings-stack--tight">
      <BaseCheckbox
        v-for="site in pageTranslationAutoSiteOptions"
        :key="site.value"
        v-model="lexiSettings.selection.pageTranslation.autoSites[site.value]"
        :label="site.label"
        :hint="site.hint"
      />
    </div>
  </section>
</template>
