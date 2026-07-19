import Image from 'next/image'

const GITHUB = 'https://github.com/talex-touch/touch-xxeng-heart'

const links = [
  { label: '工作原理', href: '#how' },
  { label: '功能', href: '#features' },
  { label: '安装', href: '#install' },
]

export default function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2.5">
          <span className="rounded-lg border border-white/10 bg-[#141417] p-1">
            <Image src="/assets/icon-512.png" alt="" width={20} height={20} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Lexi</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href={GITHUB}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded-full border border-white/15 px-4 text-sm text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
        >
          GitHub
        </a>
      </div>
      {/* backdrop only under content width */}
      <div className="pointer-events-none absolute inset-0 -z-10 border-b border-white/5 bg-[#09090b]/70 backdrop-blur-md" />
    </header>
  )
}
