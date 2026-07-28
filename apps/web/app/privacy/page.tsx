import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import { Footer } from '@/components/Sections'

export const metadata: Metadata = {
  title: '隐私政策 - Lexi',
  description: '了解 Lexi 如何处理网页内容、学习记录、本地缓存与用户配置的 AI 服务。',
}

const contents = [
  { href: '#overview', label: '概述' },
  { href: '#data', label: '处理的信息' },
  { href: '#storage', label: '本地存储' },
  { href: '#ai', label: 'AI 服务' },
  { href: '#permissions', label: '权限用途' },
  { href: '#choices', label: '你的选择' },
  { href: '#contact', label: '联系我们' },
]

const permissions = [
  ['storage', '保存设置、学习记录与缓存。'],
  ['contextMenus', '在你选中文本时提供“使用 Lexi 翻译”菜单项。'],
  ['downloads', '仅在你主动请求时保存网页媒体文件。'],
  ['sidePanel', '提供浏览器侧边栏中的学习、复习和当前页面控制界面。'],
  ['主机权限', '使扩展能够在你访问的网页中提供术语学习、划词翻译、GitHub 速读和论坛摘要。'],
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#09090b]">
      <Nav />

      <header className="border-b border-white/8 px-6 pb-16 pt-32 md:pb-24 md:pt-44">
        <div className="mx-auto max-w-6xl">
          <p className="mb-6 text-sm font-medium text-emerald-400">Lexi · 隐私政策</p>
          <h1 className="max-w-4xl text-balance text-5xl font-semibold tracking-[-0.04em] text-white md:text-7xl">
            你的学习数据，始终由你掌控。
          </h1>
          <div className="mt-8 flex flex-col gap-2 text-sm text-zinc-400 sm:flex-row sm:items-center sm:gap-6">
            <span>生效日期：2026 年 7 月 17 日</span>
            <span className="hidden h-1 w-1 rounded-full bg-zinc-700 sm:block" aria-hidden="true" />
            <span>适用于 Lexi 浏览器扩展</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-14 px-6 py-16 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-20 lg:py-24">
        <aside className="hidden lg:block">
          <nav className="sticky top-28" aria-label="隐私政策目录">
            <p className="mb-5 text-xs font-medium text-zinc-500">目录</p>
            <ol className="space-y-3 border-l border-white/10 pl-4">
              {contents.map(item => (
                <li key={item.href}>
                  <a className="text-sm text-zinc-500 transition-colors hover:text-emerald-300" href={item.href}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="max-w-3xl text-pretty text-[17px] leading-8 text-zinc-300">
          <section id="overview" className="scroll-mt-28 pb-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">概述</h2>
            <p>
              Lexi 是一款面向技术学习者的浏览器扩展，提供网页技术术语学习、划词翻译、GitHub 仓库速读、技术论坛摘要和本地学习记录功能。本政策说明 Lexi 如何处理与你有关的数据。
            </p>
          </section>

          <section id="data" className="scroll-mt-28 border-t border-white/10 py-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">我们处理的信息</h2>
            <p>
              当你主动使用 Lexi 的功能时，扩展可能处理当前网页中的可见文本、你选中的文本、GitHub 公开仓库页面内容和技术论坛公开主题内容。这些内容只用于提供你当前请求的翻译、术语解释、速读或摘要功能。
            </p>
          </section>

          <section id="storage" className="scroll-mt-28 border-t border-white/10 py-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">本地存储</h2>
            <p>
              Lexi 默认使用浏览器本地存储保存你的设置、词汇学习记录、页面翻译缓存、GitHub 速读缓存、论坛摘要缓存和本地诊断记录。你可以随时在扩展设置中清理相关记录和缓存。
            </p>
          </section>

          <section id="ai" className="scroll-mt-28 border-t border-white/10 py-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">AI 服务</h2>
            <p>
              Lexi 不提供或运营默认 AI 服务。你可以自行配置 AI 服务端点、模型和凭据。启用相关功能后，Lexi 会将完成功能所需的选中文本或页面上下文直接发送至你配置的 AI 服务。请在使用前阅读该服务提供方的隐私政策，并避免发送敏感、机密或不应外发的内容。
            </p>
          </section>

          <section className="border-t border-white/10 py-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">我们不做什么</h2>
            <ul className="space-y-3 text-zinc-300 marker:text-emerald-400">
              <li>不出售你的学习记录或网页内容。</li>
              <li>不将你的数据用于广告定向或建立浏览画像。</li>
              <li>不下载、加载或执行远程 JavaScript、WASM 或其他可执行代码。</li>
              <li>不主动访问你未打开的网站。</li>
            </ul>
          </section>

          <section id="permissions" className="scroll-mt-28 border-t border-white/10 py-12">
            <h2 className="mb-7 text-2xl font-semibold tracking-tight text-white">权限用途</h2>
            <dl className="divide-y divide-white/8 border-y border-white/8">
              {permissions.map(([name, description]) => (
                <div key={name} className="grid gap-2 py-5 sm:grid-cols-[140px_1fr] sm:gap-6">
                  <dt className="font-mono text-sm text-emerald-300">{name}</dt>
                  <dd className="text-[15px] leading-7 text-zinc-400">{description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="choices" className="scroll-mt-28 border-t border-white/10 py-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">你的选择</h2>
            <p>
              你可以在扩展设置中关闭术语替换、自动摘要或其他功能，管理 AI 服务配置，或删除本地词汇记录和缓存。删除扩展也会移除浏览器中由该扩展保存的本地数据。
            </p>
          </section>

          <section id="contact" className="scroll-mt-28 border-t border-white/10 pt-12">
            <h2 className="mb-5 text-2xl font-semibold tracking-tight text-white">联系我们</h2>
            <p>
              如对本政策或 Lexi 的数据处理方式有疑问，请通过
              {' '}
              <a
                className="text-emerald-300 underline decoration-emerald-400/40 underline-offset-4 transition-colors hover:text-emerald-200"
                href="https://github.com/talex-touch/touch-xxeng-heart/issues"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Issues
              </a>
              {' '}
              联系我们。
            </p>
          </section>
        </article>
      </div>

      <Footer />
    </main>
  )
}
