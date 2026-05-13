import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/content-script'
import { localTranslateSelection, requestLexiDialogAnswer, requestReplacementCandidates, requestSelectionDetail, requestSelectionTranslation } from '~/logic/aiClient'
import { recordPageVisit } from '~/logic/analytics'
import { defaultSettings, mergeSettings } from '~/logic/defaults'
import { findSpecialSiteProfile, isPageEnabled, isSceneEnabled } from '~/logic/siteRules'
import type { SiteDetectionHints } from '~/logic/siteRules'
import { pageTranslationsStorageKey, settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { programmerVocabulary } from '~/logic/vocabularyBank'
import { getVocabularyId, isProductVocabularyCandidate, upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, PageTranslationBlock, PageTranslationCache, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

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
  '[data-lexi-github-digest]',
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

function textNodeAllowed(node: Text) {
  const parent = node.parentElement
  if (!parent)
    return false

  return !isLexiIgnoredElement(parent)
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
  if (isChineseTerm && !isConciseEnglishReplacement(term.term, replacement))
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

function createToken(candidate: VocabularyCandidate) {
  const token = document.createElement('span')
  const isProduct = isProductVocabularyCandidate(candidate)
  token.dataset.lexiToken = 'true'
  token.dataset.original = candidate.original
  token.dataset.replacement = candidate.replacement
  token.dataset.meaning = candidate.meaning
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
      border-bottom: 1px dashed #2563eb;
      color: #1d4ed8;
      cursor: help;
      text-decoration: none;
    }

    .lexi-token:hover {
      background: rgba(37, 99, 235, 0.09);
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
      background: #2563eb;
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
      color: #2563eb;
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
      margin: 0.55em 0;
      border-left: 3px solid #0ea5e9;
      background: rgba(14, 165, 233, 0.08);
      padding: 0.55em 0.7em;
      color: #0f172a;
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

    .lexi-dialog__context,
    .lexi-dialog__answer {
      position: relative;
      max-height: 150px;
      overflow: auto;
      border: 1px solid rgba(203, 213, 225, 0.72);
      background: rgba(248, 250, 252, 0.72);
      padding: 11px 12px;
      color: #525252;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog__context {
      background:
        linear-gradient(90deg, rgba(99, 102, 241, 0.07), transparent 22%),
        rgba(248, 250, 252, 0.72);
      color: #4b5563;
    }

    .lexi-dialog__answer {
      max-height: 220px;
      border-color: rgba(129, 140, 248, 0.28);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(248, 250, 252, 0.74));
      color: #111827;
      font-size: 13px;
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

function getPageTranslationCacheKey() {
  return `${pageTranslationsStorageKey}:${location.href}`
}

function createPageTranslationBlockId(text: string) {
  return createSelectionDomKey(text)
}

function createPageTranslationElement(block: PageTranslationBlock) {
  const element = document.createElement('div')
  element.dataset.lexiPageTranslation = 'true'
  element.dataset.lexiPageTranslationId = block.id
  element.className = 'lexi-page-translation'
  element.textContent = block.translation
  return element
}

function hasPageTranslationElementAfter(element: HTMLElement, blockId: string) {
  return element.nextElementSibling instanceof HTMLElement
    && element.nextElementSibling.dataset.lexiPageTranslationId === blockId
}

function insertPageTranslationElement(target: HTMLElement, block: PageTranslationBlock) {
  if (hasPageTranslationElementAfter(target, block.id))
    return

  target.insertAdjacentElement('afterend', createPageTranslationElement(block))
}

function removePageTranslationElements() {
  document
    .querySelectorAll<HTMLElement>('[data-lexi-page-translation]')
    .forEach(element => element.remove())
}

function getPageTranslationTargets(limit = 12) {
  const selectors = location.hostname.includes('x.com') || location.hostname.includes('twitter.com')
    ? '[data-testid="tweetText"], article div[lang]'
    : 'article p, article div[lang], main p, main li, p, li'
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selectors))
  const seen = new Set<string>()
  const targets: Array<{ element: HTMLElement, text: string, id: string }> = []

  for (const element of elements) {
    if (targets.length >= limit)
      break

    if (isLexiIgnoredElement(element))
      continue

    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text.length < 24 || text.length > 600 || seen.has(text))
      continue

    const id = createPageTranslationBlockId(text)
    if (hasPageTranslationElementAfter(element, id))
      continue

    seen.add(text)
    targets.push({
      element,
      text,
      id,
    })
  }

  return targets
}

async function readPageTranslationCache() {
  const stored = await browser.storage.local.get(getPageTranslationCacheKey())
  return readJsonValue<PageTranslationCache | undefined>(stored[getPageTranslationCacheKey()], undefined)
}

async function savePageTranslationCache(cache: PageTranslationCache) {
  await browser.storage.local.set({ [getPageTranslationCacheKey()]: JSON.stringify(cache) })
}

async function restorePageTranslationCache(settings: LexiSettings) {
  const cache = await readPageTranslationCache()
  if (!cache?.enabled || !cache.blocks.length)
    return

  ensurePageStyles(settings.ui.customCss)
  removePageTranslationElements()
  const targets = getPageTranslationTargets(cache.blocks.length + 4)
  for (const block of cache.blocks) {
    const target = targets.find(item => item.id === block.id || item.text === block.source)
    if (!target)
      continue

    insertPageTranslationElement(target.element, block)
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

function renderSelectionTranslationText(container: HTMLElement, text: string, previousText: string, revealChunk: boolean) {
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
        renderSelectionTranslationText(text, nextText, previousText, !wasLoading)
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
  const anchor = getCurrentDialogAnchor()
  const dialog = document.createElement('section')
  const head = document.createElement('div')
  const title = document.createElement('div')
  const close = document.createElement('button')
  const body = document.createElement('div')
  const contextBlock = document.createElement('div')
  const answer = document.createElement('div')
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
  answer.className = 'lexi-dialog__answer'
  form.className = 'lexi-dialog__form'
  input.className = 'lexi-dialog__input'
  button.className = 'lexi-dialog__button'

  title.textContent = 'Lexi 对话'
  close.type = 'button'
  close.textContent = '×'
  contextBlock.textContent = renderDialogContext(context) || '当前页面暂无可用上下文。'
  answer.textContent = context.selected
    ? '输入问题后，Lexi 会结合当前翻译、页面内容和上下文回答。'
    : '未检测到选区。现在会基于整个页面内容回答，你可以直接提问。'
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

    answer.textContent = '思考中...'
    button.setAttribute('disabled', 'true')
    requestLexiDialogAnswer(settings, question, context, text => answer.textContent = text)
      .then((text) => {
        if (text)
          answer.textContent = text
      })
      .catch((error) => {
        answer.textContent = error instanceof Error ? error.message : '请求失败'
      })
      .finally(() => {
        button.removeAttribute('disabled')
      })
  })

  head.append(title, close)
  form.append(input, button)
  body.append(contextBlock, form, answer)
  dialog.append(head, body)
  document.documentElement.appendChild(dialog)
  positionLexiDialog(dialog, anchor)
  const reposition = () => positionLexiDialog(dialog, anchor)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, true)
  dialog.addEventListener('lexi-dialog-close', () => {
    window.removeEventListener('resize', reposition)
    window.removeEventListener('scroll', reposition, true)
  }, { once: true })
  input.focus()

  return dialog
}

