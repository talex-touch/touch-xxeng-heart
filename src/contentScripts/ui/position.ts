export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface FlipPlacementOptions {
  /** Minimum distance from the viewport edge. */
  margin?: number
  /** Gap between the anchor and the panel. */
  gap?: number
  /** Horizontal alignment against the anchor. */
  align?: 'start' | 'center' | 'end'
  /** Preferred vertical side; flips automatically when it doesn't fit. */
  prefer?: 'below' | 'above'
}

/**
 * Places a panel next to an anchor, flipping to the other side when it would overflow
 * and clamping into the viewport as a last resort.
 *
 * Previously reimplemented three times — for the dialog, the media toolbar and the video
 * speed menu — each with slightly different clamping and its own off-by-one edge cases.
 */
export function resolveFlipPlacement(
  anchor: AnchorRect,
  panel: { width: number, height: number },
  options: FlipPlacementOptions = {},
) {
  const margin = options.margin ?? 12
  const gap = options.gap ?? 8
  const align = options.align ?? 'start'
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const desiredLeft = align === 'center'
    ? anchor.left + anchor.width / 2 - panel.width / 2
    : align === 'end'
      ? anchor.right - panel.width
      : anchor.left

  const maxLeft = Math.max(margin, viewportWidth - panel.width - margin)
  const left = Math.max(margin, Math.min(desiredLeft, maxLeft))

  const below = anchor.bottom + gap
  const above = anchor.top - panel.height - gap
  const fitsBelow = below + panel.height <= viewportHeight - margin
  const fitsAbove = above >= margin

  let top = options.prefer === 'above'
    ? (fitsAbove ? above : below)
    : (fitsBelow ? below : above)

  if (top < margin || top + panel.height > viewportHeight - margin)
    top = Math.max(margin, Math.min(viewportHeight - panel.height - margin, Math.max(margin, anchor.top)))

  return { left, top }
}

/** Applies a placement to a fixed-position element. */
export function applyPlacement(element: HTMLElement, placement: { left: number, top: number }) {
  element.style.left = `${placement.left}px`
  element.style.top = `${placement.top}px`
}

/**
 * Positions a panel against an anchor element, measuring the panel first and falling
 * back to caller-supplied dimensions while it is still unrendered.
 */
export function positionAgainstAnchor(
  panel: HTMLElement,
  anchor: AnchorRect,
  options: FlipPlacementOptions & { fallbackWidth?: number, fallbackHeight?: number } = {},
) {
  const measured = panel.getBoundingClientRect()
  const placement = resolveFlipPlacement(anchor, {
    width: measured.width || options.fallbackWidth || 320,
    height: measured.height || options.fallbackHeight || 160,
  }, options)

  applyPlacement(panel, placement)
  return placement
}

/** Mirrors an element's box onto an overlay, used for the media highlight. */
export function overlayRect(overlay: HTMLElement, anchor: Element, radius?: string) {
  const rect = anchor.getBoundingClientRect()
  overlay.style.left = `${rect.left}px`
  overlay.style.top = `${rect.top}px`
  overlay.style.width = `${Math.max(0, rect.width)}px`
  overlay.style.height = `${Math.max(0, rect.height)}px`
  if (radius) {
    overlay.style.borderRadius = radius
    overlay.style.setProperty('--lexi-media-radius', radius)
  }
}
