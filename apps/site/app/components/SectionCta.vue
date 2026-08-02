<template>
  <section class="section section--subtle cta">
    <div class="wrap cta__inner">
      <img class="cta__mark" src="/assets/icon.png" width="60" height="60" alt="">

      <h2 class="cta__title">
        下一篇英文文档，<br>就从读懂开始。
      </h2>

      <p class="lead cta__desc">
        免费、开源，装上就能用。
      </p>

      <div class="cta__actions">
        <a class="btn btn--primary btn--lg" href="https://github.com/talex-touch/touch-xxeng-heart#安装方法开发者模式" rel="noopener">
          查看安装方式
          <span aria-hidden="true">→</span>
        </a>
        <a class="btn btn--ghost btn--lg" href="https://github.com/talex-touch/touch-xxeng-heart" rel="noopener">
          在 GitHub 上查看
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cta__inner {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 30px;
}

.cta__mark {
  border-radius: 15px;
  box-shadow: 0 10px 26px -6px rgb(13 13 13 / 0.16);
}

.cta__title {
  max-width: 14em;
  font-size: clamp(30px, 3.8vw, 52px);
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 1.3;
}

.cta__desc {
  margin-top: -14px;
}

.cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  margin-top: 8px;
}
</style>
