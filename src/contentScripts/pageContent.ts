import { ensureStyleSheet } from '~/contentScripts/ui/digestCard'
import type { PageDocument, PageSegment, PageSegmentKind } from '~/logic/contextRetrieval'

const blockSelector = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,dd,figcaption,td,summary'

/** Page chrome plus every UI surface Lexi itself injects — none of it is page content. */
const excludedSelector = [
  'nav',
  'header',
  'footer',
  'aside',
  'script',
  'style',
  'noscript',
  'svg',
  'template',
  'form',
  'button',
  'select',
  'textarea',
  'iframe',
  '[aria-hidden="true"]',
  '[hidden]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="search"]',
  '[data-lexi-page-translation]',
  '[data-lexi-dialog]',
  '[data-lexi-toast]',
  '[data-lexi-media-toolbar]',
  '[data-lexi-video-speed-menu]',
  '[data-lexi-selection-translation]',
  '[data-lexi-content-digest]',
  '[data-lexi-github-digest]',
  '[data-lexi-forum-digest]',
  '[data-lexi-media-highlight]',
].join(',')

const mainSelectors = [
  'main article',
  'main',
  'article',
  '[role="main"]',
  '#content',
  '#main',
  '.markdown-body',
  '.post-stream',
]

const maxSegments = 260
const maxSegmentChars = 1600
/** A 20-character Chinese sentence is real content, so keep this floor low. */
const minSegmentChars = 16

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Text as the author wrote it: Lexi's inline replacement tokens render the English
 * word, so read `data-original` back out instead of feeding our own rewrite to the model.
 */
function readOriginalText(element: Element) {
  const tokens = element.querySelectorAll<HTMLElement>('[data-lexi-token]')
  if (!tokens.length)
    return normalize(element.textContent ?? '')

  const clone = element.cloneNode(true) as Element
  for (const token of Array.from(clone.querySelectorAll<HTMLElement>('[data-lexi-token]')))
    token.replaceWith(token.dataset.original ?? token.textContent ?? '')

  return normalize(clone.textContent ?? '')
}

function isRendered(element: Element) {
  const rect = element.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0)
    return true

  // Elements below the fold in a collapsed container still report zero — fall back to styles.
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function isInViewport(element: Element) {
  const rect = element.getBoundingClientRect()
  return rect.bottom > 0 && rect.top < window.innerHeight
}

/** Link-heavy blocks are menus and card grids, not prose. */
function linkDensity(element: Element) {
  const total = (element.textContent ?? '').length
  if (!total)
    return 1

  let linked = 0
  for (const anchor of Array.from(element.querySelectorAll('a')))
    linked += (anchor.textContent ?? '').length

  return linked / total
}

function pickContentRoot(): HTMLElement {
  for (const selector of mainSelectors) {
    const candidate = document.querySelector<HTMLElement>(selector)
    if (candidate && normalize(candidate.textContent ?? '').length >= 200)
      return candidate
  }

  // Nothing semantic — score the obvious containers by prose volume.
  const candidates = Array.from(document.body?.querySelectorAll<HTMLElement>('div,section') ?? [])
    .slice(0, 400)
    .map((element) => {
      const length = normalize(element.textContent ?? '').length
      return { element, score: length * (1 - linkDensity(element)) }
    })
    .filter(item => item.score > 400)
    .sort((left, right) => right.score - left.score)

  return candidates[0]?.element ?? document.body ?? document.documentElement
}

function getSegmentKind(element: Element): PageSegmentKind {
  const tag = element.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag))
    return 'heading'
  if (tag === 'pre')
    return 'code'
  if (tag === 'li')
    return 'list'
  if (tag === 'blockquote')
    return 'quote'
  if (tag === 'td')
    return 'table'

  return 'paragraph'
}

function getHeadingLevel(element: Element) {
  const match = element.tagName.match(/^H([1-6])$/i)
  return match ? Number(match[1]) : 0
}

/** Join the enclosing headings into a breadcrumb, e.g. "安装 › 快速开始". */
function formatHeadingTrail(trail: Array<{ level: number, text: string }>) {
  return trail.map(item => item.text).join(' › ')
}

/**
 * Elements behind the latest capture, so "引用" chips in the dialog can scroll back to
 * the paragraph an excerpt came from. WeakRefs: retaining detached subtrees of an SPA
 * page for the tab's lifetime would be a leak.
 */
let segmentElements = new Map<string, WeakRef<HTMLElement>>()

