<script setup lang="ts">
import { ref } from 'vue'

const festivalOptions = [
  { id: 'default', label: '默认' },
  { id: 'spring', label: '春节' },
  { id: 'valentine', label: '情人节' },
  { id: 'halloween', label: '万圣节' },
]
const activeFestival = ref('default')
</script>

<template>
  <section class="festival-preview" aria-labelledby="festival-preview-title">
    <div>
      <span class="festival-preview__eyebrow">仅本地开发</span>
      <h3 id="festival-preview-title">
        节日形态预览
      </h3>
      <p>快速切换 Lexi 的节日氛围。预览只作用于当前设置页，不会写入用户设置。</p>
    </div>
    <div class="festival-preview__controls" role="tablist" aria-label="节日预览">
      <button
        v-for="festival in festivalOptions"
        :key="festival.id"
        type="button"
        role="tab"
        :aria-selected="activeFestival === festival.id"
        :class="{ 'is-active': activeFestival === festival.id }"
        @click="activeFestival = festival.id"
      >
        {{ festival.label }}
      </button>
    </div>
    <div class="festival-preview__stage" :class="`festival-preview__stage--${activeFestival}`">
      <div class="festival-preview__mascot" aria-hidden="true">
        ✦
      </div>
      <div>
        <strong>Lexi</strong>
        <p>{{ activeFestival === 'valentine' ? '把每一次阅读，变成值得收藏的相遇。' : activeFestival === 'spring' ? '新春阅读计划，今天也积累一个新词。' : activeFestival === 'halloween' ? '点亮夜读模式，发现藏在网页里的词汇。' : '在自然阅读中积累英语词汇。' }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.festival-preview { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px 24px; padding: 20px 28px; border-top: 1px dashed #e7e9ee; }
.festival-preview__eyebrow { color: #7d8695; font-size: 11px; font-weight: 600; letter-spacing: .04em; }
h3 { margin: 3px 0 0; font-size: 15px; }
.festival-preview > div > p { margin: 5px 0 0; color: #5a6270; font-size: 12px; }
.festival-preview__controls { display: flex; flex-wrap: wrap; align-content: start; justify-content: end; gap: 4px; }
.festival-preview__controls button { min-height: 30px; padding: 0 10px; color: #5a6270; background: #f5f7fa; border: 1px solid #e7e9ee; border-radius: 8px; font: inherit; font-size: 12px; cursor: pointer; }
.festival-preview__controls button.is-active { color: #2f6fed; background: #eaf1fe; border-color: #c8d9fb; }
.festival-preview__stage { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; min-height: 94px; padding: 18px; color: #17315f; background: linear-gradient(135deg, #edf5ff, #f9fbff); border: 1px solid #d6e6fb; border-radius: 12px; }
.festival-preview__stage strong { font-size: 18px; }
.festival-preview__stage p { margin: 3px 0 0; font-size: 12px; }
.festival-preview__mascot { display: grid; width: 54px; height: 54px; flex: 0 0 auto; place-items: center; color: #fff; background: #2f6fed; border-radius: 18px 18px 18px 4px; font-size: 24px; }
.festival-preview__stage--spring { color: #315a27; background: linear-gradient(135deg, #f5fde8, #fff8e3); border-color: #d8edbd; }
.festival-preview__stage--spring .festival-preview__mascot { background: #6b9f37; border-radius: 50% 50% 50% 8px; }
.festival-preview__stage--valentine { color: #7b2441; background: linear-gradient(135deg, #fff0f4, #fff8fa); border-color: #f4cddd; }
.festival-preview__stage--valentine .festival-preview__mascot { background: #d84d7a; border-radius: 50% 50% 8px; }
.festival-preview__stage--halloween { color: #59381c; background: linear-gradient(135deg, #fff4df, #fffaf1); border-color: #f0d29b; }
.festival-preview__stage--halloween .festival-preview__mascot { background: #c96b1d; border-radius: 50% 8px 50% 50%; }
</style>