function shortcutMatches(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.toLowerCase().split('+').map(part => part.trim()).filter(Boolean)
  const key = parts.at(-1)
  if (!key)
    return false

  const wantsMod = parts.includes('mod')
  const wantsCtrl = parts.includes('ctrl') || parts.includes('control')
  const wantsMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
  const wantsAlt = parts.includes('alt') || parts.includes('option')
  const wantsShift = parts.includes('shift')

  return event.key.toLowerCase() === key
    && (!wantsMod || event.metaKey || event.ctrlKey)
    && (!wantsCtrl || event.ctrlKey)
    && (!wantsMeta || event.metaKey)
    && (!wantsAlt || event.altKey)
    && (!wantsShift || event.shiftKey)
}

function isMacPlatform() {
  return /\bMac|iPhone|iPad|iPod\b/i.test(navigator.platform)
}

function selectionModifierPressed(event: MouseEvent | PointerEvent | KeyboardEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
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
  let lastTranslation: LastTranslationState | undefined
  let dialogShortcut = defaultSettings.ui.dialogShortcut
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
  const pageTranslationSources = new Map<string, PageTranslationBlock>()
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
    events.onStats(stats)
  }

  async function run() {
    const { settings, records } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    const enabled = pageFeatureEnabled(settings, siteHints)
    const replacementEnabled = settings.replacement.enabled && isSceneEnabled(settings, 'replacement', location.href, siteHints)
    const budget = getReplacementBudget(settings, siteHints)
    dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
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

  async function savePageTranslationSnapshot() {
    const blocks = [...pageTranslationSources.values()]
    await savePageTranslationCache({
      url: location.href,
      title: document.title,
      enabled: pageTranslationEnabled,
      blocks,
      updatedAt: Date.now(),
    })
  }

  async function runPageTranslation(settings: LexiSettings, runId: number) {
    if (pageTranslationRunning)
      return

    ensurePageStyles(settings.ui.customCss)
    pageTranslationRunning = true
    pageTranslationScanPending = false

    try {
      const targets = getPageTranslationTargets(16)
      for (const target of targets) {
        if (!pageTranslationEnabled || runId !== pageTranslationRunId)
          break

        const cached = pageTranslationSources.get(target.id)
        if (cached) {
          insertPageTranslationElement(target.element, cached)
          continue
        }

        if (hasPageTranslationElementAfter(target.element, target.id))
          continue

        const placeholderElement = createPageTranslationElement({
          id: target.id,
          source: target.text,
          translation: '翻译中...',
        })
        target.element.insertAdjacentElement('afterend', placeholderElement)

        const translation = await translateSelection(settings, target.text, target.text)
        if (!pageTranslationEnabled || runId !== pageTranslationRunId) {
          placeholderElement.remove()
          break
        }

        const block: PageTranslationBlock = {
          id: target.id,
          source: target.text,
          translation: translation.translation,
        }
        placeholderElement.textContent = block.translation
        pageTranslationSources.set(block.id, block)
        await savePageTranslationSnapshot()
      }
    }
    finally {
      pageTranslationRunning = false
    }

    if (pageTranslationScanPending && pageTranslationEnabled && runId === pageTranslationRunId)
      schedulePageTranslationScan(settings, 300)
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
    window.removeEventListener('scroll', onPageTranslationScroll)
    window.addEventListener('scroll', onPageTranslationScroll, { passive: true })
  }

  async function startPageTranslation() {
    if (pageTranslationEnabled)
      return { ok: true, message: '当前页面自动翻译已启用。', blocks: pageTranslationSources.size }

    const { settings } = await getStoredState()
    const siteHints = detectSpecialSiteHints()
    if (!isSceneEnabled(settings, 'selection', location.href, siteHints) || !settings.selection.enabled)
      return { ok: false, message: '划词翻译场景未启用。', blocks: 0 }

    const cache = await readPageTranslationCache()
    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    pageTranslationEnabled = true
    pageTranslationRunId += 1
    await savePageTranslationSnapshot()
    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 0)

    return { ok: true, message: '已启用当前页面自动翻译，结果会逐段插入并保存。', blocks: 0 }
  }

  async function stopPageTranslation() {
    pageTranslationRunId += 1
    pageTranslationEnabled = false
    pageTranslationRunning = false
    pageTranslationScanPending = false
    window.clearTimeout(pageTranslationTimer)
    pageTranslationObserver?.disconnect()
    window.removeEventListener('scroll', onPageTranslationScroll)
    removePageTranslationElements()
    const cache = await readPageTranslationCache()
    pageTranslationSources.clear()
    for (const block of cache?.blocks ?? [])
      pageTranslationSources.set(block.id, block)

    await savePageTranslationCache({
      url: location.href,
      title: document.title,
      enabled: false,
      blocks: [...pageTranslationSources.values()],
      updatedAt: Date.now(),
    })

    return { ok: true, message: '已停止当前页面自动翻译。' }
  }

  async function getPageTranslationStatus() {
    const cache = await readPageTranslationCache()
    return {
      ok: true,
      enabled: Boolean(pageTranslationEnabled || cache?.enabled),
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

    const cache = await restorePageTranslationCache(settings)
    if (!cache?.enabled)
      return

    pageTranslationSources.clear()
    for (const block of cache.blocks)
      pageTranslationSources.set(block.id, block)

    pageTranslationEnabled = true
    pageTranslationRunId += 1
    ensurePageTranslationWatcher(settings)
    schedulePageTranslationScan(settings, 500)
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
    if (!selection || !selected || selected.length < 2 || selected.length > 600)
      return

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

  const onPointerDown = () => {
    selectionPointerDown = true
    selectionFinalizedAt = 0
    selectionFinalizedWithModifier = false
    selectionChangingSince = performance.now()
    window.clearTimeout(selectionTimer)
  }

  const onMouseUp = (event: MouseEvent) => {
    selectionPointerDown = false
    selectionFinalizedAt = performance.now()
    selectionFinalizedWithModifier = selectionModifierPressed(event)
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
  }

  const onPointerOver = (event: PointerEvent) => {
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

  const onPointerMove = (event: PointerEvent) => {
    if (tooltip && !tooltip.hidden)
      moveTooltip(tooltip, event)
  }

  const onPointerOut = (event: PointerEvent) => {
    const token = getTokenFromEvent(event)
    if (!token || !tooltip)
      return

    const related = event.relatedTarget
    if (related instanceof Node && token.contains(related))
      return

    tooltip.hidden = true
  }

  function onPageTranslationScroll() {
    if (!pageTranslationEnabled)
      return

    getStoredState()
      .then(({ settings }) => schedulePageTranslationScan(settings, 500))
      .catch(error => console.warn('[Lexi] page translation scroll scan failed', error))
  }

  const removeContextTranslateListener = onMessage('lexi-context-translate', async ({ data }) => {
    const selected = data.text.trim()
    if (!selected)
      return

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
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('pointerup', onPointerUp)
  window.addEventListener('mouseup', onMouseUp, true)
  window.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('keyup', onKeyUp)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keydown', onEscape)
  document.addEventListener('pointerover', onPointerOver)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerout', onPointerOut)
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
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('keyup', onKeyUp)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keydown', onEscape)
    document.removeEventListener('pointerover', onPointerOver)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerout', onPointerOut)
    window.removeEventListener('scroll', onPageTranslationScroll)
    browser.storage.onChanged.removeListener(onStorageChanged)
    tooltip?.remove()
    dialog?.remove()
  }
}
