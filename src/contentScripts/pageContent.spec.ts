// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { capturePageDocument, clearPageDocumentCache, findAnchorSegmentId, revealPageSegment } from './pageContent'
import { rankSegments, selectSegments } from '~/logic/contextRetrieval'

/**
 * A page shaped like the ones that broke the old extractor: a long nav and a cookie
 * banner sit ahead of the article, so `body.textContent.slice(0, 1200)` returned chrome.
 */
const articlePage = `
  <header class="site-header">
    <nav>
      <a href="/">首页</a><a href="/docs">文档</a><a href="/blog">博客</a>
      <a href="/pricing">定价</a><a href="/about">关于我们</a><a href="/login">登录</a>
    </nav>
  </header>
  <div class="cookie-banner">我们使用 Cookie 来改善您的浏览体验，继续访问即表示您同意我们的隐私政策与条款。</div>
  <main>
    <article>
      <h1>部署指南</h1>
      <p>本文介绍如何把服务部署到生产环境，包括构建、配置和上线检查。请先确保本地能够正常构建。</p>
      <h2>环境变量</h2>
      <p>通过 PORT 环境变量可以修改监听端口，默认值为 3000。修改后需要重启进程才会生效。</p>
      <pre>PORT=8080 node server.js</pre>
      <h2>数据库迁移</h2>
      <p>上线前必须执行数据库迁移脚本，否则新版本的表结构不存在会导致启动失败。</p>
      <ul>
        <li>先在预发环境执行一次迁移，确认没有报错再操作生产环境。</li>
        <li>迁移期间建议开启维护模式，避免写入冲突造成数据不一致。</li>
      </ul>
    </article>
  </main>
  <footer><p>版权所有 © 2026 示例公司，保留一切权利。备案号 12345678 号。</p></footer>
`

describe('capturePageDocument', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearPageDocumentCache()
  })

  it('extracts the article and drops nav, cookie banner and footer', () => {
    document.body.innerHTML = articlePage
    const captured = capturePageDocument()
    const allText = captured.segments.map(segment => segment.text).join(' ')

    expect(allText).toContain('PORT 环境变量')
    expect(allText).not.toContain('Cookie')
    expect(allText).not.toContain('备案号')
    expect(allText).not.toContain('定价')
  })

  it('builds a heading outline with breadcrumb trails', () => {
    document.body.innerHTML = articlePage
    const captured = capturePageDocument()

    expect(captured.outline).toContain('部署指南')
    expect(captured.outline).toContain('部署指南 › 环境变量')
  })

  it('tags body segments with their enclosing section', () => {
    document.body.innerHTML = articlePage
    const captured = capturePageDocument()
    const portSegment = captured.segments.find(segment => segment.text.includes('PORT 环境变量'))

    expect(portSegment?.heading).toBe('部署指南 › 环境变量')
  })

  it('classifies code blocks and list items', () => {
    document.body.innerHTML = articlePage
    const captured = capturePageDocument()
    const kinds = new Set(captured.segments.map(segment => segment.kind))

    expect(kinds.has('code')).toBe(true)
    expect(kinds.has('list')).toBe(true)
    expect(kinds.has('heading')).toBe(true)
  })

  it('reads the author original back out of Lexi replacement tokens', () => {
    document.body.innerHTML = `
      <main><article><p>请配置<span data-lexi-token="true" data-original="反向代理">reverse proxy</span>后再重启服务，确保端口转发正确。</p></article></main>
    `
    const captured = capturePageDocument()

    expect(captured.segments[0].text).toContain('反向代理')
    expect(captured.segments[0].text).not.toContain('reverse proxy')
  })

  it('skips Lexi\'s own injected surfaces', () => {
    document.body.innerHTML = `
      <main><article>
        <p>这是页面本身的正文内容，应该被抽取出来用于回答问题。</p>
        <div data-lexi-page-translation="true"><p>这是 Lexi 注入的译文，不应该被当成页面正文。</p></div>
      </article></main>
    `
    const captured = capturePageDocument()
    const allText = captured.segments.map(segment => segment.text).join(' ')

    expect(allText).toContain('页面本身的正文内容')
    expect(allText).not.toContain('Lexi 注入的译文')
  })

  it('does not duplicate text from nested block elements', () => {
    document.body.innerHTML = `
      <main><article><li><p>这一段被 li 包着，不应该同时以 li 和 p 的身份出现两次。</p></li></article></main>
    `
    const captured = capturePageDocument()
    expect(captured.segments).toHaveLength(1)
  })
})

describe('retrieval over a captured page', () => {
  beforeEach(() => {
    document.body.innerHTML = articlePage
    clearPageDocumentCache()
  })

  it('answers a question with the right section instead of the page opening', () => {
    const captured = capturePageDocument()
    const picked = selectSegments(rankSegments('端口怎么改', captured.segments), { maxTokens: 400 })
    const text = picked.segments.map(segment => segment.text).join(' ')

    expect(text).toContain('PORT 环境变量')
    expect(text).not.toContain('数据库迁移脚本')
  })

  it('retrieves the migration section for a different question on the same page', () => {
    const captured = capturePageDocument()
    const picked = selectSegments(rankSegments('迁移数据库要注意什么', captured.segments), { maxTokens: 400 })
    const text = picked.segments.map(segment => segment.text).join(' ')

    expect(text).toContain('迁移')
    expect(text).not.toContain('默认值为 3000')
  })

  it('anchors retrieval to the segment holding the selection', () => {
    const captured = capturePageDocument()
    const anchor = findAnchorSegmentId(captured, '默认值为 3000')

    expect(anchor).toBeDefined()
    expect(captured.segments.find(segment => segment.id === anchor)?.text).toContain('PORT')
  })
})

describe('revealPageSegment', () => {
  beforeEach(() => {
    document.body.innerHTML = articlePage
    clearPageDocumentCache()
  })

  it('flashes the captured element behind a segment', () => {
    const captured = capturePageDocument()
    const segment = captured.segments.find(item => item.text.includes('PORT 环境变量'))!

    expect(revealPageSegment(segment)).toBe(true)
    const flashed = document.querySelector('.lexi-segment-flash')
    expect(flashed?.textContent).toContain('PORT 环境变量')
  })

  it('falls back to a text search when the captured element was replaced', () => {
    const captured = capturePageDocument()
    const segment = captured.segments.find(item => item.text.includes('PORT 环境变量'))!

    // Simulate an SPA re-render: same content, brand-new DOM nodes.
    const html = document.body.innerHTML
    document.body.innerHTML = html

    expect(revealPageSegment(segment)).toBe(true)
    expect(document.querySelector('.lexi-segment-flash')?.textContent).toContain('PORT 环境变量')
  })

  it('reports failure when the content is gone entirely', () => {
    const captured = capturePageDocument()
    const segment = captured.segments.find(item => item.text.includes('PORT 环境变量'))!
    document.body.innerHTML = '<main><article><p>完全不同的内容，原来的段落已经不存在了。</p></article></main>'

    expect(revealPageSegment(segment)).toBe(false)
  })
})
