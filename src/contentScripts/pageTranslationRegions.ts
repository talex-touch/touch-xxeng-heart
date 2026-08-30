/** Reading order: the article body first, page furniture (nav, sidebar, footer) afterwards. */
export type PageTranslationRegion = 'content' | 'chrome'

const pageChromeSelector = 'nav, aside, header, footer, [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"]'

/**
 * The reader's main column, when the page marks one.
 *
 * Resolved once per scan: `closest`/`contains` against a cached root is cheap, while
 * asking every candidate to walk up to `main` on its own is not.
 */
export function getPageContentRoot(root: ParentNode = document) {
  return root.querySelector<HTMLElement>('main, [role="main"], article') ?? undefined
}

export function getPageTranslationRegion(element: HTMLElement, contentRoot?: HTMLElement): PageTranslationRegion {
  if (element.closest(pageChromeSelector))
    return 'chrome'

  // Without a marked main column every paragraph counts as content; demoting on a guess
  // would leave a plain-`<body>` page with nothing to translate first.
  return !contentRoot || contentRoot.contains(element) ? 'content' : 'chrome'
}
