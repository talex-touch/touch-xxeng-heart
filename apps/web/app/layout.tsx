import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lexi - 把网页变成你的英语环境',
  description:
    'Lexi 是一款面向程序员的 Chrome 扩展：在真实网页中替换少量中文技术词为英文，划词即译，自动沉淀学习进度。',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="grain font-sans">{children}</body>
    </html>
  )
}
