<script setup lang="ts">
useSeoMeta({
  title: '隐私政策 — 理析 Lexi',
  description: '理析 Lexi 隐私政策：本地优先的数据处理、AI 服务端点由你配置、不执行远程代码。',
})

const permissions = [
  ['storage', '保存设置、学习记录、缓存和本地诊断记录。'],
  ['contextMenus', '在用户选中文本时提供「使用理析翻译」菜单项。'],
  ['downloads', '仅在用户主动请求时保存网页媒体文件。'],
  ['sidePanel', '提供浏览器侧边栏中的学习、复习和当前页面控制界面。'],
  ['主机权限', '使扩展能够在用户访问的网页中提供术语学习、划词翻译、理析速览和论坛摘要。'],
]
</script>

<template>
  <article class="policy wrap">
    <header class="policy__hero">
      <p class="eyebrow">
        理析 Lexi
      </p>
      <h1 class="display policy__title">
        隐私政策
      </h1>
      <p class="policy__date">
        生效日期：2026 年 7 月 17 日
      </p>
    </header>

    <div class="policy__body">
      <section>
        <h2 class="h3">
          概述
        </h2>
        <p>理析（Lexi）是一款面向技术学习者的浏览器扩展，提供网页术语学习、划词翻译、理析速览（仓库与论坛速读）和本地学习记录功能。本政策说明理析如何处理与你有关的数据。</p>
      </section>

      <section>
        <h2 class="h3">
          我们处理的信息
        </h2>
        <p>当你主动使用理析的功能时，扩展可能处理当前网页中的可见文本、你选中的文本、公开仓库页面内容和技术论坛公开主题内容。这些内容只用于提供你当前请求的翻译、术语解释、速览或摘要功能。</p>
      </section>

      <section>
        <h2 class="h3">
          本地存储
        </h2>
        <p>理析默认使用浏览器本地存储保存你的设置、词汇学习记录、页面翻译缓存、速览缓存、论坛摘要缓存和本地诊断记录。你可以在扩展设置中清理相关记录和缓存。</p>
      </section>

      <section>
        <h2 class="h3">
          场景规则
        </h2>
        <p>理析内置学习通与雨课堂的停用策略，在这些站点不进行术语标注与翻译。对于其他考试、支付、内网或管理系统，你可以在设置中按域名加入黑名单，或关闭全局开关。</p>
      </section>

      <section>
        <h2 class="h3">
          AI 服务
        </h2>
        <p>理析不提供或运营默认 AI 服务。你可以自行配置 AI 服务端点、模型和凭据。启用相关功能后，理析会将完成功能所需的选中文本或页面上下文直接发送至你配置的 AI 服务。请在使用前阅读该服务提供方的隐私政策，并避免发送敏感、机密或不应外发的内容。</p>
      </section>

      <section>
        <h2 class="h3">
          我们不做什么
        </h2>
        <ul class="policy__list">
          <li>不出售你的学习记录或网页内容。</li>
          <li>不将你的数据用于广告定向或建立浏览画像。</li>
          <li>不下载、加载或执行远程 JavaScript、WASM 或其他可执行代码。</li>
          <li>不主动访问你未打开的网站。</li>
        </ul>
      </section>

      <section id="permissions">
        <h2 class="h3">
          权限用途
        </h2>
        <dl class="policy__dl">
          <div v-for="[name, use] in permissions" :key="name">
            <dt class="mono">
              {{ name }}
            </dt>
            <dd>{{ use }}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 class="h3">
          你的选择
        </h2>
        <p>你可以在扩展设置中关闭术语替换、自动摘要或其他功能，管理 AI 服务配置，或删除本地词汇记录和缓存。删除扩展也会移除浏览器中由该扩展保存的本地数据。</p>
      </section>

      <section>
        <h2 class="h3">
          联系我们
        </h2>
        <p>如对本政策或理析的数据处理方式有疑问，请通过 Chrome Web Store 商品页中公布的支持联系方式联系我们，或在 GitHub Issues 中提出。</p>
      </section>
    </div>
  </article>
</template>

<style scoped>
.policy {
  max-width: 860px;
  padding-block: clamp(56px, 8vw, 100px) clamp(72px, 9vw, 120px);
}

.policy__hero {
  display: grid;
  gap: 20px;
  border-bottom: 1px solid var(--line);
  padding-bottom: clamp(32px, 5vw, 50px);
}

.policy__title {
  font-size: clamp(40px, 6vw, 72px);
}

.policy__date {
  color: var(--ink-2);
  font-size: 15px;
}

.policy__body {
  display: grid;
  gap: clamp(32px, 4vw, 46px);
  padding-top: clamp(36px, 5vw, 58px);
}

.policy__body section {
  display: grid;
  gap: 14px;
}

.policy__body p,
.policy__body li,
.policy__body dd {
  color: var(--ink-2);
  font-size: 15.5px;
  line-height: 1.95;
}

.policy__list {
  display: grid;
  gap: 8px;
  padding-left: 22px;
  list-style: disc;
}

.policy__dl {
  display: grid;
}

.policy__dl > div {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 20px;
  border-top: 1px solid var(--line);
  padding: 17px 0;
}

.policy__dl dt {
  color: var(--accent-ink);
  font-size: 14px;
  font-weight: 600;
}

.policy__dl dd {
  margin: 0;
}

@media (max-width: 620px) {
  .policy__dl > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
