// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAnimatedText } from './animatedText'

/**
 * The incremental renderer is what keeps a streaming translation from flickering: stable
 * text must survive untouched while only the appended characters are re-marked for the
 * reveal animation, a replacement must not leave stale text behind, and the highlight
 * must be cleared once the animation window closes.
 */

function mountContainer() {
  const element = document.createElement('p')
  document.body.append(element)
  return element
}

function highlightedChars(element: HTMLElement) {
  return Array.from(element.querySelectorAll<HTMLElement>('.lexi-selection-translation__char[data-lexi-new="true"]'))
    .map(char => char.textContent)
    .join('')
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('renderAnimatedText', () => {
  it('replaces the text outright when the reveal chunk is suppressed', () => {
    const element = mountContainer()
    element.textContent = '上一版翻译'

    renderAnimatedText(element, '分析中...', '上一版翻译', false)

    expect(element.textContent).toBe('分析中...')
    expect(element.querySelectorAll('.lexi-selection-translation__chunk')).toHaveLength(0)
  })

  it('replaces the text outright when the new text does not extend the old one', () => {
    const element = mountContainer()
    element.textContent = '旧的结果'

    renderAnimatedText(element, '一个完全不同的结果', '旧的结果', true)

    expect(element.textContent).toBe('一个完全不同的结果')
    expect(highlightedChars(element)).toBe('')
  })

  it.each([
    ['a plain mid-stream append', 'Hello', 'Hello world'],
    ['an append after trailing whitespace', 'Hello ', 'Hello world'],
    ['a CJK append', '你好', '你好，世界'],
    ['a single new character', '进度', '进度…'],
  ])('renders exactly the new text for %s', (_name, previous, next) => {
    const element = mountContainer()
    element.textContent = previous

    renderAnimatedText(element, next, previous, true)

    expect(element.textContent).toBe(next)
    const stable = previous.replace(/\s+$/, '')
    const expectedChunk = previous.slice(stable.length) + next.slice(previous.length)
    expect(highlightedChars(element)).toBe(expectedChunk)
    expect(element.querySelector('.lexi-selection-translation__chunk')?.textContent).toBe(expectedChunk)
  })

  it('appends nothing when the text did not grow', () => {
    const element = mountContainer()
    renderAnimatedText(element, '你好世界', '你好', true)

    const chunksBefore = element.querySelectorAll('.lexi-selection-translation__chunk').length
    renderAnimatedText(element, '你好世界', '你好世界', true)

    expect(element.textContent).toBe('你好世界')
    expect(element.querySelectorAll('.lexi-selection-translation__chunk')).toHaveLength(chunksBefore)
  })

  it('clears the new-chunk highlight once the reveal window closes', async () => {
    const element = mountContainer()
    renderAnimatedText(element, '你好世界', '你好', true)
    expect(element.querySelectorAll('[data-lexi-new="true"]').length).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(220)

    expect(element.querySelectorAll('[data-lexi-new="true"]')).toHaveLength(0)
    expect(element.textContent).toBe('你好世界')
  })
})
