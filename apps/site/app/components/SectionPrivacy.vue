<script setup lang="ts">
const principles = [
  { n: '01', t: '本地优先', d: '设置、词汇记录和摘要缓存默认保存在你的浏览器里，不经过我们的服务器。' },
  { n: '02', t: '你决定何时发送', d: '只有在你配置并主动使用 AI 功能时，必要的选中文本或页面上下文才会发往你指定的服务。' },
  { n: '03', t: '不执行远程代码', d: '扩展包不下载、不执行远程脚本。AI 返回的内容一律按纯文本处理。' },
]
</script>

<template>
  <section id="privacy" class="section section--dark privacy">
    <div class="wrap">
      <div class="head">
        <div class="head__copy">
          <p class="eyebrow">
            隐私
          </p>
          <h2 class="h2">
            学习数据，始终留在你这边。
          </h2>
        </div>
        <p class="head__desc">
          理析是一个阅读辅助工具，不是一个数据收集器。下面三条是我们对自己的约束。
        </p>
      </div>

      <ol class="privacy__list">
        <li v-for="p in principles" :key="p.n">
          <p class="mono privacy__index">
            {{ p.n }}
          </p>
          <h3 class="privacy__title">
            {{ p.t }}
          </h3>
          <p class="privacy__desc">
            {{ p.d }}
          </p>
        </li>
      </ol>

      <NuxtLink class="btn btn--onDark privacy__cta" to="/privacy">
        查看完整隐私政策 <span aria-hidden="true">↗</span>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.privacy__list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
  margin: clamp(44px, 5vw, 72px) 0 0;
  padding: 0;
  list-style: none;
}

.privacy__list li {
  display: grid;
  align-content: start;
  gap: 16px;
  border-top: 1px solid var(--dark-line);
  padding-top: 28px;
}

.privacy__index {
  color: var(--dark-accent);
  font-size: 11.5px;
  letter-spacing: 0.1em;
}

.privacy__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.4;
}

.privacy__desc {
  color: var(--dark-ink-2);
  font-size: 14.5px;
  line-height: 1.9;
}

.privacy__cta {
  margin-top: clamp(40px, 5vw, 64px);
}

@media (max-width: 860px) {
  .privacy__list {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .privacy__list li {
    padding-block: 28px;
  }
}
</style>
