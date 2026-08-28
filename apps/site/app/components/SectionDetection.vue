<script setup lang="ts">
// The four demo entities cycle in the CSS keyframe loop below (--i = slot).
const entities = [
  { en: 'Claude Code', zh: '产品与公司', d: 'prod' },
  { en: 'MCP', zh: '技术工程', d: 'tech' },
  { en: 'per-seat', zh: '金融商业', d: 'fin' },
  { en: 'ARR', zh: '金融商业', d: 'fin' },
  { en: 'infrastructure SaaS', zh: '产品与公司', d: 'prod' },
  { en: 'Series F', zh: '金融商业', d: 'fin' },
  { en: 'post-money valuation', zh: '金融商业', d: 'fin' },
  { en: 'liquidation preference', zh: '金融商业', d: 'fin' },
  { en: 'Class II', zh: '法律合规', d: 'law' },
  { en: 'Phase II trial', zh: '医学生物', d: 'med' },
  { en: 'peer-reviewed', zh: '学术论文', d: 'aca' },
]

const summary = [
  { label: '技术', d: 'tech', n: 1 },
  { label: '金融', d: 'fin', n: 5 },
  { label: '产品', d: 'prod', n: 2 },
  { label: '法律', d: 'law', n: 1 },
  { label: '医学', d: 'med', n: 1 },
  { label: '学术', d: 'aca', n: 1 },
]

// Examples, not inventory: every term below actually ships in the seed dictionary.
const domains = [
  { label: '技术工程', d: 'tech', eg: 'MCP · idempotent · backpressure' },
  { label: '金融商业', d: 'fin', eg: 'ARR · liquidation preference · basis point' },
  { label: '产品与公司', d: 'prod', eg: 'Claude Code · Vite · Stripe' },
  { label: '医学生物', d: 'med', eg: 'Phase II · biomarker · half-life' },
  { label: '法律合规', d: 'law', eg: 'GDPR · force majeure · non-compete' },
  { label: '学术论文', d: 'aca', eg: 'peer-reviewed · p-value · ablation study' },
]

const cycle = ['Claude Code', 'ARR', 'Phase II trial', 'liquidation preference']
</script>

