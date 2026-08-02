<template>
  <section class="section section--subtle brand-moment">
    <div class="wrap brand-moment__inner">
      <p class="eyebrow">
        Why Lexi
      </p>

      <p class="hand brand-moment__wordmark">
        理析
      </p>
      <p class="mono brand-moment__pinyin">
        lǐ xī · L E X I
      </p>

      <p class="brand-moment__gloss">
        理，是把它读通；析，是把它拆开。
      </p>

      <hr class="brand-moment__rule">

      <p class="brand-moment__statement">
        技术英语不是背出来的。<br>它在代码、文档和讨论里被理解。
      </p>
    </div>
  </section>
</template>

<style scoped>
.brand-moment__inner {
  display: grid;
  justify-items: center;
  text-align: center;
}

.brand-moment__wordmark {
  margin-top: clamp(22px, 3vw, 34px);
  font-size: clamp(64px, 8vw, 104px);
  line-height: 1.25;
}

.brand-moment__pinyin {
  margin-top: 14px;
  color: var(--ink-3);
  font-size: 12px;
  letter-spacing: 0.22em;
}

.brand-moment__gloss {
  margin-top: 26px;
  color: var(--ink-2);
  font-size: clamp(16px, 1.5vw, 19px);
  line-height: 1.8;
}

.brand-moment__rule {
  width: 56px;
  margin: clamp(28px, 4vw, 42px) 0 clamp(26px, 4vw, 40px);
  border: 0;
  border-top: 1px solid var(--line-strong);
}

.brand-moment__statement {
  max-width: 20em;
  font-size: clamp(24px, 3vw, 40px);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1.45;
}
</style>
