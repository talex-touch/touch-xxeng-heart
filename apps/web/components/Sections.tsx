import { Reveal } from './Reveal'

const GITHUB = 'https://github.com/talex-touch/touch-xxeng-heart'

const caps = [
  { t: '每日推荐', d: '侧边栏提供 Lexical 学习空间、专业术语与待复盘词汇。' },
  { t: '场景化 AI', d: '替换、划词、推荐可配置独立模型；未配置时走本地术语库。' },
  { t: '站点策略', d: '全部网页、白名单、黑名单与特殊站点策略，一键总开关。' },
  { t: '本地优先', d: '学习数据记录在你自己的浏览器里，不依赖任何账号。' },
]

export default function More() {
  return (
    <section className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr] md:gap-20">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              还有更多，
              <br />
              都在选项页里。
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-zinc-400">
              Lexi 不追求功能堆砌。每一样设置都指向同一件事：让你在真实网页里自然积累英文词汇。
            </p>
          </Reveal>

          <div className="grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2">
            {caps.map((c, i) => (
              <Reveal key={c.t} delay={i * 0.06}>
                <div className="border-t border-white/10 pt-5">
                  <h3 className="text-lg font-semibold">{c.t}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{c.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export function CTA() {
  return (
    <section id="install" className="relative overflow-hidden border-t border-white/5">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[720px] -translate-x-1/2 rounded-full opacity-15 blur-[100px]"
        style={{ background: 'radial-gradient(closest-side, #34d399, transparent)' }}
      />
      <div className="mx-auto max-w-6xl px-6 py-32 text-center md:py-44">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-400/80">
            开源 · 免费 · 本地运行
          </p>
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
            从今天开始，
            <br />
            读网页顺便背单词。
          </h2>
          <div className="mt-10 flex items-center justify-center gap-4">
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center rounded-full bg-emerald-400 px-8 text-[15px] font-medium text-emerald-950 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
            >
              免费安装
            </a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center rounded-full border border-white/15 px-8 text-[15px] font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
            >
              Star on GitHub
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 text-sm text-zinc-500 md:flex-row md:items-center">
        <span>Lexi · 面向程序员的语境英语学习</span>
        <div className="flex gap-6">
          <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-zinc-200">
            GitHub
          </a>
          <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer" className="transition-colors hover:text-zinc-200">
            反馈
          </a>
        </div>
      </div>
    </footer>
  )
}