<template>
  <section id="detection" class="section section--subtle detection">
    <div class="wrap">
      <div class="head">
        <div class="head__copy">
          <p class="eyebrow">
            识别范围
          </p>
          <h2 class="h2">
            它认识的，不只是英语单词。
          </h2>
        </div>
        <p class="head__desc">
          技术术语、金融缩写、法律条款、开源项目、公司产品——理析边读边扫描页面，认出专有名词并标出它属于哪个领域。悬停就能展开。
        </p>
      </div>

      <div class="demo">
        <article class="demo__article">
          <p class="demo__source">
            <i aria-hidden="true" />
            <span class="mono">techcrunch.com</span>
            <b>本页 11 个专有名词</b>
          </p>

          <h3 class="demo__headline">
            Anthropic's coding agent goes enterprise
          </h3>

          <p class="demo__body">
            Anthropic said <span class="ent ent--demo is-prod" style="--i:0">Claude Code</span> will ship an
            <span class="ent is-tech">MCP</span> server registry this quarter, letting teams share internal
            tools across agents. Enterprise seats are priced <span class="ent is-fin">per-seat</span> with
            annual commitments, and analysts put the implied
            <span class="ent ent--demo is-fin" style="--i:1">ARR</span> multiple near 18x — well above the
            median for <span class="ent is-prod">infrastructure SaaS</span>. The round was structured as a
            <span class="ent is-fin">Series F</span> at a $183B <span class="ent is-fin">post-money valuation</span>,
            with standard <span class="ent ent--demo is-fin" style="--i:3">liquidation preference</span>.
            Separately, its health arm filed for <span class="ent is-law">Class II</span> clearance and began a
            <span class="ent ent--demo is-med" style="--i:2">Phase II trial</span> of an AI triage tool; results
            are due in a <span class="ent is-aca">peer-reviewed</span> journal next quarter.
          </p>

          <!-- Frosted cards cross-fade in place, one per demo entity. -->
          <div class="cards" aria-hidden="true">
            <div class="glass card" style="--i:0">
              <div class="card__head">
                <b class="card__term">Claude Code</b>
                <span class="tag is-prod">产品与公司</span>
              </div>
              <p class="card__desc">
                Anthropic 推出的终端 AI 编程代理，可直接读写仓库、执行命令，并通过 MCP 接入外部工具。
              </p>
            </div>

            <div class="glass card" style="--i:1">
              <div class="card__head">
                <b class="card__term mono">ARR</b>
                <span class="tag is-fin">金融商业</span>
              </div>
              <p class="card__expansion">
                Annual Recurring Revenue
              </p>
              <p class="card__desc">
                年度经常性收入：订阅业务一年内可重复取得的收入，比一次性收入更能反映稳定性。
              </p>
            </div>

            <div class="glass card" style="--i:2">
              <div class="card__head">
                <b class="card__term">Phase II trial</b>
                <span class="tag is-med">医学生物</span>
              </div>
              <p class="card__desc">
                二期临床试验：在较小规模患者中验证疗效并继续观察安全性，通常 100–300 人。
              </p>
            </div>

            <div class="glass card" style="--i:3">
              <div class="card__head">
                <b class="card__term">liquidation preference</b>
                <span class="tag is-fin">金融商业</span>
              </div>
              <p class="card__desc">
                清算优先权：公司清算或被收购时投资人先于普通股东按约定倍数收回本金的权利，常见为 1x 无参与分配。
              </p>
            </div>
          </div>

          <div class="demo__foot">
            <p class="legend">
              <span v-for="s in summary" :key="s.label" :class="`is-${s.d}`">
                <i class="dot" /> {{ s.label }}
              </span>
            </p>

            <div class="replay">
              <span class="replay__btn"><i aria-hidden="true" />自动演示</span>
              <span class="replay__track" aria-hidden="true">
                <i v-for="n in 4" :key="n" :style="`--i:${n - 1}`" />
              </span>
              <span class="replay__label mono">
                <b v-for="(name, i) in cycle" :key="name" :style="`--i:${i}`">{{ i + 1 }} / 4 · {{ name }}</b>
              </span>
              <span class="replay__hint">光标依次停在每个词上</span>
            </div>
          </div>
        </article>

        <aside class="side demo__side">
          <div class="side__head">
            <img src="/assets/icon.png" width="19" height="19" alt="">
            <span>本页实体</span>
            <span class="count">11</span>
          </div>
          <div class="side__body">
            <p class="demo__summary">
              <span v-for="s in summary" :key="s.label" class="tag" :class="`is-${s.d}`">
                <i class="dot" /> {{ s.label }} {{ s.n }}
              </span>
            </p>
            <ul class="demo__list">
              <li v-for="(e, i) in entities" :key="e.en" :class="[`is-${e.d}`, { 'is-active': i === 0 }]">
                <i class="dot" />
                <span>
                  <b>{{ e.en }}</b>
                  <em>{{ e.zh }}</em>
                </span>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <ul class="domains">
        <li v-for="d in domains" :key="d.label" :class="`is-${d.d}`">
          <p><i class="dot" /> <b>{{ d.label }}</b></p>
          <p class="mono">
            {{ d.eg }}
          </p>
        </li>
      </ul>

      <p class="domains__note">
        六个领域由一份内置的种子词典打底——约 230 条，覆盖长期稳定的术语和一词多义的词。
        这一页特有的名字（本季度的新产品、这篇论文的方法、这份文件里的对手方）由 AI 现场识别并补进来，每页最多一次请求，结果按页面内容缓存。
      </p>

      <div class="panel ambiguity">
        <div class="ambiguity__copy">
          <h3 class="h3">
            同一个词，看上下文再决定。
          </h3>
          <p>
            理析先从网址、标题和正文判断这一页属于哪个领域，再决定给出哪一个释义，而不是把词典里的义项一股脑摊开。
            判断不出来时它会说明，并退回默认释义；选了一边时，卡片也会注明这个词在别的领域另有含义。
          </p>
        </div>
        <div class="ambiguity__examples">
          <div>
            <p class="mono ambiguity__word">
              volatile
            </p>
            <p><span class="tag is-tech">技术</span> 易变的；变量修饰符</p>
            <p><span class="tag is-fin">金融</span> 波动剧烈的</p>
          </div>
          <div>
            <p class="mono ambiguity__word">
              position
            </p>
            <p><span class="tag is-tech">技术</span> 位置、偏移量</p>
            <p><span class="tag is-fin">金融</span> 持仓、头寸</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* One 16s loop, four 4s slots. Everything keyed off --i stays in step. */
