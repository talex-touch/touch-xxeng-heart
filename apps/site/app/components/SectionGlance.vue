<script setup lang="ts">
const platforms = [
  { name: 'GitHub', icon: true, on: true },
  { name: 'Discourse', letter: 'D', on: true },
]

const cards = [
  {
    badges: ['GH'],
    title: 'GitHub 仓库',
    sub: '读取仓库介绍、主题与语言构成',
    stat: '项目定位、技术线索与阅读入口',
    rows: [
      { k: '这是什么', v: '给应用层接入流式模型输出的统一 SDK。' },
      { k: '技术线索', chips: ['TypeScript', 'React', 'Edge'] },
      { k: '从哪读起', paths: ['packages/core/index.ts', 'examples/next-openai/', 'docs/streaming.md'] },
    ],
  },
  {
    badges: ['D'],
    title: 'Discourse 主题',
    sub: '读取主贴与前几条可见回复',
    stat: '主贴、回复共识与仍待确认的问题',
    rows: [
      { k: '主贴在问', v: '重试机制要不要做幂等键？' },
      { k: '回复共识', v: '用请求指纹做幂等键，服务端保留有限窗口。', tone: 'info' },
      { k: '仍待确认', v: '窗口期该由客户端还是服务端决定。', tone: 'warn' },
    ],
  },
]
</script>

<template>
  <section id="glance" class="section glance">
    <div class="wrap">
      <div class="head">
        <div class="head__copy">
          <p class="glance__eyebrow">
            <span class="hand">理析速览</span>
            <span class="eyebrow">Glance</span>
          </p>
          <h2 class="h2">
            打开一个仓库或帖子，<br>先看懂它在讲什么。
          </h2>
        </div>
        <p class="head__desc">
          理析会识别当前页面是否为 GitHub 仓库或 Discourse 主题，再选择对应的速览结构：仓库看定位与入口，论坛看主贴与回复共识。
        </p>
      </div>

      <div class="platforms">
        <p class="platforms__status">
          <span class="platforms__radar" aria-hidden="true" />
          当前支持
        </p>
        <ul class="platforms__list">
          <li v-for="p in platforms" :key="p.name" :class="{ 'is-on': p.on }">
            <AppIcon v-if="p.icon" name="github" :size="14" />
            <i v-else aria-hidden="true">{{ p.letter }}</i>
            {{ p.name }}
          </li>
        </ul>
        <p class="platforms__more mono">
          2 类定向速览
        </p>
      </div>

      <div class="glance__cards">
        <article v-for="c in cards" :key="c.title" class="panel glance__card">
          <header>
            <p class="glance__badges">
              <AppIcon v-if="c.badges[0] === 'GH'" name="github" :size="15" />
              <i v-for="b in c.badges.filter(x => x !== 'GH')" :key="b" aria-hidden="true">{{ b }}</i>
            </p>
            <h3 class="h3">
              {{ c.title }}
            </h3>
            <p class="glance__sub">
              {{ c.sub }}
            </p>
          </header>

          <hr>

          <div class="glance__rows">
            <div v-for="r in c.rows" :key="r.k">
              <p class="glance__k">
                <i v-if="r.tone" class="dot" :class="`tone-${r.tone}`" />{{ r.k }}
              </p>
              <p v-if="r.v" class="glance__v">
                {{ r.v }}
              </p>
              <p v-if="r.chips" class="glance__chips">
                <span v-for="t in r.chips" :key="t" class="chip">{{ t }}</span>
              </p>
              <p v-for="p in r.paths ?? []" :key="p" class="glance__path mono">
                <span aria-hidden="true">↳</span> {{ p }}
              </p>
            </div>
          </div>

          <hr>

          <p class="glance__stat mono">
            {{ c.stat }}
          </p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.glance__eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.glance__eyebrow .hand {
  font-size: 22px;
  line-height: 1.3;
}

.platforms {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: clamp(32px, 4vw, 48px);
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  padding: 16px 20px;
}

.platforms__status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  border-right: 1px solid var(--line-strong);
  padding-right: 16px;
  font-size: 12.5px;
  font-weight: 600;
}

.platforms__radar {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px rgb(25 118 255 / 0.16);
}

.platforms__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  flex: 1;
}

.platforms__list li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  padding: 7px 11px;
  color: var(--ink-3);
  font-size: 12.5px;
}

.platforms__list li.is-on {
  border-color: var(--line);
  background: var(--bg);
  color: var(--ink);
  font-weight: 600;
}

.platforms__list i,
.glance__badges i {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--bg-muted);
  color: var(--ink-3);
  font-family: var(--font-mono);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
}

.platforms__more {
  flex: none;
  color: var(--ink-3);
  font-size: 11px;
}

.glance__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.glance__card {
  display: grid;
  align-content: start;
  gap: 20px;
  padding: 26px;
}

.glance__card hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.glance__card header {
  display: grid;
  gap: 13px;
}

.glance__badges {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
}

.glance__sub {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.75;
}

.glance__rows {
  display: grid;
  gap: 16px;
}

.glance__rows > div {
  display: grid;
  gap: 7px;
}

.glance__k {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 11.5px;
  letter-spacing: 0.03em;
}

.glance__k .tone-ok { background: var(--d-fin); }
.glance__k .tone-warn { background: var(--warn); }
.glance__k .tone-info { background: var(--d-tech); }

.glance__v {
  font-size: 13.5px;
  line-height: 1.7;
}

.glance__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.glance__path {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.6;
}

.glance__path span {
  color: var(--accent);
}

.glance__stat {
  color: var(--ink-3);
  font-size: 11px;
}

@media (max-width: 1000px) {
  .glance__cards {
    grid-template-columns: 1fr;
  }

  .platforms {
    flex-wrap: wrap;
  }

  .platforms__status {
    border-right: 0;
    padding-right: 0;
  }
}
</style>
