<script setup lang="ts">
const faqs = [
  {
    q: '理析会上传我的浏览记录吗？',
    a: '不会。页面访问与诊断记录只保存在浏览器本地。只有当你主动使用翻译或摘要功能时，必要的选中文本或页面上下文才会发往你自己配置的 AI 端点。',
    open: true,
  },
  {
    q: '必须自己准备 AI 服务吗？',
    a: '术语标注、词库和复习不需要 AI。翻译、速览和摘要这类需要生成的功能，要你在设置里填入自己的服务端点——理析不代运营任何模型服务。',
  },
  {
    q: '考试或在线答题时会出现吗？',
    a: '学习通和雨课堂已内置为默认停用站点。其他考试或答题系统需要你在设置中按域名加入黑名单，或直接关闭全局开关。',
  },
  {
    q: '速览支持哪些平台？',
    a: '当前提供 GitHub 仓库速读和 Discourse 主题摘要。其他普通网页仍可使用术语学习、划词翻译、页面翻译和页面问答。',
  },
  {
    q: '会让页面变慢吗？',
    a: '术语识别在页面空闲时进行，不阻塞渲染。速览和摘要只在你触发时请求一次，结果会缓存在本地，缓存周期可以在设置里调整或直接清空。',
  },
]
</script>

<template>
  <section id="faq" class="section faq">
    <div class="wrap faq__inner">
      <div class="faq__head">
        <p class="eyebrow">
          常见问题
        </p>
        <h2 class="h2">
          还有疑问？
        </h2>
        <p>没找到答案可以在 GitHub Issues 里提问。</p>
      </div>

      <div class="faq__list">
        <details v-for="f in faqs" :key="f.q" :open="f.open">
          <summary>
            <span>{{ f.q }}</span>
            <i aria-hidden="true" />
          </summary>
          <p>{{ f.a }}</p>
        </details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.faq__inner {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: clamp(32px, 6vw, 100px);
  align-items: start;
}

.faq__head {
  display: grid;
  gap: 20px;
}

.faq__head p:last-child {
  color: var(--ink-2);
  font-size: 15px;
  line-height: 1.85;
}

.faq__list {
  border-bottom: 1px solid var(--line);
}

.faq__list details {
  border-top: 1px solid var(--line);
}

.faq__list summary {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 26px 0;
  cursor: pointer;
  font-size: clamp(16px, 1.4vw, 18px);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.5;
  list-style: none;
}

.faq__list summary::-webkit-details-marker {
  display: none;
}

.faq__list summary span {
  flex: 1;
}

/* Plus that loses its vertical stroke when the row is open. */
.faq__list summary i {
  position: relative;
  width: 16px;
  height: 16px;
  flex: none;
}

.faq__list summary i::before,
.faq__list summary i::after {
  content: '';
  position: absolute;
  inset: 50% 0 auto;
  height: 1.6px;
  border-radius: 2px;
  background: var(--ink-3);
  transform: translateY(-50%);
}

.faq__list summary i::after {
  transform: translateY(-50%) rotate(90deg);
  transition: opacity 0.18s ease;
}

.faq__list details[open] summary i::before,
.faq__list details[open] summary i::after {
  background: var(--accent);
}

.faq__list details[open] summary i::after {
  opacity: 0;
}

.faq__list details > p {
  max-width: 42em;
  padding-bottom: 28px;
  color: var(--ink-2);
  font-size: 15px;
  line-height: 1.95;
}

@media (max-width: 860px) {
  .faq__inner {
    grid-template-columns: 1fr;
  }
}
</style>
