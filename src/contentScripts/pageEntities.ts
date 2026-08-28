import browser from 'webextension-polyfill'
import { sendMessage } from 'webext-bridge/content-script'

import { startRouteWatcher } from '~/contentScripts/ui/routeWatcher'
import type { RouteWatcher } from '~/contentScripts/ui/routeWatcher'
import { requestPageEntities } from '~/logic/aiClient'
import { mergeSettings } from '~/logic/defaults'
import { buildDetectedEntities, collectDomainVotes, findEntityMatches, mergeDetectedEntities, summarizeEntityDomains } from '~/logic/entityDetection'
import { entityDomainColors, entityDomainLabels, entityDomainShortLabels } from '~/logic/entityDomains'
import { createEntityCacheEntry, getEntityCacheKey, getEntityModelFingerprint, getEntitySourceHash, readCachedDomainProfile, resolveEntityCache } from '~/logic/entityCache'
import { detectPageDomain } from '~/logic/pageDomain'
import { listenRuntimeMessage } from '~/logic/runtimeMessaging'
import { isSceneEnabled } from '~/logic/siteRules'
import { pageEntitiesStorageKey, settingsStorageKey } from '~/logic/storageKeys'
import { readJsonValue } from '~/logic/storageJson'
import { withTimeout } from '~/logic/text'
import type { DetectedEntity, EntityCache, EntityCacheEntry, EntityDomain, LexiSettings, PageDomainProfile, PageEntityReport } from '~/logic/types'

/**
 * Entity detection: names the proper nouns on a page and says which field each belongs to.
 *
 * Visually this is the lightest thing Lexi does. The text is never rewritten and never
 * tinted — an entity gets one 4.5px dot in its domain colour and nothing more until the
 * reader points at it. That sits deliberately below the replacement layer, which does
 * change words and therefore earns its underline.
 */

const markAttribute = 'data-lexi-entity'
const styleId = 'lexi-entity-styles'
const maxMarkNodes = 900
const minNodeLength = 24
const maxSampleLength = 9000
const requestTimeoutMs = 25_000
const maxCacheEntries = 120
const maxCacheBytes = 1024 * 1024

const sampleSelectors = 'h1, h2, h3, p, li, blockquote, dd, td, figcaption'

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
  '[role="textbox"]',
  '[data-lexi-token]',
  `[${markAttribute}]`,
  '[data-lexi-selection-translation]',
  '[data-lexi-page-translation]',
  '[data-lexi-dialog]',
  '[data-lexi-content-digest]',
  '[data-lexi-github-digest]',
  '[data-lexi-forum-digest]',
].join(',')

function createEmptyScores(): Record<EntityDomain, number> {
  return { tech: 0, finance: 0, product: 0, medical: 0, legal: 0, academic: 0 }
}

function createEmptyReport(): PageEntityReport {
  return {
    domain: { primary: undefined, confidence: 0, scores: createEmptyScores() },
    entities: [],
    aiAssisted: false,
  }
}

let report = createEmptyReport()
let lastSourceHash = ''
let requestId = 0
let watcher: RouteWatcher | undefined
let tooltip: HTMLElement | undefined
let hideTimer: number | undefined

async function getSettings() {
  const stored = await browser.storage.local.get(settingsStorageKey)
  return mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined))
}

async function getCachedEntry(key: string) {
  const stored = await browser.storage.local.get(pageEntitiesStorageKey)
  return readJsonValue<EntityCache>(stored[pageEntitiesStorageKey], {})[key]
}

async function saveCacheEntry(key: string, entry: EntityCacheEntry) {
  const result = await sendMessage('lexi-upsert-digest-cache', {
    storageKey: pageEntitiesStorageKey,
    cacheKey: key,
    entry: JSON.stringify(entry),
    maxEntries: maxCacheEntries,
    maxBytes: maxCacheBytes,
  }, 'background') as { ok?: boolean, error?: string }
  if (!result.ok)
    throw new Error(result.error || '实体缓存更新失败')
}

function isIgnored(element: Element | null) {
  return !element || Boolean(element.closest(ignoredSelectors))
}

function readHeadings() {
  return Array.from(document.querySelectorAll('h1, h2, h3'))
    .slice(0, 12)
    .map(element => element.textContent?.trim() ?? '')
    .filter(Boolean)
}

/**
 * The text the analysis reads.
 *
 * Taken from block elements rather than from the marking walker on purpose: wrapping a
 * term in a `<span>` leaves `textContent` untouched, so this sample — and the source
 * hash derived from it — stays identical before and after Lexi writes to the page. A
 * sample that shifted when we marked it would make every mutation look like new content
 * and put the rescan into a loop with itself.
 */
