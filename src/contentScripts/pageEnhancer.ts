import browser from 'webextension-polyfill'
import { localTranslateSelection, requestReplacementCandidates, requestSelectionTranslation } from '~/logic/aiClient'
import { defaultSettings, mergeSettings } from '~/logic/defaults'
import { isPageEnabled } from '~/logic/siteRules'
import { settingsStorageKey, vocabularyStorageKey } from '~/logic/storageKeys'
import { findCandidateByChinese } from '~/logic/vocabularyBank'
import { upsertVocabularyRecord } from '~/logic/vocabularyRecords'
import type { LexiSettings, SelectionTranslation, VocabularyCandidate, VocabularyRecord } from '~/logic/types'

interface EnhancerEvents {
  onSelection: (translation: SelectionTranslation, position: { x: number, y: number }) => void
  onStats: (stats: PageStats) => void
}

export interface PageStats {
  replacements: number
  records: number
  enabled: boolean
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
]

function textNodeAllowed(node: Text) {
  const parent = node.parentElement
  if (!parent)
    return false

  return !ignoredSelectors.some(selector => parent.closest(selector))
}

function pickCandidates(text: string, settings: LexiSettings) {
  const local = findCandidateByChinese(text, settings.replacement.difficulty)
  const limit = Math.max(1, Math.round(local.length * settings.replacement.density))
  return local
    .map(candidate => ({ candidate, score: Math.random() + candidate.difficulty / 10 }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.candidate)
    .slice(0, limit)
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

function ensurePageStyles() {
  if (document.getElementById('lexi-page-style'))
    return

  const style = document.createElement('style')
  style.id = 'lexi-page-style'
  style.textContent = `
    .lexi-token {
      border-bottom: 1px dashed #2563eb;
      color: #1d4ed8;
      cursor: help;
      text-decoration: none;
    }

    .lexi-token:hover {
      background: rgba(37, 99, 235, 0.09);
    }

    .lexi-token:hover::after {
      content: attr(data-original) " · " attr(data-meaning) "\\A" attr(data-example);
      position: absolute;
      z-index: 2147483647;
      max-width: min(360px, calc(100vw - 32px));
      margin-top: 1.5em;
      margin-left: -0.5em;
      white-space: pre-wrap;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      color: #1f2937;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
      padding: 10px 12px;
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  `
  document.documentElement.appendChild(style)
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

async function getStoredState() {
  const stored = await browser.storage.local.get([settingsStorageKey, vocabularyStorageKey])
  const settings = mergeSettings(stored[settingsStorageKey] as Partial<LexiSettings> | undefined)
  const records = Array.isArray(stored[vocabularyStorageKey])
    ? stored[vocabularyStorageKey] as VocabularyRecord[]
    : []

  return { settings, records }
}

async function saveRecords(records: VocabularyRecord[]) {
  await browser.storage.local.set({ [vocabularyStorageKey]: records })
}

function getContextText(node: Text) {
  const text = node.parentElement?.textContent?.trim() ?? node.nodeValue ?? ''
  return text.replace(/\s+/g, ' ').slice(0, 420)
}

async function translateSelection(settings: LexiSettings, selected: string, context: string) {
  try {
    const ai = await requestSelectionTranslation(settings, selected, context)
    if (ai)
      return ai
  }
  catch (error) {
    console.warn('[Lexi] AI selection translation failed', error)
  }

  return localTranslateSelection(selected)
}

export function startPageEnhancer(events: EnhancerEvents) {
  let disposed = false
  let stats: PageStats = {
    replacements: 0,
    records: 0,
    enabled: false,
  }

  async function run() {
    const { settings, records } = await getStoredState()
    const enabled = isPageEnabled(settings) && settings.replacement.enabled
    stats = {
      replacements: 0,
      records: records.length,
      enabled,
    }

    if (!enabled) {
      events.onStats(stats)
      return
    }

    ensurePageStyles()

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
    for (const node of textNodes) {
      if (stats.replacements >= settings.replacement.maxPerPage)
        break

      const context = getContextText(node)
      let candidates = pickCandidates(node.nodeValue ?? '', settings)

      if (!candidates.length && settings.ai.replacement.enabled) {
        try {
          candidates = await requestReplacementCandidates(settings, node.nodeValue ?? '', context)
        }
        catch (error) {
          console.warn('[Lexi] AI replacement failed', error)
        }
      }

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

    if (nextRecords !== records)
      await saveRecords(nextRecords)

    stats.records = nextRecords.length
    events.onStats(stats)
  }

  async function handleSelection() {
    if (disposed)
      return

    const selection = window.getSelection()
    const selected = selection?.toString().trim()
    if (!selection || !selected || selected.length < 2 || selected.length > 160)
      return

    const { settings, records } = await getStoredState()
    if (!isPageEnabled(settings) || !settings.selection.enabled || !settings.selection.autoTranslate)
      return

    const range = selection.rangeCount ? selection.getRangeAt(0) : undefined
    const rect = range?.getBoundingClientRect()
    const context = range?.commonAncestorContainer.textContent?.replace(/\s+/g, ' ').slice(0, 420) ?? selected
    const translation = await translateSelection(settings, selected, context)

    const nextRecords = upsertVocabularyRecord(records, {
      candidate: createManualCandidate(translation),
      source: 'manual',
      pageUrl: location.href,
      pageTitle: document.title,
      context,
    })
    await saveRecords(nextRecords)
    stats.records = nextRecords.length
    events.onStats(stats)

    events.onSelection(translation, {
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.bottom + 12 : window.innerHeight / 2,
    })
  }

  const onMouseUp = () => {
    window.setTimeout(handleSelection, 120)
  }

  browser.storage.local.get(settingsStorageKey).then((stored) => {
    if (!stored[settingsStorageKey])
      browser.storage.local.set({ [settingsStorageKey]: defaultSettings })
  })

  run()
  document.addEventListener('mouseup', onMouseUp)

  return () => {
    disposed = true
    document.removeEventListener('mouseup', onMouseUp)
  }
}
