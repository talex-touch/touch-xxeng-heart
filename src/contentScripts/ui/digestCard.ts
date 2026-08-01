/**
 * Presentation primitives shared by the GitHub and Forum digest cards.
 */

export const digestCardTokens = `
  --lexi-digest-radius: 12px;
  --lexi-digest-pad: 12px;
  --lexi-digest-font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --lexi-digest-eyebrow-size: 11px;
  --lexi-digest-title-size: 15px;
  --lexi-digest-meta-size: 12px;
`

export function digestCardKeyframes(prefix: string) {
  return `
    @keyframes ${prefix}-content-enter { from { opacity: 0.72; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ${prefix}-toggle-enter { from { opacity: 0.72; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
    @keyframes ${prefix}-loading-pulse { 50% { opacity: 0.58; } }
  `
}

export function prefersReducedMotion() {
  return typeof window.matchMedia !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function canAnimate(element: Element): element is Element & { animate: Element['animate'] } {
  return typeof element.animate === 'function'
}

/** Swaps card content with a short paint-only transition. */
export function morphCardContent(element: HTMLElement, html: string, onRendered?: (element: HTMLElement) => void) {
  element.innerHTML = html
  onRendered?.(element)

  if (prefersReducedMotion() || !canAnimate(element))
    return

  element.animate([
    { opacity: 0.82, transform: 'translateY(-3px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], {
    duration: 180,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  })
}

export function ensureStyleSheet(id: string, content: string) {
  if (document.getElementById(id))
    return

  const style = document.createElement('style')
  style.id = id
  style.textContent = content
  document.documentElement.appendChild(style)
}
