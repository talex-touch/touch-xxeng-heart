export function renderAnimatedText(
  container: HTMLElement,
  text: string | undefined,
  previousText: string | undefined,
  revealChunk: boolean,
) {
  const nextText = typeof text === 'string' ? text : ''
  const stablePreviousText = typeof previousText === 'string' ? previousText : ''
  if (!revealChunk || !stablePreviousText || !nextText.startsWith(stablePreviousText)) {
    container.textContent = nextText
    return
  }

  const nextChunk = nextText.slice(stablePreviousText.length)
  if (!nextChunk)
    return

  const stableText = stablePreviousText.replace(/\s+$/, '')
  const chunkPrefix = stablePreviousText.slice(stableText.length)
  container.textContent = stablePreviousText
  const chunk = document.createElement('span')
  chunk.className = 'lexi-selection-translation__chunk'
  chunk.dataset.lexiNew = 'true'
  for (const [index, char] of Array.from(`${chunkPrefix}${nextChunk}`).entries()) {
    const charElement = document.createElement('span')
    charElement.className = 'lexi-selection-translation__char'
    charElement.dataset.lexiNew = 'true'
    charElement.textContent = char
    charElement.style.animationDelay = `${Math.min(index * 14, 140)}ms`
    chunk.append(charElement)
  }
  if (stableText.length !== stablePreviousText.length)
    container.textContent = stableText
  container.append(chunk)
  window.setTimeout(() => {
    delete chunk.dataset.lexiNew
    chunk
      .querySelectorAll<HTMLElement>('[data-lexi-new="true"]')
      .forEach(element => delete element.dataset.lexiNew)
  }, 220)
}
