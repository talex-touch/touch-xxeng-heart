<template>
  <header class="site-header">
    <div class="wrap site-header__inner">
      <NuxtLink to="/" aria-label="理析 Lexi 首页">
        <BrandMark />
      </NuxtLink>

      <nav class="site-header__nav" aria-label="主导航">
        <NuxtLink to="/#features">
          功能
        </NuxtLink>
        <NuxtLink to="/#glance">
          速览
        </NuxtLink>
        <NuxtLink to="/#privacy">
          隐私
        </NuxtLink>
        <NuxtLink to="/#faq">
          常见问题
        </NuxtLink>
      </nav>

      <div class="site-header__actions">
        <a class="site-header__link" href="https://github.com/talex-touch/touch-xxeng-heart" rel="noopener">GitHub</a>
        <a class="btn btn--primary btn--sm" href="https://github.com/talex-touch/touch-xxeng-heart" rel="noopener">
          获取源码
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgb(255 255 255 / 0.82);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  backdrop-filter: saturate(180%) blur(16px);
}

.site-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: 76px;
}

.site-header__nav {
  display: flex;
  align-items: center;
  gap: 34px;
  color: var(--ink-2);
  font-size: 14px;
}

.site-header__nav a:hover {
  color: var(--ink);
}

.site-header__actions {
  display: flex;
  align-items: center;
  gap: 22px;
}

.site-header__link {
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 500;
}

.site-header__link:hover {
  color: var(--ink);
}

@media (max-width: 900px) {
  .site-header__nav {
    display: none;
  }
}

@media (max-width: 560px) {
  .site-header__link {
    display: none;
  }

  .site-header__inner {
    height: 64px;
  }
}
</style>
