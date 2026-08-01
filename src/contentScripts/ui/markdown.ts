function escapeMarkdownHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderInlineMarkdown(value: string) {
  const escaped = escapeMarkdownHtml(value)
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

export function renderMarkdown(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean, items: string[] } | undefined
  let codeLines: string[] | undefined
  let codeLanguage = ''

  const flushParagraph = () => {
    if (!paragraph.length)
      return

    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list)
      return

    const tag = list.ordered ? 'ol' : 'ul'
    html.push(`<${tag}>${list.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`)
    list = undefined
  }

  for (const line of lines) {
    const fenceText = line.trim()
    if (fenceText.startsWith('```')) {
      if (codeLines) {
        html.push(`<pre><code${codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''}>${escapeMarkdownHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = undefined
        codeLanguage = ''
      }
      else if (/^```[\w-]*$/.test(fenceText)) {
        flushParagraph()
        flushList()
        codeLines = []
        codeLanguage = fenceText.slice(3)
      }
      continue
    }

    if (codeLines) {
      codeLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`)
      continue
    }

    const bulletPrefix = trimmed.slice(0, 2)
    const bulletItem = ['- ', '* ', '+ '].includes(bulletPrefix)
      ? trimmed.slice(2).trim()
      : ''
    const orderedMatch = trimmed.match(/^(\d{1,3})[.)] (.*)$/)
    if (bulletItem || orderedMatch) {
      flushParagraph()
      const isOrdered = Boolean(orderedMatch)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(bulletItem || (orderedMatch?.[2] ?? '').trim())
      continue
    }

    paragraph.push(trimmed)
  }

  if (codeLines)
    html.push(`<pre><code${codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''}>${escapeMarkdownHtml(codeLines.join('\n'))}</code></pre>`)
  flushParagraph()
  flushList()

  return html.join('') || '<p></p>'
}
