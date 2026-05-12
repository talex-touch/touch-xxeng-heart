import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/content-script'
import { localTranslateSelection, requestLexiDialogAnswer, requestReplacementCandidates, requestSelectionDetail, requestSelectionTranslation } from '~/logic/aiClient'
import { recordPageVisit } from '~/logic/analytics'
import { defaultSettings, mergeSettings } from '~/logic/defaults'
import { findSpecialSiteProfile, isPageEnabled, isSceneEnabled } from '~/logic/siteRules'
import { pageTranslationsStorageKey, settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { findCandidateByChinese } from '~/logic/vocabularyBank'
import { getVocabularyId, upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, PageTranslationBlock, PageTranslationCache, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

interface EnhancerEvents {
  onStats: (stats: PageStats) => void
}

export interface PageStats {
  replacements: number
  records: number
  enabled: boolean
  showFloatingStatus: boolean
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

interface SelectionDetailView {
  explanation?: string
  context?: string
  terms: Array<{
    term: string
    explanation: string
  }>
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

function getCandidateRecord(records: VocabularyRecord[], candidate: VocabularyCandidate) {
  const id = getVocabularyId(candidate.original, candidate.replacement)
  return records.find(record => record.id === id)
    ?? records.find(record => record.original === candidate.original)
}

function dedupeReplacementCandidates(candidates: VocabularyCandidate[]) {
  const byOriginal = new Map<string, VocabularyCandidate>()
  for (const candidate of candidates)
    byOriginal.set(candidate.original.trim().toLowerCase(), candidate)

  return [...byOriginal.values()]
}

function getReplacementCandidates(text: string, settings: LexiSettings, records: VocabularyRecord[]) {
  const recorded = records.filter(record => record.difficulty <= settings.replacement.difficulty && text.includes(record.original))
  return dedupeReplacementCandidates([...findCandidateByChinese(text, settings.replacement.difficulty), ...recorded])
}

function scoreReplacementCandidate(candidate: VocabularyCandidate, records: VocabularyRecord[], randomWeight = 0.65) {
  const record = getCandidateRecord(records, candidate)
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

function scoreTextNodeForReplacement(node: Text, settings: LexiSettings, records: VocabularyRecord[]) {
  const text = node.nodeValue ?? ''
  const candidates = getReplacementCandidates(text, settings, records)
  if (!candidates.length)
    return settings.ai.replacement.enabled ? Math.random() * 0.2 : 0

  return candidates.reduce((total, candidate) => total + scoreReplacementCandidate(candidate, records, 0.2), 0)
    + Math.min(0.4, text.length / 500)
}

function pickCandidates(text: string, settings: LexiSettings, records: VocabularyRecord[], usedOriginals = new Set<string>()) {
  const local = getReplacementCandidates(text, settings, records)
  const limit = Math.max(1, Math.round(local.length * settings.replacement.density))
  const fresh = local.filter(candidate => !usedOriginals.has(candidate.original))
  const source = fresh.length ? fresh : local
  return source
    .map(candidate => ({ candidate, score: scoreReplacementCandidate(candidate, records) }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.candidate)
    .slice(0, limit)
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
    advice?: unknown
    aiSuggestion?: unknown
  }

  return {
    explanation: typeof detail.explanation === 'string' ? detail.explanation.trim() : undefined,
    context: typeof detail.context === 'string' ? detail.context.trim() : undefined,
    terms: Array.isArray(detail.terms)
      ? detail.terms.map(normalizeTerm).filter(item => item != null)
      : [],
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
    detail.context ? `上下文：${detail.context}` : '',
    detail.advice ? `AI 建议：${detail.advice}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function createCandidateFromTerm(translation: SelectionTranslation, term: { term: string, explanation: string }): VocabularyCandidate {
  const isChineseTerm = /[\u4E00-\u9FA5]/.test(term.term)
  return {
    original: isChineseTerm ? term.term : translation.original,
    replacement: isChineseTerm ? translation.translation : term.term,
    meaning: term.explanation,
    example: `Selected on page: ${translation.original}`,
    tags: ['technical', 'selection'],
    difficulty: 2,
  }
}

function createToken(candidate: VocabularyCandidate) {
  const token = document.createElement('span')
  token.dataset.lexiToken = 'true'
  token.dataset.original = candidate.original
  token.dataset.replacement = candidate.replacement
  token.dataset.meaning = candidate.meaning
  token.dataset.example = candidate.example
  token.dataset.tags = candidate.tags.join(', ')
  token.dataset.pronunciation = candidate.pronunciation ?? ''
  token.className = 'lexi-token'
  token.textContent = candidate.replacement
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

    .lexi-token-tooltip {
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483647;
      max-width: min(360px, calc(100vw - 32px));
      white-space: pre-wrap;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
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
      border: 1px solid #bfdbfe;
      border-left: 4px solid #2563eb;
      background: #eff6ff;
      padding: 0.7em 0.85em;
      color: #111827;
      font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
      overflow: hidden;
    }

    .lexi-selection-translation[data-lexi-loading="true"] {
      background: linear-gradient(100deg, #eff6ff 0%, #dbeafe 48%, #eff6ff 100%);
      background-size: 220% 100%;
      animation: lexi-shimmer-surface 900ms ease-in-out infinite;
    }

    .lexi-selection-translation[data-lexi-loading="true"]::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.72) 46%, transparent 78%);
      transform: translateX(-120%);
      animation: lexi-shimmer-sweep 900ms ease-in-out infinite;
      pointer-events: none;
    }

    .lexi-selection-translation__label {
      all: initial;
      display: inline-block;
      box-sizing: border-box;
      margin: 0 0.55em 0.15em 0;
      background: #2563eb;
      color: #fff;
      font-weight: 600;
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 0.15em 0.55em;
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

    @keyframes lexi-text-reveal {
      from {
        opacity: 0;
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
      .lexi-selection-translation__text[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"],
      .lexi-selection-translation[data-lexi-loading="true"]::after {
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
      gap: 10px;
      padding: 14px;
    }

    .lexi-dialog__context,
    .lexi-dialog__answer {
      max-height: 160px;
      overflow: auto;
      border: 1px solid rgba(203, 213, 225, 0.72);
      background: rgba(248, 250, 252, 0.72);
      padding: 10px;
      color: #525252;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .lexi-dialog__answer {
      max-height: 220px;
      background: rgba(255, 255, 255, 0.72);
      color: #111827;
      font-size: 13px;
    }

    .lexi-dialog__form {
      display: flex;
      gap: 8px;
    }

    .lexi-dialog__input {
      min-width: 0;
      flex: 1;
      border: 1px solid rgba(148, 163, 184, 0.78);
      border-radius: 0;
      padding: 10px 11px;
      color: #111827;
      font-size: 14px;
      outline: none;
    }

    .lexi-dialog__button {
      border: 1px solid #312e81;
      border-radius: 0;
      background: linear-gradient(135deg, #111827, #4338ca 58%, #0284c7);
      color: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      padding: 0 14px;
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

function replaceTextNode(node: Text, candidates: VocabularyCandidate[]) {
  if (!candidates.length || !node.parentNode)
    return 0

  let text = node.nodeValue ?? ''
  const fragment = document.createDocumentFragment()
  let count = 0

  const used = new Set<string>()

  while (text) {
    const next = candidates
      .map(candidate => ({ candidate, index: text.indexOf(candidate.original) }))
      .filter(item => item.index >= 0 && !used.has(item.candidate.original))
      .sort((a, b) => a.index - b.index || b.candidate.original.length - a.candidate.original.length)[0]

    if (!next) {
      fragment.append(document.createTextNode(text))
      break
    }

    if (next.index > 0)
      fragment.append(document.createTextNode(text.slice(0, next.index)))

    fragment.append(createToken(next.candidate))
    used.add(next.candidate.original)
    text = text.slice(next.index + next.candidate.original.length)
    count += 1
  }

  node.parentNode.replaceChild(fragment, node)
  return count
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

function pageFeatureEnabled(settings: LexiSettings) {
  return isPageEnabled(settings) && (
    (settings.replacement.enabled && isSceneEnabled(settings, 'replacement'))
    || (settings.selection.enabled && isSceneEnabled(settings, 'selection'))
  )
}

function getReplacementBudget(settings: LexiSettings) {
  const profile = findSpecialSiteProfile(settings)
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

function getSelectionBlock(range?: Range) {
  const endElement = range ? getElementFromRangeEnd(range) : undefined
  const anchor = endElement?.closest<HTMLElement>(selectionAnchorSelectors)
  if (anchor)
    return anchor

  const node = range?.commonAncestorContainer
  const element = node instanceof Element ? node : node?.parentElement
  if (range) {
    const container = document.createElement('span')
    container.dataset.lexiSelectionAnchor = 'true'
    container.style.cssText = 'display:block;height:0;overflow:hidden;'
    try {
      const collapsed = range.cloneRange()
      collapsed.collapse(false)
      collapsed.insertNode(container)
      return container
    }
    catch {}
  }

  return element?.closest(blockSelectors) ?? element ?? document.body
}

function insertAfterSelectionAnchor(anchor: Element, block: HTMLElement) {
  if (anchor instanceof HTMLElement && anchor.dataset.lexiSelectionAnchor === 'true') {
    const parent = anchor.parentElement
    if (parent)
      parent.insertAdjacentElement('afterend', block)
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

function createSelectionTranslationBlock(settings: LexiSettings, selected: string, requestKey: string, range?: Range) {
  ensurePageStyles(settings.ui.customCss)

  const anchor = getSelectionBlock(range)
  const block = document.createElement('div')
  const label = document.createElement('span')
  const text = document.createElement('span')
  const detail = document.createElement('span')

  block.dataset.lexiSelectionTranslation = 'true'
  block.dataset.lexiSelectionKey = requestKey
  block.dataset.lexiLoading = 'true'
  block.className = 'lexi-selection-translation'
  label.className = 'lexi-selection-translation__label'
  text.className = 'lexi-selection-translation__text'
  detail.className = 'lexi-selection-translation__detail'
  label.textContent = 'Lexi 翻译'
  text.textContent = `翻译中：${selected}`
  text.dataset.lexiLoading = 'true'

  block.append(label, text, detail)
  insertAfterSelectionAnchor(anchor, block)
  pruneDuplicateSelectionBlocks(requestKey, block)

  return {
    update(translation: SelectionTranslation, detailText?: string) {
      const wasLoading = text.dataset.lexiLoading === 'true'
      const previousText = text.textContent ?? ''
      const nextText = translation.translation
      text.textContent = translation.translation
      delete block.dataset.lexiLoading
      delete text.dataset.lexiLoading
      if (wasLoading || previousText.length === 0 || nextText.length < previousText.length) {
        text.dataset.lexiRevealing = 'true'
        window.setTimeout(() => {
          delete text.dataset.lexiRevealing
        }, 260)
      }
      if (detailText)
        detail.textContent = detailText
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
  const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined

  return {
    selected: selected || lastTranslation?.selected || '',
    translation: lastTranslation?.translation || '',
    detail: lastTranslation?.detail || '',
    page: getPageContext(range) || lastTranslation?.context || '',
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
  const input = document.createElement('input')
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
  answer.textContent = '输入问题后，Lexi 会结合当前翻译、页面内容和上下文回答。'
  input.placeholder = context.selected ? '解释这段内容，或继续追问...' : '基于当前页面提问...'
  button.type = 'submit'
  button.textContent = '发送'

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
    stats = {
      ...stats,
      records: records.length,
      enabled: pageFeatureEnabled(settings),
      showFloatingStatus: settings.ui.showFloatingStatus,
    }
    dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
    events.onStats(stats)
  }

  async function run() {
    const { settings, records } = await getStoredState()
    const enabled = pageFeatureEnabled(settings)
    const replacementEnabled = settings.replacement.enabled && isSceneEnabled(settings, 'replacement')
    const budget = getReplacementBudget(settings)
    dialogShortcut = settings.ui.dialogShortcut || defaultSettings.ui.dialogShortcut
    stats = {
      replacements: 0,
      records: records.length,
      enabled,
      showFloatingStatus: settings.ui.showFloatingStatus,
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

    const prioritizedTextNodes = textNodes
      .map(node => ({ node, score: scoreTextNodeForReplacement(node, settings, records) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.node)

    let nextRecords = records
    const aiReplacementSeeds: ReplacementSeed[] = []
    const usedOriginals = new Set<string>()
    for (const node of prioritizedTextNodes) {
      if (stats.replacements >= budget.maxPerPage)
        break

      const context = getContextText(node)
      const sourceText = node.nodeValue ?? ''
      let candidates = pickCandidates(sourceText, {
        ...settings,
        replacement: {
          ...settings.replacement,
          density: budget.density,
        },
      }, records, usedOriginals)

      if (!candidates.length && settings.ai.replacement.enabled)
        collectReplacementSeed(aiReplacementSeeds, sourceText, context)

      const remaining = budget.maxPerPage - stats.replacements
      candidates = candidates.slice(0, remaining)
      const changed = replaceTextNode(node, candidates)
      if (!changed)
        continue

      stats.replacements += changed
      for (const candidate of candidates.slice(0, changed)) {
        usedOriginals.add(candidate.original)
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

    if (settings.ai.replacement.enabled && isSceneEnabled(settings, 'replacement') && aiReplacementSeeds.length) {
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
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled)
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
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled)
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
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled)
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

    let detailView: SelectionDetailView = { terms: [] }
    let detailText = ''
    let detailCandidate: VocabularyCandidate | undefined
    try {
      const detail = await requestSelectionDetail(settings, selected, translation.translation, context)
      if (requestId !== selectionRequestId) {
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

    const candidate = detailCandidate
      ?? (detailView.terms[0] ? createCandidateFromTerm(translation, detailView.terms[0]) : undefined)
      ?? (looksTechnicalTerm(selected) ? createTechnicalCandidate(translation, detailText) : createManualCandidate(translation))
    let nextRecords = upsertVocabularyRecord(records, {
      candidate,
      source: 'manual',
      pageUrl: location.href,
      pageTitle: document.title,
      context,
    })

    for (const term of detailView.terms.slice(1, 4)) {
      nextRecords = upsertVocabularyRecord(nextRecords, {
        candidate: createCandidateFromTerm(translation, term),
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
    latestSelectionSnapshot = getSelectionSnapshot()
    if (!selectionChangingSince)
      selectionChangingSince = performance.now()

    const activeDuration = performance.now() - selectionChangingSince
    const stableDelay = delay + Math.min(900, Math.floor(activeDuration / 120) * 120)
    window.clearTimeout(selectionTimer)
    selectionTimer = window.setTimeout(() => {
      if (requireFinalized && (selectionPointerDown || !selectionFinalizedAt))
        return

      const current = getSelectionSnapshot()
      if (!current || current !== latestSelectionSnapshot)
        return

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
    if (!claimSelectionDomLock(domKey))
      return

    cancelActiveSelectionRequest()
    removeSelectionBlocksByKey(domKey)
    activeSelectionKey = selectionKey
    rememberSelectionKey(selectionKey)

    const { settings } = await getStoredState()
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled || !settings.selection.autoTranslate) {
      activeSelectionKey = ''
      return
    }

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
    selectionChangingSince = performance.now()
    cancelActiveSelectionRequest()
    window.clearTimeout(selectionTimer)
  }

  const onMouseUp = () => {
    selectionPointerDown = false
    selectionFinalizedAt = performance.now()
    scheduleSelectionCheck(360)
  }

  const onPointerUp = () => {
    selectionPointerDown = false
    selectionFinalizedAt = performance.now()
    scheduleSelectionCheck(360)
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key.startsWith('Arrow') || event.key === 'Shift') {
      selectionFinalizedAt = performance.now()
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
        if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled)
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

    tooltip.textContent = `${token.dataset.original} · ${token.dataset.meaning}\n${token.dataset.example}`
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
    if (!getReplacementBudget(settings).dynamicScan)
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
