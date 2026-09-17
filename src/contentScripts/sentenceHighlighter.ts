import type { LexiSettings, PageTranslationHighlightStyle } from '~/logic/types'

/**
 * Wraps sentence slices in a source element with `<span class="lexi-sentence" data-lexi-sentence="i">`.
 *
 * Requirements:
 * - Reversible: unwrapSourceSentences + normalize() completely restores the original DOM.
 * - Idempotent: already-wrapped elements are not re-wrapped.
 * - Non-destructive: preserves existing child elements (links, code, bold).
 */
export function wrapSourceSentences(element: HTMLElement, sentences: string[]): boolean {
  if (!element || !Array.isArray(sentences) || sentences.length <= 1)
    return false

  if (element.dataset.lexiSentenceWrapped === 'true' || element.querySelector('[data-lexi-sentence]'))
    return true

  // Collect text nodes in element, skipping scripts, styles, and existing tokens
  const textNodes: Text[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest('script, style, [data-lexi-sentence]'))
        return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode()
  while (current) {
    textNodes.push(current as Text)
    current = walker.nextNode()
  }

  if (!textNodes.length)
    return false

  let textNodeIdx = 0
  let nodeOffset = 0

  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx]
    let sentenceCharIdx = 0

    // Skip leading whitespace between sentences
    while (textNodeIdx < textNodes.length) {
      const node = textNodes[textNodeIdx]
      const text = node.nodeValue ?? ''
      while (nodeOffset < text.length && /\s/.test(text[nodeOffset]))
        nodeOffset++
      if (nodeOffset < text.length)
        break
      textNodeIdx++
      nodeOffset = 0
    }

    while (textNodeIdx < textNodes.length && sentenceCharIdx < sentence.length) {
      const node = textNodes[textNodeIdx]
      const text = node.nodeValue ?? ''

      if (nodeOffset >= text.length) {
        textNodeIdx++
        nodeOffset = 0
        continue
      }

      let matchLength = 0
      while (nodeOffset + matchLength < text.length && sentenceCharIdx < sentence.length) {
        const textChar = text[nodeOffset + matchLength]
        const sentenceChar = sentence[sentenceCharIdx]

        if (textChar === sentenceChar || (/\s/.test(textChar) && /\s/.test(sentenceChar))) {
          matchLength++
          sentenceCharIdx++
        }
        else if (/\s/.test(textChar)) {
          matchLength++
        }
        else {
          break
        }
      }

      if (matchLength > 0) {
        let targetNode = node
        if (nodeOffset > 0) {
          targetNode = node.splitText(nodeOffset)
          textNodes.splice(textNodeIdx + 1, 0, targetNode)
          textNodeIdx++
          nodeOffset = 0
        }

        if (targetNode.length > matchLength) {
          const nextPart = targetNode.splitText(matchLength)
          textNodes.splice(textNodeIdx + 1, 0, nextPart)
        }

        const span = document.createElement('span')
        span.dataset.lexiSentence = String(sIdx)
        span.className = 'lexi-sentence'
        targetNode.parentNode?.replaceChild(span, targetNode)
        span.appendChild(targetNode)

        textNodeIdx++
        nodeOffset = 0
      }
      else {
        textNodeIdx++
        nodeOffset = 0
      }
    }
  }

  element.dataset.lexiSentenceWrapped = 'true'
  return true
}

/**
 * Completely restores the source element by removing all sentence spans and normalizing text nodes.
 */
export function unwrapSourceSentences(element: HTMLElement): void {
  if (!element)
    return

  const spans = Array.from(element.querySelectorAll<HTMLElement>('[data-lexi-sentence]'))
  for (const span of spans) {
    span.replaceWith(...Array.from(span.childNodes))
  }

  delete element.dataset.lexiSentenceWrapped
  element.normalize()
}

/**
 * Renders translated sentences into spans with `data-lexi-sentence="i"`.
 */
