import browser from 'webextension-polyfill'
import { onMessage } from 'webext-bridge/content-script'
import { localTranslateSelection, requestReplacementCandidates, requestSelectionDetail, requestSelectionTranslation } from '~/logic/aiClient'
import { recordPageVisit } from '~/logic/analytics'
import { defaultSettings, mergeSettings } from '~/logic/defaults'
import { isPageEnabled, isSceneEnabled } from '~/logic/siteRules'
import { settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { findCandidateByChinese } from '~/logic/vocabularyBank'
import { getVocabularyId, upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

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
  '[data-lexi-token]',
  '[data-lexi-selection-translation]',
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

const maxAiReplacementSeedsPerPage = 3
const requestedReplacementSeeds = new Set<string>()

interface ReplacementSeed {
  text: string
  context: string
}

function textNodeAllowed(node: Text) {
  const parent = node.parentElement
  if (!parent)
    return false

  return !ignoredSelectors.some(selector => parent.closest(selector))
}

function pickCandidates(text: string, settings: LexiSettings, records: VocabularyRecord[]) {
  const recorded = records.filter(record => record.difficulty <= settings.replacement.difficulty && text.includes(record.original))
  const local = [...findCandidateByChinese(text, settings.replacement.difficulty), ...recorded]
  const limit = Math.max(1, Math.round(local.length * settings.replacement.density))
  return local
    .map(candidate => ({ candidate, score: Math.random() + candidate.difficulty / 10 }))
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
      color: #111827;
      font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      opacity: 1;
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

function getContextText(node: Text) {
  const text = node.parentElement?.textContent?.trim() ?? node.nodeValue ?? ''
  return text.replace(/\s+/g, ' ').slice(0, 420)
}

function getSelectionBlock(range?: Range) {
  const node = range?.commonAncestorContainer
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest(blockSelectors) ?? element ?? document.body
}

function createSelectionTranslationBlock(settings: LexiSettings, selected: string, range?: Range) {
  ensurePageStyles(settings.ui.customCss)

  const anchor = getSelectionBlock(range)
  const block = document.createElement('div')
  const label = document.createElement('span')
  const text = document.createElement('span')
  const detail = document.createElement('span')

  block.dataset.lexiSelectionTranslation = 'true'
  block.className = 'lexi-selection-translation'
  label.className = 'lexi-selection-translation__label'
  text.className = 'lexi-selection-translation__text'
  detail.className = 'lexi-selection-translation__detail'
  label.textContent = 'Lexi 翻译'
  text.textContent = `翻译中：${selected}`

  block.append(label, text, detail)
  anchor.insertAdjacentElement('afterend', block)

  return (translation: SelectionTranslation, detailText?: string) => {
    text.textContent = translation.translation
    if (detailText)
      detail.textContent = detailText
  }
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
  catch (error) {
    console.warn('[Lexi] AI selection translation failed', error)
  }

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
    events.onStats(stats)
  }

  async function run() {
    const { settings, records } = await getStoredState()
    const enabled = pageFeatureEnabled(settings)
    const replacementEnabled = settings.replacement.enabled && isSceneEnabled(settings, 'replacement')
    stats = {
      replacements: 0,
      records: records.length,
      enabled,
      showFloatingStatus: settings.ui.showFloatingStatus,
    }

    if (!replacementEnabled) {
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
    while (walker.nextNode() && textNodes.length < settings.replacement.maxPerPage * 4)
      textNodes.push(walker.currentNode as Text)

    let nextRecords = records
    const aiReplacementSeeds: ReplacementSeed[] = []
    for (const node of textNodes) {
      if (stats.replacements >= settings.replacement.maxPerPage)
        break

      const context = getContextText(node)
      const sourceText = node.nodeValue ?? ''
      let candidates = pickCandidates(sourceText, settings, records)

      if (!candidates.length && settings.ai.replacement.enabled)
        collectReplacementSeed(aiReplacementSeeds, sourceText, context)

      const remaining = settings.replacement.maxPerPage - stats.replacements
      candidates = candidates.slice(0, remaining)
      const changed = replaceTextNode(node, candidates)
      if (!changed)
        continue

      stats.replacements += changed
      for (const candidate of candidates.slice(0, changed)) {
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

  async function translateAndRecord(selected: string, context: string, range?: Range) {
    const { settings, records } = await getStoredState()
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled)
      return

    const updateTranslation = createSelectionTranslationBlock(settings, selected, range)
    const translation = await translateSelection(settings, selected, context, updateTranslation)
    updateTranslation(translation)

    let detailText = ''
    let detailCandidate: VocabularyCandidate | undefined
    try {
      const detail = await requestSelectionDetail(settings, selected, translation.translation, context)
      detailText = [
        detail?.explanation,
        detail?.context ? `上下文：${detail.context}` : '',
      ].filter(Boolean).join('\n')
      detailCandidate = detail?.candidate
      if (detailText)
        updateTranslation(translation, detailText)
    }
    catch (error) {
      if (looksTechnicalTerm(selected)) {
        detailText = '技术名词：已加入本地词库。'
        updateTranslation(translation, detailText)
      }
      console.warn('[Lexi] AI selection detail failed', error)
    }

    if (!settings.history.enabled)
      return

    const candidate = detailCandidate
      ?? (looksTechnicalTerm(selected) ? createTechnicalCandidate(translation, detailText) : createManualCandidate(translation))
    const nextRecords = applyHistoryLimit(upsertVocabularyRecord(records, {
      candidate,
      source: 'manual',
      pageUrl: location.href,
      pageTitle: document.title,
      context,
    }), settings)
    await saveRecords(nextRecords)
    stats.records = nextRecords.length
    stats.showFloatingStatus = settings.ui.showFloatingStatus
    events.onStats(stats)
  }

  async function handleSelection() {
    if (disposed)
      return

    const selection = window.getSelection()
    const selected = selection?.toString().trim()
    if (!selection || !selected || selected.length < 2 || selected.length > 160)
      return

    const { settings } = await getStoredState()
    if (!isSceneEnabled(settings, 'selection') || !settings.selection.enabled || !settings.selection.autoTranslate)
      return

    const range = selection.rangeCount ? selection.getRangeAt(0) : undefined
    const context = range?.commonAncestorContainer.textContent?.replace(/\s+/g, ' ').slice(0, 420) ?? selected
    await translateAndRecord(selected, context, range)
  }

  const onMouseUp = () => {
    window.setTimeout(handleSelection, 120)
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

  const removeContextTranslateListener = onMessage('lexi-context-translate', async ({ data }) => {
    const selected = data.text.trim()
    if (!selected)
      return

    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
    await translateAndRecord(selected, selected, range)
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
  document.addEventListener('mouseup', onMouseUp)
  document.addEventListener('pointerover', onPointerOver)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerout', onPointerOut)
  browser.storage.onChanged.addListener(onStorageChanged)

  return () => {
    disposed = true
    removeContextTranslateListener()
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('pointerover', onPointerOver)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerout', onPointerOut)
    browser.storage.onChanged.removeListener(onStorageChanged)
    tooltip?.remove()
  }
}