function readPageSample() {
  const parts: string[] = []
  let length = 0

  for (const element of Array.from(document.querySelectorAll(sampleSelectors))) {
    if (length >= maxSampleLength)
      break

    if (isIgnored(element.parentElement) || element.closest('nav, header, footer, aside'))
      continue

    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length < minNodeLength)
      continue

    parts.push(text)
    length += text.length
  }

  return parts.join('\n').slice(0, maxSampleLength)
}

/** Text nodes eligible for marking, capped so a very long page cannot stall the tab. */
function collectTextNodes() {
  if (!document.body)
    return []

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if ((node.nodeValue ?? '').trim().length < minNodeLength)
        return NodeFilter.FILTER_REJECT

      return isIgnored(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  while (walker.nextNode() && nodes.length < maxMarkNodes)
    nodes.push(walker.currentNode as Text)

  return nodes
}

function ensureStyles() {
  if (document.getElementById(styleId))
    return

  const domainRules = Object.entries(entityDomainColors)
    .map(([domain, color]) => `[${markAttribute}][data-lexi-domain="${domain}"] { --lexi-entity: ${color.ink}; --lexi-entity-soft: ${color.soft}; }`)
    .join('\n    ')

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    ${domainRules}

    /* The mark changes nothing about the text: same font, same weight, same box. */
    [${markAttribute}] {
      background: transparent;
      color: inherit;
      font: inherit;
      border-radius: 3px;
      cursor: help;
      transition: background-color 0.15s ease;
    }

    [${markAttribute}]::after {
      content: "";
      display: inline-block;
      width: 4.5px;
      height: 4.5px;
      margin-left: 3px;
      border-radius: 50%;
      background: var(--lexi-entity, #8e8e9a);
      vertical-align: 0.18em;
    }

    [${markAttribute}]:hover {
      background: var(--lexi-entity-soft, #f7f7f8);
    }

    .lexi-entity-card {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 2147483646;
      display: grid;
      gap: 8px;
      width: min(320px, calc(100vw - 32px));
      border: 1px solid #e6e6ea;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      backdrop-filter: blur(24px) saturate(180%);
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.16);
      padding: 12px 14px;
      color: #0d0d0d;
      font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
    }

    .lexi-entity-card[data-lexi-open="true"] {
      opacity: 1;
      visibility: visible;
      transform: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .lexi-entity-card * {
      box-sizing: border-box;
      font-family: inherit;
    }

    .lexi-entity-card__head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .lexi-entity-card__term {
      flex: 1;
      min-width: 0;
      font-size: 14.5px;
      font-weight: 700;
      line-height: 1.35;
    }

    .lexi-entity-card__tag {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--lexi-entity-soft, #f7f7f8);
      padding: 3px 9px;
      color: var(--lexi-entity, #5c5c66);
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .lexi-entity-card__expansion {
      color: #5c5c66;
      font-size: 12px;
      font-weight: 600;
    }

    .lexi-entity-card__meaning {
      color: #5c5c66;
      font-size: 12.5px;
      line-height: 1.75;
    }

    .lexi-entity-card__note {
      color: #8e8e9a;
      font-size: 11px;
      line-height: 1.6;
    }

    @media (prefers-reduced-motion: reduce) {
      [${markAttribute}],
      .lexi-entity-card {
        transition: none;
      }
    }

    @media (prefers-color-scheme: dark) {
      .lexi-entity-card {
        border-color: #34343a;
        background: rgba(28, 28, 30, 0.95);
        color: #f2f2f4;
      }

      .lexi-entity-card__expansion,
      .lexi-entity-card__meaning {
        color: #b6b6bf;
      }
    }
  `
  document.documentElement.appendChild(style)
}

function createMark(entity: DetectedEntity, surface: string) {
  const mark = document.createElement('span')
  mark.setAttribute(markAttribute, 'true')
  mark.dataset.lexiDomain = entity.domain
  // The surface, not the dictionary headword: a page that says "Phase II trial" should
  // not get a card titled "Phase II".
  mark.dataset.lexiTerm = surface
  mark.dataset.lexiMeaning = entity.meaning
  mark.dataset.lexiExpansion = entity.expansion ?? ''
  mark.dataset.lexiAlternatives = entity.alternativeDomains.join(',')
  mark.textContent = surface
  return mark
}

/**
 * Marks the first occurrence of each entity and no more.
 *
 * A term that appears thirty times would otherwise turn an article into a dotted field,
 * and the second dot teaches the reader nothing the first one did not.
 */
function markTextNode(node: Text, byTerm: Map<string, DetectedEntity>, marked: Set<string>) {
  const text = node.nodeValue ?? ''
  const matches = findEntityMatches(text).filter(match => byTerm.has(match.entry.term) && !marked.has(match.entry.term))
  if (!matches.length || !node.parentNode)
    return

  const fragment = document.createDocumentFragment()
  let cursor = 0
  let applied = 0

  for (const match of matches) {
    const entity = byTerm.get(match.entry.term)
    if (!entity || marked.has(match.entry.term) || match.index < cursor)
      continue

    if (match.index > cursor)
      fragment.append(document.createTextNode(text.slice(cursor, match.index)))

    fragment.append(createMark(entity, match.surface))
    marked.add(match.entry.term)
    cursor = match.index + match.surface.length
    applied += 1
  }

  if (!applied)
    return

  if (cursor < text.length)
    fragment.append(document.createTextNode(text.slice(cursor)))

  node.parentNode.replaceChild(fragment, node)
}

function applyMarks(entities: DetectedEntity[]) {
  if (!entities.length)
    return

  ensureStyles()
  const byTerm = new Map(entities.map(entity => [entity.term, entity]))
  const marked = new Set<string>()

  for (const node of collectTextNodes()) {
    if (marked.size >= byTerm.size)
      break

    if (node.isConnected)
      markTextNode(node, byTerm, marked)
  }
}

function clearMarks() {
  document.querySelectorAll<HTMLElement>(`[${markAttribute}]`).forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  })
}

function ensureCard() {
  if (tooltip?.isConnected)
    return tooltip

  tooltip = document.createElement('div')
  tooltip.className = 'lexi-entity-card'
  tooltip.dataset.lexiOpen = 'false'
  document.documentElement.appendChild(tooltip)
  return tooltip
}

function renderCard(card: HTMLElement, mark: HTMLElement) {
  const domain = mark.dataset.lexiDomain as EntityDomain
  const color = entityDomainColors[domain]
  card.replaceChildren()
  card.style.setProperty('--lexi-entity', color?.ink ?? '#8e8e9a')
  card.style.setProperty('--lexi-entity-soft', color?.soft ?? '#f7f7f8')

  const head = document.createElement('div')
  head.className = 'lexi-entity-card__head'

  const term = document.createElement('b')
  term.className = 'lexi-entity-card__term'
  term.textContent = mark.dataset.lexiTerm ?? ''

  const tag = document.createElement('span')
  tag.className = 'lexi-entity-card__tag'
  tag.textContent = entityDomainLabels[domain] ?? ''
  head.append(term, tag)
  card.append(head)

  if (mark.dataset.lexiExpansion) {
    const expansion = document.createElement('p')
    expansion.className = 'lexi-entity-card__expansion'
    expansion.textContent = mark.dataset.lexiExpansion
    card.append(expansion)
  }

  const meaning = document.createElement('p')
  meaning.className = 'lexi-entity-card__meaning'
  meaning.textContent = mark.dataset.lexiMeaning ?? ''
  card.append(meaning)

  // Naming the readings we passed over keeps a wrong page-domain call visible to the
  // reader rather than silently authoritative.
  const alternatives = (mark.dataset.lexiAlternatives ?? '').split(',').filter(Boolean) as EntityDomain[]
  if (alternatives.length) {
    const note = document.createElement('p')
    note.className = 'lexi-entity-card__note'
    note.textContent = `本页判定为${entityDomainShortLabels[domain] ?? ''}领域；该词在${alternatives.map(item => entityDomainShortLabels[item]).join('、')}领域另有含义。`
    card.append(note)
  }
}

function positionCard(card: HTMLElement, mark: HTMLElement) {
  const margin = 12
  const gap = 8
  const rect = mark.getBoundingClientRect()
  const { offsetWidth: width, offsetHeight: height } = card
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  const below = rect.bottom + gap
  const fitsBelow = below + height <= window.innerHeight - margin
  const top = !fitsBelow && rect.top - gap - height >= margin ? rect.top - gap - height : below

  card.style.left = `${left}px`
  card.style.top = `${Math.max(margin, top)}px`
}

function onPointerOver(event: Event) {
  const target = event.target
  const mark = target instanceof Element ? target.closest<HTMLElement>(`[${markAttribute}]`) : undefined
  if (!mark)
    return

  window.clearTimeout(hideTimer)
  const card = ensureCard()
  renderCard(card, mark)
  positionCard(card, mark)
  card.dataset.lexiOpen = 'true'
}

function onPointerOut(event: Event) {
  const target = event.target
  if (!(target instanceof Element) || !target.closest(`[${markAttribute}]`))
    return

  hideTimer = window.setTimeout(() => {
    if (tooltip)
      tooltip.dataset.lexiOpen = 'false'
  }, 120)
}

/**
 * Two passes over the same matches.
 *
 * Votes are collected first, from unambiguous terms only, and the page domain is settled
 * from those plus the host and marker signals. Senses are resolved after that, so the
 * words that need disambiguating never help decide the verdict used to disambiguate them.
 */
function analyzeSample(settings: LexiSettings, sample: string) {
  const matches = findEntityMatches(sample)
  const profile = detectPageDomain(
    { host: location.hostname, title: document.title, headings: readHeadings(), text: sample },
    collectDomainVotes(matches),
  )

  return {
    profile,
    entities: buildDetectedEntities(matches, profile, settings.entityDetection.maxPerPage),
  }
}

async function augmentWithAi(settings: LexiSettings, id: number, sample: string, local: ReturnType<typeof analyzeSample>) {
  const response = await withTimeout(
    requestPageEntities(settings, {
      title: document.title,
      host: location.hostname,
      text: sample,
      domainGuess: local.profile.primary,
      knownTerms: local.entities.map(entity => entity.term),
    }),
    requestTimeoutMs,
    '实体识别请求超时',
  )

  if (id !== requestId)
    return undefined

  // The model only names the page's domain when the local signals could not.
  const profile: PageDomainProfile = local.profile.primary || !response.domain
    ? local.profile
    : { ...local.profile, primary: response.domain }

  return {
    profile,
    entities: mergeDetectedEntities(local.entities, response.entities, settings.entityDetection.maxPerPage),
  }
}

function publish(profile: PageDomainProfile, entities: DetectedEntity[], aiAssisted: boolean) {
  report = { domain: profile, entities, aiAssisted }
  clearMarks()
  applyMarks(entities)
}

async function refresh() {
  const id = ++requestId
  const settings = await getSettings()
  if (id !== requestId)
    return

  if (!settings.entityDetection.enabled || !isSceneEnabled(settings, 'entity')) {
    lastSourceHash = ''
    report = createEmptyReport()
    clearMarks()
    return
  }

  const sample = readPageSample()
  const sourceHash = getEntitySourceHash(document.title, sample)
  // Nothing readable changed, so re-marking would only re-trigger the mutation watcher.
  if (sourceHash === lastSourceHash)
    return

  lastSourceHash = sourceHash
  const local = analyzeSample(settings, sample)
  publish(local.profile, local.entities, false)

  const aiAllowed = settings.entityDetection.aiAssist
    && settings.ai.entity.enabled
    && local.entities.length < settings.entityDetection.maxPerPage
  if (!aiAllowed || !sample)
    return

  const cacheKey = getEntityCacheKey(location.href)
  const fingerprint = getEntityModelFingerprint(settings)
  const cached = resolveEntityCache(await getCachedEntry(cacheKey), sourceHash, fingerprint, settings.entityDetection.cacheDays)
  if (id !== requestId)
    return

  if (cached) {
    publish(readCachedDomainProfile(cached), cached.entities, true)
    return
  }

  const augmented = await augmentWithAi(settings, id, sample, local).catch((error) => {
    console.warn('[Lexi] entity detection request failed', error)
    return undefined
  })
  if (!augmented || id !== requestId)
    return

  publish(augmented.profile, augmented.entities, true)
  await saveCacheEntry(cacheKey, createEntityCacheEntry(
    { url: location.href, title: document.title, host: location.hostname },
    augmented.profile,
    augmented.entities,
    sourceHash,
    fingerprint,
  )).catch(error => console.warn('[Lexi] entity cache write failed', error))
}

export interface PageEntitySummary extends PageEntityReport {
  primaryLabel: string
  domainCounts: Array<{ domain: EntityDomain, label: string, count: number }>
}

function summarize(): PageEntitySummary {
  return {
    ...report,
    primaryLabel: report.domain.primary ? entityDomainLabels[report.domain.primary] : '',
    domainCounts: summarizeEntityDomains(report.entities).map(item => ({
      domain: item.domain,
      label: entityDomainShortLabels[item.domain],
      count: item.count,
    })),
  }
}

/** Toggling the feature from the side panel has to take effect without a reload. */
function onStorageChanged(changes: Record<string, browser.Storage.StorageChange>, areaName: string) {
  if (areaName !== 'local' || !changes[settingsStorageKey])
    return

  lastSourceHash = ''
  void refresh().catch(error => console.warn('[Lexi] entity settings refresh failed', error))
}

export function startPageEntities() {
  if (watcher && !watcher.disposed)
    return watcher.stop

  const removeListener = listenRuntimeMessage('lexi-page-entities', summarize)
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  browser.storage.onChanged.addListener(onStorageChanged)

  watcher = startRouteWatcher({
    label: 'Entity Detection',
    refresh,
    onDispose: () => {
      window.clearTimeout(hideTimer)
      removeListener()
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      browser.storage.onChanged.removeListener(onStorageChanged)
      clearMarks()
      tooltip?.remove()
      tooltip = undefined
      lastSourceHash = ''
      report = createEmptyReport()
    },
    mutationDelayMs: 1200,
  })

  return watcher.stop
}