.demo {
  --cycle: 16s;
  --slot: 25%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 334px;
  margin-top: clamp(32px, 4vw, 48px);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg);
  overflow: hidden;
}

.demo__article {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: clamp(20px, 3vw, 32px);
}

.demo__source {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ink-3);
  font-size: 11.5px;
}

.demo__source i {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--ink-3);
}

.demo__source b {
  margin-left: auto;
  border-radius: var(--r-pill);
  background: var(--accent-soft);
  padding: 5px 10px;
  color: var(--accent-ink);
  font-size: 11.5px;
  font-weight: 500;
}

.demo__headline {
  font-size: clamp(20px, 2.1vw, 25px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.35;
}

.demo__body {
  max-width: 44em;
  color: var(--ink-2);
  font-size: clamp(14px, 1.15vw, 16px);
  line-height: 2.1;
}

/* Recognised entity: text untouched, one small domain dot after it. */
.ent {
  position: relative;
  border-radius: 4px;
  padding: 1px 2px;
}

.ent::after {
  content: '';
  display: inline-block;
  width: 4.5px;
  height: 4.5px;
  margin-left: 3px;
  border-radius: 50%;
  background: var(--domain);
  vertical-align: 0.18em;
}

.ent--demo {
  animation: entOn var(--cycle) infinite both;
  animation-delay: calc(var(--i) * var(--cycle) / 4);
}

.ent--demo::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 42%;
  width: 17px;
  height: 17px;
  margin-top: 2px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230d0d0d'%3E%3Cpath d='m4 4 7.07 17 2.51-7.39L21 11.07z'/%3E%3C/svg%3E") center / contain no-repeat;
  animation: cursorOn var(--cycle) infinite both;
  animation-delay: calc(var(--i) * var(--cycle) / 4);
}

@keyframes entOn {
  0%, 24%, 100% { background: transparent; color: inherit; }
  2%, 22% { background: var(--domain-soft); color: var(--ink); }
}

@keyframes cursorOn {
  0%, 24%, 100% { opacity: 0; }
  3%, 22% { opacity: 1; }
}

/* --- floating card stack --- */

.cards {
  position: absolute;
  top: 128px;
  right: clamp(16px, 2vw, 28px);
  width: 340px;
  min-height: 190px;
  pointer-events: none;
}

.card {
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  display: grid;
  gap: 12px;
  padding: 18px;
  animation: cardOn var(--cycle) infinite both;
  animation-delay: calc(var(--i) * var(--cycle) / 4);
}

@keyframes cardOn {
  0% { opacity: 0; transform: translateY(8px); }
  3%, 21% { opacity: 1; transform: none; }
  24%, 100% { opacity: 0; transform: translateY(-6px); }
}

.card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.card__term {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  letter-spacing: -0.02em;
  line-height: 1.35;
}

.card__expansion {
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: -4px;
}

.card__desc {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.85;
}

.card__note {
  color: var(--ink-3);
  font-size: 11.5px;
  line-height: 1.6;
}

/* --- legend + replay --- */

