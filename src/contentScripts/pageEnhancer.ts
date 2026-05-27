import browser from 'webextension-polyfill'
import { onMessage, sendMessage } from 'webext-bridge/content-script'
import { localTranslateSelection, requestLexiDialogAnswer, requestMediaAnalysis, requestPageTranslationBatch, requestReplacementCandidates, requestSelectionDetail, requestSelectionTranslation } from '~/logic/aiClient'
import { recordPageVisit } from '~/logic/analytics'
import { defaultSettings, mergeSettings } from '~/logic/defaults'
import { findSpecialSiteProfile, isPageEnabled, isSceneEnabled } from '~/logic/siteRules'
import type { SiteDetectionHints } from '~/logic/siteRules'
import { pageTranslationActivationsStorageKey, pageTranslationMemoryStorageKey, pageTranslationsStorageKey, settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { programmerVocabulary } from '~/logic/vocabularyBank'
import { getVocabularyId, isProductVocabularyCandidate, upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, PageTranslationActivation, PageTranslationBlock, PageTranslationCache, PageTranslationMemory, PageTranslationScope, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

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
  '[data-lexi-selection-translation]',
  '[data-lexi-page-translation]',
  '[data-lexi-dialog]',
  '[data-lexi-media-toolbar]',
  '[data-lexi-media-highlight]',
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

function createReplacementCandidatePool(settings: LexiSettings, records: VocabularyRecord[]) {
  const maxDifficulty = settings.replacement.difficulty
  const local = programmerVocabulary.filter(item => item.difficulty <= maxDifficulty)
  const recorded = records.filter(record => record.difficulty <= maxDifficulty || isProductVocabularyCandidate(record))
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

function hasCjkText(text: string) {
  return /[\u3400-\u9FFF]/.test(text)
}

function countCjkCharacters(text: string) {
  return Array.from(text).filter(char => /[\u3400-\u9FFF]/.test(char)).length
}

function isAmbiguousSingleCharacterTerm(text: string) {
  const normalized = text.replace(/\s+/g, '').trim()
  return normalized.length === 1 && hasCjkText(normalized)
}

function isConciseEnglishReplacement(original: string, replacement: string) {
  const normalized = replacement.replace(/\s+/g, ' ').trim()
  if (!normalized || hasCjkText(normalized))
    return false

  if (/Selected on page|[。！？；]/i.test(normalized))
    return false

  const maxLength = Math.max(32, countCjkCharacters(original) * 8)
  const wordCount = normalized.split(/[\s/]+/).filter(Boolean).length
  return normalized.length <= maxLength && wordCount <= 6
}

function canAutoReplaceCandidate(candidate: VocabularyCandidate) {
  if (isProductVocabularyCandidate(candidate))
    return candidate.original.trim() === candidate.replacement.trim()

  if (isAmbiguousSingleCharacterTerm(candidate.original))
    return false

  return hasCjkText(candidate.original) && isConciseEnglishReplacement(candidate.original, candidate.replacement)
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

function createManualCandidate(translation: SelectionTranslation): VocabularyCandidate {
  return translation.candidate ?? {
    original: translation.original,
    replacement: translation.translation,
    meaning: translation.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['manual'],
    difficulty: 2,
  }
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
    ...detail.terms.map(item => `名词：${item.term} - ${item.explanation}`),
    detail.context ? `语境：${detail.context}` : '',
    detail.translationReview ? `译文优化：${detail.translationReview}` : '',
    detail.advice ? `建议：${detail.advice}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function createCandidateFromTerm(translation: SelectionTranslation, term: { term: string, explanation: string }): VocabularyCandidate | undefined {
  const isChineseTerm = hasCjkText(term.term)
  const replacement = isChineseTerm ? translation.translation : term.term
  if (isChineseTerm && (isAmbiguousSingleCharacterTerm(term.term) || !isConciseEnglishReplacement(term.term, replacement)))
    return undefined

  return {
    original: isChineseTerm ? term.term : translation.original,
    replacement,
    meaning: term.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['technical', 'selection'],
    difficulty: 2,
  }
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

function createToken(candidate: VocabularyCandidate) {
  const token = document.createElement('span')
  const isProduct = isProductVocabularyCandidate(candidate)
  token.dataset.lexiToken = 'true'
  token.dataset.original = candidate.original
  token.dataset.replacement = candidate.replacement
  token.dataset.meaning = formatCandidateMeaning(candidate)
  token.dataset.example = candidate.example
  token.dataset.tags = candidate.tags.join(', ')
  token.dataset.pronunciation = candidate.pronunciation ?? ''
  token.dataset.lexiProduct = isProduct ? 'true' : 'false'
  token.className = isProduct ? 'lexi-token lexi-token-product' : 'lexi-token'
  token.textContent = isProduct ? candidate.original : candidate.replacement
  return token
}

function getPageStyleContent(customCss = '') {
  return `
    .lexi-token {
      border-bottom: 1px dashed #0ea5e9;
      color: #0ea5e9;
      cursor: help;
      text-decoration: none;
    }

    .lexi-token:hover {
      background: rgba(14, 165, 233, 0.14);
    }

    .lexi-token-product {
      border-bottom-color: #9333ea;
      color: inherit;
    }

    .lexi-token-product:hover {
      background: rgba(147, 51, 234, 0.08);
    }

    .lexi-token-tooltip {
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      max-width: min(360px, calc(100vw - 32px));
      white-space: pre-wrap;
      border: 1px solid rgba(203, 213, 225, 0.82);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(255, 255, 255, 0.5) inset;
      backdrop-filter: blur(14px) saturate(1.12);
      -webkit-backdrop-filter: blur(14px) saturate(1.12);
      color: #1f2937;
      padding: 10px 12px;
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
    }

    .lexi-toast {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      left: 50%;
      bottom: 28px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      border: 1px solid rgba(203, 213, 225, 0.82);
      border-radius: 12px;
      background: rgba(17, 24, 39, 0.92);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
      color: #fff;
      padding: 10px 13px;
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
      transform: translateX(-50%) translateY(10px);
      opacity: 0;
      animation: lexi-toast-enter 180ms ease-out forwards;
    }

    .lexi-selection-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      position: relative;
      max-width: min(100%, 64rem);
      margin: 0.85em 0;
      border: 1px solid rgba(215, 227, 248, 0.86);
      border-left: 4px solid #2563eb;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(255, 255, 255, 0.48) inset;
      backdrop-filter: blur(14px) saturate(1.12);
      -webkit-backdrop-filter: blur(14px) saturate(1.12);
      padding: 0.7em 0.85em;
      color: #111827;
      font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
      overflow: hidden;
      animation: lexi-card-enter 180ms ease-out both;
      transform-origin: top left;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] {
      display: inline-flex;
      width: fit-content;
      max-width: min(100%, 22rem);
      border: 1px solid rgba(191, 219, 254, 0.88);
      border-radius: 999px;
      background: rgba(239, 246, 255, 0.82);
      padding: 0;
      color: #1e3a8a;
    }

    .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, rgba(255, 255, 255, 0.86) 0%, rgba(241, 247, 255, 0.84) 48%, rgba(255, 255, 255, 0.86) 100%);
      background-size: 220% 100%;
      animation: lexi-card-enter 180ms ease-out both, lexi-shimmer-surface 1000ms ease-in-out infinite;
    }

    .lexi-selection-translation[data-lexi-loading="true"]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, transparent 0%, rgba(37, 99, 235, 0.08) 46%, transparent 78%);
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
      background: #0ea5e9;
      color: #fff;
      font-weight: 600;
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 0.15em 0.55em;
      border-radius: 3px;
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
      border-radius: 4px;
      color: #475569;
      cursor: pointer;
      font: 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }

    .lexi-selection-translation__icon-button:hover {
      border-color: #bfdbfe;
      background: #eff6ff;
      color: #1d4ed8;
    }

    .lexi-selection-translation__body {
      all: initial;
      display: block;
      box-sizing: border-box;
    }

    .lexi-selection-translation__text {
      all: initial;
      display: inline;
      color: #111827;
      font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
      color: #1d4ed8;
      opacity: 0.62;
    }

    .lexi-selection-translation__detail {
      all: initial;
      display: block;
      margin-top: 0.45em;
      color: rgba(17, 24, 39, 0.68);
      font: 12px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-selection-translation__collapsed {
      all: initial;
      box-sizing: border-box;
      display: none;
      align-items: center;
      gap: 0.4em;
      max-width: 100%;
      padding: 0.24em 0.65em;
      color: #1e3a8a;
      cursor: pointer;
      font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }

    .lexi-selection-translation[data-lexi-collapsed="true"] .lexi-selection-translation__collapsed {
      display: inline-flex;
      animation: lexi-capsule-content-enter 180ms ease-out both;
    }

    .lexi-selection-translation__collapsed-icon {
      all: initial;
      color: #0ea5e9;
      font: 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .lexi-selection-translation__collapsed-text {
      all: initial;
      min-width: 0;
      overflow: hidden;
      color: #1e3a8a;
      font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @keyframes lexi-toast-enter {
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
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

    .lexi-page-translation {
      all: initial;
      box-sizing: border-box;
      display: block;
      position: relative;
      margin: 0.55em 0;
      border: 1px solid rgba(14, 165, 233, 0.22);
      border-left: 3px solid #0ea5e9;
      border-radius: 9px;
      background: rgba(14, 165, 233, 0.08);
      box-shadow: 0 10px 26px rgba(14, 165, 233, 0.08);
      padding: 0.55em 0.7em;
      color: #0f172a;
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow: hidden;
      overflow-wrap: anywhere;
      animation: lexi-page-translation-enter 180ms ease-out both;
    }

    .lexi-page-translation[data-lexi-loading="true"] {
      border-color: transparent;
      background:
        linear-gradient(rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.88)) padding-box,
        linear-gradient(110deg, #2563eb, #06b6d4, #a855f7, #2563eb) border-box;
      background-size: 100% 100%, 240% 100%;
      color: rgba(30, 64, 175, 0.78);
      animation: lexi-page-translation-enter 180ms ease-out both, lexi-ai-border-flow var(--lexi-page-translation-speed, 1100ms) linear infinite, lexi-priority-opacity var(--lexi-page-translation-pulse, 1200ms) ease-in-out infinite;
    }

    .lexi-page-translation[data-lexi-loading="true"]::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, transparent 8%, rgba(59, 130, 246, 0.12) 45%, transparent 72%);
      transform: translateX(-120%);
      animation: lexi-page-translation-sweep var(--lexi-page-translation-speed, 1100ms) ease-in-out infinite;
      pointer-events: none;
    }

    .lexi-page-translation[data-lexi-priority="viewport"] {
      --lexi-page-translation-speed: 520ms;
      --lexi-page-translation-pulse: 760ms;
      border-left-color: #2563eb;
    }

    .lexi-page-translation[data-lexi-priority="near"] {
      --lexi-page-translation-speed: 860ms;
      --lexi-page-translation-pulse: 1040ms;
      border-left-color: #0891b2;
    }

    .lexi-page-translation[data-lexi-priority="prefetch"] {
      --lexi-page-translation-speed: 1350ms;
      --lexi-page-translation-pulse: 1480ms;
      opacity: 0.82;
    }

    @keyframes lexi-page-translation-enter {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes lexi-ai-border-flow {
      to { background-position: 0 0, -240% 0; }
    }

    @keyframes lexi-priority-opacity {
      0%, 100% { opacity: 0.54; }
      50% { opacity: 0.98; }
    }

    @keyframes lexi-page-translation-sweep {
      to { transform: translateX(120%); }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-page-translation,
      .lexi-page-translation[data-lexi-loading="true"],
      .lexi-page-translation[data-lexi-loading="true"]::before {
        animation: none;
      }
    }

    .lexi-media-highlight {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483646;
      overflow: visible;
      border: 2px solid rgba(37, 99, 235, 0.92);
      border-radius: var(--lexi-media-radius, 16px);
      box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.72), 0 0 24px rgba(99, 102, 241, 0.36), 0 0 42px rgba(14, 165, 233, 0.22);
      pointer-events: none;
      transform: translateY(0);
      animation: lexi-media-float 2.2s ease-in-out infinite, lexi-media-border-pulse 1.25s ease-in-out infinite;
    }

    .lexi-media-highlight::before {
      content: "";
      position: absolute;
      inset: -7px;
      border: 2px solid rgba(168, 85, 247, 0.78);
      border-radius: calc(var(--lexi-media-radius, 16px) + 7px);
      box-shadow: 0 0 22px rgba(168, 85, 247, 0.36), 0 0 34px rgba(14, 165, 233, 0.24);
      opacity: 0.85;
      animation: lexi-media-glow-pulse 1.45s ease-in-out infinite;
    }

    .lexi-media-highlight__shine {
      position: absolute;
      inset: 0;
      overflow: hidden;
      border-radius: inherit;
      opacity: 0.38;
      mix-blend-mode: screen;
    }

    .lexi-media-highlight__shine::before {
      content: "";
      position: absolute;
      left: -42%;
      top: 0;
      width: 28%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.16) 48%, rgba(125, 211, 252, 0.08) 58%, transparent 100%);
      transform: translateX(0) skewX(-12deg);
      animation: lexi-media-shimmer 1.35s ease-in-out infinite;
    }

    .lexi-media-highlight::after {
      content: "Lexi";
      position: absolute;
      right: 8px;
      top: 8px;
      z-index: 1;
      border: 1px solid rgba(255, 255, 255, 0.5);
      border-radius: 999px;
      background: linear-gradient(135deg, rgba(17, 24, 39, 0.92), rgba(67, 56, 202, 0.88), rgba(2, 132, 199, 0.88));
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.22);
      color: #fff;
      font: 700 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: .02em;
      padding: 5px 7px;
    }

    @keyframes lexi-media-border-pulse {
      0%, 100% { border-color: rgba(37, 99, 235, 0.92); box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.72), 0 0 24px rgba(99, 102, 241, 0.36), 0 0 42px rgba(14, 165, 233, 0.22); }
      50% { border-color: rgba(236, 72, 153, 0.92); box-shadow: 0 0 0 1px rgba(216, 180, 254, 0.76), 0 0 28px rgba(236, 72, 153, 0.32), 0 0 46px rgba(99, 102, 241, 0.24); }
    }

    @keyframes lexi-media-glow-pulse {
      0%, 100% { opacity: 0.72; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.006); }
    }

    @keyframes lexi-media-shimmer {
      to { transform: translateX(470%) skewX(-12deg); }
    }

    @keyframes lexi-media-float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }

    @media (prefers-reduced-motion: reduce) {
      .lexi-media-highlight,
      .lexi-media-highlight::before,
      .lexi-media-highlight__shine::before {
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
      border: 1px solid rgba(226, 232, 240, 0.58);
      border-radius: 18px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.7), rgba(241, 245, 249, 0.46)),
        radial-gradient(circle at 0% 0%, rgba(129, 140, 248, 0.16), transparent 36%),
        radial-gradient(circle at 100% 12%, rgba(14, 165, 233, 0.12), transparent 34%);
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(255, 255, 255, 0.62) inset;
      backdrop-filter: blur(22px) saturate(1.18);
      -webkit-backdrop-filter: blur(22px) saturate(1.18);
      color: #111827;
      padding: 12px;
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: lexi-card-enter 160ms ease-out both;
    }

    .lexi-media-toolbar * {
      box-sizing: border-box;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
      color: #111827;
      font-size: 13px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lexi-media-toolbar__close {
      border: 0;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 3px;
    }

    .lexi-media-toolbar__meta {
      overflow: hidden;
      color: #64748b;
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
      border: 1px solid rgba(203, 213, 225, 0.88);
      border-radius: 999px;
      background: #fff;
      color: #111827;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 10px;
    }

    .lexi-media-toolbar__button:first-child {
      border-color: #312e81;
      background: linear-gradient(135deg, #111827, #4338ca 58%, #0284c7);
      color: #fff;
    }

    .lexi-media-toolbar__answer {
      max-height: 260px;
      overflow: auto;
      border: 1px solid rgba(226, 232, 240, 0.68);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.5);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.65) inset;
      padding: 11px 12px;
      color: #243244;
      font-size: 12px;
      line-height: 1.68;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      top: 12vh;
      left: 50%;
      transform: translateX(-50%) translateY(-4px);
      width: min(720px, calc(100vw - 32px));
      border: 1px solid rgba(129, 140, 248, 0.34);
      border-radius: 10px;
      background:
        radial-gradient(circle at 0% 0%, rgba(99, 102, 241, 0.16), transparent 34%),
        radial-gradient(circle at 100% 8%, rgba(14, 165, 233, 0.14), transparent 30%),
        linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.92));
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.7) inset;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      color: #111827;
      font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      opacity: 0;
      animation: lexi-dialog-enter 160ms ease-out forwards;
    }

    .lexi-dialog * {
      box-sizing: border-box;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .lexi-dialog__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.3);
      background: linear-gradient(90deg, rgba(79, 70, 229, 0.08), rgba(14, 165, 233, 0.05), transparent);
      padding: 12px 14px;
    }

    .lexi-dialog__title {
      background: linear-gradient(90deg, #111827, #4f46e5 58%, #0284c7);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      font-size: 14px;
      font-weight: 700;
    }

    .lexi-dialog__close {
      border: 0;
      background: transparent;
      color: #525252;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px;
    }

    .lexi-dialog__body {
      display: grid;
      gap: 12px;
      padding: 14px;
    }

    .lexi-dialog__context {
      position: relative;
      max-height: 118px;
      overflow: auto;
      border: 1px solid rgba(203, 213, 225, 0.72);
      background:
        linear-gradient(90deg, rgba(99, 102, 241, 0.07), transparent 22%),
        rgba(248, 250, 252, 0.72);
      padding: 11px 12px;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog__messages {
      display: flex;
      max-height: min(50vh, 420px);
      flex-direction: column;
      gap: 10px;
      overflow: auto;
      padding: 2px 1px 4px;
      scroll-behavior: smooth;
    }

    .lexi-dialog__bubble {
      max-width: min(88%, 38rem);
      border: 1px solid rgba(203, 213, 225, 0.66);
      border-radius: 16px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.62;
      overflow-wrap: anywhere;
      white-space: normal;
      animation: lexi-dialog-bubble-enter 160ms ease-out both;
    }

    .lexi-dialog__bubble--system,
    .lexi-dialog__bubble--assistant {
      align-self: flex-start;
      border-bottom-left-radius: 6px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 250, 252, 0.78));
      color: #111827;
    }

    .lexi-dialog__bubble--system {
      max-width: 100%;
      border-style: dashed;
      background: rgba(248, 250, 252, 0.62);
      color: #64748b;
      font-size: 12px;
    }

    .lexi-dialog__bubble--user {
      align-self: flex-end;
      border-color: rgba(37, 99, 235, 0.22);
      border-bottom-right-radius: 6px;
      background: linear-gradient(135deg, #2563eb, #4f46e5 58%, #7c3aed);
      color: #fff;
    }

    .lexi-dialog__bubble[data-lexi-pending="true"] {
      background: linear-gradient(100deg, rgba(255,255,255,0.9), rgba(238,242,255,0.9), rgba(255,255,255,0.9));
      background-size: 220% 100%;
      color: #4f46e5;
      animation: lexi-dialog-bubble-enter 160ms ease-out both, lexi-shimmer-surface 1000ms ease-in-out infinite;
    }

    .lexi-dialog__bubble p {
      margin: 0.45em 0;
    }

    .lexi-dialog__bubble p:first-child {
      margin-top: 0;
    }

    .lexi-dialog__bubble p:last-child {
      margin-bottom: 0;
    }

    .lexi-dialog__bubble ul,
    .lexi-dialog__bubble ol {
      margin: 0.45em 0;
      padding-left: 1.35em;
    }

    .lexi-dialog__bubble li {
      margin: 0.18em 0;
    }

    .lexi-dialog__bubble code {
      border-radius: 5px;
      background: rgba(15, 23, 42, 0.08);
      padding: 0.1em 0.32em;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
    }

    .lexi-dialog__bubble--user code {
      background: rgba(255, 255, 255, 0.18);
    }

    .lexi-dialog__bubble pre {
      max-width: 100%;
      overflow: auto;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.9);
      color: #e5e7eb;
      padding: 10px;
      white-space: pre;
    }

    .lexi-dialog__bubble pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }

    .lexi-dialog__bubble blockquote {
      margin: 0.5em 0;
      border-left: 3px solid rgba(99, 102, 241, 0.35);
      padding-left: 0.75em;
      color: #475569;
    }

    .lexi-dialog__bubble a {
      color: #2563eb;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .lexi-dialog__bubble--user a {
      color: #fff;
    }

    .lexi-dialog__form {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
      gap: 8px;
    }

    .lexi-dialog__input {
      display: block;
      min-width: 0;
      min-height: 54px;
      max-height: 120px;
      resize: vertical;
      border: 1px solid rgba(148, 163, 184, 0.78);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.78);
      padding: 10px 11px;
      color: #111827;
      font-size: 14px;
      line-height: 1.45;
      outline: none;
    }

    .lexi-dialog__input:focus {
      border-color: rgba(79, 70, 229, 0.72);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
    }

    .lexi-dialog__button {
      align-self: end;
      min-width: 76px;
      height: 42px;
      border: 1px solid #312e81;
      border-radius: 6px;
      background: linear-gradient(135deg, #111827, #4338ca 58%, #0284c7);
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      padding: 0 16px;
    }

    @keyframes lexi-dialog-enter {
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes lexi-dialog-bubble-enter {
      from {
        opacity: 0;
        filter: blur(2px);
        transform: translateY(4px) scale(0.99);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0) scale(1);
      }
    }

    ${customCss}
  `
}

function ensurePageStyles(customCss = '') {
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
  tooltip.hidden = true
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
  window.setTimeout(() => toast.remove(), 3200)
}

function moveTooltip(tooltip: HTMLElement, event: MouseEvent) {
  const offset = 14
  const maxLeft = window.innerWidth - tooltip.offsetWidth - 12
  const maxTop = window.innerHeight - tooltip.offsetHeight - 12
  tooltip.style.left = `${Math.max(12, Math.min(event.clientX + offset, maxLeft))}px`
  tooltip.style.top = `${Math.max(12, Math.min(event.clientY + offset, maxTop))}px`
}

function replaceTextNode(node: Text, matches: ReplacementMatch[]) {
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

    fragment.append(createToken(candidate))
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

function readJsonValue<T>(value: unknown, fallback: T): T {
  if (value == null)
    return fallback

  if (typeof value !== 'string')
    return value as T

  try {
    return JSON.parse(value) as T
  }
  catch {
    return fallback
  }
}

async function getStoredState() {
  const stored = await browser.storage.local.get([settingsStorageKey, vocabularyStorageKey])
  const settings = mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined))
  const records = readJsonValue<VocabularyRecord[]>(stored[vocabularyStorageKey], [])

  return { settings, records }
}

async function saveRecords(records: VocabularyRecord[]) {
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
  const density = profile?.conservative
    ? Math.min(settings.replacement.density, profile.density ?? 0.06)
    : settings.replacement.density

  return {
    maxPerPage: Math.max(0, maxPerPage),
    density: Math.max(0, density),
    dynamicScan: Boolean(profile?.dynamicScan),
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

type PageTranslationActivations = Record<string, PageTranslationActivation>

function normalizePageTranslationUrl(url = location.href) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  }
  catch {
    return url.split('#')[0]
  }
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
  return [scope, identity, settings.selection.translationDirection, createPageTranslationBlockId(text)].join(':')
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

function getPageTranslationActivationKey(activation: PageTranslationActivation) {
  if (activation.scope === 'site')
    return `site:${activation.host}`

  if (activation.scope === 'regex')
    return `regex:${activation.regex}`

  return `url:${normalizePageTranslationUrl(activation.url)}`
}

function pageTranslationActivationMatches(activation: PageTranslationActivation, url = location.href) {
  if (!activation.enabled)
    return false

  const normalizedUrl = normalizePageTranslationUrl(url)
  if (activation.scope === 'url')
    return normalizePageTranslationUrl(activation.url) === normalizedUrl

  if (activation.scope === 'site')
    return activation.host === location.hostname

  if (!activation.regex.trim())
    return false

  try {
    return new RegExp(activation.regex).test(url)
  }
  catch {
    return false
  }
}

async function readPageTranslationActivations() {
  const stored = await browser.storage.local.get(pageTranslationActivationsStorageKey)
  return readJsonValue<PageTranslationActivations>(stored[pageTranslationActivationsStorageKey], {})
}

async function savePageTranslationActivations(activations: PageTranslationActivations) {
  await browser.storage.local.set({ [pageTranslationActivationsStorageKey]: JSON.stringify(activations) })
}

async function findMatchingPageTranslationActivation() {
  const activations = await readPageTranslationActivations()
  return Object.values(activations)
    .filter(activation => pageTranslationActivationMatches(activation))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

async function savePageTranslationActivation(activation: PageTranslationActivation) {
  const activations = await readPageTranslationActivations()
  activations[getPageTranslationActivationKey(activation)] = activation
  await savePageTranslationActivations(activations)
}

async function removePageTranslationActivation(activation: PageTranslationActivation) {
  const activations = await readPageTranslationActivations()
  delete activations[getPageTranslationActivationKey(activation)]
  await savePageTranslationActivations(activations)
}

async function readPageTranslationMemory() {
  const stored = await browser.storage.local.get(pageTranslationMemoryStorageKey)
  return readJsonValue<PageTranslationMemory>(stored[pageTranslationMemoryStorageKey], {})
}

async function savePageTranslationMemory(memory: PageTranslationMemory) {
  await browser.storage.local.set({ [pageTranslationMemoryStorageKey]: JSON.stringify(memory) })
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

function createPageTranslationElement(
  block: PageTranslationBlock,
  options: { loading?: boolean, priority?: PageTranslationPriority } = {},
) {
  const element = document.createElement('div')
  element.dataset.lexiPageTranslation = 'true'
  element.dataset.lexiPageTranslationId = block.id
  element.dataset.lexiPriority = options.priority ?? block.priority ?? 'prefetch'
  if (options.loading)
    element.dataset.lexiLoading = 'true'
  element.className = 'lexi-page-translation'
  element.textContent = block.translation
  return element
}

function updatePageTranslationElement(element: HTMLElement, block: PageTranslationBlock) {
  const from = element.getBoundingClientRect()
  element.dataset.lexiPriority = block.priority ?? element.dataset.lexiPriority ?? 'prefetch'
  delete element.dataset.lexiLoading
  element.removeAttribute('aria-busy')
  element.textContent = block.translation

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

function getPageTranslationElementAfter(element: HTMLElement, blockId: string) {
  return element.nextElementSibling instanceof HTMLElement
    && element.nextElementSibling.dataset.lexiPageTranslationId === blockId
    ? element.nextElementSibling
    : undefined
}

function hasPageTranslationElementAfter(element: HTMLElement, blockId: string) {
  return Boolean(getPageTranslationElementAfter(element, blockId))
}

function insertPageTranslationElement(
  target: HTMLElement,
  block: PageTranslationBlock,
  options: { loading?: boolean, priority?: PageTranslationPriority } = {},
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

function getPageTranslationTargets(settings: LexiSettings, limit = 12) {
  const selectors = location.hostname.includes('x.com') || location.hostname.includes('twitter.com')
    ? '[data-testid="tweetText"], article div[lang]'
    : 'article p, article div[lang], main p, main li, p, li'
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors)).slice(0, 420)
  const seen = new Set<string>()
  const targets: PageTranslationTarget[] = []

  for (const element of elements) {
    if (isLexiIgnoredElement(element))
      continue

    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text.length < 24 || text.length > 900 || seen.has(text))
      continue

    const id = createPageTranslationBlockId(text)
    if (hasPageTranslationElementAfter(element, id))
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
  await browser.storage.local.set({ [getPageTranslationCacheKey()]: JSON.stringify(cache) })
}

async function restorePageTranslationCache(settings: LexiSettings, force = false) {
  const cache = await readPageTranslationCache()
  if ((!force && !cache?.enabled) || !cache?.blocks.length)
    return cache

  ensurePageStyles(settings.ui.customCss)
  removePageTranslationElements()
  const targets = getPageTranslationTargets(settings, cache.blocks.length + 8)
  for (const block of cache.blocks) {
    const target = targets.find(item => item.id === block.id || item.text === block.source)
    if (!target)
      continue

    insertPageTranslationElement(target.element, block, { priority: block.priority ?? target.priority })
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

function renderAnimatedText(container: HTMLElement, text: string, previousText: string, revealChunk: boolean) {
  if (!revealChunk || !previousText || !text.startsWith(previousText)) {
    container.textContent = text
    return
  }

  const nextChunk = text.slice(previousText.length)
  if (!nextChunk)
    return

  const stableText = previousText.replace(/\s+$/, '')
  const chunkPrefix = previousText.slice(stableText.length)
  container.textContent = previousText
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
  if (stableText.length !== previousText.length)
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
  collapsed.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    animateSelectionCardFlip(block, () => {
      delete block.dataset.lexiCollapsed
    })
  })

  actions.append(hide, close)
  header.append(label, actions)
  body.append(text, detail)
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
    },
    remove() {
      block.remove()
    },
  }
}

function getPageContext(range?: Range) {
  const fromSelection = range?.commonAncestorContainer.textContent
  const pageText = fromSelection || document.body.textContent || ''
  return pageText.replace(/\s+/g, ' ').trim().slice(0, 1200)
}

function createDialogContext(lastTranslation?: LastTranslationState) {
  const selection = window.getSelection()
  const selected = selection?.toString().trim()
  const range = selection?.rangeCount && selected ? selection.getRangeAt(0) : undefined
  const page = selected
    ? getPageContext(range) || lastTranslation?.context || ''
    : getPageContext()

  return {
    selected: selected || lastTranslation?.selected || '',
    translation: selected ? lastTranslation?.translation || '' : '',
    detail: selected ? lastTranslation?.detail || '' : '',
    page,
  }
}

function renderDialogContext(context: ReturnType<typeof createDialogContext>) {
  return [
    context.selected ? `选区：${context.selected}` : '',
    context.translation ? `最近翻译：${context.translation}` : '',
    context.detail ? `说明：${context.detail}` : '',
    context.page ? `页面：${context.page.slice(0, 360)}` : '',
  ].filter(Boolean).join('\n')
}

function escapeMarkdownHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderInlineMarkdown(value: string) {
  const escaped = escapeMarkdownHtml(value)
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
}

function renderMarkdown(value: string) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean, items: string[] } | undefined
  let codeLines: string[] | undefined
  let codeLanguage = ''

  const flushParagraph = () => {
    if (!paragraph.length)
      return

    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list)
      return

    const tag = list.ordered ? 'ol' : 'ul'
    html.push(`<${tag}>${list.items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`)
    list = undefined
  }

  for (const line of lines) {
    const fenceText = line.trim()
    if (fenceText.startsWith('```')) {
      if (codeLines) {
        html.push(`<pre><code${codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''}>${escapeMarkdownHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = undefined
        codeLanguage = ''
      }
      else if (/^```[\w-]*$/.test(fenceText)) {
        flushParagraph()
        flushList()
        codeLines = []
        codeLanguage = fenceText.slice(3)
      }
      continue
    }

    if (codeLines) {
      codeLines.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`)
      continue
    }

    const bulletPrefix = trimmed.slice(0, 2)
    const bulletItem = ['- ', '* ', '+ '].includes(bulletPrefix)
      ? trimmed.slice(2).trim()
      : ''
    const orderedMatch = trimmed.match(/^(\d{1,3})[.)] (.*)$/)
    if (bulletItem || orderedMatch) {
      flushParagraph()
      const isOrdered = Boolean(orderedMatch)
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(bulletItem || (orderedMatch?.[2] ?? '').trim())
      continue
    }

    paragraph.push(trimmed)
  }

  if (codeLines)
    html.push(`<pre><code${codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''}>${escapeMarkdownHtml(codeLines.join('\n'))}</code></pre>`)
  flushParagraph()
  flushList()

  return html.join('') || '<p></p>'
}

function appendDialogMessage(container: HTMLElement, role: DialogMessageRole, text: string, pending = false) {
  const bubble = document.createElement('div')
  bubble.className = `lexi-dialog__bubble lexi-dialog__bubble--${role}`
  bubble.dataset.lexiRole = role
  if (pending)
    bubble.dataset.lexiPending = 'true'
  bubble.innerHTML = renderMarkdown(text)
  container.append(bubble)
  container.scrollTop = container.scrollHeight
  return bubble
}

function updateDialogMessage(bubble: HTMLElement, text: string, pending = false) {
  bubble.innerHTML = renderMarkdown(text)
  if (pending)
    bubble.dataset.lexiPending = 'true'
  else
    delete bubble.dataset.lexiPending
  const container = bubble.parentElement
  if (container)
    container.scrollTop = container.scrollHeight
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

function positionLexiDialog(dialog: HTMLElement, anchor?: DialogAnchor) {
  const margin = 16
  const gap = 10
  const width = Math.min(720, Math.max(280, window.innerWidth - margin * 2))
  dialog.style.width = `${width}px`

  const measured = dialog.getBoundingClientRect()
  const height = Math.min(measured.height || 420, window.innerHeight - margin * 2)
  const anchorCenter = anchor ? anchor.left + anchor.width / 2 : window.innerWidth / 2
  const left = Math.max(margin + width / 2, Math.min(anchorCenter, window.innerWidth - margin - width / 2))
  let top = anchor ? anchor.bottom + gap : Math.max(margin, window.innerHeight * 0.12)

  if (anchor && top + height > window.innerHeight - margin)
    top = anchor.top - height - gap

  if (top < margin)
    top = Math.max(margin, Math.min(window.innerHeight - height - margin, window.innerHeight * 0.12))

  dialog.style.left = `${left}px`
  dialog.style.top = `${top}px`
}

function closeLexiDialog(dialog: HTMLElement) {
  dialog.dispatchEvent(new CustomEvent('lexi-dialog-close'))
  dialog.remove()
}

function createLexiDialog(settings: LexiSettings, lastTranslation?: LastTranslationState) {
  ensurePageStyles(settings.ui.customCss)

  const existing = document.querySelector<HTMLElement>('[data-lexi-dialog]')
  if (existing) {
    closeLexiDialog(existing)
    return undefined
  }

  const context = createDialogContext(lastTranslation)
  const history: DialogHistoryMessage[] = []
  let dialogAbortController: AbortController | undefined
  const anchor = getCurrentDialogAnchor()
  const dialog = document.createElement('section')
  const head = document.createElement('div')
  const title = document.createElement('div')
  const close = document.createElement('button')
  const body = document.createElement('div')
  const contextBlock = document.createElement('div')
  const messages = document.createElement('div')
  const form = document.createElement('form')
  const input = document.createElement('textarea')
  const button = document.createElement('button')

  dialog.dataset.lexiDialog = 'true'
  dialog.className = 'lexi-dialog'
  head.className = 'lexi-dialog__head'
  title.className = 'lexi-dialog__title'
  close.className = 'lexi-dialog__close'
  body.className = 'lexi-dialog__body'
  contextBlock.className = 'lexi-dialog__context'
  messages.className = 'lexi-dialog__messages'
  form.className = 'lexi-dialog__form'
  input.className = 'lexi-dialog__input'
  button.className = 'lexi-dialog__button'

  title.textContent = 'Lexi 对话'
  close.type = 'button'
  close.textContent = '×'
  contextBlock.textContent = renderDialogContext(context) || '当前页面暂无可用上下文。'
  appendDialogMessage(messages, 'system', context.selected
    ? '输入问题后，Lexi 会结合当前翻译、页面内容和上下文回答。支持 Markdown 渲染，可连续追问。'
    : '未检测到选区。现在会基于整个页面内容回答，你可以直接提问。支持 Markdown 渲染，可连续追问。')
  input.placeholder = context.selected ? '解释这段内容，或继续追问...' : '基于当前页面提问...'
  input.rows = 2
  button.type = 'submit'
  button.textContent = '发送'

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
      form.requestSubmit()
  })

  close.addEventListener('click', () => closeLexiDialog(dialog))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const question = input.value.trim()
    if (!question)
      return

    appendDialogMessage(messages, 'user', question)
    history.push({ role: 'user', content: question })
    input.value = ''
    const assistantBubble = appendDialogMessage(messages, 'assistant', '思考中...', true)
    button.setAttribute('disabled', 'true')
    dialogAbortController = new AbortController()
    requestLexiDialogAnswer(settings, question, context, text => updateDialogMessage(assistantBubble, text || '思考中...', true), history.slice(0, -1), dialogAbortController.signal)
      .then((text) => {
        const answer = text || assistantBubble.textContent || ''
        updateDialogMessage(assistantBubble, answer || '（无返回内容）')
        if (answer)
          history.push({ role: 'assistant', content: answer })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '请求失败'
        updateDialogMessage(assistantBubble, message)
        history.push({ role: 'assistant', content: message })
      })
      .finally(() => {
        dialogAbortController = undefined
        button.removeAttribute('disabled')
        input.focus()
      })
  })

  head.append(title, close)
  form.append(input, button)
  body.append(contextBlock, messages, form)
  dialog.append(head, body)
  document.documentElement.appendChild(dialog)
  positionLexiDialog(dialog, anchor)
  const reposition = () => positionLexiDialog(dialog, anchor)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
  dialog.addEventListener('lexi-dialog-close', () => {
    dialogAbortController?.abort()
    window.removeEventListener('resize', reposition)
    window.removeEventListener('scroll', reposition, true)
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
  const rect = anchor.getBoundingClientRect()
  highlight.style.left = `${rect.left}px`
  highlight.style.top = `${rect.top}px`
  highlight.style.width = `${Math.max(0, rect.width)}px`
  highlight.style.height = `${Math.max(0, rect.height)}px`
  const radius = getMediaRadius(anchor)
  highlight.style.borderRadius = radius
  highlight.style.setProperty('--lexi-media-radius', radius)
}

function positionMediaToolbar(toolbar: HTMLElement, anchor: Element) {
  const rect = anchor.getBoundingClientRect()
  const margin = 12
  const gap = 8
  const measured = toolbar.getBoundingClientRect()
  const width = measured.width || Math.min(360, window.innerWidth - margin * 2)
  const height = measured.height || 160
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  let top = rect.bottom + gap
  if (top + height > window.innerHeight - margin)
    top = rect.top - height - gap
  if (top < margin)
    top = Math.max(margin, Math.min(window.innerHeight - height - margin, rect.top))

  toolbar.style.left = `${left}px`
  toolbar.style.top = `${top}px`
}

function positionMediaUi(state: MediaToolbarState) {
  positionMediaHighlight(state.highlight, state.element)
  positionMediaToolbar(state.toolbar, state.element)
}

function captureVideoFrame(element: HTMLVideoElement) {
  if (!element.videoWidth || !element.videoHeight)
    return undefined

  try {
    const canvas = document.createElement('canvas')
    const maxSize = 960
    const scale = Math.min(1, maxSize / Math.max(element.videoWidth, element.videoHeight))
    canvas.width = Math.max(1, Math.round(element.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(element.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context)
      return undefined

    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  }
  catch {
    return undefined
  }
}

async function imageToDataUrl(element: HTMLImageElement) {
  if (!element.naturalWidth || !element.naturalHeight)
    return undefined

  try {
    const canvas = document.createElement('canvas')
    const maxSize = 960
    const scale = Math.min(1, maxSize / Math.max(element.naturalWidth, element.naturalHeight))
    canvas.width = Math.max(1, Math.round(element.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(element.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context)
      return undefined

    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  }
  catch {
    return undefined
  }
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

function looksTechnicalTerm(text: string) {
  const trimmed = text.trim()
  return /^[A-Z][A-Z0-9-]+$/.test(trimmed)
    || /^[a-z][a-z0-9-]{1,24}$/i.test(trimmed)
    || /[A-Z][a-z]+[A-Z]/.test(trimmed)
}

function createTechnicalCandidate(translation: SelectionTranslation, explanation: string): VocabularyCandidate {
  return translation.candidate ?? {
    original: translation.original,
    replacement: translation.translation,
    meaning: explanation || translation.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['technical', 'manual'],
    difficulty: 2,
  }
}

export function startPageEnhancer(events: EnhancerEvents) {
  let disposed = false
  let tooltip: HTMLElement | undefined
  let dynamicObserver: MutationObserver | undefined
  let dynamicTimer: number | undefined
  let selectionTimer: number | undefined
  let dialog: HTMLElement | undefined
  let mediaToolbarState: MediaToolbarState | undefined
  let lastTranslation: LastTranslationState | undefined
  let dialogShortcut = defaultSettings.ui.dialogShortcut
  let mediaModifierShortcut = defaultSettings.ui.mediaModifierShortcut
  let lastSelectionKey = ''
  let activeSelectionKey = ''
  let latestSelectionSnapshot = ''
  let selectionChangingSince = 0
  let selectionRequestId = 0
  let selectionPointerDown = false
  let selectionFinalizedAt = 0
  let selectionFinalizedWithModifier = false
  let activeSelectionBlock: { remove: () => void } | undefined
  let pageTranslationRunning = false
  let pageTranslationEnabled = false
  let pageTranslationTimer: number | undefined
  let pageTranslationObserver: MutationObserver | undefined
  let pageTranslationScanPending = false
  let pageTranslationRunId = 0
  let pageTranslationActivation: PageTranslationActivation | undefined
  const pageTranslationSources = new Map<string, PageTranslationBlock>()
  const pageTranslationInFlight = new Set<string>()
  const recentSelectionKeys = new Set<string>()
  let stats: PageStats = {
    replacements: 0,
    records: 0,
    enabled: false,
    showFloatingStatus: true,
  }

  async function refreshStats() {
    const { settings, records } = await getStoredState()
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
    const candidatePool = createReplacementCandidatePool(settings, records)
      .filter(canAutoReplaceCandidate)
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
      const changedCandidates = replaceTextNode(node, matches)
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
      enabled: pageTranslationEnabled,
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
        translation: target.priority === 'viewport' ? '正在优先翻译当前可视区域...' : '预加载翻译中...',
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

  async function translatePageTargetBatch(settings: LexiSettings, targets: PageTranslationTarget[], memory: PageTranslationMemory) {
    const uniqueTargets = targets.filter(target => !pageTranslationSources.has(target.id) && !pageTranslationInFlight.has(target.id))
    if (!uniqueTargets.length)
      return

    uniqueTargets.forEach(target => pageTranslationInFlight.add(target.id))
    updateTranslationLoadingState(uniqueTargets)

    try {
      const results = await requestPageTranslationBatch(
        settings,
        uniqueTargets.map(target => ({ id: target.id, text: target.text })),
        getPageTranslationContext(uniqueTargets),
      )
      const byId = new Map(results.map(item => [item.id, item.translation]))

      for (const target of uniqueTargets) {
        if (!pageTranslationEnabled || disposed)
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
          ?? insertPageTranslationElement(target.element, block, { priority: target.priority })
        updatePageTranslationElement(element, block)
        pageTranslationSources.set(block.id, block)
        memory[target.memoryKey] = {
          ...block,
          url: normalizePageTranslationUrl(),
          host: location.hostname,
          direction: settings.selection.translationDirection,
          updatedAt: Date.now(),
        }
      }

      await savePageTranslationSnapshot(settings)
      await savePageTranslationMemory(prunePageTranslationMemory(memory, settings))
    }
    finally {
      uniqueTargets.forEach((target) => {
        pageTranslationInFlight.delete(target.id)
        if (!pageTranslationSources.has(target.id)) {
          const element = getPageTranslationElementAfter(target.element, target.id)
          if (element?.dataset.lexiLoading === 'true')
            element.remove()
        }
      })
    }
  }

  async function runPageTranslation(settings: LexiSettings, runId: number) {
    if (pageTranslationRunning)
      return

    ensurePageStyles(settings.ui.customCss)
    pageTranslationRunning = true
    pageTranslationScanPending = false

    try {
      const remainingPageBudget = Math.max(0, settings.selection.pageTranslation.maxBlocksPerPage - pageTranslationSources.size - pageTranslationInFlight.size)
      if (remainingPageBudget <= 0)
        return

      const limit = Math.min(getPageTranslationLimit(settings), remainingPageBudget)
      const targets = getPageTranslationTargets(settings, limit)
      if (!targets.length)
        return

      const memory = await readPageTranslationMemory()
      const uncachedTargets: PageTranslationTarget[] = []

      for (const target of targets) {
        if (!pageTranslationEnabled || runId !== pageTranslationRunId)
          break

        const cached = pageTranslationSources.get(target.id)
        if (cached) {
          insertPageTranslationElement(target.element, { ...cached, priority: target.priority }, { priority: target.priority })
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
          insertPageTranslationElement(target.element, block, { priority: target.priority })
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
        await translatePageTargetBatch(settings, batch, memory)
      }
    }
    finally {
      pageTranslationRunning = false
    }

    if (pageTranslationScanPending && pageTranslationEnabled && runId === pageTranslationRunId)
      schedulePageTranslationScan(settings, 260)
  }

  function schedulePageTranslationScan(settings: LexiSettings, delay = 700) {
    if (!pageTranslationEnabled)
      return

    if (pageTranslationRunning) {
      pageTranslationScanPending = true
      return
    }

    window.clearTimeout(pageTranslationTimer)
    pageTranslationTimer = window.setTimeout(() => {
      runPageTranslation(settings, pageTranslationRunId)
        .catch(error => console.warn('[Lexi] page translation failed', error))
    }, delay)
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

  async function startPageTranslation() {
    if (pageTranslationEnabled)
      return { ok: true, message: '当前页面自动翻译已启用。', blocks: pageTranslationSources.size }

    const { settings } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return { ok: false, message: '划词翻译场景未启用。', blocks: 0 }

    const activation = createPageTranslationActivation(settings)
    if (!activation)
      return { ok: false, message: '自动翻译 Regex 无效或为空，请在设置中修正。', blocks: 0 }

    const cache = await restorePageTranslationCache(settings, true)
    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    pageTranslationActivation = activation
    pageTranslationEnabled = true
    pageTranslationRunId += 1
    await savePageTranslationActivation(activation)
    await savePageTranslationSnapshot(settings)
    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 0)

    const scopeLabel = activation.scope === 'site' ? '当前站点' : activation.scope === 'regex' ? 'Regex 匹配页面' : '当前链接'
    return { ok: true, message: `已启用${scopeLabel}自动翻译：可视区域优先，后续滚动会预加载。`, blocks: pageTranslationSources.size }
  }

  async function stopPageTranslation() {
    pageTranslationRunId += 1
    pageTranslationEnabled = false
    pageTranslationRunning = false
    pageTranslationScanPending = false
    pageTranslationInFlight.clear()
    window.clearTimeout(pageTranslationTimer)
    pageTranslationObserver?.disconnect()
    window.removeEventListener('scroll', onPageScroll)
    removePageTranslationElements()
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

    if (pageTranslationActivation)
      await removePageTranslationActivation(pageTranslationActivation)
    pageTranslationActivation = undefined

    return { ok: true, message: '已停止当前自动翻译范围。' }
  }

  async function getPageTranslationStatus() {
    const cache = await readPageTranslationCache()
    const activation = pageTranslationActivation ?? await findMatchingPageTranslationActivation()
    return {
      ok: true,
      enabled: Boolean(pageTranslationEnabled || activation || cache?.enabled),
      scope: pageTranslationEnabled ? pageTranslationActivation?.scope : activation?.scope,
      blocks: pageTranslationSources.size || cache?.blocks.length || 0,
      cached: Boolean(pageTranslationSources.size || cache?.blocks.length),
      bytes: cache ? new Blob([JSON.stringify(cache)]).size : 0,
    }
  }

  async function restoreSavedPageTranslation() {
    const { settings } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return

    const activation = await findMatchingPageTranslationActivation()
    const cache = await restorePageTranslationCache(settings, Boolean(activation))
    if (!activation && !cache?.enabled)
      return

    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    pageTranslationActivation = activation ?? createPageTranslationActivation(settings)
    pageTranslationEnabled = true
    pageTranslationRunId += 1
    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 220)
  }

  async function queueAiReplacementSeeds(settings: LexiSettings, seeds: ReplacementSeed[], currentEvents: EnhancerEvents) {
    let { records } = await getStoredState()
    let changed = false

    for (const seed of seeds) {
      if (disposed)
        return

      try {
        const candidates = await requestReplacementCandidates(settings, seed.text, seed.context)
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
    stats.records = records.length
    currentEvents.onStats(stats)
  }

  function closeMediaToolbar() {
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
    const response = await sendMessage('lexi-download-media', {
      url: state.src,
      filename,
    }, 'background') as { ok?: boolean, error?: string }
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
    highlight.append(Object.assign(document.createElement('span'), { className: 'lexi-media-highlight__shine' }))
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

    head.append(title, close)
    actions.append(analyze, copy, download)
    toolbar.append(head, meta, actions, answer)
    document.documentElement.append(highlight, toolbar)
    mediaToolbarState = { ...info, toolbar, highlight, answer, copy }
    positionMediaUi(mediaToolbarState)
  }

  async function translateAndRecord(selected: string, context: string, range: Range | undefined, requestId: number, requestKey: string) {
    const { settings, records } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return

    const block = createSelectionTranslationBlock(settings, selected, requestKey, range)
    let translationVisible = false
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
    translationVisible = true
    activeSelectionBlock = undefined

    let detailView: SelectionDetailView = { terms: [] }
    let detailText = ''
    let detailCandidate: VocabularyCandidate | undefined
    try {
      const detail = await requestSelectionDetail(settings, selected, translation.translation, context)
      if (requestId !== selectionRequestId) {
        if (!translationVisible)
          block.remove()
        return
      }
      detailView = normalizeSelectionDetail(detail)
      detailText = formatSelectionDetail(detailView)
      detailCandidate = detail?.candidate
      if (detailText)
        updateTranslation(translation, detailText)
    }
    catch {
      if (looksTechnicalTerm(selected)) {
        detailText = '技术名词：已加入本地词库。'
        updateTranslation(translation, detailText)
      }
    }

    if (requestId !== selectionRequestId) {
      if (!translationVisible)
        block.remove()
      return
    }

    lastTranslation = {
      selected,
      translation: translation.translation,
      detail: detailText,
      context,
    }

    if (!settings.history.enabled)
      return

    const validDetailCandidate = detailCandidate && canAutoReplaceCandidate(detailCandidate)
      ? detailCandidate
      : undefined
    const termCandidates = detailView.terms
      .map(term => createCandidateFromTerm(translation, term))
      .filter((candidate): candidate is VocabularyCandidate => candidate != null)
    const candidate = validDetailCandidate
      ?? termCandidates[0]
      ?? (looksTechnicalTerm(selected) ? createTechnicalCandidate(translation, detailText) : createManualCandidate(translation))
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

  const onPointerDown = (event: PointerEvent) => {
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

  const onMouseUp = (event: MouseEvent) => {
    selectionPointerDown = false
    selectionFinalizedAt = performance.now()
    selectionFinalizedWithModifier = selectionModifierPressed(event)
    if (tryShowMediaToolbarFromEvent(event))
      return

    scheduleSelectionCheck(360)
    window.setTimeout(() => {
      if (!disposed && getSelectionSnapshot())
        handleSelection().catch(error => console.warn('[Lexi] selection mouseup fallback failed', error))
    }, 80)
  }

  const onPointerUp = (event: PointerEvent) => {
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
    if (event.key.startsWith('Arrow') || event.key === 'Shift') {
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
        dialog = createLexiDialog(settings, lastTranslation) ?? dialog
      })
      .catch(error => console.warn('[Lexi] dialog failed', error))
  }

  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape')
      return

    const currentDialog = document.querySelector<HTMLElement>('[data-lexi-dialog]')
    if (currentDialog)
      closeLexiDialog(currentDialog)
    if (mediaToolbarState)
      closeMediaToolbar()
  }

  const onPointerOver = (event: MouseEvent | PointerEvent) => {
    const token = getTokenFromEvent(event)
    if (!token)
      return

    if (!tooltip)
      tooltip = createTooltip()

    const productPrefix = token.dataset.lexiProduct === 'true' ? '产品 / 工具 · ' : ''
    const replacementLine = token.dataset.lexiProduct === 'true'
      ? `${token.dataset.original} · ${productPrefix}${token.dataset.meaning}`
      : `${token.dataset.original} → ${token.dataset.replacement} · ${token.dataset.meaning}`
    const tagsLine = token.dataset.tags ? `\n标签：${token.dataset.tags}` : ''
    tooltip.textContent = `${replacementLine}\n${token.dataset.example}${tagsLine}`
    tooltip.hidden = false
    moveTooltip(tooltip, event)
  }

  const onPointerMove = (event: MouseEvent | PointerEvent) => {
    if (tooltip && !tooltip.hidden)
      moveTooltip(tooltip, event)
  }

  const onPointerOut = (event: MouseEvent | PointerEvent) => {
    const token = getTokenFromEvent(event)
    if (!token || !tooltip)
      return

    const related = event.relatedTarget
    if (related instanceof Node && token.contains(related))
      return

    tooltip.hidden = true
  }

  function onPageScroll() {
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

  const removeContextTranslateListener = onMessage('lexi-context-translate', async ({ data }) => {
    const selected = data.text.trim()
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

  const removePageTranslateStartListener = onMessage('lexi-page-translate-start', () => {
    return startPageTranslation()
  })

  const removePageTranslateStopListener = onMessage('lexi-page-translate-stop', () => {
    return stopPageTranslation()
  })

  const removePageTranslateStatusListener = onMessage('lexi-page-translate-status', () => {
    return getPageTranslationStatus()
  })

  const removePageStatsListener = onMessage('lexi-page-stats', async () => {
    await refreshStats()
    return stats
  })

  const onStorageChanged = (changes: Record<string, browser.Storage.StorageChange>, areaName: string) => {
    if (areaName === 'local' && changes[settingsStorageKey])
      refreshStats()
  }

  browser.storage.local.get(settingsStorageKey).then((stored) => {
    if (!stored[settingsStorageKey])
      browser.storage.local.set({ [settingsStorageKey]: JSON.stringify(defaultSettings) })
  })

  run()
  restoreSavedPageTranslation().catch(error => console.warn('[Lexi] restore page translation failed', error))
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onMediaClickCapture, true)
  document.addEventListener('auxclick', onMediaClickCapture, true)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('pointerup', onPointerUp)
  window.addEventListener('scroll', onPageScroll, { passive: true, capture: true })
  window.addEventListener('mouseup', onMouseUp, true)
  window.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keydown', onEscape)
  window.addEventListener('resize', onPageScroll)
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('mouseover', onPointerOver, true)
  document.addEventListener('mousemove', onPointerMove, true)
  document.addEventListener('mouseout', onPointerOut, true)
  browser.storage.onChanged.addListener(onStorageChanged)

  void getStoredState().then(({ settings }) => {
    if (!getReplacementBudget(settings, detectSpecialSiteHints()).dynamicScan)
      return

    dynamicObserver = new MutationObserver(() => {
      window.clearTimeout(dynamicTimer)
      dynamicTimer = window.setTimeout(() => {
        run().catch(error => console.warn('[Lexi] dynamic scan failed', error))
      }, 900)
    })
    dynamicObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })
  })

  return () => {
    disposed = true
    dynamicObserver?.disconnect()
    pageTranslationObserver?.disconnect()
    window.clearTimeout(dynamicTimer)
    window.clearTimeout(selectionTimer)
    window.clearTimeout(pageTranslationTimer)
    removeContextTranslateListener()
    removePageTranslateStartListener()
    removePageTranslateStopListener()
    removePageTranslateStatusListener()
    removePageStatsListener()
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('click', onMediaClickCapture, true)
    document.removeEventListener('auxclick', onMediaClickCapture, true)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keydown', onEscape)
    window.removeEventListener('resize', onPageScroll)
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    document.removeEventListener('pointerout', onPointerOut, true)
    document.removeEventListener('mouseover', onPointerOver, true)
    document.removeEventListener('mousemove', onPointerMove, true)
    document.removeEventListener('mouseout', onPointerOut, true)
    window.removeEventListener('scroll', onPageScroll)
    browser.storage.onChanged.removeListener(onStorageChanged)
    tooltip?.remove()
    dialog?.remove()
    closeMediaToolbar()
  }
}