export function renderTranslationSentences(
  container: HTMLElement,
  sentences: string[],
  settings?: LexiSettings,
  renderLearningText?: (target: HTMLElement, text: string, settings?: LexiSettings) => void,
): void {
  const fragment = document.createDocumentFragment()

  for (let i = 0; i < sentences.length; i++) {
    const span = document.createElement('span')
    span.dataset.lexiSentence = String(i)
    span.className = 'lexi-sentence'

    if (renderLearningText)
      renderLearningText(span, sentences[i], settings)
    else
      span.textContent = sentences[i]

    fragment.appendChild(span)
    if (i < sentences.length - 1)
      fragment.appendChild(document.createTextNode(' '))
  }

  container.replaceChildren(fragment)
}

/**
 * Applies highlight configuration (preset style and color) to a pair of elements.
 */
export function applyHighlightStyle(
  element: HTMLElement,
  style: PageTranslationHighlightStyle = 'outline',
  color = '#3b82f6',
): void {
  element.dataset.lexiHighlightStyle = style
  if (color)
    element.style.setProperty('--lexi-highlight-color', color)
}

let activeHoverElements: HTMLElement[] = []

function clearActiveHover(): void {
  if (!activeHoverElements.length)
    return
  for (const el of activeHoverElements)
    delete el.dataset.lexiSentenceActive
  activeHoverElements = []
}

/**
 * Wires document-level mouseover and mouseout listeners for dual-sided sentence hovering.
 * Returns a cleanup callback.
 */
export function setupSentenceHoverListeners(): () => void {
  function handleMouseOver(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target)
      return

    const sentenceEl = target.closest?.('[data-lexi-sentence]') as HTMLElement | null
    if (!sentenceEl) {
      clearActiveHover()
      return
    }

    const sentenceIndex = sentenceEl.dataset.lexiSentence
    if (!sentenceIndex) {
      clearActiveHover()
      return
    }

    // Find the pair: source block and translation block
    let sourceEl: HTMLElement | null = null
    let translationEl: HTMLElement | null = null

    if (sentenceEl.closest('.lexi-page-translation')) {
      translationEl = sentenceEl.closest('.lexi-page-translation') as HTMLElement
      sourceEl = (translationEl.previousElementSibling as HTMLElement | null)
    }
    else {
      sourceEl = sentenceEl.closest('[data-lexi-sentence-wrapped="true"]') as HTMLElement | null
      ?? (sentenceEl.parentElement?.closest('[data-lexi-sentence-wrapped="true"]') as HTMLElement | null)
      ?? (sentenceEl.parentElement as HTMLElement | null)
      if (sourceEl?.nextElementSibling?.classList.contains('lexi-page-translation'))
        translationEl = sourceEl.nextElementSibling as HTMLElement
    }

    if (!sourceEl && !translationEl) {
      clearActiveHover()
      return
    }

    clearActiveHover()

    const matches: HTMLElement[] = []
    if (sourceEl) {
      const sourceMatches = sourceEl.querySelectorAll<HTMLElement>(`[data-lexi-sentence="${sentenceIndex}"]`)
      matches.push(...Array.from(sourceMatches))
    }
    if (translationEl) {
      const transMatches = translationEl.querySelectorAll<HTMLElement>(`[data-lexi-sentence="${sentenceIndex}"]`)
      matches.push(...Array.from(transMatches))
    }

    for (const match of matches)
      match.dataset.lexiSentenceActive = 'true'

    activeHoverElements = matches
  }

  function handleMouseOut(event: MouseEvent) {
    const related = event.relatedTarget as Element | null
    if (related && related.closest?.('[data-lexi-sentence]'))
      return
    clearActiveHover()
  }

  document.addEventListener('mouseover', handleMouseOver, { passive: true })
  document.addEventListener('mouseout', handleMouseOut, { passive: true })

  return () => {
    document.removeEventListener('mouseover', handleMouseOver)
    document.removeEventListener('mouseout', handleMouseOut)
    clearActiveHover()
  }
}
