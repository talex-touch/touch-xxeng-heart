import type { PageTranslationAutoSite, PageTranslationAutoSites } from './types'
import type { SiteDetectionHints } from './siteRules'

export const pageTranslationAutoSiteOptions: Array<{ value: PageTranslationAutoSite, label: string, hint: string }> = [
  { value: 'discourse', label: 'Discourse 主题帖', hint: '只读取标题、主帖和已加载回复正文。' },
  { value: 'github-readme', label: 'GitHub README', hint: '只读取仓库 README 正文。' },
  { value: 'reddit', label: 'Reddit 帖子', hint: '只读取发帖和已加载评论正文。' },
]

const selectorsBySite: Record<PageTranslationAutoSite, string> = {
  'discourse': [
    '#topic-title h1',
    '.topic-title h1',
    '.topic-post .cooked > p',
    '.topic-post .cooked > ul > li',
    '.topic-post .cooked > ol > li',
    '.topic-post .cooked > blockquote',
  ].join(','),
  'github-readme': [
    '#readme article > p',
    '#readme article > ul > li',
    '#readme article > ol > li',
    '#readme article > blockquote',
    '[data-testid="readme"] article > p',
    '[data-testid="readme"] article > ul > li',
    '[data-testid="readme"] article > ol > li',
    '[data-testid="readme"] article > blockquote',
  ].join(','),
  'reddit': [
    'shreddit-post [slot="text-body"]',
    '[data-post-click-location="text-body"]',
    'shreddit-comment [slot="comment"]',
    '[data-testid="comment"] > p',
    '.Comment .md > p',
  ].join(','),
}

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

export function getPageTranslationAutoSiteSelectors(site: PageTranslationAutoSite) {
  return selectorsBySite[site]
}

function pageTextLooksEnglish(document: Document, site: PageTranslationAutoSite) {
  const text = Array.from(document.querySelectorAll<HTMLElement>(selectorsBySite[site]))
    .slice(0, 32)
    .map(element => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(text => text.length >= 24)
    .join(' ')
    .slice(0, 6000)
  const latin = (text.match(/[a-z]/gi) ?? []).length
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length

  return latin >= 80 && latin > cjk * 2
}

export function findEnabledEnglishAutoPageTranslationSite(
  document: Document,
  url: string,
  hints: SiteDetectionHints,
  enabledSites: PageTranslationAutoSites,
): PageTranslationAutoSite | undefined {
  const site = findPageTranslationAutoSite(document, url, hints)
  if (!site || !enabledSites[site] || !pageTextLooksEnglish(document, site))
    return undefined

  return site
}
