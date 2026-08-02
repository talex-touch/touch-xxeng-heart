<script setup lang="ts">
const steps = [
  { n: '01', t: '安装扩展', d: '从 GitHub 获取源码，构建后通过 Chrome 开发者模式加载 extension/ 目录。' },
  { n: '02', t: '照常阅读', d: '打开文档、GitHub 或论坛，遇到不懂的地方划一下，解释就地出现。' },
  { n: '03', t: '按时复习', d: '读过的术语进入词库，理析按遗忘曲线提醒你回来看一眼。' },
]
</script>

<template>
  <section class="section section--subtle steps">
    <div class="wrap steps__inner">
      <p class="eyebrow">
        学习方式
      </p>
      <h2 class="h2 steps__title">
        三步，把阅读变成学习。
      </h2>
      <p class="lead steps__desc">
        不需要新的学习计划，也不需要新的账号。装上之后，一切发生在你原本就要读的页面里。
      </p>

      <ol class="steps__list">
        <li v-for="s in steps" :key="s.n">
          <span class="steps__badge mono">{{ s.n }}</span>
          <h3 class="steps__stepTitle">
            {{ s.t }}
          </h3>
          <p>{{ s.d }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.steps__inner {
  display: grid;
  justify-items: center;
  text-align: center;
}

.steps__title {
  margin-top: 22px;
  max-width: 16em;
}

.steps__desc {
  margin-top: 22px;
  max-width: 34em;
}

.steps__list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(28px, 4vw, 40px);
  width: 100%;
  margin: clamp(44px, 6vw, 70px) 0 0;
  padding: 0;
  list-style: none;
}

.steps__list li {
  display: grid;
  justify-items: center;
  gap: 18px;
}

.steps__badge {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--bg);
  font-size: 13px;
  letter-spacing: 0.04em;
}

.steps__stepTitle {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.4;
}

.steps__list p {
  max-width: 22em;
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.9;
}

@media (max-width: 800px) {
  .steps__list {
    grid-template-columns: 1fr;
  }
}
</style>
