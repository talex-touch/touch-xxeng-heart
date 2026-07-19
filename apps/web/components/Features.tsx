import Image from 'next/image'
import { Reveal } from './Reveal'

const features = [
  {
    kicker: '词汇替换',
    title: '在真实语境里遇见单词',
    desc: '按启用范围、替换密度、基础难度和单页上限处理正文。你在读技术文章时，顺便把词学了。',
    img: '/assets/hero-demo.png',
    alt: '文章正文中被替换为英文的词汇带绿色虚线下划线',
    wide: true,
  },
  {
    kicker: '划词翻译',
    title: '选中，就译',
    desc: '选中任何网页文本，翻译说明浮现在手边，同时记入手动学习记录。',
    img: '/assets/feature-select.png',
    alt: '选中文本后浮现的翻译说明卡片',
    wide: false,
  },
  {
    kicker: '词汇进阶',
    title: '会越用越懂你',
    desc: '记录出现次数、手动次数与复盘时间，有效难度随学习量自适应提升。',
    img: '/assets/feature-progress.png',
    alt: '每日词汇复盘面板',
    wide: false,
  },
]

export default function Features() {
  return (
    <section id="features" className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <Reveal>
          <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">
            功能克制，
            <span className="text-zinc-500">但每一下都算数。</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2">
          {features.map((f, i) => (
            <Reveal
              key={f.kicker}
              delay={i * 0.08}
              className={f.wide ? 'md:col-span-2' : ''}
            >
              <article className="group overflow-hidden rounded-2xl border border-white/8 bg-[#0f0f12]">
                <div className="relative aspect-[16/9] overflow-hidden md:aspect-[21/10]">
                  <Image
                    src={f.img}
                    alt={f.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 66vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f12] via-transparent to-transparent opacity-60" />
                </div>
                <div className="px-7 pb-8 pt-1 md:px-9 md:pb-10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-emerald-400/80">
                    {f.kicker}
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight md:text-[1.7rem]">
                    {f.title}
                  </h3>
                  <p className="mt-2.5 max-w-lg text-[15px] leading-7 text-zinc-400">
                    {f.desc}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
