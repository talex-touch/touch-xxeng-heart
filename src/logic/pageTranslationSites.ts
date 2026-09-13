/**
 * Which platform rule, if any, claims this page — detection only.
 *
 * The prose each platform is made of, and whether that prose is English enough to
 * translate unattended, live in `pageTranslationLanguage`, so a platform verdict and a
 * generic one come from the same reading.
 */

import { pageTextLooksEnglish, readPageLanguage } from './pageTranslationLanguage'
import type { PageTranslationActivation, PageTranslationAutoSite, PageTranslationAutoSites, PageTranslationDirection } from './types'
import type { SiteDetectionHints } from './siteRules'

export const pageTranslationAutoSiteOptions: Array<{ value: PageTranslationAutoSite, label: string, hint: string }> = [
  { value: 'discourse', label: 'Discourse 主题帖', hint: '只读取标题、主帖和已加载回复正文。' },
  { value: 'github-readme', label: 'GitHub README', hint: '只读取仓库 README 正文。' },
  { value: 'reddit', label: 'Reddit 帖子', hint: '只读取发帖和已加载评论正文。' },
]

function hostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  }
  catch {
    return ''
  }
}

export function findPageTranslationAutoSite(
  document: Document,
  url: string,
  hints: SiteDetectionHints = {},
): PageTranslationAutoSite | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return undefined
  }
  const host = hostname(url)

  if (hints.discourse && /\/t\//.test(parsed.pathname))
    return 'discourse'

  if (host === 'github.com' && document.querySelector('#readme article, [data-testid="readme"] article'))
    return 'github-readme'

  if ((host === 'reddit.com' || host.endsWith('.reddit.com'))
    && /\/comments\/[^/]+/i.test(parsed.pathname)
    && document.querySelector('shreddit-post, [data-testid="post-container"], article')) {
    return 'reddit'
  }
}

export function findEnabledEnglishAutoPageTranslationSite(
  document: Document,
  url: string,
  hints: SiteDetectionHints,
  enabledSites: PageTranslationAutoSites,
): PageTranslationAutoSite | undefined {
  const site = findPageTranslationAutoSite(document, url, hints)
  if (!site || !enabledSites[site] || !pageTextLooksEnglish(readPageLanguage(document, site)))
    return undefined

  return site
}

/**
 * A manually saved rule always outranks the platform auto path, and auto
 * translation only ever runs for the fixed English → Chinese direction.
 */
export function resolveAutoPageTranslationSite(
  document: Document,
  url: string,
  hints: SiteDetectionHints,
  pageTranslation: { direction: PageTranslationDirection, autoSites: PageTranslationAutoSites },
  manualActivation: PageTranslationActivation | undefined,
): PageTranslationAutoSite | undefined {
  if (manualActivation || pageTranslation.direction !== 'en-to-zh')
    return undefined

  return findEnabledEnglishAutoPageTranslationSite(document, url, hints, pageTranslation.autoSites)
}