export function capturePageDocument(): PageDocument {
  const root = pickContentRoot()
  const segments: PageSegment[] = []
  const outline: string[] = []
  const trail: Array<{ level: number, text: string }> = []
  const seen = new Set<string>()
  const elements = new Map<string, WeakRef<HTMLElement>>()
  let charCount = 0
  let order = 0

  for (const element of Array.from(root.querySelectorAll<HTMLElement>(blockSelector))) {
    if (segments.length >= maxSegments)
      break

    if (element.closest(excludedSelector) || !isRendered(element))
      continue

    // A <li> wrapping paragraphs would duplicate them; let the inner blocks win.
    if (element.querySelector(blockSelector))
      continue

    const text = readOriginalText(element)
    const kind = getSegmentKind(element)
    if (!text || (kind !== 'heading' && text.length < minSegmentChars))
      continue

    if (kind !== 'code' && kind !== 'heading' && linkDensity(element) > 0.6)
      continue

    const key = `${kind}:${text.slice(0, 120)}`
    if (seen.has(key))
      continue

    seen.add(key)

    if (kind === 'heading') {
      const level = getHeadingLevel(element)
      while (trail.length && trail[trail.length - 1].level >= level)
        trail.pop()

      trail.push({ level, text })
      outline.push(formatHeadingTrail(trail))
    }

    const clipped = text.slice(0, maxSegmentChars)
    charCount += clipped.length
    const id = `s${order}`
    elements.set(id, new WeakRef(element))
    segments.push({
      id,
      heading: kind === 'heading' ? formatHeadingTrail(trail.slice(0, -1)) : formatHeadingTrail(trail),
      text: clipped,
      kind,
      order,
      visible: isInViewport(element),
    })
    order += 1
  }

  segmentElements = elements
  return {
    title: normalize(document.title),
    url: location.href,
    segments,
    outline: outline.slice(0, 60),
    charCount,
  }
}

const segmentFlashClass = 'lexi-segment-flash'

function ensureFlashStyles() {
  ensureStyleSheet('lexi-segment-flash-style', `
    .${segmentFlashClass} { animation: lexi-segment-flash 1.8s ease-out 1; border-radius: 4px; }
    @keyframes lexi-segment-flash {
      0% { background: rgba(255, 212, 0, 0.4); box-shadow: 0 0 0 6px rgba(255, 212, 0, 0.4); }
      100% { background: transparent; box-shadow: 0 0 0 6px transparent; }
    }
    @media (prefers-reduced-motion: reduce) { .${segmentFlashClass} { animation: none; background: rgba(255, 212, 0, 0.3); } }
  `)
}

function findSegmentElementByText(segment: PageSegment) {
  const needle = segment.text.slice(0, 60)
  if (!needle)
    return undefined

  return Array.from(document.querySelectorAll<HTMLElement>(blockSelector))
    .slice(0, 500)
    .find(element => !element.closest(excludedSelector) && normalize(element.textContent ?? '').includes(needle))
}

/**
 * Scrolls the page to the paragraph a dialog excerpt came from and flashes it.
 * Falls back to a text search when the captured element is gone (SPA re-render,
 * or the chip belongs to an older capture whose ids no longer line up).
 */
export function revealPageSegment(segment: PageSegment): boolean {
  const captured = segmentElements.get(segment.id)?.deref()
  const target = captured?.isConnected ? captured : findSegmentElementByText(segment)
  if (!target)
    return false

  ensureFlashStyles()
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  target.classList.remove(segmentFlashClass)
  // Force a reflow so re-clicking the same chip restarts the animation.
  void target.offsetWidth
  target.classList.add(segmentFlashClass)
  window.setTimeout(() => target.classList.remove(segmentFlashClass), 2000)
  return true
}

/**
 * Find the captured segment that contains the selection, so retrieval can bias
 * toward the neighbourhood the user is actually looking at.
 */
export function findAnchorSegmentId(document_: PageDocument, selectedText: string) {
  const needle = normalize(selectedText).slice(0, 60)
  if (!needle)
    return undefined

  return document_.segments.find(segment => segment.text.includes(needle))?.id
}

let cached: { key: string, document: PageDocument, capturedAt: number } | undefined
const captureTtlMs = 15000

/**
 * Capturing walks the DOM, so reuse a recent capture for the same URL. The dialog
 * recaptures per question, and pages mutate constantly on SPAs — hence the short TTL.
 */
export function getPageDocument(options: { force?: boolean } = {}): PageDocument {
  const key = location.href
  const fresh = cached
    && cached.key === key
    && Date.now() - cached.capturedAt < captureTtlMs

  if (fresh && !options.force)
    return cached!.document

  const document_ = capturePageDocument()
  cached = { key, document: document_, capturedAt: Date.now() }
  return document_
}

export function clearPageDocumentCache() {
  cached = undefined
}