.demo__foot {
  display: grid;
  gap: 18px;
  margin-top: auto;
  padding-top: 4px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  border-top: 1px solid var(--line);
  padding-top: 18px;
  color: var(--ink-2);
  font-size: 11.5px;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.replay {
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid var(--line);
  padding-top: 18px;
}

.replay__btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--ink);
  padding: 7px 12px;
  color: var(--inverse);
  font-size: 11.5px;
  font-weight: 500;
}

.replay__btn i {
  width: 0;
  height: 0;
  border-left: 6px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}

.replay__track {
  display: flex;
  gap: 6px;
  flex: none;
}

.replay__track i {
  width: 22px;
  height: 6px;
  border-radius: 3px;
  background: var(--line-strong);
  animation: segOn var(--cycle) infinite both;
  animation-delay: calc(var(--i) * var(--cycle) / 4);
}

@keyframes segOn {
  0%, 24%, 100% { background: var(--line-strong); }
  2%, 22% { background: var(--accent); }
}

.replay__label {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 1.4em;
  color: var(--ink-3);
  font-size: 11px;
}

.replay__label b {
  position: absolute;
  inset: 0;
  font-weight: 400;
  white-space: nowrap;
  animation: cardOn var(--cycle) infinite both;
  animation-delay: calc(var(--i) * var(--cycle) / 4);
}

.replay__hint {
  flex: none;
  color: var(--ink-3);
  font-size: 11.5px;
}

/* --- side panel --- */

.demo__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.demo__summary .tag {
  justify-content: center;
  padding: 5px 6px;
}

.demo__list {
  display: grid;
  gap: 3px;
}

.demo__list li {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 9px 11px;
}

.demo__list li.is-active {
  border-color: var(--domain);
  background: var(--bg);
}

.demo__list b {
  display: block;
  font-size: 12.5px;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.demo__list em {
  display: block;
  color: var(--ink-3);
  font-size: 10.5px;
  font-style: normal;
  line-height: 1.3;
}

/* --- domain strip --- */

.domains {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.domains li {
  display: grid;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--bg);
  padding: 15px 17px;
}

.domains p {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.domains p.mono {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.55;
}

.domains__note {
  max-width: 76ch;
  margin-top: 16px;
  color: var(--ink-3);
  font-size: 12.5px;
  line-height: 1.9;
}

/* --- disambiguation --- */

.ambiguity {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: clamp(24px, 4vw, 48px);
  align-items: center;
  margin-top: 16px;
  padding: clamp(24px, 3vw, 32px);
}

.ambiguity__copy p {
  margin-top: 12px;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.85;
}

.ambiguity__examples {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.ambiguity__examples > div {
  display: grid;
  gap: 12px;
  border-radius: 14px;
  background: var(--bg-subtle);
  padding: 18px;
  font-size: 12.5px;
}

.ambiguity__examples p {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-2);
}

.ambiguity__word {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink);
}

@media (max-width: 1080px) {
  .demo {
    grid-template-columns: 1fr;
  }

  .demo__side {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  /* Stack moves into flow but keeps cycling. */
  .cards {
    position: relative;
    top: auto;
    right: auto;
    width: auto;
    min-height: 230px;
    margin-top: 4px;
  }

  .domains {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ambiguity {
    grid-template-columns: 1fr;
    align-items: start;
  }
}

@media (max-width: 620px) {
  .domains {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ambiguity__examples {
    grid-template-columns: 1fr;
  }

  .replay__hint,
  .replay__label {
    display: none;
  }
}

/* Static first frame when motion is reduced. */
@media (prefers-reduced-motion: reduce) {
  .ent--demo,
  .ent--demo::before,
  .replay__track i {
    animation: none;
  }

  .ent--demo[style*='--i:0'] {
    background: var(--domain-soft);
    color: var(--ink);
  }

  .card {
    animation: none;
    opacity: 0;
  }

  .card[style*='--i:0'] {
    opacity: 1;
  }

  .replay__label b {
    animation: none;
    opacity: 0;
  }

  .replay__label b[style*='--i:0'] {
    opacity: 1;
  }
}
</style>
