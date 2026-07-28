export const githubDigestMountAttribute = 'data-lexi-github-digest-mount'

export interface DigestPlacement {
  parent: HTMLElement
  before: Element | null
}

function normalizeText(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function findRepoSidebar(root: ParentNode) {
  const selectors = [
    '.Layout-sidebar',
    '[data-testid="repository-sidebar"]',
    'aside[aria-label*="Repository" i]',
  ]

  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector)
    if (element)
      return element
  }

  return undefined
}

/**
 * The About block. GitHub has shipped several markups for it, so fall back from the
 * test id to a plain heading scan rather than pinning one class name.
 */
export function findAboutHeading(root: ParentNode) {
  const labelled = root.querySelector<HTMLElement>('[data-testid="repository-about"]')
  if (labelled)
    return labelled

  return Array.from(root.querySelectorAll<HTMLElement>('h2, h3'))
    .find(element => normalizeText(element.textContent) === 'About')
}

/**
 * Where the digest card belongs: directly above the About section, inside the repo sidebar.
 * Degrades through sidebar-only and heading-only markups before giving up.
 */
export function findAboutPlacement(root: ParentNode): DigestPlacement | undefined {
  const sidebar = findRepoSidebar(root)
  const heading = findAboutHeading(root)

  if (sidebar && heading && sidebar.contains(heading)) {
    // Climb to the About section's outermost wrapper inside the sidebar, so the card
    // lands above the whole section instead of between the heading and its body.
    let block: HTMLElement = heading
    while (block.parentElement && block.parentElement !== sidebar)
      block = block.parentElement

    return { parent: sidebar, before: block }
  }

  if (sidebar)
    return { parent: sidebar, before: sidebar.firstElementChild }

  if (heading) {
    const row = heading.closest<HTMLElement>('.BorderGrid-row') ?? heading
    return row.parentElement ? { parent: row.parentElement, before: row } : undefined
  }

  return undefined
}

/** GitHub's app header is sticky, so a sticky card has to clear it or it slides underneath. */
export function getStickyOffset(root: ParentNode, view: Pick<Window, 'getComputedStyle'>) {
  const header = root.querySelector<HTMLElement>('.AppHeader, header.AppHeader, .js-header-wrapper header')
  if (!header)
    return 16

  const position = view.getComputedStyle(header).position
  const height = position === 'sticky' || position === 'fixed' ? header.getBoundingClientRect().height : 0
  return Math.round(height) + 16
}
