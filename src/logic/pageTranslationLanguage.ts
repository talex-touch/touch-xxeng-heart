/**
 * What language is this page in, and does that leave anything to translate?
 *
 * One reading answers every question the page-translation feature asks about language:
 * whether an unattended start would be a no-op, whether a single block already reads the
 * way the reader asked for, and whether a platform's prose is English enough for its
 * dedicated rule. Detection is cheap but not free, and more importantly a *second*
 * reading could disagree with the first — the same page sampled twice with different
 * selector sets was how the rule path ended up gating on a different verdict than the
 * platform path. Callers take one reading and pass it around.
 *
 * The prose selectors live here because they define the page for both jobs: the reading
 * below and the content script's target collection. A verdict is only meaningful if it
 * describes the same text that would be translated.
 */

import { confidentEnough, detectLanguage } from './languageDetection'
import type { DetectedLanguage, LanguageDetection } from './languageDetection'
import { getPageContentRoot, getPageTranslationRegion } from './pageTranslationRegions'
import type { PageTranslationAutoSite, PageTranslationDirection } from './types'

/** The language layer of one page's prose. `generic` is anything without a platform rule. */
export type PageTranslationLanguageScope = 'generic' | PageTranslationAutoSite

export interface PageLanguageReading extends LanguageDetection {
  /** Characters the verdict was made from. `0` means nothing readable was sampled. */
  textLength: number
}

const genericPageTranslationSelectors = 'article p, article div[lang], main p, main li, p, li'

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

/** The prose a verdict and the target collector read for one scope. */
export function pageTranslationLanguageSelectors(scope: PageTranslationLanguageScope) {
  return scope === 'generic' ? genericPageTranslationSelectors : selectorsBySite[scope]
}

/** Bounded on purpose: a verdict does not need the whole document, and neither does a run. */
const maxSampleBlocks = 32
const maxSampleChars = 6000
const minSampleBlockChars = 24
/**
 * Prose the reader's own column must carry before it speaks for the page. Below this the
 * reading falls back to the whole document: a page whose article is a stub is better
 * judged — and translated — by everything it has than by the three lines it has in `main`.
 */
const minContentSampleChars = 120

function samplePageProse(document: Document, selector: string) {
  const contentRoot = getPageContentRoot(document)
  const content: string[] = []
  const chrome: string[] = []

  for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, maxSampleBlocks)) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text.length < minSampleBlockChars)
      continue

    const bucket = getPageTranslationRegion(element, contentRoot) === 'content' ? content : chrome
    bucket.push(text)
  }

  // Page furniture does not speak for the page. A Chinese article under an English site
  // chrome — a forum thread, an issue tracker, a blog on a platform whose navigation is
  // English — used to be read as English, and the reader got their own language translated
  // back at them. The collector already treats navigation as second-class; the verdict has
  // to agree with it, or the two disagree about the same page.
  const article = content.join(' ')
  if (article.length >= minContentSampleChars)
    return article.slice(0, maxSampleChars)

  return [...content, ...chrome].join(' ').slice(0, maxSampleChars)
}

export function readPageLanguage(document: Document, scope: PageTranslationLanguageScope = 'generic'): PageLanguageReading {
  const text = samplePageProse(document, pageTranslationLanguageSelectors(scope))
  const { language, confidence, counts } = detectLanguage(text)
  return { language, confidence, counts, textLength: text.length }
}

/** The language this run turns the page into — the direction names it outright. */
export function resolvePageTranslationTarget(direction: PageTranslationDirection): DetectedLanguage {
  return direction === 'zh-to-en' ? 'en' : 'zh'
}

/**
 * How much of the prose has to be written in the target language's own script.
 *
 * The detector answers "which language does this text read as", and it answers it with a
 * preference: any Han character at all makes a page Chinese to it, however much English
 * surrounds it. That is the right call for a *block* — a Chinese paragraph among English
 * ones is Chinese — and the wrong call for a *page*, where it would refuse to translate a
 * two-language article after reading one sentence of it. Requiring a majority of the prose
 * separates "already in the reader's language" from "contains some of it", and the blocks
 * that are not are dropped one by one instead.
 */
const targetDominanceShare = 0.6

function targetScriptShare(reading: PageLanguageReading, target: DetectedLanguage) {
  const { counts } = reading
  if (!counts.total)
    return 0

  if (target === 'zh')
    return counts.han / counts.total
  if (target === 'en')
    return counts.latin / counts.total

  return 0
}

/**
 * Is the page already written in the language the reader asked for?
 *
 * A rule is a standing request, not a promise that every page it matches carries
 * something to translate: a site rule kept for its English docs still matches that site's
 * Chinese pages. Only the *target* language is refused — a Japanese or Spanish page under
 * an en→zh rule still translates, which is what "译成中文" promises. A reading we cannot
 * trust is not a refusal either: a rule the user saved outranks a verdict the detector
 * never reached.
 */
export function pageLanguageIsTranslationTarget(reading: PageLanguageReading, direction: PageTranslationDirection) {
  const target = resolvePageTranslationTarget(direction)
  return reading.language === target
    && reading.confidence >= confidentEnough
    && targetScriptShare(reading, target) >= targetDominanceShare
}

/**
 * The same question for a single block, for pages that mix languages.
 *
 * An English article quoting a Chinese paragraph has work in one of the two, and sending
 * both spends the reader's quota paraphrasing half the page in its own language. Unknown
 * or low-confidence text is translated — a block is only dropped when we can name its
 * language.
 */
export function blockIsTranslationTarget(text: string, target: DetectedLanguage) {
  const { language, confidence } = detectLanguage(text)
  return language === target && confidence >= confidentEnough
}

const languageLabels: Record<DetectedLanguage, string> = {
  zh: '中文',
  en: '英文',
  ja: '日语',
  ko: '韩语',
  other: '其他语言',
}

/** How a reading is named in the UI — "已跳过" without the language it read reads like a bug. */
export function pageTranslationLanguageLabel(language: DetectedLanguage) {
  return languageLabels[language]
}

/**
 * The platform path's own requirement: those three sites ship English prose, and a
 * Chinese thread on Discourse is not what a reader enabled that rule for.
 */
export function pageTextLooksEnglish(reading: PageLanguageReading) {
  return reading.counts.latin >= 80 && reading.language === 'en' && reading.confidence >= confidentEnough
}
