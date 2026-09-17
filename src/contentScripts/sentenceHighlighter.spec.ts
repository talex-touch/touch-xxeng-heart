import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyHighlightStyle,
  renderTranslationSentences,
  setupSentenceHoverListeners,
  unwrapSourceSentences,
  wrapSourceSentences,
} from './sentenceHighlighter'

describe('sentenceHighlighter', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('wraps multi-sentence paragraphs into sentence spans', () => {
    const p = document.createElement('p')
    p.textContent = 'First sentence. Second sentence. Third sentence.'
    document.body.appendChild(p)

    const sentences = ['First sentence.', 'Second sentence.', 'Third sentence.']
    const wrapped = wrapSourceSentences(p, sentences)
    expect(wrapped).toBe(true)

    const spans = p.querySelectorAll<HTMLElement>('span[data-lexi-sentence]')
    expect(spans).toHaveLength(3)
    expect(spans[0].textContent).toBe('First sentence.')
    expect(spans[0].dataset.lexiSentence).toBe('0')
    expect(spans[1].textContent).toBe('Second sentence.')
    expect(spans[1].dataset.lexiSentence).toBe('1')
    expect(spans[2].textContent).toBe('Third sentence.')
    expect(spans[2].dataset.lexiSentence).toBe('2')
  })

  it('is idempotent and does not double-wrap already wrapped elements', () => {
    const p = document.createElement('p')
    p.textContent = 'First sentence. Second sentence.'
    document.body.appendChild(p)

    const sentences = ['First sentence.', 'Second sentence.']
    wrapSourceSentences(p, sentences)
    expect(p.querySelectorAll('span[data-lexi-sentence]')).toHaveLength(2)

    // Call wrap again
    wrapSourceSentences(p, sentences)
    expect(p.querySelectorAll('span[data-lexi-sentence]')).toHaveLength(2)
  })

  it('ignores single sentence paragraphs', () => {
    const p = document.createElement('p')
    p.textContent = 'Only one sentence here.'
    document.body.appendChild(p)

    const wrapped = wrapSourceSentences(p, ['Only one sentence here.'])
    expect(wrapped).toBe(false)
    expect(p.querySelectorAll('span[data-lexi-sentence]')).toHaveLength(0)
  })

  it('unwraps cleanly and restores original DOM text', () => {
    const p = document.createElement('p')
    const originalText = 'First sentence. Second sentence.'
    p.textContent = originalText
    document.body.appendChild(p)

    wrapSourceSentences(p, ['First sentence.', 'Second sentence.'])
    expect(p.querySelectorAll('span[data-lexi-sentence]')).toHaveLength(2)

    unwrapSourceSentences(p)
    expect(p.querySelectorAll('span[data-lexi-sentence]')).toHaveLength(0)
    expect(p.textContent).toBe(originalText)
    // Verify normalize joined text nodes
    expect(p.childNodes.length).toBe(1)
  })

  it('renders translation sentences into separate spans', () => {
    const container = document.createElement('div')
    const sentences = ['第一句。', '第二句。']

    renderTranslationSentences(container, sentences)

    const spans = container.querySelectorAll<HTMLElement>('span[data-lexi-sentence]')
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe('第一句。')
    expect(spans[0].dataset.lexiSentence).toBe('0')
    expect(spans[1].textContent).toBe('第二句。')
    expect(spans[1].dataset.lexiSentence).toBe('1')
  })

  it('applies highlight configuration attributes and styles', () => {
    const el = document.createElement('div')
    applyHighlightStyle(el, 'background', '#10b981')
    expect(el.dataset.lexiHighlightStyle).toBe('background')
    expect(el.style.getPropertyValue('--lexi-highlight-color')).toBe('#10b981')
  })

  it('activates dual-sided highlight on hover', () => {
    const cleanup = setupSentenceHoverListeners()

    const source = document.createElement('p')
    source.textContent = 'First sentence. Second sentence.'
    document.body.appendChild(source)

    wrapSourceSentences(source, ['First sentence.', 'Second sentence.'])

    const translation = document.createElement('div')
    translation.className = 'lexi-page-translation'
    renderTranslationSentences(translation, ['第一句。', '第二句。'])
    source.insertAdjacentElement('afterend', translation)

    const transSpan0 = translation.querySelector<HTMLElement>('[data-lexi-sentence="0"]')!
    const sourceSpan0 = source.querySelector<HTMLElement>('[data-lexi-sentence="0"]')!

    // Hover translation sentence 0
    transSpan0.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(transSpan0.dataset.lexiSentenceActive).toBe('true')
    expect(sourceSpan0.dataset.lexiSentenceActive).toBe('true')

    // Mouse out
    transSpan0.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    expect(transSpan0.dataset.lexiSentenceActive).toBeUndefined()
    expect(sourceSpan0.dataset.lexiSentenceActive).toBeUndefined()

    cleanup()
  })

  it('handles sentences spanning across inline elements and unwraps cleanly', () => {
    const p = document.createElement('p')
    p.innerHTML = 'This is <code>code</code> here. Next sentence.'
    document.body.appendChild(p)

    const sentences = ['This is code here.', 'Next sentence.']
    const wrapped = wrapSourceSentences(p, sentences)
    expect(wrapped).toBe(true)

    const sentence0Spans = p.querySelectorAll<HTMLElement>('[data-lexi-sentence="0"]')
    expect(sentence0Spans.length).toBeGreaterThanOrEqual(1)

    const sentence1Spans = p.querySelectorAll<HTMLElement>('[data-lexi-sentence="1"]')
    expect(sentence1Spans.length).toBeGreaterThanOrEqual(1)
    expect(sentence1Spans[0].textContent).toBe('Next sentence.')

    // Unwrap and verify structure restored
    unwrapSourceSentences(p)
    expect(p.querySelectorAll('[data-lexi-sentence]')).toHaveLength(0)
    expect(p.innerHTML).toBe('This is <code>code</code> here. Next sentence.')
  })

  it('activates dual-sided highlight when hovering the source sentence', () => {
    const cleanup = setupSentenceHoverListeners()

    const source = document.createElement('p')
    source.textContent = 'First sentence. Second sentence.'
    document.body.appendChild(source)

    wrapSourceSentences(source, ['First sentence.', 'Second sentence.'])

    const translation = document.createElement('div')
    translation.className = 'lexi-page-translation'
    renderTranslationSentences(translation, ['第一句。', '第二句。'])
    source.insertAdjacentElement('afterend', translation)

    const transSpan1 = translation.querySelector<HTMLElement>('[data-lexi-sentence="1"]')!
    const sourceSpan1 = source.querySelector<HTMLElement>('[data-lexi-sentence="1"]')!

    // Hover source sentence 1
    sourceSpan1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

    expect(sourceSpan1.dataset.lexiSentenceActive).toBe('true')
    expect(transSpan1.dataset.lexiSentenceActive).toBe('true')

    // Move to sentence 0
    const transSpan0 = translation.querySelector<HTMLElement>('[data-lexi-sentence="0"]')!
    const sourceSpan0 = source.querySelector<HTMLElement>('[data-lexi-sentence="0"]')!

    sourceSpan0.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(sourceSpan1.dataset.lexiSentenceActive).toBeUndefined()
    expect(transSpan1.dataset.lexiSentenceActive).toBeUndefined()
    expect(sourceSpan0.dataset.lexiSentenceActive).toBe('true')
    expect(transSpan0.dataset.lexiSentenceActive).toBe('true')

    cleanup()
  })
})
