import browser from 'webextension-polyfill'

import { isAttachmentElement, isPageTranslationAttachment } from './pageTranslationAttachments'
import { getPageTranslationAutoSiteSelectors, resolveAutoPageTranslationSite } from '~/logic/pageTranslationSites'
import { localTranslateSelection, requestLexiDialogAnswer, requestMediaAnalysis, requestPageTranslationBatch, requestReplacementCandidates, requestSelectionDetail, requestSelectionTranslation } from '~/logic/aiClient'
import { recordPageVisit } from '~/logic/analytics'
import type { PageDocument, PageSegment } from '~/logic/contextRetrieval'
import { defaultSettings } from '~/logic/defaults'
import { getReplacementDisplayText } from '~/logic/replacementDisplay'
import type { DialogSelectionContext } from '~/logic/dialogHarness'
import { findAnchorSegmentId, getPageDocument, revealPageSegment } from '~/contentScripts/pageContent'
import { elementToDataUrl } from '~/contentScripts/ui/canvas'
import { collapsibleStyles, createCollapsible } from '~/contentScripts/ui/collapsible'
import type { CollapsibleHandle } from '~/contentScripts/ui/collapsible'
import { createListenerGroup, once, pointerEventName } from '~/contentScripts/ui/listenerGroup'
import { renderMarkdown } from '~/contentScripts/ui/markdown'
import { overlayRect, positionAgainstAnchor } from '~/contentScripts/ui/position'
import { startVideoSpeedControl } from '~/contentScripts/ui/videoSpeed'
import { getStoredState, primeStoredRecords } from '~/logic/settingsCache'
import { createSerializedTaskQueue } from '~/logic/asyncQueue'
import { createOperationEpoch } from '~/logic/operationEpoch'
import type { OperationEpochHandle } from '~/logic/operationEpoch'
import { classifyTranslationFailure, createFailureReporter, describeTranslationFailure, isTerminalTranslationFailure } from '~/logic/translationFailure'
import { getDifficultyWindow, getEffectiveDensity } from '~/logic/replacementLevels'
import { readJsonValue } from '~/logic/storageJson'
import { listenRuntimeMessage, sendRuntimeMessage } from '~/logic/runtimeMessaging'
import { canAutoReplaceCandidate, createCandidateFromTerm, createManualCandidate, createTechnicalCandidate, hasCjkText, isLikelyTechnicalSelectionTerm, isLowValueShortChineseCandidate, shouldRecordSelectionCandidate } from '~/logic/selectionVocabulary'
import { findSpecialSiteProfile, isPageEnabled, isSceneEnabled } from '~/logic/siteRules'
import type { SiteDetectionHints } from '~/logic/siteRules'
import { pageTranslationMemoryStorageKey, pageTranslationsStorageKey, settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { deletePageTranslationActivation, findMatchingPageTranslationActivation as findActivationMatchingUrl, getPageTranslationActivationKey, normalizePageTranslationUrl as normalizeTranslationRuleUrl, upsertPageTranslationActivation } from '~/logic/pageTranslationRules'
import { programmerVocabulary } from '~/logic/vocabularyBank'
import { getVocabularyId, isProductVocabularyCandidate, isReplacementSuppressed, setVocabularyArchived, upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, PageTranslationActivation, PageTranslationAutoSite, PageTranslationBlock, PageTranslationCache, PageTranslationDirection, PageTranslationMemory, PageTranslationScope, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

interface EnhancerEvents {
  onStats: (stats: PageStats) => void
}

export interface PageStats {
  replacements: number
  records: number
  enabled: boolean
  showFloatingStatus: boolean
  specialProfile?: PageSpecialProfileStats
}

export interface PageSpecialProfileStats {
  id: string
  label: string
  kind: string
  detected: boolean
  dynamicScan: boolean
  conservative: boolean
}

const ignoredSelectors = [
  'script',
  'style',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'code',
  'pre',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[aria-multiline="true"]',
  '.ProseMirror',
  '.CodeMirror',
  '.monaco-editor',
  '.ql-editor',
  '.tox-edit-area',
  '.w-e-text-container',
  '.vditor',
  '.md-editor',
  '.markdown-body[contenteditable]',
  '.simditor-body',
  '.fr-element',
  '.note-editable',
  '.medium-editor-element',
  '[data-lexi-token]',
  '[data-lexi-entity]',
  '[data-lexi-selection-translation]',
  '[data-lexi-page-translation]',
  '[data-lexi-dialog]',
  '[data-lexi-media-toolbar]',
  '[data-lexi-media-highlight]',
  '[data-lexi-content-digest]',
  '[data-lexi-github-digest]',
  '[data-lexi-forum-digest]',
]

const blockSelectors = [
  'p',
  'li',
  'blockquote',
  'dd',
  'dt',
  'figcaption',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'div',
].join(',')

const selectionAnchorSelectors = [
  '[data-testid="tweetText"]',
  '[data-testid="tweet"] div[lang]',
  'article div[lang]',
  'article p',
  'article blockquote',
  'div[dir="auto"]',
  'p',
  'li',
  'blockquote',
  'dd',
  'dt',
  'figcaption',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
].join(',')

const maxAiReplacementSeedsPerPage = 3
const requestedReplacementSeeds = new Set<string>()
const replacementFreshnessWindowMs = 7 * 24 * 60 * 60 * 1000
const maxSelectionTranslationLength = 5000
/** Traversal budget, not a translation budget — how many blocks actually get translated is a separate limit. */
const maxPageTranslationScanElements = 2000

interface ReplacementSeed {
  text: string
  context: string
}

interface ReplacementRecordIndex {
  byId: Map<string, VocabularyRecord>
  byOriginal: Map<string, VocabularyRecord>
}

interface ReplacementMatch {
  candidate: VocabularyCandidate
  index: number
  score: number
  nodeScore: number
}

interface ReplacementNodePlan {
  node: Text
  matches: ReplacementMatch[]
  score: number
  limit: number
}

interface SelectionDetailView {
  explanation?: string
  context?: string
  terms: Array<{
    term: string
    explanation: string
  }>
  translationReview?: string
  advice?: string
}

interface LastTranslationState {
  selected: string
  translation: string
  detail: string
  context: string
}

interface DialogAnchor {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

type DialogMessageRole = 'system' | 'user' | 'assistant'

interface DialogHistoryMessage {
  role: 'user' | 'assistant'
  content: string
  /** Excerpt ids sent with this turn, so later turns can skip resending them. */
  segmentIds?: string[]
}

interface MediaTargetInfo {
  element: HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement
  kind: 'image' | 'video' | 'audio' | 'media'
  src: string
  title?: string
  alt?: string
  mimeType?: string
  currentTime?: number
  duration?: number
  width?: number
  height?: number
  poster?: string
}

interface MediaToolbarState extends MediaTargetInfo {
  toolbar: HTMLElement
  highlight: HTMLElement
  answer?: HTMLElement
  copy?: HTMLButtonElement
  collapsible?: CollapsibleHandle
  promptText?: string
  frameDataUrl?: string
  mediaDataUrl?: string
}

const discourseTitleSelectors = [
  '.topic-list .main-link',
  '.topic-list .title',
  '.topic-list-item .title',
  '.latest-topic-list-item .main-link',
  '.latest-topic-list-item .title',
  '.topic-title',
  '.fancy-title',
  '[data-topic-id] .title',
  '[itemprop="headline"]',
].join(',')

function isDiscourseTitleElement(element: Element) {
  return detectSpecialSiteHints().discourse && Boolean(element.closest(discourseTitleSelectors))
}

function textNodeAllowed(node: Text) {
  const parent = node.parentElement
  if (!parent)
    return false

  return !isLexiIgnoredElement(parent) && !isDiscourseTitleElement(parent)
}

function isLexiIgnoredElement(element: Element) {
  return ignoredSelectors.some(selector => element.closest(selector))
    || isAttachmentElement(element)
    || Boolean(element.closest('[contenteditable]:not([contenteditable="false"])'))
}

function isSelectionInIgnoredArea(range?: Range) {
  const node = range?.commonAncestorContainer
  const element = node instanceof Element ? node : node?.parentElement
  return Boolean(element && isLexiIgnoredElement(element))
}

function dedupeReplacementCandidates(candidates: VocabularyCandidate[]) {
  const byOriginal = new Map<string, VocabularyCandidate>()
  for (const candidate of candidates)
    byOriginal.set(candidate.original.trim().toLowerCase(), candidate)

  return [...byOriginal.values()]
}

function createReplacementRecordIndex(records: VocabularyRecord[]): ReplacementRecordIndex {
  const byId = new Map<string, VocabularyRecord>()
  const byOriginal = new Map<string, VocabularyRecord>()
  for (const record of records) {
    byId.set(record.id, record)
    if (!byOriginal.has(record.original))
      byOriginal.set(record.original, record)
  }

  return { byId, byOriginal }
}

function getCandidateRecord(index: ReplacementRecordIndex, candidate: VocabularyCandidate) {
  const id = getVocabularyId(candidate.original, candidate.replacement)
  return index.byId.get(id) ?? index.byOriginal.get(candidate.original)
}

function createReplacementCandidatePool(
  settings: LexiSettings,
  records: VocabularyRecord[],
  recordIndex: ReplacementRecordIndex,
  conservative = false,
) {
  const { min, max: maxDifficulty } = getDifficultyWindow(settings.replacement.level)
  // Conservative sites skip the easiest tier when the level still leaves room for it.
  const minDifficulty = conservative ? Math.min(Math.max(min, 2), maxDifficulty) : min
  const now = Date.now()
  const filterCandidate = (candidate: VocabularyCandidate) => {
    // Eligibility, not just ranking: archived or over-exposed words leave the pool
    // entirely, so pages replace less as the user actually learns.
    const record = getCandidateRecord(recordIndex, candidate)
    if (record && isReplacementSuppressed(record, now))
      return false

    if (isProductVocabularyCandidate(candidate))
      return true

    if (conservative && isLowValueShortChineseCandidate(candidate))
      return false

    return candidate.difficulty >= minDifficulty
      && candidate.difficulty <= maxDifficulty
      && canAutoReplaceCandidate(candidate)
  }
  const local = programmerVocabulary.filter(filterCandidate)
  const recorded = records.filter(filterCandidate)
  return dedupeReplacementCandidates([...local, ...recorded])
}

function scoreReplacementCandidate(candidate: VocabularyCandidate, index: ReplacementRecordIndex, randomWeight = 0.65) {
  const record = getCandidateRecord(index, candidate)
  const now = Date.now()
  const unseenBoost = record ? 0 : 1.2
  const staleBoost = record ? Math.min(1.2, (now - record.updatedAt) / replacementFreshnessWindowMs) : 0.8
  const fatiguePenalty = record
    ? Math.min(1.8, Math.log1p(record.seenCount) * 0.35 + record.learnedLevel * 0.16)
    : 0

  return unseenBoost
    + staleBoost
    + Math.random() * randomWeight
    + candidate.difficulty * 0.06
    + Math.min(0.25, candidate.original.length / 30)
    - fatiguePenalty
}

function collectReplacementMatches(
  node: Text,
  candidates: VocabularyCandidate[],
  recordIndex: ReplacementRecordIndex,
  density: number,
): ReplacementNodePlan | undefined {
  const text = node.nodeValue ?? ''
  const matches: ReplacementMatch[] = []

  for (const candidate of candidates) {
    if (!candidate.original)
      continue

    const index = text.indexOf(candidate.original)
    if (index < 0)
      continue

    matches.push({
      candidate,
      index,
      score: scoreReplacementCandidate(candidate, recordIndex, 0.2),
      nodeScore: 0,
    })
  }

  if (!matches.length)
    return undefined

  const nodeBoost = Math.min(0.4, text.length / 500)
  const score = matches.reduce((total, match) => total + match.score, 0) + nodeBoost
  const uniqueOriginals = new Set(matches.map(match => match.candidate.original))
  const limit = Math.max(1, Math.round(uniqueOriginals.size * density))

  return {
    node,
    matches: matches.map(match => ({ ...match, nodeScore: score })),
    score,
    limit,
  }
}

function selectReplacementPlans(plans: ReplacementNodePlan[], maxPerPage: number, maxProductAnnotationsPerPage: number) {
  const usedOriginals = new Set<string>()
  const selected = new Map<Text, ReplacementMatch[]>()
  const sortedPlans = [...plans].sort((a, b) => b.score - a.score)

  let replacementCount = 0
  let productAnnotationCount = 0
  for (const plan of sortedPlans) {
    if (replacementCount >= maxPerPage && productAnnotationCount >= maxProductAnnotationsPerPage)
      break

    const fresh = plan.matches.filter(match => !usedOriginals.has(match.candidate.original))
    const matches = (fresh.length ? fresh : plan.matches)
      .sort((a, b) => b.score - a.score || a.index - b.index)
    let planReplacementCount = 0
    let planProductAnnotationCount = 0

    for (const match of matches) {
      const isProduct = isProductVocabularyCandidate(match.candidate)
      if (isProduct) {
        if (productAnnotationCount >= maxProductAnnotationsPerPage || planProductAnnotationCount >= 2)
          continue
      }
      else if (replacementCount >= maxPerPage || planReplacementCount >= plan.limit) {
        continue
      }

      const nodeMatches = selected.get(plan.node) ?? []
      if (nodeMatches.some(selectedMatch => replacementMatchesOverlap(selectedMatch, match)))
        continue

      nodeMatches.push(match)
      selected.set(plan.node, nodeMatches)
      usedOriginals.add(match.candidate.original)
      if (isProduct) {
        productAnnotationCount += 1
        planProductAnnotationCount += 1
      }
      else {
        replacementCount += 1
        planReplacementCount += 1
      }
    }
  }

  return selected
}

function replacementMatchesOverlap(a: ReplacementMatch, b: ReplacementMatch) {
  const aEnd = a.index + a.candidate.original.length
  const bEnd = b.index + b.candidate.original.length
  return a.index < bEnd && b.index < aEnd
}

function countSelectedReplacements(plans: Map<Text, ReplacementMatch[]>) {
  let count = 0
  for (const matches of plans.values())
    count += matches.filter(match => !isProductVocabularyCandidate(match.candidate)).length

  return count
}

function getProductAnnotationBudget(maxReplacementsPerPage: number) {
  return Math.min(12, Math.max(3, Math.ceil(maxReplacementsPerPage * 0.75)))
}

function normalizeReplacementSeed(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 320)
}

function createReplacementSeedKey(text: string) {
  return `${location.href}:${normalizeReplacementSeed(text)}`
}

function candidateExists(records: VocabularyRecord[], candidate: VocabularyCandidate) {
  const id = getVocabularyId(candidate.original, candidate.replacement)
  return records.some(record => record.id === id)
}

function collectReplacementSeed(seeds: ReplacementSeed[], text: string, context: string) {
  const normalized = normalizeReplacementSeed(text)
  if (seeds.length >= maxAiReplacementSeedsPerPage || normalized.length < 24)
    return

  const key = createReplacementSeedKey(normalized)
  if (requestedReplacementSeeds.has(key))
    return

  requestedReplacementSeeds.add(key)
  seeds.push({
    text: normalized,
    context,
  })
}

function normalizeTerm(value: unknown) {
  if (!value || typeof value !== 'object')
    return undefined

  const item = value as { term?: unknown, explanation?: unknown }
  const term = typeof item.term === 'string' ? item.term.trim() : ''
  const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
  if (!term || !explanation)
    return undefined

  return {
    term,
    explanation,
  }
}

function normalizeSelectionDetail(value: unknown): SelectionDetailView {
  if (!value || typeof value !== 'object')
    return { terms: [] }

  const detail = value as {
    explanation?: unknown
    context?: unknown
    terms?: unknown
    translationReview?: unknown
    advice?: unknown
    aiSuggestion?: unknown
  }

  return {
    explanation: typeof detail.explanation === 'string' ? detail.explanation.trim() : undefined,
    context: typeof detail.context === 'string' ? detail.context.trim() : undefined,
    terms: Array.isArray(detail.terms)
      ? detail.terms.map(normalizeTerm).filter(item => item != null)
      : [],
    translationReview: typeof detail.translationReview === 'string' ? detail.translationReview.trim() : undefined,
    advice: typeof detail.advice === 'string'
      ? detail.advice.trim()
      : typeof detail.aiSuggestion === 'string'
        ? detail.aiSuggestion.trim()
        : undefined,
  }
}

function formatSelectionDetail(detail: SelectionDetailView) {
  const lines = [
    detail.explanation,
    ...detail.terms.map(item => `术语：${item.term} - ${item.explanation}`),
    detail.context ? `语境：${detail.context}` : '',
    detail.translationReview ? `译文优化：${detail.translationReview}` : '',
    detail.advice ? `建议：${detail.advice}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function formatCandidateMeaning(candidate: VocabularyCandidate) {
  const meaning = candidate.meaning.trim()
  if (!meaning)
    return ''

  if (!hasCjkText(meaning))
    return `英文解释：${meaning}`

  const hasEnglishExplanation = /[a-z][a-z\s,.;:'"()/-]{18,}/i.test(meaning)
  return hasEnglishExplanation ? `中英解释：${meaning}` : meaning
}

function createToken(candidate: VocabularyCandidate, displayMode: LexiSettings['replacement']['displayMode']) {
  const token = document.createElement('span')
  const isProduct = isProductVocabularyCandidate(candidate)
  token.dataset.lexiToken = 'true'
  token.dataset.lexiId = getVocabularyId(candidate.original, candidate.replacement)
  token.dataset.original = candidate.original
  token.dataset.replacement = candidate.replacement
  token.dataset.meaning = formatCandidateMeaning(candidate)
  token.dataset.example = candidate.example
  token.dataset.tags = candidate.tags.join(', ')
  token.dataset.pronunciation = candidate.pronunciation ?? ''
  token.dataset.lexiProduct = isProduct ? 'true' : 'false'
  token.className = isProduct ? 'lexi-token lexi-token-product' : 'lexi-token'
  token.textContent = isProduct
    ? candidate.original
    : getReplacementDisplayText(candidate, displayMode)
  return token
}

function getPageStyleContent(customCss = '') {
  return `
    /* Shared design tokens, mirrored from the official site (apps/site main.css):
       near-neutral surfaces, one blue accent, purple only for product entities. */
    .lexi-token,
    .lexi-token-tooltip,
    .lexi-toast,
    .lexi-selection-translation,
    .lexi-page-translation,
    .lexi-media-highlight,
    .lexi-media-toolbar,
    .lexi-dialog {
      --lexi-ink: #0d0d0d;
      --lexi-ink-2: #5c5c66;
      --lexi-ink-3: #8e8e9a;
      --lexi-line: #e6e6ea;
      --lexi-line-strong: #d8d8de;
      --lexi-bg: #ffffff;
      --lexi-bg-subtle: #f7f7f8;
      --lexi-accent: #1976ff;
      --lexi-accent-ink: #0b57c7;
      --lexi-accent-soft: #edf3ff;
      --lexi-tech-soft: #e8f0fe;
      --lexi-prod: #7c5cff;
      --lexi-prod-soft: #f0ecff;
      --lexi-glass-bg: rgba(255, 255, 255, 0.76);
      --lexi-glass-blur: blur(26px) saturate(180%);
      --lexi-glass-shadow: 0 16px 40px -8px rgba(13, 13, 13, 0.17);
      --lexi-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
      --lexi-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    /* Dark pages get the iOS dark material: same structure, inverted surfaces. */
    [data-lexi-theme="dark"] .lexi-token,
    [data-lexi-theme="dark"] .lexi-token-tooltip,
    [data-lexi-theme="dark"] .lexi-toast,
    [data-lexi-theme="dark"] .lexi-selection-translation,
    [data-lexi-theme="dark"] .lexi-page-translation,
    [data-lexi-theme="dark"] .lexi-media-highlight,
    [data-lexi-theme="dark"] .lexi-media-toolbar {
      --lexi-ink: #f2f2f4;
      --lexi-ink-2: #b6b6c2;
      --lexi-ink-3: #8e8e9a;
      --lexi-line: rgba(255, 255, 255, 0.12);
      --lexi-line-strong: rgba(255, 255, 255, 0.22);
      --lexi-bg: #1c1c1e;
      --lexi-bg-subtle: rgba(255, 255, 255, 0.06);
      --lexi-accent: #6fa8ff;
      --lexi-accent-ink: #8db8ff;
      --lexi-accent-soft: rgba(111, 168, 255, 0.16);
      --lexi-tech-soft: rgba(111, 168, 255, 0.16);
      --lexi-prod: #a18bff;
      --lexi-prod-soft: rgba(161, 139, 255, 0.18);
      --lexi-glass-bg: rgba(28, 28, 30, 0.72);
      --lexi-glass-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.6);
    }

    [data-lexi-theme="dark"] .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, rgba(28, 28, 30, 0.86) 0%, rgba(38, 42, 52, 0.84) 48%, rgba(28, 28, 30, 0.86) 100%);
      background-size: 220% 100%;
    }


    [data-lexi-theme="dark"] .lexi-media-toolbar__button:first-child {
      background: #ececec;
      color: #0d0d0d;
    }

    [data-lexi-theme="dark"] .lexi-media-toolbar__button:first-child:hover {
      background: #ffffff;
    }

    @supports not (backdrop-filter: blur(4px)) {
      [data-lexi-theme="dark"] .lexi-token-tooltip,
      [data-lexi-theme="dark"] .lexi-selection-translation,
      [data-lexi-theme="dark"] .lexi-media-toolbar {
        background: rgba(28, 28, 30, 0.97);
      }
    }

    /* Replaced word: keep the page's own type, mark it with a quiet underline
       only; the tint appears on hover. Layout is untouched (no padding). */
    .lexi-token {
      border-radius: 3px;
      background: transparent;
      padding: 0;
      color: inherit;
      font-weight: inherit;
      cursor: help;
      text-decoration: underline;
      text-decoration-color: rgba(25, 118, 255, 0.42);
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
      transition: background-color 0.15s ease, text-decoration-color 0.15s ease;
    }

    .lexi-token:hover {
      background: var(--lexi-accent-soft);
      text-decoration-color: var(--lexi-accent);
    }

    [data-lexi-theme="dark"] .lexi-token {
      text-decoration-color: rgba(111, 168, 255, 0.48);
    }

    /* Product entity: text untouched, one small domain dot after it (.ent). */
    .lexi-token-product {
      background: transparent;
      padding: 0;
      color: inherit;
      font-weight: inherit;
      border-radius: 3px;
      text-decoration: none;
    }

    .lexi-token-product::after {
      content: "";
      display: inline-block;
      width: 4.5px;
      height: 4.5px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--lexi-prod);
      vertical-align: 0.18em;
    }

    .lexi-token-product:hover {
      background: var(--lexi-prod-soft);
      color: var(--lexi-ink);
    }

    /* Hover card: the frosted definition card from the official hero mock.
       Kept in layout while closed so it can be measured, then faded in/out. */
    .lexi-token-tooltip {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: grid;
      gap: 10px;
      width: min(360px, calc(100vw - 32px));
      border: 1px solid var(--lexi-line);
      border-radius: 14px;
      background: var(--lexi-glass-bg);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      backdrop-filter: var(--lexi-glass-blur);
      box-shadow: var(--lexi-glass-shadow);
      color: var(--lexi-ink);
      padding: 14px 16px;
      font: 13px/1.6 var(--lexi-font-sans);
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px) scale(0.98);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
    }

    .lexi-token-tooltip[data-lexi-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: none;
      pointer-events: auto;
      transition: opacity 160ms ease, transform 160ms ease;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-token-tooltip {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-token-tooltip {
        transition: none;
        transform: none;
      }
    }

    .lexi-token-tooltip * {
      box-sizing: border-box;
      font-family: var(--lexi-font-sans);
    }

    .lexi-hover-card__head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .lexi-hover-card__word {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--lexi-ink);
    }

    .lexi-hover-card__original {
      color: var(--lexi-ink-3);
      font-size: 12px;
    }

    .lexi-hover-card__tag {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--lexi-tech-soft);
      padding: 3px 9px;
      color: var(--lexi-accent);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }

    .lexi-hover-card__tag--product {
      background: var(--lexi-prod-soft);
      color: var(--lexi-prod);
    }

    .lexi-hover-card__phonetic {
      color: var(--lexi-ink-3);
      font-size: 12px;
      font-family: var(--lexi-font-mono);
    }

    .lexi-hover-card__def {
      margin: 0;
      color: var(--lexi-ink-2);
      font-size: 13px;
      line-height: 1.8;
    }

    .lexi-hover-card__example {
      margin: 0;
      color: var(--lexi-ink-3);
      font-size: 12px;
      line-height: 1.7;
    }

    .lexi-hover-card__divider {
      margin: 0;
      border: 0;
      border-top: 1px solid var(--lexi-line);
    }

    .lexi-hover-card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .lexi-hover-card__action {
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--lexi-accent);
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.4;
    }

    .lexi-hover-card__action:hover {
      color: var(--lexi-accent-ink);
    }

    .lexi-hover-card__tags {
      overflow: hidden;
      color: var(--lexi-ink-3);
      font-size: 11px;
      font-family: var(--lexi-font-mono);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-toast {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      border-radius: 10px;
      background: rgba(13, 13, 13, 0.92);
      box-shadow: 0 16px 40px -8px rgba(13, 13, 13, 0.3);
      color: #ffffff;
      padding: 10px 14px;
      font: 13px/1.5 var(--lexi-font-sans);
      pointer-events: none;
      transform: translateX(-50%) translateY(10px);
      opacity: 0;
      animation: lexi-toast-enter 180ms ease-out forwards;
    }

    .lexi-toast[data-lexi-closing="true"] {
      animation: lexi-toast-exit 200ms ease forwards;
    }

    .lexi-selection-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      position: relative;
      max-width: min(100%, 64rem);
      margin: 0.85em 0;
      border: 1px solid var(--lexi-line);
      border-radius: 12px;
      background: var(--lexi-glass-bg);
      box-shadow: 0 16px 40px -12px rgba(13, 13, 13, 0.14);
      backdrop-filter: var(--lexi-glass-blur);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      padding: 0.7em 0.85em;
      color: var(--lexi-ink);
      font: 14px/1.65 var(--lexi-font-sans);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
      overflow: hidden;
      animation: lexi-card-enter 180ms ease-out both;
      transform-origin: top left;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-selection-translation {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] {
      display: inline-flex;
      width: fit-content;
      max-width: min(100%, 22rem);
      border: 1px solid var(--lexi-line);
      border-radius: 999px;
      background: var(--lexi-accent-soft);
      padding: 0;
      color: var(--lexi-accent-ink);
    }

    .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, rgba(255, 255, 255, 0.86) 0%, rgba(237, 243, 255, 0.84) 48%, rgba(255, 255, 255, 0.86) 100%);
      background-size: 220% 100%;
      animation: lexi-card-enter 180ms ease-out both, lexi-shimmer-surface 1000ms ease-in-out infinite;
    }

    .lexi-selection-translation[data-lexi-loading="true"]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, transparent 0%, rgba(25, 118, 255, 0.08) 46%, transparent 78%);
      transform: translateX(-120%);
      animation: lexi-shimmer-sweep 1000ms ease-in-out infinite;
      pointer-events: none;
    }

    .lexi-selection-translation__header {
      all: initial;
      display: flex;
      box-sizing: border-box;
      align-items: center;
      justify-content: space-between;
      gap: 0.65em;
      margin-bottom: 0.18em;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__header,
    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__body {
      display: none;
    }

    .lexi-selection-translation__label {
      all: initial;
      display: inline-block;
      box-sizing: border-box;
      margin: 0;
      background: var(--lexi-accent-soft);
      color: var(--lexi-accent-ink);
      font: 600 11px/1.5 var(--lexi-font-sans);
      padding: 3px 9px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .lexi-selection-translation__actions {
      all: initial;
      display: inline-flex;
      box-sizing: border-box;
      align-items: center;
      gap: 0.25em;
    }

    .lexi-selection-translation__icon-button {
      all: initial;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.65em;
      height: 1.65em;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--lexi-ink-3);
      cursor: pointer;
      font: 13px/1 var(--lexi-font-sans);
      user-select: none;
    }

    .lexi-selection-translation__icon-button:hover {
      border-color: var(--lexi-line);
      background: var(--lexi-accent-soft);
      color: var(--lexi-accent-ink);
    }

    .lexi-selection-translation__body {
      all: initial;
      display: block;
      box-sizing: border-box;
    }

    .lexi-selection-translation__text {
      all: initial;
      display: inline;
      color: var(--lexi-ink);
      font: 14px/1.65 var(--lexi-font-sans);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
    }

    .lexi-selection-translation__text[data-lexi-revealing="true"] {
      animation: lexi-text-reveal 220ms ease-out both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__chunk[data-lexi-new="true"] {
      animation: lexi-text-reveal 180ms ease-out both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__char[data-lexi-new="true"] {
      display: inline-block;
      animation: lexi-char-reveal 190ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
      will-change: opacity, filter, transform;
    }

    .lexi-selection-translation__text[data-lexi-loading="true"] {
      display: inline;
      color: var(--lexi-accent-ink);
      opacity: 0.62;
    }

    .lexi-selection-translation__detail {
      all: initial;
      display: block;
      margin-top: 0.45em;
      color: var(--lexi-ink-2);
      font: 12px/1.55 var(--lexi-font-sans);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-selection-translation__status {
      all: initial;
      display: flex;
      box-sizing: border-box;
      align-items: center;
      justify-content: space-between;
      gap: 0.75em;
      margin-top: 0.8em;
      padding-top: 0.6em;
      border-top: 1px solid var(--lexi-line);
      color: var(--lexi-ink-3);
      font: 11px/1.4 var(--lexi-font-sans);
    }

    .lexi-selection-translation__locate {
      all: initial;
      box-sizing: border-box;
      color: var(--lexi-accent-ink);
      cursor: pointer;
      font: 600 11px/1.4 var(--lexi-font-sans);
    }

    .lexi-selection-translation__locate:hover,
    .lexi-selection-translation__locate:focus-visible {
      text-decoration: underline;
      outline: none;
    }

    .lexi-selection-translation__collapsed {
      all: initial;
      box-sizing: border-box;
      display: none;
      align-items: center;
      gap: 0.4em;
      max-width: 100%;
      padding: 0.24em 0.65em;
      color: var(--lexi-accent-ink);
      cursor: pointer;
      font: 12px/1.45 var(--lexi-font-sans);
      user-select: none;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__collapsed {
      display: inline-flex;
      animation: lexi-capsule-content-enter 180ms ease-out both;
    }

    .lexi-selection-translation__collapsed-icon {
      all: initial;
      color: var(--lexi-accent);
      font: 13px/1 var(--lexi-font-sans);
    }

    .lexi-selection-translation__collapsed-text {
      all: initial;
      min-width: 0;
      overflow: hidden;
      color: var(--lexi-accent-ink);
      font: 12px/1.45 var(--lexi-font-sans);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @keyframes lexi-toast-enter {
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes lexi-toast-exit {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(6px);
      }
    }

    @keyframes lexi-text-reveal {
      from {
        opacity: 0.42;
        filter: blur(3px);
        transform: translateY(2px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }
    }

    @keyframes lexi-card-enter {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes lexi-capsule-content-enter {
      from {
        opacity: 0;
        transform: translateY(1px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes lexi-char-reveal {
      from {
        opacity: 0;
        filter: blur(3px);
        transform: translateX(4px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateX(0);
      }
    }

    @keyframes lexi-shimmer-surface {
      from {
        background-position-x: 110%;
      }
      to {
        background-position-x: -110%;
      }
    }

    @keyframes lexi-shimmer-sweep {
      to {
        transform: translateX(120%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-selection-translation__text[data-lexi-revealing="true"],
      .lexi-selection-translation__chunk[data-lexi-new="true"],
      .lexi-selection-translation__char[data-lexi-new="true"],
      .lexi-selection-translation__text[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"]::after,
      .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__collapsed,
      .lexi-selection-translation {
        animation: none;
      }
    }

    /* Translations read as quiet footnotes to the original paragraph, not as
       AI task cards: one soft tint, no accent bars, no looping animation.
       Scheduling priority (viewport/near/prefetch) stays invisible on purpose. */
    .lexi-page-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      margin: 0.55em 0;
      border-radius: 8px;
      background: var(--lexi-accent-soft);
      padding: 0.55em 0.7em;
      color: var(--lexi-ink);
      font: 13px/1.55 var(--lexi-font-sans);
      white-space: pre-wrap;
      overflow: hidden;
      overflow-wrap: anywhere;
      animation: lexi-page-translation-enter 180ms ease-out both;
    }

    .lexi-page-translation[data-lexi-loading="true"] {
      color: var(--lexi-ink-3);
      transition: opacity 180ms ease;
      opacity: 0.75;
    }

    @keyframes lexi-page-translation-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-page-translation,
      .lexi-page-translation[data-lexi-loading="true"] {
        animation: none;
        transition: none;
      }
    }

    .lexi-media-highlight {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483646;
      overflow: visible;
      border: 2px solid rgba(25, 118, 255, 0.9);
      border-radius: var(--lexi-media-radius, 16px);
      box-shadow: 0 0 0 4px rgba(25, 118, 255, 0.14), 0 16px 40px -8px rgba(13, 13, 13, 0.2);
      pointer-events: none;
      animation: lexi-card-enter 160ms ease-out both;
    }

    .lexi-media-highlight::after {
      content: "Lexi";
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 1;
      border-radius: 999px;
      background: rgba(13, 13, 13, 0.92);
      box-shadow: 0 8px 20px rgba(13, 13, 13, 0.22);
      color: #fff;
      font: 700 11px/1 var(--lexi-font-sans);
      letter-spacing: .02em;
      padding: 5px 8px;
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-media-highlight {
        animation: none;
      }
    }

    .lexi-media-toolbar {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: grid;
      gap: 10px;
      width: min(420px, calc(100vw - 24px));
      border: 1px solid var(--lexi-line);
      border-radius: 16px;
      background: var(--lexi-glass-bg);
      box-shadow: var(--lexi-glass-shadow);
      backdrop-filter: var(--lexi-glass-blur);
      -webkit-backdrop-filter: var(--lexi-glass-blur);
      color: var(--lexi-ink);
      padding: 12px;
      font: 13px/1.45 var(--lexi-font-sans);
      animation: lexi-card-enter 160ms ease-out both;
    }

    @supports not (backdrop-filter: blur(4px)) {
      .lexi-media-toolbar {
        background: rgba(255, 255, 255, 0.97);
      }
    }

    .lexi-media-toolbar * {
      box-sizing: border-box;
      font-family: var(--lexi-font-sans);
    }

    .lexi-media-toolbar__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .lexi-media-toolbar__title {
      min-width: 0;
      overflow: hidden;
      color: var(--lexi-ink);
      font-size: 13px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-media-toolbar__close {
      border: 0;
      background: transparent;
      color: var(--lexi-ink-3);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 3px;
    }

    .lexi-media-toolbar__meta {
      overflow: hidden;
      color: var(--lexi-ink-3);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-media-toolbar__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .lexi-media-toolbar__button {
      border: 1px solid var(--lexi-line-strong);
      border-radius: 999px;
      background: var(--lexi-bg);
      color: var(--lexi-ink);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 12px;
    }

    .lexi-media-toolbar__button:hover {
      border-color: var(--lexi-ink-3);
    }

    .lexi-media-toolbar__button:first-child {
      border-color: transparent;
      background: var(--lexi-ink);
      color: #ffffff;
    }

    .lexi-media-toolbar__button:first-child:hover {
      background: #2b2b2b;
    }

    .lexi-media-toolbar__answer {
      max-height: 260px;
      overflow: auto;
      border: 1px solid var(--lexi-line);
      border-radius: 12px;
      background: var(--lexi-bg-subtle);
      padding: 11px 12px;
      color: var(--lexi-ink-2);
      font-size: 12px;
      line-height: 1.68;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog {
      /* ChatGPT-style surface: flat, quiet, generous radius, one strong shadow. */
      --ld-bg: #ffffff;
      --ld-text: #0d0d0d;
      --ld-muted: #8f8f8f;
      --ld-faint: #b4b4b4;
      --ld-border: rgba(13, 13, 13, 0.1);
      --ld-hover: rgba(13, 13, 13, 0.05);
      --ld-bubble: #f4f4f4;
      --ld-code-bg: #f9f9f9;
      --ld-code-border: rgba(13, 13, 13, 0.08);
      --ld-link: #1976ff;
      --ld-composer-bg: #ffffff;
      --ld-composer-border: rgba(13, 13, 13, 0.16);
      --ld-composer-focus: rgba(13, 13, 13, 0.42);
      --ld-send-bg: #0d0d0d;
      --ld-send-fg: #ffffff;
      --ld-send-disabled: #e3e3e3;
      --ld-send-disabled-fg: #a6a6a6;
      --ld-chip-bg: #ffffff;
      --ld-chip-border: rgba(13, 13, 13, 0.12);
      --ld-shadow: 0 24px 70px rgba(0, 0, 0, 0.16), 0 4px 14px rgba(0, 0, 0, 0.06);
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      width: min(680px, calc(100vw - 32px));
      max-height: min(72vh, 640px);
      border: 1px solid var(--ld-border);
      border-radius: 18px;
      background: var(--ld-bg);
      box-shadow: var(--ld-shadow);
      color: var(--ld-text);
      color-scheme: light;
      font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
      overflow: hidden;
      animation: lexi-dialog-enter 180ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
    }

    .lexi-dialog * {
      box-sizing: border-box;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", sans-serif;
    }

    .lexi-dialog__head {
      display: flex;
      align-items: center;
      flex: none;
      gap: 8px;
      border-bottom: 1px solid var(--ld-border);
      padding: 10px 14px;
      cursor: grab;
      /* The header is the drag handle, so a drag must not select the title text. */
      user-select: none;
      touch-action: none;
    }

    .lexi-dialog__head button { cursor: pointer; }

    .lexi-dialog[data-lexi-dialog-dragging="true"] .lexi-dialog__head { cursor: grabbing; }

    .lexi-dialog[data-lexi-dialog-dragging="true"],
    .lexi-dialog[data-lexi-dialog-resizing="true"] {
      user-select: none;
      animation: none;
    }

    .lexi-dialog__resizer {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      touch-action: none;
    }

    .lexi-dialog__resizer::after {
      content: "";
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 7px;
      height: 7px;
      border-right: 1.5px solid var(--ld-faint);
      border-bottom: 1.5px solid var(--ld-faint);
      border-bottom-right-radius: 2px;
    }

    .lexi-dialog[data-lexi-collapsed="true"] > .lexi-dialog__resizer { display: none; }

    .lexi-dialog__title {
      flex: none;
      color: var(--ld-text);
      font-size: 14px;
      font-weight: 650;
      letter-spacing: 0.01em;
    }

    .lexi-dialog__subtitle {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      color: var(--ld-muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-dialog__close,
    .lexi-dialog__collapse-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex: none;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ld-muted);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0;
    }

    .lexi-dialog__close:hover,
    .lexi-dialog__collapse-toggle:hover {
      background: var(--ld-hover);
      color: var(--ld-text);
      opacity: 1;
    }

    .lexi-dialog__body {
      display: flex;
      min-height: 0;
      flex: 1;
      flex-direction: column;
    }

    .lexi-dialog__messages {
      display: flex;
      min-height: 96px;
      flex: 1;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 16px 18px 8px;
      scroll-behavior: smooth;
      scrollbar-width: thin;
      scrollbar-color: rgba(127, 127, 127, 0.35) transparent;
    }

    .lexi-dialog__messages::-webkit-scrollbar { width: 6px; }
    .lexi-dialog__messages::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(127, 127, 127, 0.35); }
    .lexi-dialog__messages::-webkit-scrollbar-track { background: transparent; }

    .lexi-dialog__msg {
      display: flex;
      flex-direction: column;
      animation: lexi-dialog-msg-in 180ms ease-out both;
    }

    .lexi-dialog__msg--user { align-items: flex-end; }
    .lexi-dialog__msg--assistant { align-items: stretch; }

    /* User turns: quiet gray bubble on the right, like ChatGPT. */
    .lexi-dialog__bubble {
      max-width: 85%;
      border-radius: 18px;
      background: var(--ld-bubble);
      padding: 9px 14px;
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.6;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    /* Assistant turns: no bubble, plain text on the surface. */
    .lexi-dialog__md {
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }

    .lexi-dialog__note {
      align-self: center;
      max-width: 88%;
      color: var(--ld-faint);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }

    .lexi-dialog__md p { margin: 0 0 10px; }
    .lexi-dialog__md p:last-child, .lexi-dialog__bubble p { margin: 0; }
    .lexi-dialog__md ul, .lexi-dialog__md ol { margin: 0 0 10px; padding-left: 22px; }
    .lexi-dialog__md li { margin: 3px 0; }
    .lexi-dialog__md blockquote { margin: 0 0 10px; border-left: 3px solid var(--ld-border); padding: 2px 0 2px 12px; color: var(--ld-muted); }
    .lexi-dialog__md a { color: var(--ld-link); text-decoration: underline; text-underline-offset: 2px; }
    .lexi-dialog__md code, .lexi-dialog__bubble code {
      border: 1px solid var(--ld-code-border);
      border-radius: 6px;
      background: var(--ld-code-bg);
      padding: 1px 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12.5px;
    }
    .lexi-dialog__md pre {
      margin: 0 0 10px;
      border: 1px solid var(--ld-code-border);
      border-radius: 10px;
      background: var(--ld-code-bg);
      padding: 12px 14px;
      overflow-x: auto;
    }
    .lexi-dialog__md pre code { border: 0; background: transparent; padding: 0; font-size: 12.5px; line-height: 1.55; }

    /* Streaming indicator: ChatGPT's pulsing dot at the end of the draft. */
    .lexi-dialog__cursor {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--ld-text);
      vertical-align: baseline;
      animation: lexi-dialog-cursor 900ms ease-in-out infinite;
    }

    .lexi-dialog__sources {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }

    .lexi-dialog__source-chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      gap: 5px;
      border: 1px solid var(--ld-chip-border);
      border-radius: 999px;
      background: var(--ld-chip-bg);
      color: var(--ld-muted);
      cursor: pointer;
      font-size: 11.5px;
      line-height: 1;
      padding: 5px 10px;
    }

    .lexi-dialog__source-chip:hover { background: var(--ld-hover); color: var(--ld-text); }
    .lexi-dialog__source-chip span { overflow: hidden; max-width: 200px; text-overflow: ellipsis; white-space: nowrap; }

    .lexi-dialog__composer { flex: none; padding: 8px 14px 12px; }

    .lexi-dialog__suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 2px 8px;
    }

    .lexi-dialog__suggestion {
      border: 1px solid var(--ld-chip-border);
      border-radius: 999px;
      background: var(--ld-chip-bg);
      color: var(--ld-muted);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 5px 11px;
    }

    .lexi-dialog__suggestion:hover {
      background: var(--ld-hover);
      color: var(--ld-text);
    }

    .lexi-dialog__context {
      overflow: hidden;
      margin: 0 4px 6px;
      color: var(--ld-faint);
      font-size: 11.5px;
      line-height: 1.5;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The composer: one rounded field with the send control inside, ChatGPT-style. */
    .lexi-dialog__form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border: 1px solid var(--ld-composer-border);
      border-radius: 24px;
      background: var(--ld-composer-bg);
      padding: 8px 8px 8px 16px;
      transition: border-color 120ms ease;
    }

    .lexi-dialog__form:focus-within { border-color: var(--ld-composer-focus); }

    .lexi-dialog__input {
      display: block;
      min-width: 0;
      flex: 1;
      min-height: 24px;
      max-height: 160px;
      resize: none;
      border: 0;
      background: transparent;
      padding: 3px 0;
      color: var(--ld-text);
      font-size: 14px;
      line-height: 1.55;
      outline: none;
      overflow-y: auto;
      scrollbar-width: thin;
    }

    .lexi-dialog__input::placeholder { color: var(--ld-faint); }

    .lexi-dialog__send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      flex: none;
      border: 0;
      border-radius: 50%;
      background: var(--ld-send-bg);
      color: var(--ld-send-fg);
      cursor: pointer;
      padding: 0;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .lexi-dialog__send:hover { opacity: 0.85; }
    .lexi-dialog__send:active { transform: scale(0.94); }
    .lexi-dialog__send[data-lexi-idle="true"] { background: var(--ld-send-disabled); color: var(--ld-send-disabled-fg); cursor: default; }
    .lexi-dialog__send svg { display: block; }

    .lexi-dialog__hint {
      margin: 7px 4px 0;
      color: var(--ld-faint);
      font-size: 11px;
      text-align: center;
    }

    @keyframes lexi-dialog-enter {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes lexi-dialog-msg-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes lexi-dialog-cursor {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.82); }
    }

    @media (prefers-color-scheme: dark) {
      .lexi-dialog {
        --ld-bg: #212121;
        --ld-text: #ececec;
        --ld-muted: #9b9b9b;
        --ld-faint: #7c7c7c;
        --ld-border: rgba(255, 255, 255, 0.09);
        --ld-hover: rgba(255, 255, 255, 0.08);
        --ld-bubble: #303030;
        --ld-code-bg: #171717;
        --ld-code-border: rgba(255, 255, 255, 0.08);
        --ld-link: #6fa8ff;
        --ld-composer-bg: #2f2f2f;
        --ld-composer-border: rgba(255, 255, 255, 0.12);
        --ld-composer-focus: rgba(255, 255, 255, 0.36);
        --ld-send-bg: #ececec;
        --ld-send-fg: #0d0d0d;
        --ld-send-disabled: #3a3a3a;
        --ld-send-disabled-fg: #737373;
        --ld-chip-bg: #2a2a2a;
        --ld-chip-border: rgba(255, 255, 255, 0.12);
        --ld-shadow: 0 24px 70px rgba(0, 0, 0, 0.55), 0 4px 14px rgba(0, 0, 0, 0.3);
        color-scheme: dark;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-dialog, .lexi-dialog__msg { animation: none; }
      .lexi-dialog__cursor { animation: none; opacity: 0.6; }
    }

    ${collapsibleStyles('lexi-dialog')}
    ${collapsibleStyles('lexi-media-toolbar')}

    ${customCss}
  `
}

function parseCssColor(value: string): [number, number, number, number] | undefined {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match)
    return undefined

  const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()))
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN))
    return undefined

  return [parts[0], parts[1], parts[2], Number.isNaN(parts[3]) ? 1 : parts[3] ?? 1]
}

/** Injected UI follows the page's own theme, not the OS preference. */
function detectPageTheme(): 'light' | 'dark' {
  let element: Element | null = document.body ?? document.documentElement
  while (element) {
    const color = parseCssColor(getComputedStyle(element).backgroundColor)
    if (color && color[3] > 0.02) {
      const [r, g, b] = color
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      return luminance < 0.45 ? 'dark' : 'light'
    }

    element = element.parentElement
  }

  return 'light'
}

function ensurePageStyles(customCss = '') {
  document.documentElement.dataset.lexiTheme = detectPageTheme()

  const content = getPageStyleContent(customCss)
  const current = document.getElementById('lexi-page-style')
  if (current) {
    if (current.textContent !== content)
      current.textContent = content
    return
  }

  const style = document.createElement('style')
  style.id = 'lexi-page-style'
  style.textContent = content
  document.documentElement.appendChild(style)
}

function getTokenFromEvent(event: Event) {
  const target = event.target
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-lexi-token]')
    : undefined
}

function createTooltip() {
  const tooltip = document.createElement('div')
  tooltip.className = 'lexi-token-tooltip'
  tooltip.dataset.lexiOpen = 'false'
  document.documentElement.appendChild(tooltip)
  return tooltip
}

function showLexiToast(message: string, customCss = '') {
  ensurePageStyles(customCss)
  document.querySelector<HTMLElement>('[data-lexi-toast]')?.remove()
  const toast = document.createElement('div')
  toast.className = 'lexi-toast'
  toast.dataset.lexiToast = 'true'
  toast.textContent = message
  document.documentElement.appendChild(toast)
  window.setTimeout(() => {
    toast.dataset.lexiClosing = 'true'
    window.setTimeout(() => toast.remove(), 220)
  }, 3000)
}

function positionHoverCard(tooltip: HTMLElement, token: HTMLElement) {
  const margin = 12
  const gap = 8
  const rect = token.getBoundingClientRect()
  // The card keeps its layout while closed (only opacity/visibility change),
  // so it is always measurable before opening.
  const { offsetWidth: width, offsetHeight: height } = tooltip

  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  const below = rect.bottom + gap
  const fitsBelow = below + height <= window.innerHeight - margin
  const top = !fitsBelow && rect.top - gap - height >= margin
    ? rect.top - gap - height
    : below

  tooltip.style.left = `${left}px`
  tooltip.style.top = `${Math.max(margin, top)}px`
}

function restoreReplacedTokens(original: string) {
  document.querySelectorAll<HTMLElement>('[data-lexi-token]').forEach((token) => {
    if (token.dataset.original === original)
      token.replaceWith(document.createTextNode(original))
  })
}

function renderHoverCard(tooltip: HTMLElement, token: HTMLElement, onArchive: (token: HTMLElement) => void) {
  const isProduct = token.dataset.lexiProduct === 'true'
  tooltip.replaceChildren()

  const head = document.createElement('div')
  head.className = 'lexi-hover-card__head'

  const word = document.createElement('b')
  word.className = 'lexi-hover-card__word'
  word.textContent = (isProduct ? token.dataset.original : token.dataset.replacement) ?? ''
  head.append(word)

  if (!isProduct && token.dataset.original) {
    const original = document.createElement('span')
    original.className = 'lexi-hover-card__original'
    original.textContent = token.dataset.original
    head.append(original)
  }

  const tag = document.createElement('span')
  tag.className = `lexi-hover-card__tag${isProduct ? ' lexi-hover-card__tag--product' : ''}`
  tag.textContent = isProduct ? '产品 / 工具' : '技术'
  head.append(tag)

  if (token.dataset.pronunciation) {
    const phonetic = document.createElement('span')
    phonetic.className = 'lexi-hover-card__phonetic'
    phonetic.textContent = token.dataset.pronunciation
    head.append(phonetic)
  }

  const def = document.createElement('p')
  def.className = 'lexi-hover-card__def'
  def.textContent = token.dataset.meaning ?? ''
  tooltip.append(head, def)

  if (token.dataset.example) {
    const example = document.createElement('p')
    example.className = 'lexi-hover-card__example'
    example.textContent = token.dataset.example
    tooltip.append(example)
  }

  const divider = document.createElement('hr')
  divider.className = 'lexi-hover-card__divider'

  const foot = document.createElement('div')
  foot.className = 'lexi-hover-card__foot'

  const action = document.createElement('button')
  action.type = 'button'
  action.className = 'lexi-hover-card__action'
  action.textContent = isProduct ? '✓ 知道了，不再标注' : '✓ 认识了，不再替换'
  action.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onArchive(token)
  })
  foot.append(action)

  if (token.dataset.tags) {
    const tags = document.createElement('span')
    tags.className = 'lexi-hover-card__tags'
    tags.textContent = token.dataset.tags
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ')
    foot.append(tags)
  }

  tooltip.append(divider, foot)
}

function replaceTextNode(
  node: Text,
  matches: ReplacementMatch[],
  displayMode: LexiSettings['replacement']['displayMode'],
) {
  if (!matches.length || !node.parentNode)
    return []

  const text = node.nodeValue ?? ''
  const fragment = document.createDocumentFragment()
  const applied: VocabularyCandidate[] = []
  let cursor = 0

  const used = new Set<string>()
  const sorted = [...matches].sort((a, b) => a.index - b.index || b.candidate.original.length - a.candidate.original.length)

  for (const match of sorted) {
    const { candidate, index } = match
    if (used.has(candidate.original) || index < cursor)
      continue

    if (index > cursor)
      fragment.append(document.createTextNode(text.slice(cursor, index)))

    fragment.append(createToken(candidate, displayMode))
    used.add(candidate.original)
    applied.push(candidate)
    cursor = index + candidate.original.length
  }

  if (!applied.length)
    return []

  if (cursor < text.length)
    fragment.append(document.createTextNode(text.slice(cursor)))

  node.parentNode.replaceChild(fragment, node)
  return applied
}

async function saveRecords(records: VocabularyRecord[]) {
  primeStoredRecords(records)
  await browser.storage.local.set({ [vocabularyStorageKey]: JSON.stringify(records) })
}

function applyHistoryLimit(records: VocabularyRecord[], settings: LexiSettings) {
  if (!settings.history.enabled)
    return records

  return records
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, settings.history.maxRecords))
}

function pageFeatureEnabled(settings: LexiSettings, hints = detectSpecialSiteHints()) {
  return isPageEnabled(settings) && (
    (settings.replacement.enabled && isSceneEnabled(settings, 'replacement', location.href, hints))
    || (settings.selection.enabled && isSceneEnabled(settings, 'selection', location.href, hints))
  )
}

function detectSpecialSiteHints(): SiteDetectionHints {
  const documentElement = document.documentElement
  const body = document.body
  const generator = document.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content ?? ''
  const applicationName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? ''
  const discourseManifest = document.querySelector('link[rel="manifest"][href*="manifest.webmanifest"]')
  const discourseAsset = document.querySelector('[href*="/assets/discourse"], [src*="/assets/discourse"], [href*="discourse-"], [src*="discourse-"]')
  const discourseRoot = document.querySelector('#data-preloaded, #discourse-modal, #reply-control, .d-header, .topic-list, .topic-post')
  const discourseGlobal = 'Discourse' in window || '__DISCOURSE_CONFIG__' in window
  const classText = `${documentElement.className} ${body?.className ?? ''}`
  const discourse = /discourse/i.test(generator)
    || /discourse/i.test(applicationName)
    || /discourse/i.test(classText)
    || Boolean(discourseManifest && discourseRoot)
    || Boolean(discourseAsset)
    || Boolean(discourseRoot && document.querySelector('meta[name="theme-color"], meta[property="og:site_name"]'))
    || discourseGlobal

  return { discourse }
}

function getDetectedSpecialProfileStats(settings: LexiSettings, hints = detectSpecialSiteHints()): PageSpecialProfileStats | undefined {
  const profile = findSpecialSiteProfile(settings, location.href, hints)
  if (!profile)
    return undefined

  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    detected: profile.id === 'discourse' && hints.discourse === true && profile.domains.includes(location.hostname),
    dynamicScan: profile.dynamicScan,
    conservative: profile.conservative,
  }
}

function getReplacementBudget(settings: LexiSettings, hints = detectSpecialSiteHints()) {
  const profile = findSpecialSiteProfile(settings, location.href, hints)
  const maxPerPage = profile?.conservative
    ? Math.min(settings.replacement.maxPerPage, profile.maxPerPage ?? 6)
    : settings.replacement.maxPerPage
  const levelDensity = getEffectiveDensity(settings.replacement)
  const density = profile?.conservative
    ? Math.min(levelDensity, profile.density ?? 0.06)
    : levelDensity

  return {
    maxPerPage: Math.max(0, maxPerPage),
    density: Math.max(0, density),
    dynamicScan: Boolean(profile?.dynamicScan),
    conservative: Boolean(profile?.conservative),
  }
}

function getContextText(node: Text) {
  const text = node.parentElement?.textContent?.trim() ?? node.nodeValue ?? ''
  return text.replace(/\s+/g, ' ').slice(0, 420)
}

function getElementFromRangeEnd(range: Range) {
  const container = range.endContainer
  return container instanceof Element ? container : container.parentElement
}

function createCollapsedSelectionAnchor(range: Range) {
  const anchor = document.createElement('span')
  anchor.dataset.lexiSelectionAnchor = 'true'
  anchor.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;'

  try {
    const collapsed = range.cloneRange()
    collapsed.collapse(false)
    collapsed.insertNode(anchor)
    return anchor
  }
  catch {
    return undefined
  }
}

function getSelectionBlock(range?: Range) {
  if (range) {
    const insertedAnchor = createCollapsedSelectionAnchor(range)
    if (insertedAnchor)
      return insertedAnchor
  }

  const endElement = range ? getElementFromRangeEnd(range) : undefined
  const anchor = endElement?.closest<HTMLElement>(selectionAnchorSelectors)
  if (anchor)
    return anchor

  const node = range?.commonAncestorContainer
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest(blockSelectors) ?? element ?? document.body
}

function insertAfterSelectionAnchor(anchor: Element, block: HTMLElement) {
  if (anchor instanceof HTMLElement && anchor.dataset.lexiSelectionAnchor === 'true') {
    const parentBlock = anchor.parentElement?.closest<HTMLElement>(blockSelectors)
    if (parentBlock && parentBlock !== document.body && parentBlock.contains(anchor))
      parentBlock.insertAdjacentElement('afterend', block)
    else
      anchor.insertAdjacentElement('afterend', block)

    anchor.remove()
    return
  }

  anchor.insertAdjacentElement('afterend', block)
}

type PageTranslationPriority = NonNullable<PageTranslationBlock['priority']>

interface PageTranslationTarget {
  element: HTMLElement
  text: string
  id: string
  memoryKey: string
  priority: PageTranslationPriority
  distance: number
  score: number
}

interface PageTranslationStartOptions {
  persist?: boolean
  scope?: PageTranslationScope
  regex?: string
  direction?: PageTranslationDirection
}

const enqueuePageTranslationActivationWrite = createSerializedTaskQueue()
const enqueuePageTranslationCacheWrite = createSerializedTaskQueue()
const enqueuePageTranslationMemoryWrite = createSerializedTaskQueue()
let pageTranslationCacheWritesSettled: Promise<unknown> = Promise.resolve()
let pageTranslationMemoryWritesSettled: Promise<unknown> = Promise.resolve()

function normalizePageTranslationUrl(url = location.href) {
  return normalizeTranslationRuleUrl(url)
}

function getPageTranslationCacheKey(url = location.href) {
  return `${pageTranslationsStorageKey}:${normalizePageTranslationUrl(url)}`
}

function getPageTranslationScopeIdentity(scope: PageTranslationScope, regex = '') {
  if (scope === 'site')
    return location.hostname

  if (scope === 'regex')
    return regex.trim()

  return normalizePageTranslationUrl()
}

function createPageTranslationMemoryKey(settings: LexiSettings, text: string) {
  const pageSettings = settings.selection.pageTranslation
  const scope = pageSettings.scope
  const identity = getPageTranslationScopeIdentity(scope, pageSettings.regex)
  return [scope, identity, pageSettings.direction, createPageTranslationBlockId(text)].join(':')
}

function createPageTranslationBlockId(text: string) {
  return createSelectionDomKey(text)
}

function createPageTranslationActivation(settings: LexiSettings): PageTranslationActivation | undefined {
  const pageSettings = settings.selection.pageTranslation
  const scope = pageSettings.scope
  const regex = pageSettings.regex.trim()
  if (scope === 'regex') {
    if (!regex)
      return undefined

    try {
      RegExp(regex)
    }
    catch {
      return undefined
    }
  }

  return {
    enabled: true,
    scope,
    url: normalizePageTranslationUrl(),
    host: location.hostname,
    regex,
    updatedAt: Date.now(),
  }
}

function applyPageTranslationStartOverrides(settings: LexiSettings, options: PageTranslationStartOptions): LexiSettings {
  if (options.scope === undefined && options.regex === undefined && options.direction === undefined)
    return settings

  return {
    ...settings,
    selection: {
      ...settings.selection,
      pageTranslation: {
        ...settings.selection.pageTranslation,
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
        ...(options.regex !== undefined ? { regex: options.regex } : {}),
        ...(options.direction !== undefined ? { direction: options.direction } : {}),
      },
    },
  }
}

function findMatchingPageTranslationActivation() {
  return findActivationMatchingUrl(location.href)
}

async function savePageTranslationActivation(activation: PageTranslationActivation) {
  await enqueuePageTranslationActivationWrite(() => upsertPageTranslationActivation(activation))
}

async function removePageTranslationActivation(activation: PageTranslationActivation) {
  await enqueuePageTranslationActivationWrite(() => deletePageTranslationActivation(getPageTranslationActivationKey(activation)))
}

async function readPageTranslationMemory() {
  const stored = await browser.storage.local.get(pageTranslationMemoryStorageKey)
  return readJsonValue<PageTranslationMemory>(stored[pageTranslationMemoryStorageKey], {})
}

async function savePageTranslationMemory(memory: PageTranslationMemory, operation: OperationEpochHandle) {
  const write = enqueuePageTranslationMemoryWrite(async () => {
    if (!operation.isCurrent())
      return
    await browser.storage.local.set({ [pageTranslationMemoryStorageKey]: JSON.stringify(memory) })
  })
  pageTranslationMemoryWritesSettled = write.then(() => undefined, () => undefined)
  await write
}

function prunePageTranslationMemory(memory: PageTranslationMemory, settings: LexiSettings) {
  const pageSettings = settings.selection.pageTranslation
  const ttl = Math.max(1, pageSettings.cacheDays) * 24 * 60 * 60 * 1000
  const now = Date.now()
  const hostCounts = new Map<string, number>()
  const next: PageTranslationMemory = {}

  const entries = Object.entries(memory)
    .filter(([, entry]) => now - (entry.updatedAt ?? 0) <= ttl)
    .sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0))

  for (const [key, entry] of entries) {
    const count = hostCounts.get(entry.host) ?? 0
    if (count >= Math.max(20, pageSettings.maxBlocksPerSite))
      continue

    hostCounts.set(entry.host, count + 1)
    next[key] = entry
    if (Object.keys(next).length >= 1200)
      break
  }

  return next
}

interface PageTranslationElementOptions {
  loading?: boolean
  priority?: PageTranslationPriority
  /** Omit only for the loading placeholder; every real translation needs it to mark up vocabulary. */
  settings?: LexiSettings
}

function createPageTranslationElement(
  block: PageTranslationBlock,
  options: PageTranslationElementOptions = {},
) {
  const element = document.createElement('div')
  element.dataset.lexiPageTranslation = 'true'
  element.dataset.lexiPageTranslationId = block.id
  element.dataset.lexiPriority = options.priority ?? block.priority ?? 'prefetch'
  if (options.loading)
    element.dataset.lexiLoading = 'true'
  element.className = 'lexi-page-translation'
  renderPageLearningText(element, block.translation, options.settings)
  return element
}

function updatePageTranslationElement(element: HTMLElement, block: PageTranslationBlock, settings?: LexiSettings) {
  const from = element.getBoundingClientRect()
  element.dataset.lexiPriority = block.priority ?? element.dataset.lexiPriority ?? 'prefetch'
  delete element.dataset.lexiLoading
  element.removeAttribute('aria-busy')
  renderPageLearningText(element, block.translation, settings)

  if (prefersReducedMotion())
    return

  const to = element.getBoundingClientRect()
  element.animate([
    { opacity: 0.48, filter: 'blur(2px)', transform: `translateY(${Math.min(8, Math.max(2, from.height - to.height))}px)` },
    { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
  ], {
    duration: block.priority === 'viewport' ? 210 : 280,
    easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  })
}

/**
 * The one place a translation's text reaches the DOM.
 *
 * Four paths produce a translation — a fresh request, session reuse, the page cache and
 * cross-page memory — and only the first used to run this pass. A reload therefore kept
 * the translation but stripped every vocabulary token out of it, so the learning layer
 * only ever worked on a page's first visit.
 *
 * `settings` is absent for the loading placeholder, which is a status string rather than
 * translated prose and has nothing to mark up.
 */
function renderPageLearningText(element: HTMLElement, text: string, settings?: LexiSettings) {
  if (!settings) {
    element.textContent = text
    return
  }

  const { min, max } = getDifficultyWindow(settings.replacement.level)
  const candidates = programmerVocabulary
    .filter(candidate => candidate.original.length >= 2 && !isProductVocabularyCandidate(candidate) && candidate.difficulty >= min && candidate.difficulty <= max && text.includes(candidate.original))
    .slice(0, Math.max(1, Math.round(settings.replacement.density * 12)))
  if (!candidates.length) {
    element.textContent = text
    return
  }

  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const candidate of candidates.sort((a, b) => text.indexOf(a.original) - text.indexOf(b.original))) {
    const index = text.indexOf(candidate.original, cursor)
    if (index < cursor)
      continue
    fragment.append(document.createTextNode(text.slice(cursor, index)), createToken(candidate, settings.replacement.displayMode))
    cursor = index + candidate.original.length
  }
  fragment.append(document.createTextNode(text.slice(cursor)))
  element.replaceChildren(fragment)
}

function getPageTranslationElementAfter(element: HTMLElement, blockId: string) {
  return element.nextElementSibling instanceof HTMLElement
    && element.nextElementSibling.dataset.lexiPageTranslationId === blockId
    ? element.nextElementSibling
    : undefined
}

function insertPageTranslationElement(
  target: HTMLElement,
  block: PageTranslationBlock,
  options: PageTranslationElementOptions = {},
) {
  const existing = getPageTranslationElementAfter(target, block.id)
  if (existing)
    return existing

  const element = createPageTranslationElement(block, options)
  if (options.loading)
    element.setAttribute('aria-busy', 'true')
  target.insertAdjacentElement('afterend', element)
  return element
}

function removePageTranslationElements() {
  document
    .querySelectorAll<HTMLElement>('[data-lexi-page-translation]')
    .forEach(element => element.remove())
}

function getPageTranslationPriority(element: HTMLElement): Pick<PageTranslationTarget, 'priority' | 'distance' | 'score'> {
  const rect = element.getBoundingClientRect()
  const viewportHeight = Math.max(1, window.innerHeight)
  const inViewport = rect.bottom >= 0 && rect.top <= viewportHeight
  const distance = inViewport
    ? 0
    : rect.top > viewportHeight
      ? rect.top - viewportHeight
      : Math.abs(rect.bottom)
  const priority: PageTranslationPriority = inViewport
    ? 'viewport'
    : distance <= viewportHeight * 1.35
      ? 'near'
      : 'prefetch'
  const priorityRank = priority === 'viewport' ? 0 : priority === 'near' ? 1 : 2
  const topTieBreaker = inViewport ? Math.max(0, rect.top) / 10000 : 0

  return {
    priority,
    distance,
    score: priorityRank * 100000 + distance + topTieBreaker,
  }
}

function getPageTranslationTargets(settings: LexiSettings, limit = 12, autoSite?: PageTranslationAutoSite) {
  const selectors = autoSite
    ? getPageTranslationAutoSiteSelectors(autoSite)
    : location.hostname.includes('x.com') || location.hostname.includes('twitter.com')
      ? '[data-testid="tweetText"], article div[lang]'
      : 'article p, article div[lang], main p, main li, p, li'
  // Scanning is bounded, but the bound cannot be applied here in DOM order: the priority
  // sort at the bottom is what puts the viewport first, and cutting at 420 beforehand
  // meant a long document simply had no viewport candidates left to sort once the reader
  // scrolled past that point. Every rect read below happens without an interleaved write,
  // so the whole pass costs one layout regardless of how many elements it walks.
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors)).slice(0, maxPageTranslationScanElements)
  const seen = new Set<string>()
  const targets: PageTranslationTarget[] = []

  for (const element of elements) {
    if (isLexiIgnoredElement(element) || isPageTranslationAttachment(element))
      continue

    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text.length < 24 || text.length > 900 || seen.has(text))
      continue

    const id = createPageTranslationBlockId(text)
    if (getPageTranslationElementAfter(element, id))
      continue

    seen.add(text)
    const priority = getPageTranslationPriority(element)
    targets.push({
      element,
      text,
      id,
      memoryKey: createPageTranslationMemoryKey(settings, text),
      ...priority,
    })
  }

  return targets
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.max(1, limit))
}

async function readPageTranslationCache() {
  const stored = await browser.storage.local.get(getPageTranslationCacheKey())
  return readJsonValue<PageTranslationCache | undefined>(stored[getPageTranslationCacheKey()], undefined)
}

async function savePageTranslationCache(cache: PageTranslationCache) {
  const key = getPageTranslationCacheKey()
  const write = enqueuePageTranslationCacheWrite(async () => {
    const result = await sendRuntimeMessage<{ ok?: boolean, error?: string }>('lexi-write-page-translation-cache', { key, cache })
    if (!result?.ok)
      throw new Error(result?.error || '页面翻译缓存写入失败')
  })
  pageTranslationCacheWritesSettled = write.then(() => undefined, () => undefined)
  await write
}

async function restorePageTranslationCache(
  settings: LexiSettings,
  force = false,
  isActive: () => boolean = () => true,
  autoSite?: PageTranslationAutoSite,
) {
  const cache = await readPageTranslationCache()
  if (!isActive() || (!force && !cache?.enabled) || !cache?.blocks.length)
    return cache

  ensurePageStyles(settings.ui.customCss)
  removePageTranslationElements()
  const targets = getPageTranslationTargets(settings, cache.blocks.length + 8, autoSite)
  for (const block of cache.blocks) {
    if (!isActive())
      return cache

    const target = targets.find(item => item.id === block.id || item.text === block.source)
    if (!target)
      continue

    insertPageTranslationElement(target.element, block, { priority: block.priority ?? target.priority, settings })
  }

  return cache
}

function createSelectionDomKey(selected: string) {
  let hash = 0
  const normalized = selected.replace(/\s+/g, ' ').trim()
  for (let index = 0; index < normalized.length; index += 1)
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0

  return hash.toString(36)
}

function removeSelectionBlocksByKey(key: string) {
  const blocks = document.querySelectorAll<HTMLElement>(`[data-lexi-selection-key="${key}"]`)
  blocks.forEach(block => block.remove())
}

function pruneDuplicateSelectionBlocks(key: string, keep: HTMLElement) {
  document
    .querySelectorAll<HTMLElement>(`[data-lexi-selection-key="${key}"]`)
    .forEach((block) => {
      if (block !== keep)
        block.remove()
    })
}

function claimSelectionDomLock(key: string) {
  const lockKey = `lexiSelectionLock${key}`
  const now = Date.now()
  const current = Number(document.documentElement.dataset[lockKey] ?? 0)
  if (current && now - current < 8000)
    return false

  document.documentElement.dataset[lockKey] = String(now)
  return true
}

function releaseSelectionDomLock(key: string) {
  delete document.documentElement.dataset[`lexiSelectionLock${key}`]
}

function createSelectionCardButton(label: string, icon: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'lexi-selection-translation__icon-button'
  button.textContent = icon
  button.setAttribute('aria-label', label)
  button.title = label
  return button
}

function createCollapsedSelectionSummary(translation: string) {
  const normalized = translation.replace(/\s+/g, ' ').trim()
  return normalized ? `${Array.from(normalized).slice(0, 5).join('')}...` : '翻译...'
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function animateSelectionCardFlip(block: HTMLElement, mutate: () => void) {
  const first = block.getBoundingClientRect()
  mutate()

  if (prefersReducedMotion())
    return

  const last = block.getBoundingClientRect()
  if (!first.width || !first.height || !last.width || !last.height)
    return

  const deltaX = first.left - last.left
  const deltaY = first.top - last.top
  const scaleX = first.width / last.width
  const scaleY = first.height / last.height
  const settlingScaleX = 1 + (scaleX < 1 ? 0.015 : -0.012)
  const settlingScaleY = 1 + (scaleY < 1 ? 0.035 : -0.018)

  block.getAnimations().forEach(animation => animation.cancel())
  block.animate(
    [
      {
        opacity: 0.88,
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
      },
      {
        opacity: 1,
        offset: 0.78,
        transform: `translate(0, 0) scale(${settlingScaleX}, ${settlingScaleY})`,
      },
      {
        opacity: 1,
        transform: 'translate(0, 0) scale(1, 1)',
      },
    ],
    {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0.9, 0.18, 1)',
    },
  )
}

function animateSelectionBlockHeight(block: HTMLElement, mutate: () => void) {
  const fromHeight = block.getBoundingClientRect().height
  mutate()

  const toHeight = block.getBoundingClientRect().height
  if (Math.abs(toHeight - fromHeight) < 1)
    return

  block.style.height = `${fromHeight}px`
  block.style.transition = 'height 180ms cubic-bezier(0.2, 0.7, 0.2, 1)'
  void block.offsetHeight
  block.style.height = `${toHeight}px`
  window.setTimeout(() => {
    block.style.height = ''
    block.style.transition = ''
  }, 210)
}

function renderAnimatedText(container: HTMLElement, text: string | undefined, previousText: string | undefined, revealChunk: boolean) {
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

function createSelectionTranslationBlock(settings: LexiSettings, selected: string, requestKey: string, range?: Range) {
  ensurePageStyles(settings.ui.customCss)

  const anchor = getSelectionBlock(range)
  const block = document.createElement('div')
  const header = document.createElement('div')
  const label = document.createElement('span')
  const actions = document.createElement('span')
  const hide = createSelectionCardButton('隐藏翻译卡片', '−')
  const close = createSelectionCardButton('关闭翻译卡片', '×')
  const body = document.createElement('div')
  const text = document.createElement('span')
  const detail = document.createElement('span')
  const status = document.createElement('div')
  const metrics = document.createElement('span')
  const locate = document.createElement('button')
  const selectionRange = range?.cloneRange()
  const startedAt = performance.now()
  const collapsed = document.createElement('button')
  const collapsedIcon = document.createElement('span')
  const collapsedText = document.createElement('span')

  block.dataset.lexiSelectionTranslation = 'true'
  block.dataset.lexiSelectionKey = requestKey
  block.dataset.lexiLoading = 'true'
  block.className = 'lexi-selection-translation'
  header.className = 'lexi-selection-translation__header'
  label.className = 'lexi-selection-translation__label'
  actions.className = 'lexi-selection-translation__actions'
  body.className = 'lexi-selection-translation__body'
  text.className = 'lexi-selection-translation__text'
  detail.className = 'lexi-selection-translation__detail'
  status.className = 'lexi-selection-translation__status'
  locate.className = 'lexi-selection-translation__locate'
  locate.type = 'button'
  locate.textContent = '定位原文'
  metrics.textContent = '翻译中…'
  collapsed.className = 'lexi-selection-translation__collapsed'
  collapsed.type = 'button'
  collapsed.setAttribute('aria-label', '展开翻译卡片')
  collapsed.title = '展开翻译卡片'
  collapsedIcon.className = 'lexi-selection-translation__collapsed-icon'
  collapsedText.className = 'lexi-selection-translation__collapsed-text'
  label.textContent = 'Lexi 翻译'
  text.textContent = `翻译中：${selected}`
  text.dataset.lexiLoading = 'true'
  collapsedIcon.textContent = '+'
  collapsedText.textContent = '翻译中...'

  hide.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    animateSelectionCardFlip(block, () => {
      block.dataset.lexiCollapsed = 'true'
    })
  })
  close.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    block.remove()
  })
  locate.addEventListener('click', () => {
    const commonAncestor = selectionRange?.commonAncestorContainer
    const target = commonAncestor instanceof Element ? commonAncestor : commonAncestor?.parentElement ?? anchor
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
    if (!selectionRange)
      return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(selectionRange)
  })
  collapsed.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    animateSelectionCardFlip(block, () => {
      delete block.dataset.lexiCollapsed
    })
  })

  actions.append(hide, close)
  header.append(label, actions)
  status.append(metrics, locate)
  body.append(text, detail, status)
  collapsed.append(collapsedIcon, collapsedText)
  block.append(header, body, collapsed)
  insertAfterSelectionAnchor(anchor, block)
  pruneDuplicateSelectionBlocks(requestKey, block)

  return {
    update(translation: SelectionTranslation, detailText?: string) {
      const wasLoading = text.dataset.lexiLoading === 'true'
      const previousText = text.textContent ?? ''
      const nextText = translation.translation
      animateSelectionBlockHeight(block, () => {
        renderAnimatedText(text, nextText, previousText, !wasLoading)
        delete block.dataset.lexiLoading
        delete text.dataset.lexiLoading
      })
      if (wasLoading || previousText.length === 0 || nextText.length < previousText.length) {
        text.dataset.lexiRevealing = 'true'
        window.setTimeout(() => {
          delete text.dataset.lexiRevealing
        }, 260)
      }
      if (detailText)
        detail.textContent = detailText
      collapsedText.textContent = createCollapsedSelectionSummary(nextText)
      const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt))
      const estimatedTokens = Math.ceil((selected.length + nextText.length) / 4)
      const charactersPerSecond = Math.max(1, Math.round(nextText.length / (elapsedMs / 1000)))
      metrics.textContent = `${translation.explanation} · 约 ${estimatedTokens} tokens · ${elapsedMs}ms · ${charactersPerSecond} 字/秒`
    },
    remove() {
      block.remove()
    },
  }
}

interface DialogContext {
  page: PageDocument
  selection?: DialogSelectionContext
}

/**
 * Re-read the page and the selection for every question. The old panel froze both at
 * open time, so the model kept answering about whatever happened to be selected then.
 */
function createDialogContext(lastTranslation?: LastTranslationState): DialogContext {
  const page = getPageDocument()
  const selection = window.getSelection()
  const selected = selection?.toString().trim() || lastTranslation?.selected || ''
  if (!selected)
    return { page }

  return {
    page,
    selection: {
      text: selected,
      translation: lastTranslation?.translation || '',
      detail: lastTranslation?.detail || '',
      anchorSegmentId: findAnchorSegmentId(page, selected),
    },
  }
}

function renderDialogContext(context: DialogContext) {
  const page = context.page
  return [
    page.segments.length
      ? `已索引本页 ${page.segments.length} 段 · 按问题检索作答`
      : '未抽取到正文，仅依赖选区回答',
    context.selection?.text ? `选区：${context.selection.text.slice(0, 60)}` : '',
  ].filter(Boolean).join(' · ')
}

function isDialogNearBottom(container: HTMLElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 90
}

function scrollDialogMessages(container: HTMLElement, force = false) {
  if (force || isDialogNearBottom(container))
    container.scrollTop = container.scrollHeight
}

/**
 * ChatGPT-style turns: user text sits in a quiet gray bubble on the right, assistant
 * text renders plain on the surface, system notes are small and centered.
 * Returns the content element, which `updateDialogMessage` re-renders while streaming.
 */
function appendDialogMessage(container: HTMLElement, role: DialogMessageRole, text: string, pending = false) {
  const message = document.createElement('article')
  message.className = `lexi-dialog__msg lexi-dialog__msg--${role}`

  const content = document.createElement('div')
  content.className = role === 'user'
    ? 'lexi-dialog__bubble'
    : role === 'system'
      ? 'lexi-dialog__note'
      : 'lexi-dialog__md'
  content.dataset.lexiRole = role
  message.append(content)
  container.append(message)
  updateDialogMessage(content, text, pending)
  scrollDialogMessages(container, true)
  return content
}

function updateDialogMessage(bubble: HTMLElement, text: string, pending = false) {
  bubble.innerHTML = renderMarkdown(text)
  if (pending) {
    // The pulsing dot rides at the end of the draft, inside the last block.
    const cursor = document.createElement('span')
    cursor.className = 'lexi-dialog__cursor'
    ;(bubble.lastElementChild ?? bubble).append(cursor)
  }

  const container = bubble.closest<HTMLElement>('.lexi-dialog__messages')
  if (container)
    scrollDialogMessages(container)
}

/**
 * "引用" chips under an assistant reply. Clicking one collapses the panel to its pill
 * and scrolls the page to the paragraph the excerpt came from, flashing it.
 */
function appendDialogSources(
  bubble: HTMLElement,
  page: PageDocument,
  segmentIds: string[],
  onNavigate: () => void,
) {
  const segments = segmentIds
    .map(id => page.segments.find(segment => segment.id === id))
    .filter((segment): segment is PageSegment => Boolean(segment))
  if (!segments.length)
    return

  const row = document.createElement('div')
  row.className = 'lexi-dialog__sources'
  for (const segment of segments) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'lexi-dialog__source-chip'
    chip.title = segment.text.slice(0, 160)
    const label = document.createElement('span')
    label.textContent = segment.heading || segment.text.slice(0, 24)
    chip.append('↗', label)
    chip.addEventListener('click', () => {
      if (revealPageSegment(segment))
        onNavigate()
    })
    row.append(chip)
  }

  bubble.append(row)
}

function getDialogAnchorFromRange(range?: Range): DialogAnchor | undefined {
  if (!range)
    return undefined

  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 || rect.height > 0)
  const rect = rects.at(-1) ?? range.getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height))
    return undefined

  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function getCurrentDialogAnchor() {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
  return getDialogAnchorFromRange(range)
}

/** Set once the user drags or resizes: from then on the geometry is theirs, not ours. */
const dialogPlacedAttribute = 'data-lexi-dialog-placed'
const dialogMinWidth = 300
const dialogMinHeight = 220
const dialogEdgeMargin = 8

/**
 * Where the panel sits in layout, which is not where it is drawn.
 *
 * The enter and collapse morphs animate width, height and opacity, so a measured rect is
 * transiently wrong; feeding that back into `left`/`top` makes the panel creep on every
 * scroll event. Inline styles and offset sizes are the state the animation is playing over.
 */
function readDialogFrame(dialog: HTMLElement) {
  const rect = dialog.getBoundingClientRect()
  return {
    left: Number.parseFloat(dialog.style.left) || rect.left,
    top: Number.parseFloat(dialog.style.top) || rect.top,
    width: dialog.offsetWidth || rect.width,
    height: dialog.offsetHeight || rect.height,
  }
}

/** Keeps a manually placed panel reachable after the window changes size. */
function clampLexiDialog(dialog: HTMLElement) {
  const frame = readDialogFrame(dialog)
  const maxLeft = Math.max(dialogEdgeMargin, window.innerWidth - frame.width - dialogEdgeMargin)
  const maxTop = Math.max(dialogEdgeMargin, window.innerHeight - frame.height - dialogEdgeMargin)
  dialog.style.left = `${Math.min(Math.max(dialogEdgeMargin, frame.left), maxLeft)}px`
  dialog.style.top = `${Math.min(Math.max(dialogEdgeMargin, frame.top), maxTop)}px`
}

function positionLexiDialog(dialog: HTMLElement, anchor?: DialogAnchor) {
  // Scroll and resize both call this; re-anchoring a panel the user has moved would yank
  // it out from under them, so only keep it on screen.
  if (dialog.getAttribute(dialogPlacedAttribute) === 'true') {
    clampLexiDialog(dialog)
    return
  }

  const margin = 16
  const collapsed = dialog.getAttribute('data-lexi-collapsed') === 'true'
  // Collapsed the panel is a pill and must size to its content, not the full width.
  dialog.style.width = collapsed ? '' : `${Math.min(720, Math.max(280, window.innerWidth - margin * 2))}px`

  const measured = dialog.getBoundingClientRect()
  const height = Math.min(measured.height || 420, window.innerHeight - margin * 2)
  const width = measured.width || 320

  if (!anchor) {
    dialog.style.left = `${Math.max(margin, (window.innerWidth - width) / 2)}px`
    dialog.style.top = `${Math.max(margin, window.innerHeight * 0.12)}px`
    return
  }

  positionAgainstAnchor(dialog, anchor, {
    margin,
    gap: 10,
    align: 'center',
    fallbackWidth: width,
    fallbackHeight: height,
  })
}

function closeLexiDialog(dialog: HTMLElement) {
  dialog.dispatchEvent(new CustomEvent('lexi-dialog-close'))
  dialog.remove()
}

interface DialogGeometryHandle {
  /** Corner grip; the caller appends it so it stays a sibling of the panel parts. */
  resizer: HTMLElement
  /** Inline size is dropped while collapsed so the pill can shrink to its own width. */
  setCollapsed: (collapsed: boolean) => void
  destroy: () => void
}

/**
 * Makes the dialog draggable by its header and resizable from the bottom-right corner.
 *
 * Both gestures pin the panel: a floating surface that snaps back to the selection on the
 * next scroll event is worse than one that never moved. Pointer capture keeps the drag
 * alive over iframes and fast pointer movement, which plain mousemove on the panel loses.
 */
function attachDialogGeometry(dialog: HTMLElement, head: HTMLElement): DialogGeometryHandle {
  const listeners = createListenerGroup()
  const resizer = document.createElement('div')
  resizer.className = 'lexi-dialog__resizer'
  resizer.setAttribute('aria-hidden', 'true')

  let size: { width: number, height: number } | undefined

  const applySize = () => {
    if (!size)
      return

    dialog.style.width = `${size.width}px`
    dialog.style.height = `${size.height}px`
    dialog.style.maxHeight = 'none'
  }

  const clearSize = () => {
    dialog.style.width = ''
    dialog.style.height = ''
    dialog.style.maxHeight = ''
  }

  /** Runs a pointer gesture to completion, whatever it ends on. */
  const track = (
    target: HTMLElement,
    event: PointerEvent,
    state: string,
    onMove: (moveEvent: PointerEvent) => void,
  ) => {
    event.preventDefault()
    dialog.setAttribute(dialogPlacedAttribute, 'true')
    dialog.setAttribute(state, 'true')
    target.setPointerCapture(event.pointerId)

    const disposers: Array<() => void> = []
    const finish = () => {
      for (const dispose of disposers.splice(0))
        dispose()

      dialog.removeAttribute(state)
      if (target.hasPointerCapture(event.pointerId))
        target.releasePointerCapture(event.pointerId)
    }

    disposers.push(
      listeners.add<PointerEvent>(target, 'pointermove', onMove),
      listeners.add(target, 'pointerup', finish),
      listeners.add(target, 'pointercancel', finish),
    )
  }

  listeners.add<PointerEvent>(head, 'pointerdown', (event) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button')))
      return

    const frame = readDialogFrame(dialog)
    const grabX = event.clientX - frame.left
    const grabY = event.clientY - frame.top

    track(head, event, 'data-lexi-dialog-dragging', (moveEvent) => {
      const maxLeft = Math.max(dialogEdgeMargin, window.innerWidth - dialog.offsetWidth - dialogEdgeMargin)
      // The header must stay grabbable, so the bottom bound is the viewport, not the panel.
      const maxTop = Math.max(dialogEdgeMargin, window.innerHeight - 44)
      dialog.style.left = `${Math.min(Math.max(dialogEdgeMargin, moveEvent.clientX - grabX), maxLeft)}px`
      dialog.style.top = `${Math.min(Math.max(dialogEdgeMargin, moveEvent.clientY - grabY), maxTop)}px`
    })
  })

  listeners.add<PointerEvent>(resizer, 'pointerdown', (event) => {
    if (event.button !== 0)
      return

    const frame = readDialogFrame(dialog)

    track(resizer, event, 'data-lexi-dialog-resizing', (moveEvent) => {
      size = {
        width: Math.max(dialogMinWidth, Math.min(moveEvent.clientX - frame.left, window.innerWidth - frame.left - dialogEdgeMargin)),
        height: Math.max(dialogMinHeight, Math.min(moveEvent.clientY - frame.top, window.innerHeight - frame.top - dialogEdgeMargin)),
      }
      applySize()
    })
  })

  return {
    resizer,
    setCollapsed(collapsed: boolean) {
      // The collapsed pill sizes itself from a class rule, which an inline width would win.
      if (collapsed)
        clearSize()
      else
        applySize()
    },
    destroy: () => listeners.removeAll(),
  }
}

const dialogSendIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4.5l6.5 6.5-1.42 1.42L13 8.34V19.5h-2V8.34l-4.08 4.08L5.5 11z" fill="currentColor"/></svg>'
const dialogStopIcon = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>'

function isAbortLikeError(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

function createLexiDialog(settings: LexiSettings, lastTranslation?: LastTranslationState) {
  ensurePageStyles(settings.ui.customCss)

  const existing = document.querySelector<HTMLElement>('[data-lexi-dialog]')
  if (existing) {
    closeLexiDialog(existing)
    return undefined
  }

  let context = createDialogContext(lastTranslation)
  const history: DialogHistoryMessage[] = []
  let dialogAbortController: AbortController | undefined
  const anchor = getCurrentDialogAnchor()

  const dialog = document.createElement('section')
  const head = document.createElement('header')
  const title = document.createElement('div')
  const subtitle = document.createElement('div')
  const close = document.createElement('button')
  const body = document.createElement('div')
  const messages = document.createElement('div')
  const composer = document.createElement('div')
  const contextLine = document.createElement('div')
  const form = document.createElement('form')
  const input = document.createElement('textarea')
  const send = document.createElement('button')
  const hint = document.createElement('div')

  dialog.dataset.lexiDialog = 'true'
  dialog.className = 'lexi-dialog'
  head.className = 'lexi-dialog__head'
  title.className = 'lexi-dialog__title'
  subtitle.className = 'lexi-dialog__subtitle'
  close.className = 'lexi-dialog__close'
  body.className = 'lexi-dialog__body'
  messages.className = 'lexi-dialog__messages'
  composer.className = 'lexi-dialog__composer'
  contextLine.className = 'lexi-dialog__context'
  form.className = 'lexi-dialog__form'
  input.className = 'lexi-dialog__input'
  send.className = 'lexi-dialog__send'
  hint.className = 'lexi-dialog__hint'

  title.textContent = 'Lexi'
  subtitle.textContent = context.page.title || location.hostname
  close.type = 'button'
  close.textContent = '×'
  close.setAttribute('aria-label', '关闭对话')
  contextLine.textContent = renderDialogContext(context)
  appendDialogMessage(messages, 'system', context.selection?.text
    ? '会结合选区、译文和检索到的页面片段回答，可连续追问。'
    : '已为本页正文建立索引，提问时只检索相关片段作答。')
  input.placeholder = context.selection?.text ? '解释这段内容，或继续追问' : '基于当前页面提问'
  input.rows = 1
  send.type = 'button'
  send.setAttribute('aria-label', '发送')
  hint.textContent = 'Enter 发送 · Shift+Enter 换行'

  const inFlight = () => dialogAbortController != null

  const setSendState = () => {
    if (inFlight()) {
      send.innerHTML = dialogStopIcon
      send.setAttribute('aria-label', '停止生成')
      send.removeAttribute('data-lexi-idle')
      return
    }

    send.innerHTML = dialogSendIcon
    send.setAttribute('aria-label', '发送')
    send.toggleAttribute('data-lexi-idle', false)
    if (!input.value.trim())
      send.setAttribute('data-lexi-idle', 'true')
  }

  const autosize = () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
  }

  /**
   * Openers for the first turn.
   *
   * An empty composer over someone else's page is a blank-page problem: the panel knows
   * whether there is a selection and whether the body was indexed, so it can offer the
   * three questions worth asking instead of making the user invent one.
   */
  const suggestions = document.createElement('div')
  suggestions.className = 'lexi-dialog__suggestions'
  const suggestionLabels = context.selection?.text
    ? ['解释这段', '翻译并说明', '它和上下文的关系']
    : context.page.segments.length
      ? ['总结这个页面', '列出关键要点', '有哪些术语要了解']
      : ['这个页面讲了什么']

  for (const label of suggestionLabels) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'lexi-dialog__suggestion'
    chip.textContent = label
    chip.addEventListener('click', () => {
      if (inFlight())
        return

      input.value = label
      autosize()
      setSendState()
      form.requestSubmit()
    })
    suggestions.append(chip)
  }

  input.addEventListener('input', () => {
    autosize()
    setSendState()
  })

  // Enter sends, Shift+Enter breaks the line — with an IME guard so confirming a
  // Chinese composition with Enter never fires the request.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey)
      return
    if (event.isComposing || event.keyCode === 229)
      return

    event.preventDefault()
    if (!inFlight())
      form.requestSubmit()
  })

  send.addEventListener('click', () => {
    if (inFlight()) {
      dialogAbortController?.abort()
      return
    }

    form.requestSubmit()
  })

  close.addEventListener('click', () => closeLexiDialog(dialog))

  const panelListeners = createListenerGroup()
  const reposition = () => positionLexiDialog(dialog, anchor)
  const geometry = attachDialogGeometry(dialog, head)
  const collapsible = createCollapsible(dialog, {
    block: 'lexi-dialog',
    label: 'Lexi 对话',
    summary: context.page.title || '当前页面',
    onToggle: (collapsed) => {
      geometry.setCollapsed(collapsed)
      reposition()
    },
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const question = input.value.trim()
    if (!question || inFlight())
      return

    // The openers are for the blank transcript only; the composer takes over after that.
    suggestions.remove()
    appendDialogMessage(messages, 'user', question)
    input.value = ''
    autosize()
    const assistantBubble = appendDialogMessage(messages, 'assistant', '', true)
    dialogAbortController = new AbortController()
    setSendState()

    // Recapture per turn: the page may have navigated, scrolled or changed selection.
    context = createDialogContext(lastTranslation)
    contextLine.textContent = renderDialogContext(context)
    subtitle.textContent = context.page.title || location.hostname
    const page = context.page
    const turn: DialogHistoryMessage = { role: 'user', content: question }

    const finalizeAnswer = (answerText: string, segmentIds?: string[]) => {
      updateDialogMessage(assistantBubble, answerText || '（无返回内容）')
      if (!answerText)
        return

      turn.segmentIds = segmentIds
      history.push(turn, { role: 'assistant', content: answerText })
      if (segmentIds?.length)
        appendDialogSources(assistantBubble, page, segmentIds, () => collapsible.setCollapsed(true))
    }

    requestLexiDialogAnswer(
      settings,
      { question, history: [...history], page, selection: context.selection },
      {
        onText: text => updateDialogMessage(assistantBubble, text, true),
        onSearch: query => updateDialogMessage(assistantBubble, `正在检索页面：${query}…`, true),
      },
      dialogAbortController.signal,
    )
      .then((answer) => {
        finalizeAnswer(answer?.text || assistantBubble.textContent || '', answer?.attachedSegmentIds)
      })
      .catch((error) => {
        if (isAbortLikeError(error)) {
          // Stopped by the user: keep the partial draft as a real turn so follow-ups
          // still have its context, instead of discarding what already streamed in.
          finalizeAnswer(assistantBubble.textContent?.trim() ?? '')
          return
        }

        // Failed turns are dropped rather than pushed as assistant messages — otherwise
        // an error string poisons every subsequent prompt.
        updateDialogMessage(assistantBubble, error instanceof Error ? error.message : '请求失败')
      })
      .finally(() => {
        dialogAbortController = undefined
        setSendState()
        input.focus()
      })
  })

  head.append(title, subtitle, collapsible.toggle, close)
  form.append(input, send)
  composer.append(suggestions, contextLine, form, hint)
  body.append(messages, composer)
  dialog.append(collapsible.pill, head, body, geometry.resizer)
  document.documentElement.appendChild(dialog)
  setSendState()
  positionLexiDialog(dialog, anchor)
  panelListeners.add(window, 'resize', reposition)
  panelListeners.add(window, 'scroll', reposition, true)
  dialog.addEventListener('lexi-dialog-close', () => {
    dialogAbortController?.abort()
    collapsible.destroy()
    geometry.destroy()
    panelListeners.removeAll()
  }, { once: true })
  input.focus()

  return dialog
}

function parseShortcutParts(shortcut: string) {
  return shortcut.toLowerCase().split('+').map(part => part.trim()).filter(Boolean)
}

function shortcutModifiersMatch(event: MouseEvent | PointerEvent | KeyboardEvent, shortcut: string, options: { allowKey?: boolean } = {}) {
  const parts = parseShortcutParts(shortcut)
  const key = parts.findLast(part => !['mod', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt', 'option', 'shift'].includes(part))
  if (key && options.allowKey && event instanceof KeyboardEvent && event.key.toLowerCase() !== key)
    return false

  if (key && (!options.allowKey || !(event instanceof KeyboardEvent)))
    return false

  const wantsMod = parts.includes('mod')
  const wantsCtrl = parts.includes('ctrl') || parts.includes('control')
  const wantsMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  const wantsAlt = parts.includes('alt') || parts.includes('option')
  const wantsShift = parts.includes('shift')

  return (!wantsMod || event.metaKey || event.ctrlKey)
    && (!wantsCtrl || event.ctrlKey)
    && (!wantsMeta || event.metaKey)
    && (!wantsAlt || event.altKey)
    && (!wantsShift || event.shiftKey)
}

function shortcutMatches(event: KeyboardEvent, shortcut: string) {
  return shortcutModifiersMatch(event, shortcut, { allowKey: true })
}

function isMacPlatform() {
  return /\bMac|iPhone|iPad|iPod\b/i.test(navigator.platform)
}

function selectionModifierPressed(event: MouseEvent | PointerEvent | KeyboardEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
}

function getMediaElementFromEventTarget(target: EventTarget | null): MediaTargetInfo | undefined {
  const element = target instanceof Element
    ? target.closest<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>('img, video, audio, source')
    : undefined
  if (!element)
    return undefined

  const owner = element instanceof HTMLSourceElement && element.parentElement instanceof HTMLMediaElement
    ? element.parentElement
    : element
  const media = owner instanceof HTMLMediaElement ? owner : undefined
  const src = element instanceof HTMLSourceElement
    ? element.src
    : owner instanceof HTMLImageElement
      ? owner.currentSrc || owner.src
      : media?.currentSrc || media?.src
  if (!src)
    return undefined

  const kind = owner instanceof HTMLImageElement
    ? 'image'
    : owner instanceof HTMLVideoElement
      ? 'video'
      : owner instanceof HTMLAudioElement
        ? 'audio'
        : 'media'
  const title = owner.getAttribute('title') || owner.getAttribute('aria-label') || undefined
  const alt = owner instanceof HTMLImageElement ? owner.alt || undefined : undefined
  const width = owner instanceof HTMLImageElement
    ? owner.naturalWidth || owner.clientWidth
    : owner instanceof HTMLVideoElement
      ? owner.videoWidth || owner.clientWidth
      : owner.clientWidth
  const height = owner instanceof HTMLImageElement
    ? owner.naturalHeight || owner.clientHeight
    : owner instanceof HTMLVideoElement
      ? owner.videoHeight || owner.clientHeight
      : owner.clientHeight

  return {
    element: owner as MediaTargetInfo['element'],
    kind,
    src,
    title,
    alt,
    mimeType: element instanceof HTMLSourceElement ? element.type || undefined : undefined,
    currentTime: media?.currentTime,
    duration: Number.isFinite(media?.duration) ? media?.duration : undefined,
    width: width || undefined,
    height: height || undefined,
    poster: owner instanceof HTMLVideoElement ? owner.poster || undefined : undefined,
  }
}

function getFileNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, location.href)
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
    return name || fallback
  }
  catch {
    return fallback
  }
}

function getMediaRadius(anchor: Element) {
  const style = getComputedStyle(anchor)
  const radius = style.borderRadius
  if (radius && radius !== '0px')
    return radius

  const parentRadius = anchor.parentElement ? getComputedStyle(anchor.parentElement).borderRadius : ''
  return parentRadius && parentRadius !== '0px' ? parentRadius : '12px'
}

function positionMediaHighlight(highlight: HTMLElement, anchor: Element) {
  overlayRect(highlight, anchor, getMediaRadius(anchor))
}

function positionMediaToolbar(toolbar: HTMLElement, anchor: Element) {
  positionAgainstAnchor(toolbar, anchor.getBoundingClientRect(), {
    fallbackWidth: Math.min(360, window.innerWidth - 24),
    fallbackHeight: 160,
  })
}

function positionMediaUi(state: MediaToolbarState) {
  positionMediaHighlight(state.highlight, state.element)
  positionMediaToolbar(state.toolbar, state.element)
}

function captureVideoFrame(element: HTMLVideoElement) {
  return elementToDataUrl(element, element.videoWidth, element.videoHeight)
}

function imageToDataUrl(element: HTMLImageElement) {
  return elementToDataUrl(element, element.naturalWidth, element.naturalHeight)
}

function getMediaPageContext(element: Element) {
  const container = element.closest('figure, article, section, main, div')
  return (container?.textContent || document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 900)
}

async function translateSelection(
  settings: LexiSettings,
  selected: string,
  context: string,
  onTranslation?: (translation: SelectionTranslation) => void,
) {
  try {
    const ai = await requestSelectionTranslation(settings, selected, context, onTranslation)
    if (ai)
      return ai
  }
  catch {}

  return localTranslateSelection(selected)
}

export function startPageEnhancer(events: EnhancerEvents) {
  const mediaPlaybackOnly = window.top !== window
  const listeners = createListenerGroup()
  const stopVideoSpeedControl = startVideoSpeedControl()
  let disposed = false
  let tooltip: HTMLElement | undefined
  let activeTooltipToken: HTMLElement | undefined
  let tooltipHideTimer: number | undefined
  let tooltipRepositionFrame: number | undefined
  let dynamicObserver: MutationObserver | undefined
  let dynamicTimer: number | undefined
  let selectionTimer: number | undefined
  let mediaToolbarState: MediaToolbarState | undefined
  let lastTranslation: LastTranslationState | undefined
  let dialogShortcut = defaultSettings.ui.dialogShortcut
  let mediaModifierShortcut = defaultSettings.ui.mediaModifierShortcut
  let lastSelectionKey = ''
  let activeSelectionKey = ''
  let latestSelectionSnapshot = ''
  let selectionChangingSince = 0
  let lastModifierTapAt = 0
  let selectionRequestId = 0
  let selectionPointerDown = false
  let selectionFinalizedAt = 0
  let selectionFinalizedWithModifier = false
  let activeSelectionBlock: { remove: () => void } | undefined
  let pageTranslationRunningId: number | undefined
  let pageTranslationEnabled = false
  // Distinguishes the four side-panel states: manual run, rule-restored run, platform auto run.
  let pageTranslationOrigin: 'manual' | 'restored' | 'auto' | undefined
  // Set when the user pauses; blocks rule/auto restarts until the next page load.
  let pageTranslationSuppressed = false
  let pageTranslationTimer: number | undefined
  let pageTranslationObserver: MutationObserver | undefined
  let pageTranslationScanPending = false
  // Set when a failure will repeat until the reader changes something — a daily cap, an
  // out-of-hours schedule, a bad key. Scanning stops rather than retrying into the wall.
  let pageTranslationHalted = false
  const pageTranslationFailureReporter = createFailureReporter(60_000)
  let pageTranslationRunId = 0
  const pageTranslationEpoch = createOperationEpoch()
  let pageTranslationOperation: OperationEpochHandle | undefined
  let pageTranslationActivation: PageTranslationActivation | undefined
  let pageTranslationAutoSite: PageTranslationAutoSite | undefined
  const pageTranslationSources = new Map<string, PageTranslationBlock>()
  const pageTranslationInFlight = new Map<string, number>()
  const recentSelectionKeys = new Set<string>()
  let stats: PageStats = {
    replacements: 0,
    records: 0,
    enabled: false,
    showFloatingStatus: true,
  }

  async function refreshStats() {
    const { settings, records } = await getStoredState()
    if (disposed)
      return

    const siteHints = detectSpecialSiteHints()
    stats = {
      ...stats,
      records: records.length,
      enabled: pageFeatureEnabled(settings, siteHints),
      showFloatingStatus: settings.ui.showFloatingStatus,
      specialProfile: getDetectedSpecialProfileStats(settings, siteHints),
    }
    dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
    mediaModifierShortcut = settings.ui.mediaModifierShortcut || defaultSettings.ui.mediaModifierShortcut
    events.onStats(stats)
  }

  async function run() {
    const { settings, records } = await getStoredState()
    if (disposed)
      return

    const siteHints = detectSpecialSiteHints()
    const enabled = pageFeatureEnabled(settings, siteHints)
    const replacementEnabled = settings.replacement.enabled && isSceneEnabled(settings, 'replacement', location.href, siteHints)
    const budget = getReplacementBudget(settings, siteHints)
    dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
    mediaModifierShortcut = settings.ui.mediaModifierShortcut || defaultSettings.ui.mediaModifierShortcut
    stats = {
      replacements: 0,
      records: records.length,
      enabled,
      showFloatingStatus: settings.ui.showFloatingStatus,
      specialProfile: getDetectedSpecialProfileStats(settings, siteHints),
    }

    if (!replacementEnabled || budget.maxPerPage < 1 || budget.density <= 0) {
      events.onStats(stats)
      return
    }

    ensurePageStyles(settings.ui.customCss)

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!textNodeAllowed(node as Text))
          return NodeFilter.FILTER_REJECT

        const text = node.nodeValue?.trim() ?? ''
        return text.length >= settings.replacement.minTextLength
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    })

    const textNodes: Text[] = []
    const scanLimit = Math.max(budget.maxPerPage * 12, 80)
    while (walker.nextNode() && textNodes.length < scanLimit)
      textNodes.push(walker.currentNode as Text)

    let nextRecords = records
    const aiReplacementSeeds: ReplacementSeed[] = []
    const recordIndex = createReplacementRecordIndex(records)
    const candidatePool = createReplacementCandidatePool(settings, records, recordIndex, budget.conservative)
    const replacementPlans: ReplacementNodePlan[] = []

    for (const node of textNodes) {
      const plan = collectReplacementMatches(node, candidatePool, recordIndex, budget.density)
      if (plan) {
        replacementPlans.push(plan)
        continue
      }

      if (settings.ai.replacement.enabled)
        collectReplacementSeed(aiReplacementSeeds, node.nodeValue ?? '', getContextText(node))
    }

    const selectedPlans = selectReplacementPlans(replacementPlans, budget.maxPerPage, getProductAnnotationBudget(budget.maxPerPage))
    if (countSelectedReplacements(selectedPlans) >= budget.maxPerPage)
      aiReplacementSeeds.length = 0

    const prioritizedTextNodes = [...selectedPlans.keys()]
      .sort((a, b) => {
        const aScore = selectedPlans.get(a)?.[0]?.nodeScore ?? 0
        const bScore = selectedPlans.get(b)?.[0]?.nodeScore ?? 0
        return bScore - aScore
      })

    for (const node of prioritizedTextNodes) {
      if (stats.replacements >= budget.maxPerPage)
        break

      const context = getContextText(node)
      const remaining = budget.maxPerPage - stats.replacements
      const matches = selectedPlans.get(node)?.slice(0, remaining) ?? []
      const changedCandidates = replaceTextNode(node, matches, settings.replacement.displayMode)
      if (!changedCandidates.length)
        continue

      stats.replacements += changedCandidates.filter(candidate => !isProductVocabularyCandidate(candidate)).length
      for (const candidate of changedCandidates) {
        nextRecords = upsertVocabularyRecord(nextRecords, {
          candidate,
          source: 'auto',
          pageUrl: location.href,
          pageTitle: document.title,
          context,
        })
      }
    }

    if (nextRecords !== records) {
      nextRecords = settings.history.enabled ? applyHistoryLimit(nextRecords, settings) : records
      if (settings.history.enabled)
        await saveRecords(nextRecords)
    }
    if (disposed)
      return

    stats.records = nextRecords.length
    events.onStats(stats)
    await recordPageVisit({
      url: location.href,
      title: document.title,
      host: location.hostname,
      enabled,
      replacements: stats.replacements,
      records: stats.records,
    })
    if (disposed)
      return

    if (settings.ai.replacement.enabled && isSceneEnabled(settings, 'replacement', location.href, siteHints) && aiReplacementSeeds.length) {
      void queueAiReplacementSeeds(settings, aiReplacementSeeds, events)
        .catch(error => console.warn('[Lexi] AI replacement seed queue failed', error))
    }
  }

  async function savePageTranslationSnapshot(settings?: LexiSettings) {
    const maxBlocks = Math.max(1, settings?.selection.pageTranslation.maxBlocksPerPage ?? 120)
    const blocks = [...pageTranslationSources.values()]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, maxBlocks)
    await savePageTranslationCache({
      url: normalizePageTranslationUrl(),
      title: document.title,
      host: location.hostname,
      enabled: Boolean(pageTranslationActivation),
      blocks,
      updatedAt: Date.now(),
    })
  }

  function getPageTranslationLimit(settings: LexiSettings) {
    const pageSettings = settings.selection.pageTranslation
    const viewportLimit = Math.max(3, pageSettings.batchSize * 3)
    const prefetchLimit = Math.max(0, pageSettings.prefetchBlocks)
    return Math.min(
      Math.max(1, pageSettings.maxBlocksPerPage),
      viewportLimit + prefetchLimit,
    )
  }

  function updateTranslationLoadingState(targets: PageTranslationTarget[]) {
    for (const target of targets) {
      if (pageTranslationSources.has(target.id) || pageTranslationInFlight.has(target.id))
        continue

      const placeholder = insertPageTranslationElement(target.element, {
        id: target.id,
        source: target.text,
        translation: '正在翻译…',
        priority: target.priority,
        updatedAt: Date.now(),
      }, { loading: true, priority: target.priority })
      placeholder.dataset.lexiPriority = target.priority
    }
  }

  function getPageTranslationContext(targets: PageTranslationTarget[]) {
    const nearest = [...targets]
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6)
      .map(target => target.text)
      .join('\n')
    return nearest || document.body.textContent?.replace(/\s+/g, ' ').slice(0, 1200) || ''
  }

  async function translatePageTargetBatch(
    settings: LexiSettings,
    targets: PageTranslationTarget[],
    memory: PageTranslationMemory,
    operation: OperationEpochHandle,
  ) {
    const runId = operation.id
    const uniqueTargets = targets.filter(target => !pageTranslationSources.has(target.id) && !pageTranslationInFlight.has(target.id))
    if (!uniqueTargets.length || !operation.isCurrent())
      return

    uniqueTargets.forEach(target => pageTranslationInFlight.set(target.id, runId))
    updateTranslationLoadingState(uniqueTargets)

    try {
      const results = await requestPageTranslationBatch(
        settings,
        uniqueTargets.map(target => ({ id: target.id, text: target.text })),
        getPageTranslationContext(uniqueTargets),
        operation.signal,
      )
      const byId = new Map(results.map(item => [item.id, item.translation]))

      for (const target of uniqueTargets) {
        if (!pageTranslationEnabled || disposed || !operation.isCurrent())
          break

        const translatedText = byId.get(target.id)
        if (!translatedText)
          continue

        const block: PageTranslationBlock = {
          id: target.id,
          source: target.text,
          translation: translatedText,
          priority: target.priority,
          updatedAt: Date.now(),
        }
        const element = getPageTranslationElementAfter(target.element, target.id)
          ?? insertPageTranslationElement(target.element, block, { priority: target.priority, settings })
        updatePageTranslationElement(element, block, settings)
        pageTranslationSources.set(block.id, block)
        memory[target.memoryKey] = {
          ...block,
          url: normalizePageTranslationUrl(),
          host: location.hostname,
          direction: settings.selection.pageTranslation.direction,
          updatedAt: Date.now(),
        }
      }

      if (operation.isCurrent()) {
        await savePageTranslationSnapshot(settings)
        if (operation.isCurrent())
          await savePageTranslationMemory(prunePageTranslationMemory(memory, settings), operation)
      }
    }
    finally {
      uniqueTargets.forEach((target) => {
        if (pageTranslationInFlight.get(target.id) !== runId)
          return

        pageTranslationInFlight.delete(target.id)
        if (!pageTranslationSources.has(target.id)) {
          const element = getPageTranslationElementAfter(target.element, target.id)
          if (element?.dataset.lexiLoading === 'true')
            element.remove()
        }
      })
    }
  }

  async function runPageTranslation(settings: LexiSettings, operation: OperationEpochHandle) {
    if (pageTranslationRunningId != null || !operation.isCurrent())
      return

    const runId = operation.id
    ensurePageStyles(settings.ui.customCss)
    pageTranslationRunningId = runId
    pageTranslationScanPending = false

    try {
      const remainingPageBudget = Math.max(0, settings.selection.pageTranslation.maxBlocksPerPage - pageTranslationSources.size - pageTranslationInFlight.size)
      if (remainingPageBudget <= 0)
        return

      const limit = Math.min(getPageTranslationLimit(settings), remainingPageBudget)
      const targets = getPageTranslationTargets(settings, limit, pageTranslationAutoSite)
      if (!targets.length)
        return

      const memory = await readPageTranslationMemory()
      const uncachedTargets: PageTranslationTarget[] = []

      for (const target of targets) {
        if (!pageTranslationEnabled || runId !== pageTranslationRunId)
          break

        const cached = pageTranslationSources.get(target.id)
        if (cached) {
          insertPageTranslationElement(target.element, { ...cached, priority: target.priority }, { priority: target.priority, settings })
          continue
        }

        const memoryEntry = memory[target.memoryKey]
        if (memoryEntry?.translation) {
          const block: PageTranslationBlock = {
            id: target.id,
            source: target.text,
            translation: memoryEntry.translation,
            priority: target.priority,
            updatedAt: memoryEntry.updatedAt,
          }
          pageTranslationSources.set(target.id, block)
          insertPageTranslationElement(target.element, block, { priority: target.priority, settings })
          continue
        }

        uncachedTargets.push(target)
      }

      const pageSettings = settings.selection.pageTranslation
      const viewportTargets = uncachedTargets.filter(target => target.priority === 'viewport')
      const nearTargets = uncachedTargets.filter(target => target.priority === 'near')
      const prefetchTargets = uncachedTargets.filter(target => target.priority === 'prefetch')
      const orderedTargets = [
        ...viewportTargets,
        ...nearTargets.slice(0, Math.max(0, pageSettings.batchSize - viewportTargets.length)),
        ...prefetchTargets.slice(0, Math.max(0, pageSettings.prefetchBlocks)),
      ].slice(0, Math.max(1, pageSettings.batchSize + pageSettings.prefetchBlocks))

      if (!orderedTargets.length)
        return

      const batchSize = Math.max(1, pageSettings.batchSize)
      for (let index = 0; index < orderedTargets.length; index += batchSize) {
        if (!pageTranslationEnabled || runId !== pageTranslationRunId)
          break

        const batch = orderedTargets.slice(index, index + batchSize)
        await translatePageTargetBatch(settings, batch, memory, operation)
      }
    }
    finally {
      if (pageTranslationRunningId === runId)
        pageTranslationRunningId = undefined
    }

    if (pageTranslationScanPending && pageTranslationEnabled && operation.isCurrent())
      schedulePageTranslationScan(settings, 260)
  }

  function schedulePageTranslationScan(settings: LexiSettings, delay = 700) {
    const operation = pageTranslationOperation
    if (!pageTranslationEnabled || pageTranslationHalted || !operation?.isCurrent())
      return

    if (pageTranslationRunningId != null) {
      pageTranslationScanPending = true
      return
    }

    window.clearTimeout(pageTranslationTimer)
    pageTranslationTimer = window.setTimeout(() => {
      runPageTranslation(settings, operation)
        .catch((error) => {
          if (isAbortLikeError(error))
            return

          console.warn('[Lexi] page translation failed', error)
          reportPageTranslationFailure(error, settings)
        })
    }, delay)
  }

  /**
   * The loading placeholder is removed in a `finally`, so a silent failure reads as the
   * spinner disappearing for no reason. Say why once, and stop scanning when retrying
   * cannot help — otherwise scroll and mutation keep re-running a scan that will fail the
   * same way for as long as the tab stays open.
   */
  function reportPageTranslationFailure(error: unknown, settings: LexiSettings) {
    const kind = classifyTranslationFailure(error)

    if (pageTranslationFailureReporter.shouldReport(kind))
      showLexiToast(describeTranslationFailure(kind, error), settings.ui.customCss)

    if (isTerminalTranslationFailure(kind)) {
      pageTranslationHalted = true
      pageTranslationObserver?.disconnect()
      pageTranslationObserver = undefined
      window.clearTimeout(pageTranslationTimer)
    }
  }

  function ensurePageTranslationWatcher(settings: LexiSettings) {
    pageTranslationObserver?.disconnect()
    pageTranslationObserver = new MutationObserver((mutations) => {
      if (!mutations.some(mutation => Array.from(mutation.addedNodes).some(node => node instanceof HTMLElement && !node.closest('[data-lexi-page-translation], [data-lexi-selection-translation], [data-lexi-dialog]'))))
        return

      schedulePageTranslationScan(settings, 900)
    })
    pageTranslationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })
    window.removeEventListener('scroll', onPageScroll)
    window.addEventListener('scroll', onPageScroll, { passive: true })
  }

  async function startPageTranslation(options: PageTranslationStartOptions = {}) {
    if (pageTranslationEnabled)
      return { ok: true, message: '当前页面翻译已启用。', blocks: pageTranslationSources.size }

    const operation = pageTranslationEpoch.begin()
    pageTranslationOperation = operation
    pageTranslationRunId = operation.id
    const failStart = (message: string) => {
      if (pageTranslationOperation === operation) {
        pageTranslationEpoch.invalidate()
        pageTranslationOperation = undefined
        pageTranslationRunId += 1
      }
      return { ok: false, message, blocks: 0 }
    }

    const { settings: storedSettings } = await getStoredState()
    if (disposed || !operation.isCurrent())
      return failStart('页面自动翻译已停止。')

    // The side panel writes the chosen scope/direction to settings storage in
    // parallel with this message; overrides keep this run from racing that write.
    const settings = applyPageTranslationStartOverrides(storedSettings, options)

    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return failStart('划词翻译场景未启用。')

    pageTranslationAutoSite = undefined
    const activation = options.persist ? createPageTranslationActivation(settings) : undefined
    if (options.persist && !activation)
      return failStart('翻译规则 Regex 无效或为空，请在设置中修正。')

    const cache = await restorePageTranslationCache(settings, true, () => !disposed && operation.isCurrent())
    if (disposed || !operation.isCurrent())
      return failStart('页面自动翻译已停止。')

    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    pageTranslationActivation = activation
    pageTranslationEnabled = true
    pageTranslationHalted = false
    pageTranslationFailureReporter.reset()
    pageTranslationOrigin = 'manual'
    pageTranslationSuppressed = false
    if (activation)
      await savePageTranslationActivation(activation)
    if (disposed || !operation.isCurrent())
      return failStart('页面自动翻译已停止。')

    await savePageTranslationSnapshot(settings)
    if (disposed || !operation.isCurrent())
      return failStart('页面自动翻译已停止。')

    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 0)

    const scopeLabel = activation?.scope === 'site' ? '当前站点' : activation?.scope === 'regex' ? 'Regex 匹配页面' : '当前链接'
    return {
      ok: true,
      message: activation
        ? `已保存${scopeLabel}规则并开始翻译：可视区域优先，命中规则的页面会自动恢复。`
        : '已开始翻译本页（仅本次）：可视区域优先，关闭或刷新后不再自动恢复。',
      blocks: pageTranslationSources.size,
    }
  }

  async function stopPageTranslation(options: { keepActivation?: boolean } = {}) {
    pageTranslationEpoch.invalidate()
    pageTranslationOperation = undefined
    pageTranslationRunId += 1
    pageTranslationEnabled = false
    pageTranslationRunningId = undefined
    pageTranslationScanPending = false
    pageTranslationInFlight.clear()
    window.clearTimeout(pageTranslationTimer)
    pageTranslationObserver?.disconnect()
    window.removeEventListener('scroll', onPageScroll)
    removePageTranslationElements()
    await pageTranslationCacheWritesSettled
    await pageTranslationMemoryWritesSettled
    const cache = await readPageTranslationCache()
    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    await savePageTranslationCache({
      url: normalizePageTranslationUrl(),
      title: document.title,
      host: location.hostname,
      enabled: false,
      blocks: [...pageTranslationSources.values()],
      updatedAt: Date.now(),
    })

    const pausedActivation = options.keepActivation ? pageTranslationActivation : undefined
    const pausedAutoSite = options.keepActivation ? pageTranslationAutoSite : undefined
    if (pageTranslationActivation && !options.keepActivation)
      await removePageTranslationActivation(pageTranslationActivation)
    if (options.keepActivation)
      pageTranslationSuppressed = true
    pageTranslationActivation = undefined
    pageTranslationAutoSite = undefined
    pageTranslationOrigin = undefined

    return {
      ok: true,
      message: pausedActivation
        ? '已暂停本页翻译；保存的规则仍会在下次访问时恢复。'
        : pausedAutoSite
          ? '已暂停本页翻译；本次浏览不再自动开始。'
          : '已停止本页翻译，本页不会再自动恢复。',
    }
  }

  async function getPageTranslationStatus() {
    const cache = await readPageTranslationCache()
    const activation = pageTranslationActivation ?? await findMatchingPageTranslationActivation()
    return {
      ok: true,
      enabled: Boolean(pageTranslationEnabled || activation || cache?.enabled),
      running: pageTranslationEnabled,
      origin: pageTranslationOrigin,
      scope: pageTranslationEnabled ? pageTranslationActivation?.scope : activation?.scope,
      autoSite: pageTranslationEnabled ? pageTranslationAutoSite : undefined,
      blocks: pageTranslationSources.size || cache?.blocks.length || 0,
      cached: Boolean(pageTranslationSources.size || cache?.blocks.length),
      bytes: cache ? new Blob([JSON.stringify(cache)]).size : 0,
    }
  }

  async function restoreSavedPageTranslation() {
    const { settings } = await getStoredState()
    if (disposed)
      return

    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return

    if (pageTranslationSuppressed)
      return

    const activation = await findMatchingPageTranslationActivation()
    if (disposed)
      return

    const autoSite = resolveAutoPageTranslationSite(
      document,
      location.href,
      siteHints,
      settings.selection.pageTranslation,
      activation,
    )
    if (!activation && !autoSite)
      return

    const cache = await restorePageTranslationCache(settings, true, () => !disposed, autoSite)
    if (disposed)
      return

    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    pageTranslationActivation = activation
    pageTranslationAutoSite = autoSite
    pageTranslationEnabled = true
    pageTranslationHalted = false
    pageTranslationFailureReporter.reset()
    pageTranslationOrigin = activation ? 'restored' : 'auto'
    pageTranslationOperation = pageTranslationEpoch.begin()
    pageTranslationRunId = pageTranslationOperation.id
    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 220)
  }

  async function queueAiReplacementSeeds(settings: LexiSettings, seeds: ReplacementSeed[], currentEvents: EnhancerEvents) {
    let { records } = await getStoredState()
    if (disposed)
      return

    let changed = false

    for (const seed of seeds) {
      if (disposed)
        return

      try {
        const candidates = await requestReplacementCandidates(settings, seed.text, seed.context)
        if (disposed)
          return

        for (const candidate of candidates) {
          if (!candidate.original || !candidate.replacement || candidateExists(records, candidate))
            continue

          if (!canAutoReplaceCandidate(candidate))
            continue

          if (!settings.history.enabled)
            continue

          records = upsertVocabularyRecord(records, {
            candidate,
            source: 'auto',
            pageUrl: location.href,
            pageTitle: document.title,
            context: seed.context,
          })
          changed = true
        }
      }
      catch (error) {
        console.warn('[Lexi] AI replacement seed failed', error)
      }
    }

    if (!changed)
      return

    records = applyHistoryLimit(records, settings)
    await saveRecords(records)
    if (disposed)
      return

    stats.records = records.length
    currentEvents.onStats(stats)
  }

  function closeMediaToolbar() {
    mediaToolbarState?.collapsible?.destroy()
    mediaToolbarState?.highlight.remove()
    mediaToolbarState?.toolbar.remove()
    mediaToolbarState = undefined
  }

  async function analyzeMediaToolbar() {
    const state = mediaToolbarState
    if (!state?.answer)
      return

    const { settings } = await getStoredState()
    if (!isSceneEnabled(settings, 'omni', location.href, detectSpecialSiteHints()) || !settings.ai.omni.enabled) {
      state.answer.textContent = 'AI Omni 多模态场景未启用。请在选项页启用并配置支持 vision 的模型。'
      return
    }

    const updateAnswer = (text: string, revealChunk = true) => {
      if (!state.answer)
        return

      state.promptText = text
      if (state.copy)
        state.copy.disabled = !text.trim() || text === '分析中...'
      const previous = state.answer.textContent ?? ''
      renderAnimatedText(state.answer, text, previous, revealChunk)
    }
    updateAnswer('分析中...', false)
    if (state.kind === 'video' && state.element instanceof HTMLVideoElement)
      state.frameDataUrl = captureVideoFrame(state.element)
    else if (state.kind === 'image' && state.element instanceof HTMLImageElement)
      state.mediaDataUrl = await imageToDataUrl(state.element)

    try {
      const text = await requestMediaAnalysis(settings, {
        kind: state.kind,
        src: state.src,
        pageUrl: location.href,
        pageTitle: document.title,
        title: state.title,
        alt: state.alt,
        mimeType: state.mimeType,
        currentTime: state.currentTime,
        duration: state.duration,
        width: state.width,
        height: state.height,
        poster: state.poster,
        frameDataUrl: state.frameDataUrl,
        mediaDataUrl: state.mediaDataUrl,
        context: getMediaPageContext(state.element),
      }, (value) => {
        if (mediaToolbarState === state)
          updateAnswer(value)
      })
      if (mediaToolbarState === state && text)
        updateAnswer(text)
    }
    catch (error) {
      if (mediaToolbarState === state)
        updateAnswer(error instanceof Error ? error.message : '分析失败', false)
    }
  }

  async function downloadMediaToolbar() {
    const state = mediaToolbarState
    if (!state)
      return

    const filename = `Lexi/${getFileNameFromUrl(state.src, `media-${Date.now()}`)}`
    const response = await sendRuntimeMessage<{ ok?: boolean, error?: string }>('lexi-download-media', {
      url: state.src,
      filename,
    })
    const { settings } = await getStoredState()
    showLexiToast(response.ok ? '已交给浏览器下载。' : response.error || '下载失败', settings.ui.customCss)
  }

  async function copyMediaPrompt() {
    const state = mediaToolbarState
    if (!state?.promptText?.trim())
      return

    const { settings } = await getStoredState()
    await navigator.clipboard.writeText(state.promptText.trim())
    showLexiToast('Prompt 已复制。', settings.ui.customCss)
  }

  function showMediaToolbar(info: MediaTargetInfo) {
    closeMediaToolbar()

    const existingStyle = document.getElementById('lexi-page-style')
    if (!existingStyle)
      ensurePageStyles(defaultSettings.ui.customCss)

    const highlight = document.createElement('div')
    const toolbar = document.createElement('section')
    const head = document.createElement('div')
    const title = document.createElement('div')
    const close = document.createElement('button')
    const meta = document.createElement('div')
    const actions = document.createElement('div')
    const download = document.createElement('button')
    const analyze = document.createElement('button')
    const copy = document.createElement('button')
    const answer = document.createElement('div')

    highlight.dataset.lexiMediaHighlight = 'true'
    highlight.className = 'lexi-media-highlight'
    toolbar.dataset.lexiMediaToolbar = 'true'
    toolbar.className = 'lexi-media-toolbar'
    head.className = 'lexi-media-toolbar__head'
    title.className = 'lexi-media-toolbar__title'
    close.className = 'lexi-media-toolbar__close'
    meta.className = 'lexi-media-toolbar__meta'
    actions.className = 'lexi-media-toolbar__actions'
    download.className = 'lexi-media-toolbar__button'
    analyze.className = 'lexi-media-toolbar__button'
    copy.className = 'lexi-media-toolbar__button'
    answer.className = 'lexi-media-toolbar__answer'

    close.type = 'button'
    download.type = 'button'
    analyze.type = 'button'
    copy.type = 'button'
    title.textContent = `${info.kind === 'image' ? '图片' : info.kind === 'video' ? '视频' : info.kind === 'audio' ? '音频' : '媒体'}操作`
    close.textContent = '×'
    meta.textContent = [info.title || info.alt || getFileNameFromUrl(info.src, info.src), info.width && info.height ? `${info.width}×${info.height}` : ''].filter(Boolean).join(' · ')
    download.textContent = '下载媒体'
    analyze.textContent = '提取还原 Prompt'
    copy.textContent = '复制 Prompt'
    copy.disabled = true
    answer.textContent = '点击“提取还原 Prompt”，会输出用于还原这张图的纯文本 prompt。'

    close.addEventListener('click', closeMediaToolbar)
    download.addEventListener('click', () => downloadMediaToolbar().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '下载失败'
    }))
    analyze.addEventListener('click', () => analyzeMediaToolbar().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '分析失败'
    }))
    copy.addEventListener('click', () => copyMediaPrompt().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '复制失败'
    }))

    const collapsible = createCollapsible(toolbar, {
      block: 'lexi-media-toolbar',
      label: '媒体操作',
      summary: info.title || info.alt || getFileNameFromUrl(info.src, info.src),
      onToggle: () => {
        const state = mediaToolbarState
        if (state)
          positionMediaUi(state)
      },
    })

    head.append(title, collapsible.toggle, close)
    actions.append(analyze, copy, download)
    const body = document.createElement('div')
    body.className = 'lexi-media-toolbar__body'
    body.append(meta, actions, answer)
    toolbar.append(collapsible.pill, head, body)
    document.documentElement.append(highlight, toolbar)
    mediaToolbarState = { ...info, toolbar, highlight, answer, copy, collapsible }
    positionMediaUi(mediaToolbarState)
  }

  async function translateAndRecord(selected: string, context: string, range: Range | undefined, requestId: number, requestKey: string) {
    const { settings, records } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return

    const block = createSelectionTranslationBlock(settings, selected, requestKey, range)
    activeSelectionBlock = block
    const updateTranslation = (translation: SelectionTranslation, detailText?: string) => {
      if (requestId === selectionRequestId)
        block.update(translation, detailText)
    }
    const translation = await translateSelection(settings, selected, context, updateTranslation)
    if (requestId !== selectionRequestId) {
      block.remove()
      return
    }
    updateTranslation(translation)
    activeSelectionBlock = undefined

    let detailView: SelectionDetailView = { terms: [] }
    let detailText = ''
    let detailCandidate: VocabularyCandidate | undefined
    try {
      const detail = await requestSelectionDetail(settings, selected, translation.translation, context)
      if (requestId !== selectionRequestId)
        return

      detailView = normalizeSelectionDetail(detail)
      detailText = formatSelectionDetail(detailView)
      detailCandidate = detail?.candidate
      if (detailText)
        updateTranslation(translation, detailText)
    }
    catch {
      if (isLikelyTechnicalSelectionTerm(selected)) {
        detailText = '技术术语：已加入本地词库。'
        updateTranslation(translation, detailText)
      }
    }

    if (requestId !== selectionRequestId)
      return

    lastTranslation = {
      selected,
      translation: translation.translation,
      detail: detailText,
      context,
    }

    if (!settings.history.enabled)
      return

    const validDetailCandidate = detailCandidate && shouldRecordSelectionCandidate(detailCandidate, selected)
      ? detailCandidate
      : undefined
    const termCandidates = detailView.terms
      .map(term => createCandidateFromTerm(translation, term))
      .filter((candidate): candidate is VocabularyCandidate => candidate != null)
    const candidate = validDetailCandidate
      ?? termCandidates[0]
      ?? (isLikelyTechnicalSelectionTerm(selected) ? createTechnicalCandidate(translation, detailText) : createManualCandidate(translation))
    if (!candidate)
      return

    let nextRecords = upsertVocabularyRecord(records, {
      candidate,
      source: 'manual',
      pageUrl: location.href,
      pageTitle: document.title,
      context,
    })

    for (const termCandidate of termCandidates.slice(1, 4)) {
      nextRecords = upsertVocabularyRecord(nextRecords, {
        candidate: termCandidate,
        source: 'manual',
        pageUrl: location.href,
        pageTitle: document.title,
        context,
      })
    }

    nextRecords = applyHistoryLimit(nextRecords, settings)
    await saveRecords(nextRecords)
    stats.records = nextRecords.length
    stats.showFloatingStatus = settings.ui.showFloatingStatus
    events.onStats(stats)
  }

  function getSelectionSnapshot() {
    const selection = window.getSelection()
    const selected = selection?.toString().trim() ?? ''
    if (!selection?.rangeCount || !selected)
      return ''

    if (isSelectionInIgnoredArea(selection.getRangeAt(0)))
      return ''

    return selected
  }

  function createSelectionKey(selected: string, context: string) {
    return `${selected.replace(/\s+/g, ' ')}:${context.replace(/\s+/g, ' ').slice(0, 220)}`
  }

  function rememberSelectionKey(key: string) {
    recentSelectionKeys.add(key)
    window.setTimeout(() => {
      recentSelectionKeys.delete(key)
    }, 6000)
  }

  function cancelActiveSelectionRequest() {
    selectionRequestId += 1
    activeSelectionBlock?.remove()
    activeSelectionBlock = undefined
  }

  function scheduleSelectionCheck(delay = 520, requireFinalized = true) {
    const snapshot = getSelectionSnapshot()
    if (snapshot)
      latestSelectionSnapshot = snapshot
    if (!selectionChangingSince)
      selectionChangingSince = performance.now()

    const activeDuration = performance.now() - selectionChangingSince
    const stableDelay = delay + Math.min(900, Math.floor(activeDuration / 120) * 120)
    window.clearTimeout(selectionTimer)
    selectionTimer = window.setTimeout(() => {
      if (requireFinalized && (selectionPointerDown || !selectionFinalizedAt))
        return

      const current = getSelectionSnapshot()
      if (!current)
        return
      if (latestSelectionSnapshot && current !== latestSelectionSnapshot)
        latestSelectionSnapshot = current

      selectionChangingSince = 0
      handleSelection().catch(error => console.warn('[Lexi] selection handling failed', error))
    }, stableDelay)
  }

  async function handleSelection() {
    if (disposed)
      return

    const selection = window.getSelection()
    const selected = selection?.toString().trim()
    if (!selection || !selected || selected.length < 2)
      return

    if (selected.length > maxSelectionTranslationLength) {
      const { settings } = await getStoredState()
      showLexiToast(`选择区域过多（${selected.length} 字符），请缩小到 ${maxSelectionTranslationLength} 字符以内再翻译。`, settings.ui.customCss)
      return
    }

    const range = selection.rangeCount ? selection.getRangeAt(0) : undefined
    if (isSelectionInIgnoredArea(range))
      return

    const context = range?.commonAncestorContainer.textContent?.replace(/\s+/g, ' ').slice(0, 420) ?? selected
    const selectionKey = createSelectionKey(selected, context)
    const domKey = createSelectionDomKey(selected)
    if (selectionKey === lastSelectionKey || selectionKey === activeSelectionKey || recentSelectionKeys.has(selectionKey))
      return

    const { settings } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled || !settings.selection.autoTranslate)
      return
    if (settings.selection.requireModifierKey && !selectionFinalizedWithModifier)
      return

    if (!claimSelectionDomLock(domKey))
      return

    cancelActiveSelectionRequest()
    removeSelectionBlocksByKey(domKey)
    activeSelectionKey = selectionKey
    rememberSelectionKey(selectionKey)

    try {
      await translateAndRecord(selected, context, range, selectionRequestId, domKey)
      lastSelectionKey = selectionKey
    }
    finally {
      activeSelectionKey = ''
      releaseSelectionDomLock(domKey)
    }
  }

  const onPointerDown = (event: MouseEvent | PointerEvent) => {
    if (mediaPlaybackOnly)
      return

    selectionPointerDown = true
    selectionFinalizedAt = 0
    selectionFinalizedWithModifier = false
    selectionChangingSince = performance.now()
    window.clearTimeout(selectionTimer)

    if (shortcutModifiersMatch(event, mediaModifierShortcut || defaultSettings.ui.mediaModifierShortcut) && getMediaElementFromEventTarget(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
  }

  function tryShowMediaToolbarFromEvent(event: MouseEvent | PointerEvent) {
    if (!shortcutModifiersMatch(event, mediaModifierShortcut || defaultSettings.ui.mediaModifierShortcut))
      return false

    const media = getMediaElementFromEventTarget(event.target)
    if (!media)
      return false

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    getStoredState()
      .then(({ settings }) => {
        ensurePageStyles(settings.ui.customCss)
        showMediaToolbar(media)
      })
      .catch((error) => {
        console.warn('[Lexi] media toolbar failed', error)
        showMediaToolbar(media)
      })
    return true
  }

  const onPointerUp = (event: MouseEvent | PointerEvent) => {
    if (mediaPlaybackOnly)
      return

    selectionPointerDown = false
    selectionFinalizedAt = performance.now()
    selectionFinalizedWithModifier = selectionModifierPressed(event)
    if (tryShowMediaToolbarFromEvent(event))
      return

    scheduleSelectionCheck(360)
    window.setTimeout(() => {
      if (!disposed && getSelectionSnapshot())
        handleSelection().catch(error => console.warn('[Lexi] selection pointerup fallback failed', error))
    }, 80)
  }

  const onKeyUp = (event: KeyboardEvent) => {
    const key = typeof event.key === 'string' ? event.key : ''
    if (key === 'Control' || key === 'Alt') {
      const now = performance.now()
      if (now - lastModifierTapAt <= 360) {
        lastModifierTapAt = 0
        if (getSelectionSnapshot())
          handleSelection().catch(error => console.warn('[Lexi] double modifier selection translation failed', error))
        else
          startPageTranslation().catch(error => console.warn('[Lexi] double modifier page translation failed', error))
        return
      }
      lastModifierTapAt = now
    }
    if (key.startsWith('Arrow') || key === 'Shift') {
      selectionFinalizedAt = performance.now()
      selectionFinalizedWithModifier = selectionModifierPressed(event)
      scheduleSelectionCheck(420)
    }
  }

  const onSelectionChange = () => {
    const snapshot = getSelectionSnapshot()
    if (!snapshot)
      return

    const previousSnapshot = latestSelectionSnapshot
    latestSelectionSnapshot = snapshot
    if (!selectionChangingSince)
      selectionChangingSince = performance.now()
    if (previousSnapshot && snapshot !== previousSnapshot)
      cancelActiveSelectionRequest()

    if (!selectionPointerDown && selectionFinalizedAt)
      scheduleSelectionCheck(520)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !shortcutMatches(event, dialogShortcut))
      return

    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)))
      return

    event.preventDefault()
    getStoredState()
      .then(({ settings }) => {
        if (!isSceneEnabled(settings, 'selection', location.href, detectSpecialSiteHints()) || !settings.selection.enabled)
          return

        dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
        // The panel owns its own lifetime and is found via `[data-lexi-dialog]`; keeping a
        // closure reference only retained a detached node after close.
        createLexiDialog(settings, lastTranslation)
      })
      .catch(error => console.warn('[Lexi] dialog failed', error))
  }

  const isTooltipOpen = () => tooltip?.dataset.lexiOpen === 'true'

  const hideTooltip = () => {
    window.clearTimeout(tooltipHideTimer)
    tooltipHideTimer = undefined
    activeTooltipToken = undefined
    if (tooltip)
      tooltip.dataset.lexiOpen = 'false'
  }

  const cancelTooltipHide = () => {
    window.clearTimeout(tooltipHideTimer)
    tooltipHideTimer = undefined
  }

  const scheduleTooltipHide = () => {
    cancelTooltipHide()
    tooltipHideTimer = window.setTimeout(hideTooltip, 200)
  }

  const followTokenOnScroll = () => {
    if (tooltipRepositionFrame !== undefined || !isTooltipOpen() || !activeTooltipToken)
      return

    tooltipRepositionFrame = window.requestAnimationFrame(() => {
      tooltipRepositionFrame = undefined
      const token = activeTooltipToken
      if (!tooltip || !isTooltipOpen() || !token)
        return

      if (!token.isConnected) {
        hideTooltip()
        return
      }

      const rect = token.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        hideTooltip()
        return
      }

      positionHoverCard(tooltip, token)
    })
  }

  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape')
      return

    const currentDialog = document.querySelector<HTMLElement>('[data-lexi-dialog]')
    if (currentDialog)
      closeLexiDialog(currentDialog)
    if (mediaToolbarState)
      closeMediaToolbar()
    hideTooltip()
  }

  const archiveHoveredToken = (token: HTMLElement) => {
    void (async () => {
      const id = token.dataset.lexiId
      const original = token.dataset.original ?? ''
      if (!id || !original)
        return

      const { settings, records } = await getStoredState()
      const known = settings.history.enabled && records.some(record => record.id === id)
      if (known)
        await saveRecords(setVocabularyArchived(records, id, true))

      restoreReplacedTokens(original)
      hideTooltip()
      showLexiToast(
        known
          ? `已归档「${original}」，之后不再自动替换。`
          : `已还原本页「${original}」。开启学习记录后可永久归档。`,
        settings.ui.customCss,
      )
    })().catch(error => console.warn('[Lexi] archive word failed', error))
  }

  // The hover card stays open while the pointer is inside the token or the card,
  // so the archive action is reachable; leaving both hides it after a short grace.
  const ensureTooltip = () => {
    if (tooltip)
      return tooltip

    tooltip = createTooltip()
    tooltip.addEventListener('pointerenter', cancelTooltipHide)
    tooltip.addEventListener('pointerleave', (event) => {
      const related = event.relatedTarget
      if (related instanceof Node && activeTooltipToken?.contains(related))
        return

      scheduleTooltipHide()
    })
    return tooltip
  }

  const onPointerOver = (event: MouseEvent | PointerEvent) => {
    const token = getTokenFromEvent(event)
    if (!token) {
      // Pointer landed on something that is neither the token nor the card — the
      // "left both" signal that pointerout alone misses (iframes, page edges).
      const target = event.target
      if (isTooltipOpen() && !(target instanceof Node && (tooltip?.contains(target) || activeTooltipToken?.contains(target))))
        scheduleTooltipHide()
      return
    }

    cancelTooltipHide()
    if (activeTooltipToken === token && isTooltipOpen())
      return

    const card = ensureTooltip()
    activeTooltipToken = token
    renderHoverCard(card, token, archiveHoveredToken)
    positionHoverCard(card, token)
    card.dataset.lexiOpen = 'true'
  }

  const onPointerOut = (event: MouseEvent | PointerEvent) => {
    const token = getTokenFromEvent(event)
    if (!token || !isTooltipOpen())
      return

    const related = event.relatedTarget
    if (related instanceof Node && (token.contains(related) || tooltip?.contains(related)))
      return

    scheduleTooltipHide()
  }

  function onPageScroll() {
    followTokenOnScroll()

    if (mediaToolbarState)
      positionMediaUi(mediaToolbarState)

    if (!pageTranslationEnabled)
      return

    getStoredState()
      .then(({ settings }) => schedulePageTranslationScan(settings, 180))
      .catch(error => console.warn('[Lexi] page translation scroll scan failed', error))
  }

  function onMediaClickCapture(event: MouseEvent) {
    if (!shortcutModifiersMatch(event, mediaModifierShortcut || defaultSettings.ui.mediaModifierShortcut))
      return

    const media = getMediaElementFromEventTarget(event.target)
    if (!media)
      return

    event.preventDefault()

    event.stopPropagation()
    event.stopImmediatePropagation()
    tryShowMediaToolbarFromEvent(event)
  }

  const removeContextTranslateListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage<{ text?: unknown } | undefined>('lexi-context-translate', async (data) => {
      const selected = typeof data?.text === 'string' ? data.text.trim() : ''
      if (!selected)
        return

      if (selected.length > maxSelectionTranslationLength) {
        const { settings } = await getStoredState()
        showLexiToast(`选择区域过多（${selected.length} 字符），请缩小到 ${maxSelectionTranslationLength} 字符以内再翻译。`, settings.ui.customCss)
        return
      }

      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
      if (isSelectionInIgnoredArea(range))
        return

      selectionRequestId += 1
      activeSelectionBlock?.remove()
      activeSelectionBlock = undefined
      const domKey = createSelectionDomKey(selected)
      if (!claimSelectionDomLock(domKey))
        return
      removeSelectionBlocksByKey(domKey)
      try {
        await translateAndRecord(selected, selected, range, selectionRequestId, domKey)
      }
      finally {
        releaseSelectionDomLock(domKey)
      }
    })

  const removePageTranslateStartListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage<{ persist?: unknown, scope?: unknown, regex?: unknown, direction?: unknown } | undefined>('lexi-page-translate-start', (data) => {
      return startPageTranslation({
        persist: data?.persist === true,
        scope: data?.scope === 'url' || data?.scope === 'site' || data?.scope === 'regex' ? data.scope : undefined,
        regex: typeof data?.regex === 'string' ? data.regex : undefined,
        direction: data?.direction === 'en-to-zh' || data?.direction === 'zh-to-en' ? data.direction : undefined,
      })
    })

  const onQuickTranslate = () => {
    startPageTranslation().catch(error => console.warn('[Lexi] quick translation failed', error))
  }

  const removePageTranslateStopListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage('lexi-page-translate-stop', () => {
      return stopPageTranslation()
    })

  const removePageTranslatePauseListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage('lexi-page-translate-pause', () => {
      return stopPageTranslation({ keepActivation: true })
    })

  const removePageTranslateStatusListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage('lexi-page-translate-status', () => {
      return getPageTranslationStatus()
    })

  const removePageStatsListener = mediaPlaybackOnly
    ? () => {}
    : listenRuntimeMessage('lexi-page-stats', async () => {
      await refreshStats()
      return stats
    })

  const onStorageChanged = (changes: Record<string, browser.Storage.StorageChange>, areaName: string) => {
    if (areaName !== 'local' || !changes[settingsStorageKey])
      return

    refreshStats()
    if (mediaPlaybackOnly || pageTranslationActivation)
      return

    void getStoredState().then(async ({ settings }) => {
      if (disposed)
        return

      const hints = detectSpecialSiteHints()
      const autoSite = settings.selection.enabled
        && isSceneEnabled(settings, 'selection', location.href, hints)
        ? resolveAutoPageTranslationSite(document, location.href, hints, settings.selection.pageTranslation, undefined)
        : undefined

      if (pageTranslationAutoSite && !autoSite) {
        await stopPageTranslation()
        return
      }

      if (!pageTranslationEnabled && autoSite)
        await restoreSavedPageTranslation()
    }).catch(handleEnhancerError)
  }

  const stop = () => {
    disposed = true
    stopVideoSpeedControl()
    dynamicObserver?.disconnect()
    pageTranslationObserver?.disconnect()
    pageTranslationEpoch.invalidate()
    pageTranslationOperation = undefined
    pageTranslationRunningId = undefined
    window.clearTimeout(dynamicTimer)
    window.clearTimeout(selectionTimer)
    window.clearTimeout(pageTranslationTimer)
    window.clearTimeout(tooltipHideTimer)
    if (tooltipRepositionFrame !== undefined)
      window.cancelAnimationFrame(tooltipRepositionFrame)
    pageTranslationEnabled = false
    pageTranslationScanPending = false
    pageTranslationInFlight.clear()
    activeSelectionBlock?.remove()
    activeSelectionBlock = undefined
    removePageTranslationElements()
    listeners.removeAll()
    removeContextTranslateListener()
    removePageTranslateStartListener()
    removePageTranslateStopListener()
    removePageTranslatePauseListener()
    removePageTranslateStatusListener()
    removePageStatsListener()
    browser.storage.onChanged.removeListener(onStorageChanged)
    tooltip?.remove()
    document.querySelector('[data-lexi-dialog]')?.remove()
    closeMediaToolbar()
  }

  function handleEnhancerError(error: unknown) {
    const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error)
    if (/Extension context invalidated/i.test(message)) {
      stop()
      return
    }

    console.warn('[Lexi] page enhancer failed', error)
  }

  function initializeDocumentFeatures() {
    if (disposed || !document.body)
      return

    run().catch(handleEnhancerError)
    restoreSavedPageTranslation().catch(handleEnhancerError)
    void getStoredState().then(({ settings }) => {
      if (disposed)
        return

      if (!getReplacementBudget(settings, detectSpecialSiteHints()).dynamicScan)
        return

      dynamicObserver = new MutationObserver(() => {
        window.clearTimeout(dynamicTimer)
        dynamicTimer = window.setTimeout(() => {
          run().catch(handleEnhancerError)
        }, 900)
      })
      dynamicObserver.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }).catch(handleEnhancerError)
  }

  if (!mediaPlaybackOnly) {
    void browser.storage.local.get(settingsStorageKey).then(async (stored) => {
      if (disposed)
        return

      if (!stored[settingsStorageKey])
        await browser.storage.local.set({ [settingsStorageKey]: JSON.stringify(defaultSettings) })
    }).catch(handleEnhancerError)
  }

  // Pointer-up is bound on both the capture and the bubble phase, because pages that
  // stopPropagation() on mouseup would otherwise swallow selection handling. `once`
  // makes the second delivery of the same event a no-op instead of a duplicate run.
  const onPointerUpGuarded = once(onPointerUp)

  listeners.add(window, pointerEventName('down'), onPointerDown, true)
  listeners.add(window, 'scroll', onPageScroll, { passive: true, capture: true })
  listeners.add(window, pointerEventName('up'), onPointerUpGuarded, true)
  listeners.add(document, 'keydown', onEscape)
  listeners.add(window, 'resize', onPageScroll)

  if (!mediaPlaybackOnly) {
    listeners.add(window, 'click', onMediaClickCapture, true)
    listeners.add(window, 'auxclick', onMediaClickCapture, true)
    listeners.add(document, pointerEventName('up'), onPointerUpGuarded)
    listeners.add(document, 'keyup', onKeyUp, true)
    listeners.add(document, 'selectionchange', onSelectionChange)
    listeners.add(document, 'keydown', onKeyDown, true)
    listeners.add(document, 'lexi-quick-translate', onQuickTranslate)
    // Only the pointer variants: browsers emit pointer *and* mouse events for a mouse,
    // so binding both ran the hover-card handler twice on every single crossing.
    listeners.add(document, pointerEventName('over'), onPointerOver, true)
    listeners.add(document, pointerEventName('out'), onPointerOut, true)
    browser.storage.onChanged.addListener(onStorageChanged)

    if (document.body)
      initializeDocumentFeatures()
    else
      listeners.add(document, 'DOMContentLoaded', initializeDocumentFeatures, { once: true })
  }

  return stop
}
