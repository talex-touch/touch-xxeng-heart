<script setup lang="ts">
const terms = [
  { en: 'backpressure', zh: '反压', level: 3 },
  { en: 'highWaterMark', zh: '高水位线', level: 2 },
  { en: 'chunk', zh: '数据块', level: 3 },
  { en: 'enqueue', zh: '入队', level: 1 },
  { en: 'ReadableStream', zh: '可读流', level: 2 },
  { en: 'tee', zh: '流分叉', level: 0 },
]
</script>

<template>
  <section class="hero">
    <div class="wrap hero__copy">
      <p class="hero__pill">
        <span class="dot is-tech" aria-hidden="true" />
        为技术学习者而作 · 完全免费
      </p>

      <h1 class="display hero__title">
        在你正在读的网页里，<br>把英文读懂。
      </h1>

      <p class="lead hero__sub">
        理析在技术文档、GitHub 与论坛里随文解释术语，<br class="hero__br">不打断阅读，也不让你重新背单词。
      </p>

      <div class="hero__actions">
        <a class="btn btn--primary" href="https://github.com/talex-touch/touch-xxeng-heart#安装方法开发者模式" rel="noopener">
          查看安装方式
          <span aria-hidden="true">→</span>
        </a>
        <a class="btn btn--ghost" href="#features">看看它怎么工作</a>
      </div>

      <p class="hero__trust">
        无需注册 · 学习记录保存在本地 · AI 服务端点自行配置
      </p>
    </div>

    <div class="wrap">
      <div class="mock hero__mock">
        <div class="mock__bar">
          <span class="mock__lights" aria-hidden="true"><i /><i /><i /></span>
          <span class="mock__url">
            <span aria-hidden="true">🔒</span>
            <span>developer.mozilla.org/en-US/docs/Web/API/Streams_API</span>
          </span>
          <img src="/assets/icon.png" width="20" height="20" alt="" style="border-radius:5px">
        </div>

        <div class="hero__body">
          <article class="doc">
            <p class="doc__crumb mono">
              WEB APIS › STREAMS API
            </p>
            <h2 class="doc__title">
              Backpressure
            </h2>
            <p class="doc__p">
              When a stream's internal queue fills up, the readable side signals the
              source to slow down. This mechanism is called
              <mark class="term is-tech">backpressure</mark>, and it keeps memory usage
              bounded when the consumer cannot keep up with the producer.
            </p>

            <div class="doc__codeWrap">
              <pre class="doc__code"><code><span class="k">const</span> reader = stream.<span class="f">getReader</span>();
<span class="k">while</span> (<span class="k">true</span>) {
  <span class="k">const</span> { value, done } = <span class="k">await</span> reader.<span class="f">read</span>();
  <span class="k">if</span> (done) <span class="k">break</span>;
  <span class="k">await</span> sink.<span class="f">write</span>(value); <span class="c">// 自动遵循 backpressure</span>
}</code></pre>

              <div class="glass doc__card">
                <div class="doc__cardHead">
                  <img src="/assets/icon.png" width="18" height="18" alt="" style="border-radius:5px">
                  <b>backpressure</b>
                  <span class="tag is-tech">技术</span>
                  <span class="mono doc__pos">n.</span>
                  <span class="mono doc__phonetic">/ˈbækˌpreʃər/</span>
                </div>
                <p class="doc__def">
                  反压。下游处理不过来时向上游传递的减速信号，用来让缓冲区不会无限增长。
                </p>
                <hr>
                <div class="doc__cardFoot">
                  <span class="doc__save">＋ 加入生词本</span>
                  <kbd class="mono">⌘ D</kbd>
                </div>
              </div>
            </div>
          </article>

          <aside class="side hero__side">
            <div class="side__head">
              <img src="/assets/icon.png" width="20" height="20" alt="">
              <span>Lexi</span>
              <span class="count">设置</span>
            </div>
            <div class="side__body">
              <p class="side__label">
                本页术语 <span class="count">6</span>
              </p>
              <ul class="hero__terms">
                <li v-for="t in terms" :key="t.en" :class="{ 'is-active': t.level === 3 }">
                  <span>
                    <b>{{ t.en }}</b>
                    <em>{{ t.zh }}</em>
                  </span>
                  <span class="hero__pips" :aria-label="`掌握度 ${t.level} / 3`">
                    <i v-for="n in 3" :key="n" :class="{ on: n <= t.level }" />
                  </span>
                </li>
              </ul>
              <div class="hero__digest">
                <p class="hero__digestHead">
                  ✦ 本页速读
                </p>
                <p>这一节解释流的背压机制：队列积压时如何向上游传递减速信号，以及它与 highWaterMark 的关系。</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  padding-top: clamp(48px, 6vw, 84px);
  display: grid;
  /* minmax(0,…) keeps the mock's max-content width from widening the page. */
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(40px, 5vw, 52px);
}

