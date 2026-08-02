<script setup lang="ts">
const bars = [22, 37, 28, 49, 59, 41, 66]
const days = ['一', '二', '三', '四', '五', '六', '日']

const words = [
  { en: 'idempotent', zh: '幂等的', level: 3 },
  { en: 'throughput', zh: '吞吐量', level: 2 },
  { en: 'eventual consistency', zh: '最终一致性', level: 1 },
]
</script>

<template>
  <section id="features" class="section features">
    <div class="wrap">
      <div class="head">
        <div class="head__copy">
          <p class="eyebrow">
            功能
          </p>
          <h2 class="h2">
            你在读什么，就学什么。
          </h2>
        </div>
        <p class="head__desc">
          理析不要求你切到另一套学习系统。它在你访问技术内容时，恰好给出需要的解释，并把它留在你的词库里。
        </p>
      </div>

      <div class="bento">
        <!-- 01 selection -->
        <article class="bento__card bento__card--a">
          <header class="bento__head">
            <p class="mono bento__index">
              01
            </p>
            <h3 class="h3">
              划词即懂，不打断阅读
            </h3>
            <p class="bento__desc">
              选中任意句子或术语，理析就地给出中文释义与上下文用法，读完这句就继续往下读。
            </p>
          </header>

          <div class="bento__panel selection">
            <p class="selection__p">
              The controller enqueues chunks until the internal queue reaches its
              <span class="selection__sel">high water mark, at which point the desiredSize drops to zero</span>
              and writes should pause.
            </p>

            <div class="glass selection__bar">
              <span class="selection__act is-on">翻译</span>
              <span class="selection__act">解释</span>
              <span class="selection__act">加入词库</span>
            </div>

            <div class="selection__out">
              <p class="selection__outHead">
                <span>选中即译</span>
                <span class="tag is-tech">技术</span>
              </p>
              <p>到达高水位线时，desiredSize 会降到 0，此时应当暂停写入。</p>
            </div>
          </div>
        </article>

        <!-- 02 vocabulary -->
        <article class="bento__card bento__card--b">
          <header class="bento__head">
            <p class="mono bento__index">
              02
            </p>
            <h3 class="h3">
              读过的词，自动进入词库
            </h3>
            <p class="bento__desc">
              值得记的术语会留在生词本里，按遗忘曲线安排复习，不用手动摘抄。
            </p>
          </header>

          <div class="bento__panel vocab">
            <p class="vocab__head">
              <span>本周复习</span>
              <b class="mono">42 词</b>
            </p>

            <div class="vocab__chart" role="img" aria-label="本周每日复习量，周日最高">
              <span v-for="(b, i) in bars" :key="i" :style="{ height: `${b}%` }" :class="{ on: i === bars.length - 1 }" />
            </div>
            <p class="vocab__days">
              <span v-for="d in days" :key="d">{{ d }}</span>
            </p>

            <hr>

            <ul class="vocab__words">
              <li v-for="w in words" :key="w.en">
                <span>
                  <b>{{ w.en }}</b>
                  <em>{{ w.zh }}</em>
                </span>
                <span class="vocab__pips" :aria-label="`掌握度 ${w.level} / 3`">
                  <i v-for="n in 3" :key="n" :class="{ on: n <= w.level }" />
                </span>
              </li>
            </ul>
          </div>
        </article>

        <!-- 03 glance -->
        <article class="bento__card bento__card--c">
          <header class="bento__head">
            <p class="mono bento__index">
              03
            </p>
            <h3 class="h3">
              理析速览
            </h3>
            <p class="bento__desc">
              仓库、Issue、论坛长帖——认出平台形态后，给出对应的速览。
            </p>
          </header>

          <div class="bento__panel digest">
            <p class="digest__repo">
              <AppIcon name="github" :size="17" />
              <b>vercel/ai</b>
              <span class="tag is-prod">产品</span>
              <span class="chip">★ 12.4k</span>
            </p>
            <hr>
            <p class="digest__label">
              ✦ 项目速读
            </p>
            <p class="digest__body">
              面向需要在应用层接入流式模型输出的开发者，核心是一套统一的 provider 抽象与前端 hooks。
            </p>
            <p class="digest__tags">
              <span class="chip">TypeScript</span>
              <span class="chip">Streaming</span>
              <span class="chip">React</span>
            </p>
            <p class="digest__entry mono">
              <span aria-hidden="true">↳</span> 建议入口 <b>packages/core/index.ts</b>
            </p>
          </div>
        </article>

        <!-- 04 scenario off -->
        <article class="bento__card bento__card--d">
          <header class="bento__head">
            <p class="mono bento__index">
              04
            </p>
            <h3 class="h3">
              学习平台，默认不打扰
            </h3>
            <p class="bento__desc">
              学习通和雨课堂已内置停用策略；其他站点可以按域名加入黑名单。
            </p>
          </header>

          <div class="bento__panel exam">
            <p class="exam__detected">
              <span>命中学习平台停用策略</span>
              <b>已停用</b>
            </p>

            <div class="exam__q">
              <p>Q3. Which statement about backpressure is correct?</p>
              <span v-for="w in [72, 54, 64]" :key="w" class="exam__opt">
                <i />
                <em :style="{ width: `${w}%` }" />
              </span>
            </div>

            <p class="exam__note">
              这一站点不做任何标注与翻译
            </p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bento {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  margin-top: clamp(36px, 5vw, 58px);
}

