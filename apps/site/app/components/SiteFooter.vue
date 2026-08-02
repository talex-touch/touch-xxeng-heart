<script setup lang="ts">
const columns = [
  {
    title: '产品',
    links: [
      { label: '功能', to: '/#features' },
      { label: '理析速览', to: '/#glance' },
      { label: '更新日志', to: 'https://github.com/talex-touch/touch-xxeng-heart/blob/main/CHANGELOG.md', external: true },
    ],
  },
  {
    title: '资源',
    links: [
      { label: '使用文档', to: 'https://github.com/talex-touch/touch-xxeng-heart#readme', external: true },
      { label: 'GitHub', to: 'https://github.com/talex-touch/touch-xxeng-heart', external: true },
      { label: '反馈与提问', to: 'https://github.com/talex-touch/touch-xxeng-heart/issues', external: true },
    ],
  },
  {
    title: '法律',
    links: [
      { label: '隐私政策', to: '/privacy' },
      { label: '权限说明', to: '/privacy#permissions' },
      { label: '常见问题', to: '/#faq' },
    ],
  },
]
</script>

<template>
  <footer class="site-footer">
    <div class="wrap">
      <div class="site-footer__top">
        <div class="site-footer__brand">
          <NuxtLink to="/" aria-label="理析 Lexi 首页">
            <BrandMark :size="24" :hand="22" />
          </NuxtLink>
          <p class="site-footer__tagline">
            在真实技术内容里学习英语。
          </p>
          <p class="site-footer__license mono">
            开源 · MIT License
          </p>
        </div>

        <nav v-for="col in columns" :key="col.title" class="site-footer__col" :aria-label="col.title">
          <p class="site-footer__colTitle">
            {{ col.title }}
          </p>
          <a v-for="link in col.links" :key="link.label" :href="link.to" :rel="link.external ? 'noopener' : undefined">{{ link.label }}</a>
        </nav>
      </div>

      <hr class="site-footer__rule">

      <div class="site-footer__bottom">
        <span class="mono">© 2026 理析 Lexi</span>
        <span>为技术学习者而作</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  padding-block: clamp(48px, 6vw, 72px) clamp(40px, 5vw, 64px);
  background: var(--bg);
  font-size: 13.5px;
}

.site-footer__top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, minmax(0, 180px));
  gap: clamp(32px, 5vw, 80px);
  align-items: start;
}

.site-footer__brand {
  display: grid;
  gap: 16px;
  justify-items: start;
}

.site-footer__tagline {
  max-width: 22em;
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.8;
}

.site-footer__license {
  color: var(--ink-3);
  font-size: 11.5px;
}

.site-footer__col {
  display: grid;
  gap: 14px;
  align-content: start;
  color: var(--ink-2);
}

.site-footer__col a:hover {
  color: var(--ink);
}

.site-footer__colTitle {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
}

.site-footer__rule {
  margin: clamp(36px, 5vw, 56px) 0 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.site-footer__bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: clamp(24px, 3vw, 36px);
  color: var(--ink-3);
  font-size: 12px;
}

@media (max-width: 900px) {
  .site-footer__top {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .site-footer__brand {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .site-footer__top {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .site-footer__bottom {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