.hero__copy {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 26px;
  max-width: 880px;
}

.hero__pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--bg-subtle);
  padding: 7px 15px;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.4;
}

.hero__title {
  max-width: 15em;
}

.hero__sub {
  max-width: 34em;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
}

.hero__trust {
  color: var(--ink-3);
  font-size: 13px;
}

.hero__mock {
  border-radius: var(--r-lg);
}

.hero__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 352px;
}

/* --- document column --- */

.doc {
  padding: clamp(28px, 4vw, 52px) clamp(20px, 4vw, 60px);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 22px;
}

.doc__crumb {
  color: var(--ink-3);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.doc__title {
  font-size: clamp(28px, 3vw, 38px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.2;
}

.doc__p {
  color: var(--ink-2);
  font-size: clamp(14px, 1.2vw, 16px);
  line-height: 1.95;
}

/* Active term: soft domain tint, no underline — deliberately low-key. */
.term {
  border-radius: 5px;
  background: var(--domain-soft);
  padding: 2px 5px;
  color: var(--ink);
  font-weight: 600;
}

.doc__codeWrap {
  position: relative;
  min-width: 0;
}

.doc__code {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-subtle);
  padding: 16px 18px;
  overflow-x: auto;
  color: #2e3038;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.85;
}

.doc__code .k { color: #8250df; }
.doc__code .f { color: #0a7b4e; }
.doc__code .c { color: #9a9aa6; }

/* Frosted definition card floating over the code sample. */
.doc__card {
  position: absolute;
  top: -54px;
  left: 16%;
  width: min(396px, 92%);
  padding: 18px;
  display: grid;
  gap: 13px;
}

.doc__cardHead {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}

.doc__cardHead b {
  font-size: 16px;
  letter-spacing: -0.02em;
}

.doc__pos,
.doc__phonetic {
  color: var(--ink-3);
  font-size: 12px;
}

.doc__def {
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.8;
}

.doc__card hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.doc__cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.doc__save {
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
}

.doc__cardFoot kbd {
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg-subtle);
  padding: 3px 7px;
  color: var(--ink-3);
  font-size: 11px;
}

/* --- side panel --- */

.hero__terms {
  display: grid;
  gap: 6px;
}

.hero__terms li {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 10px 12px;
}

.hero__terms li.is-active {
  border-color: var(--line);
  background: var(--bg);
}

.hero__terms b {
  display: block;
  font-size: 13.5px;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.hero__terms em {
  display: block;
  color: var(--ink-3);
  font-size: 12px;
  font-style: normal;
  line-height: 1.3;
}

.hero__terms span:first-child {
  flex: 1;
  min-width: 0;
}

.hero__pips {
  display: flex;
  gap: 4px;
  flex: none;
}

.hero__pips i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--line-strong);
}

.hero__pips i.on {
  background: var(--accent);
}

.hero__digest {
  display: grid;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
  padding: 14px;
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.75;
}

.hero__digestHead {
  color: var(--ink);
  font-weight: 600;
}

@media (max-width: 1000px) {
  .hero__body {
    grid-template-columns: 1fr;
  }

  .hero__side {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 720px) {
  .hero__br {
    display: none;
  }

  .doc__card {
    position: static;
    width: auto;
    margin-top: 16px;
  }
}
</style>