.bento__card {
  display: flex;
  flex-direction: column;
  gap: 26px;
  border-radius: var(--r-lg);
  background: var(--bg-subtle);
  padding: clamp(22px, 2.5vw, 32px);
}

.bento__card--a { grid-column: span 7; }
.bento__card--b { grid-column: span 5; }
.bento__card--c { grid-column: span 6; }
.bento__card--d { grid-column: span 6; }

.bento__head {
  display: grid;
  gap: 11px;
}

.bento__index {
  color: var(--accent);
  font-size: 11.5px;
  letter-spacing: 0.1em;
}

.bento__desc {
  max-width: 30em;
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.85;
}

.bento__panel {
  flex: 1;
  border-radius: 14px;
  background: var(--bg);
  padding: 22px;
}

.bento__panel hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--line);
}

/* --- 01 --- */

.selection {
  display: grid;
  align-content: center;
  gap: 18px;
  position: relative;
}

.selection__p {
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.9;
}

.selection__sel {
  border-radius: 4px;
  background: rgb(25 118 255 / 0.18);
  padding: 2px 3px;
  color: var(--ink);
}

.selection__bar {
  display: flex;
  gap: 2px;
  align-self: start;
  border-radius: 11px;
  padding: 5px;
  font-size: 12.5px;
}

.selection__act {
  border-radius: 8px;
  padding: 7px 11px;
  color: var(--ink-2);
}

.selection__act.is-on {
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-weight: 600;
}

.selection__out {
  display: grid;
  gap: 10px;
  border-radius: 12px;
  background: var(--accent-soft);
  padding: 16px;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.8;
}

.selection__outHead {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--accent-ink);
  font-size: 12.5px;
  font-weight: 600;
}

/* --- 02 --- */

.vocab {
  display: grid;
  align-content: start;
  gap: 14px;
}

.vocab__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}

.vocab__head b {
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
}

.vocab__chart {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  height: 66px;
}

.vocab__chart span {
  flex: 1;
  border-radius: 5px;
  background: rgb(25 118 255 / 0.24);
}

.vocab__chart span.on {
  background: var(--accent);
}

.vocab__days {
  display: flex;
  gap: 7px;
  color: var(--ink-3);
  font-size: 10.5px;
}

.vocab__days span {
  flex: 1;
  text-align: center;
}

.vocab__words {
  display: grid;
  gap: 11px;
}

.vocab__words li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vocab__words span:first-child {
  flex: 1;
  min-width: 0;
}

.vocab__words b {
  display: block;
  font-size: 13px;
  line-height: 1.3;
}

.vocab__words em {
  display: block;
  color: var(--ink-3);
  font-size: 11.5px;
  font-style: normal;
  line-height: 1.3;
}

.vocab__pips {
  display: flex;
  gap: 4px;
  flex: none;
}

.vocab__pips i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--line-strong);
}

.vocab__pips i.on {
  background: var(--accent);
}

/* --- 03 --- */

.digest {
  display: grid;
  align-content: start;
  gap: 14px;
}

.digest__repo {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
}

.digest__repo b {
  letter-spacing: -0.01em;
}

.digest__repo .chip {
  margin-left: auto;
  font-size: 11px;
}

.digest__label {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
}

.digest__body {
  color: var(--ink-2);
  font-size: 13.5px;
  line-height: 1.85;
}

.digest__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.digest__entry {
  color: var(--ink-3);
  font-size: 12px;
}

.digest__entry b {
  color: var(--accent);
  font-weight: 500;
}

/* --- 04 --- */

.exam {
  display: grid;
  align-content: center;
  gap: 14px;
}

.exam__detected {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  background: var(--bg-subtle);
  padding: 11px 13px;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 500;
}

.exam__detected b {
  margin-left: auto;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
  padding: 4px 9px;
  color: var(--ink-3);
  font-size: 10.5px;
}

.exam__q {
  display: grid;
  gap: 10px;
  padding: 6px 0 4px;
}

.exam__q p {
  color: var(--ink-3);
  font-size: 13.5px;
  line-height: 1.6;
}

.exam__opt {
  display: flex;
  align-items: center;
  gap: 10px;
}

.exam__opt i {
  width: 12px;
  height: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  flex: none;
}

.exam__opt em {
  height: 7px;
  border-radius: 4px;
  background: var(--bg-muted);
}

.exam__note {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  color: var(--ink-3);
  font-size: 12px;
}

@media (max-width: 1000px) {
  .bento__card--a,
  .bento__card--b,
  .bento__card--c,
  .bento__card--d {
    grid-column: span 12;
  }
}
</style>
