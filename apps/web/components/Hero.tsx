'use client'

import { motion, useReducedMotion } from 'motion/react'
import Image from 'next/image'
import { useState } from 'react'

const EASE = [0.16, 1, 0.3, 1] as const

const articleLines = [
  { zh: '服务端组件允许你将渲染逻辑留在', en: 'server', rest: '，', done: true },
  { zh: '避免把不必要的', en: 'bundle', rest: ' 发送到客户端。', done: true },
  { zh: '数据获取可以直接在组件内部', en: 'await', rest: '，', done: true },
  { zh: '而流式传输让页面更早变得可', en: 'interactive', rest: '。', done: true },
]

export default function Hero() {
  const reduce = useReducedMotion()
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <section className="relative overflow-hidden">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full opacity-20 blur-[120px]"
        style={{ background: 'radial-gradient(closest-side, #34d399, transparent)' }}
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 pt-32 pb-20 md:pt-40 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        {/* copy */}
        <div>
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE }}
            className="text-balance text-5xl font-semibold leading-[1.06] tracking-tight md:text-[4.5rem] md:leading-[1.03]"
          >
            把网页
            <br />
            变成你的
            <span className="text-emerald-400">英语环境</span>
            。
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            className="mt-6 max-w-md text-lg leading-relaxed text-zinc-400"
          >
            Lexi 在你浏览的技术文章里替换少量中文词汇为英文，划词即译，学习进度自动沉淀。
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
            className="mt-9 flex items-center gap-4"
          >
            <a
              href="#install"
              className="inline-flex h-11 items-center rounded-full bg-emerald-400 px-6 text-sm font-medium text-emerald-950 transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
            >
              免费安装
            </a>
            <a
              href="#how"
              className="inline-flex h-11 items-center rounded-full border border-white/15 px-6 text-sm font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
            >
              了解原理
            </a>
          </motion.div>
        </div>

        {/* interactive demo */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, delay: 0.2, ease: EASE }}
          className="relative"
        >
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f12] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.7)]">
            {/* browser bar */}
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="ml-3 flex-1 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-zinc-500">
                blog.example.dev/react-server-components
              </span>
            </div>

            <div className="px-6 py-6 md:px-7 md:py-7">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                前端工程 · 阅读时间 8 分钟
              </p>
              <h3 className="mt-3 text-xl font-semibold leading-snug text-zinc-100">
                深入理解 Server Components 的渲染模型
              </h3>

              <div className="mt-5 space-y-3.5 text-[15px] leading-8 text-zinc-300">
                {articleLines.map((line, i) => (
                  <p key={i}>
                    {line.zh}
                    <span
                      className="relative inline-block"
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <span className="lexi-word font-medium">{line.en}</span>
                      {hovered === i && (
                        <motion.span
                          initial={{ opacity: 0, y: 6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: 0.22, ease: EASE }}
                          className="absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-xl border border-white/10 bg-[#16161a] p-3 shadow-2xl"
                        >
                          <span className="block font-mono text-[11px] text-zinc-500">
                            原词 ·
                            {' '}
                            {line.en === 'server' ? '服务端' : line.en === 'bundle' ? '打包产物' : line.en === 'await' ? '等待' : '可交互的'}
                          </span>
                          <span className="mt-1 block text-[13px] leading-5 text-zinc-200">
                            {line.en === 'server' && '在服务端执行的组件，不占用客户端体积。'}
                            {line.en === 'bundle' && '打包后的 JavaScript 资源体积。'}
                            {line.en === 'await' && '异步等待数据返回再继续渲染。'}
                            {line.en === 'interactive' && '页面可响应用户输入的状态。'}
                          </span>
                          <span className="mt-1.5 block text-[12px] italic leading-5 text-emerald-300/80">
                            {line.en === 'server' && 'Render it on the server.'}
                            {line.en === 'bundle' && 'Keep the bundle small.'}
                            {line.en === 'await' && 'Await the data inside.'}
                            {line.en === 'interactive' && 'It becomes interactive earlier.'}
                          </span>
                        </motion.span>
                      )}
                    </span>
                    {line.rest}
                  </p>
                ))}
              </div>

              <p className="mt-5 font-mono text-[11px] text-zinc-600">
                悬停绿色单词试试
              </p>
            </div>
          </div>

          {/* floating icon */}
          <motion.div
            animate={reduce ? {} : { y: [0, -10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -right-4 -top-5 hidden rounded-2xl border border-white/10 bg-[#141417] p-2.5 shadow-xl md:block"
          >
            <Image src="/assets/icon-512.png" alt="Lexi 图标" width={40} height={40} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
