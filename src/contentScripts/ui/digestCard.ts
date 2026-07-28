/**
 * Presentation primitives shared by the GitHub and Forum digest cards, so the two
 * surfaces read as one system instead of two independently drifting stylesheets.
 */

export const digestCardTokens = `
  --lexi-digest-radius: 12px;
  --lexi-digest-pad: 12px;
  --lexi-digest-font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --lexi-digest-eyebrow-size: 11px;
  --lexi-digest-title-size: 15px;
  --lexi-digest-meta-size: 12px;
`

/** Keyframes every digest surface shares; emitted once per stylesheet. */
export function digestCardKeyframes(prefix: string) {
  return `
    @keyframes ${prefix}-content-enter { from { opacity: 0; filter: blur(5px); transform: perspective(900px) rotateX(-10deg) translateY(-6px) scale(0.98); } to { opacity: 1; filter: blur(0); transform: perspective(900px) rotateX(0) translateY(0) scale(1); } }
    @keyframes ${prefix}-toggle-enter { from { opacity: 0; filter: blur(4px); transform: perspective(600px) rotateX(16deg) scale(0.94); } to { opacity: 1; filter: blur(0); transform: perspective(600px) rotateX(0) scale(1); } }
    @keyframes ${prefix}-char-in { to { opacity: 1; filter: blur(0); transform: translateY(0); } }
    @keyframes ${prefix}-ai-gradient { from { background-position-x: 120%; filter: saturate(1); } 50% { filter: saturate(1.32); } to { background-position-x: -120%; filter: saturate(1); } }
  `
}

export function prefersReducedMotion() {
  // `matchMedia` is missing in some embedded webviews and test environments; treating
  // that as "reduce motion" degrades to a static render rather than throwing mid-toggle.
  return typeof window.matchMedia !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** `Element.animate` is absent in older webviews and in jsdom. */
export function canAnimate(element: Element): element is Element & { animate: Element['animate'] } {
  return typeof element.animate === 'function'
}

export interface TypewriterOptions {
  /** Class marking the elements to animate, e.g. `lexi-github-digest__typewriter`. */
  targetClass: string
  /** Class applied to each generated character span. */
  charClass: string
  /** Per-character delay in ms. */
  step?: number
  /** Ceiling on the stagger within one element. */
  maxDelay?: number
}

/**
 * Reveals text character by character. Sets `aria-label` to the full string first so
 * screen readers get the sentence rather than a stream of single letters.
 */
export function runTypewriterAnimation(element: HTMLElement, options: TypewriterOptions) {
  if (prefersReducedMotion())
    return

  const step = options.step ?? 14
  const maxDelay = options.maxDelay ?? 1200
  const targets = Array.from(element.querySelectorAll<HTMLElement>(`.${options.targetClass}`))
  let groupDelay = 0

  for (const target of targets) {
    const text = target.textContent ?? ''
    if (!text.trim())
      continue

    target.textContent = ''
    target.setAttribute('aria-label', text)
    Array.from(text).forEach((char, index) => {
      const span = document.createElement('span')
      span.className = options.charClass
      span.textContent = char
      span.style.animationDelay = `${groupDelay + Math.min(index * step, maxDelay)}ms`
      target.append(span)
    })
    groupDelay += Math.min(520, Math.max(180, text.length * 9))
  }
}

/**
 * Swaps card content and morphs the box from its old geometry to its new one, so a
 * digest growing from one line to a full overview doesn't snap.
 */
export function morphCardContent(element: HTMLElement, html: string, onRendered?: (element: HTMLElement) => void) {
  const from = element.getBoundingClientRect()
  const fromRadius = window.getComputedStyle(element).borderRadius
  element.innerHTML = html
  onRendered?.(element)

  if (prefersReducedMotion())
    return

  const to = element.getBoundingClientRect()
  const toRadius = window.getComputedStyle(element).borderRadius
  if (!from.height || !canAnimate(element))
    return

  if (Math.abs(from.height - to.height) < 2 && Math.abs(from.width - to.width) < 2)
    return

  element.animate([
    {
      width: `${from.width}px`,
      height: `${from.height}px`,
      borderRadius: fromRadius,
      opacity: 0.86,
      filter: 'blur(1px) saturate(1.12)',
      transform: 'perspective(900px) rotateX(-7deg) scale(0.985)',
    },
    {
      width: `${to.width}px`,
      height: `${to.height}px`,
      borderRadius: toRadius,
      opacity: 1,
      filter: 'blur(0) saturate(1)',
      transform: 'perspective(900px) rotateX(0) scale(1)',
    },
  ], {
    duration: 360,
    easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
  })
}

/** Injects a stylesheet once, keyed by element id. */
export function ensureStyleSheet(id: string, content: string) {
  if (document.getElementById(id))
    return

  const style = document.createElement('style')
  style.id = id
  style.textContent = content
  document.documentElement.appendChild(style)
}
