'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Reveal } from './Reveal'

const steps = [
  {
    no: '01',
    title: '注入',
    desc: '打开任意技术文章，Lexi 按难度与密度替换少量中文技术词为英文。',
  },
  {
    no: '02',
    title: '理解',
    desc: '绿色虚线词 hover 即见释义与例句；选中任意文本，弹出划词翻译。',
  },
  {
    no: '03',
    title: '沉淀',
    desc: '命中与划选词汇自动记录，随学习量提升难度，每天给你一份复盘清单。',
  },
]

export default function HowItWorks() {
  const reduce = useReducedMotion()
  return (
    <section id="how" className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <Reveal>
          <h2 className="max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
            不改变你的工作流。
            <br />
            <span className="text-zinc-500">只在你阅读时轻轻介入。</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.no}
              initial={reduce ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.7, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="group relative bg-[#0f0f12] p-8 md:p-10"
            >
              <span className="font-mono text-sm text-emerald-400/80">{s.no}</span>
              <h3 className="mt-6 text-2xl font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-3 text-[15px] leading-7 text-zinc-400">{s.desc}</p>
              <div className="absolute inset-x-0 bottom-0 h-px scale-x-0 bg-emerald-400/60 transition-transform duration-500 ease-out group-hover:scale-x-100" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
