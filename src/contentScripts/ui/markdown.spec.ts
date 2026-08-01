import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('markdown renderer', () => {
  it('renders common dialog formatting', () => {
    expect(renderMarkdown('**Bold** and `code`\n\n- one\n- two')).toBe(
      '<p><strong>Bold</strong> and <code>code</code></p><ul><li>one</li><li>two</li></ul>',
    )
  })

  it('allows only HTTP links and adds safe link attributes', () => {
    const html = renderMarkdown('[safe](https://example.com) [unsafe](javascript:alert(1))')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">safe</a>')
    expect(html).not.toContain('href="javascript:')
  })

  it('escapes HTML in prose and code fences', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n```html\n<script>alert(1)</script>\n```')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;script&gt;')
  })
})
