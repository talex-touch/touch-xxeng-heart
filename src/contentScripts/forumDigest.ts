import browser from 'webextension-polyfill'
import { sendMessage } from 'webext-bridge/content-script'
import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'
import { digestCardKeyframes, digestCardTokens, ensureStyleSheet, morphCardContent } from '~/contentScripts/ui/digestCard'
import { startRouteWatcher } from '~/contentScripts/ui/routeWatcher'
import type { RouteWatcher } from '~/contentScripts/ui/routeWatcher'
import { requestForumDigest } from '~/logic/aiClient'
import { mergeSettings } from '~/logic/defaults'
import { createForumDigestCacheEntry, getCachedForumDigestEntry, getForumDigestVersion, shouldAutoGenerateForumDigest } from '~/logic/forumDigestCache'
import { readJsonValue } from '~/logic/storageJson'
import { forumDigestStorageKey, settingsStorageKey } from '~/logic/storageKeys'
import { escapeHtml, normalizeText, simpleHash, uniq, withTimeout } from '~/logic/text'
import type { ForumDigestCache, ForumDigestCacheEntry, ForumDigestInfo, ForumDigestResult, LexiSettings } from '~/logic/types'

interface ForumDigestCardState {
  element: HTMLElement
  info: ForumDigestInfo
  status: 'loading' | 'ready' | 'error'
  collapsed: boolean
  digest?: ForumDigestResult
  cached?: boolean
  error?: string
  history: ForumDigestCacheEntry['history']
  selectedHistoryIndex: number
  requestId: number
  lastRenderedHtml?: string
}

let cardState: ForumDigestCardState | undefined
let autoTimer: number | undefined
let watcher: RouteWatcher | undefined

const knownDiscourseHosts = new Set(['linux.do', 'idcflare.com', 'discourse.org'])
const maxDigestPosts = 8
const maxDigestCacheEntries = 80

function handleRefreshError(message: string, error: unknown) {
  if (isExtensionContextInvalidated(error)) {
    watcher?.stop()
    return
  }

  console.warn(message, error)
}

async function getSettings() {
  const stored = await browser.storage.local.get(settingsStorageKey)
  return mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined))
}

async function getDigestCache() {
  const stored = await browser.storage.local.get(forumDigestStorageKey)
  return readJsonValue<ForumDigestCache>(stored[forumDigestStorageKey], {})
}

async function saveDigestCacheEntry(key: string, entry: ForumDigestCacheEntry) {
  const result = await sendMessage('lexi-upsert-digest-cache', {
    storageKey: forumDigestStorageKey,
    cacheKey: key,
    entry: JSON.stringify(entry),
    maxEntries: maxDigestCacheEntries,
  }, 'background') as { ok?: boolean, error?: string }
  if (!result.ok)
    throw new Error(result.error || '论坛摘要缓存更新失败')
}

function isDiscourseLikePage() {
  const host = location.hostname.toLowerCase()
  if (knownDiscourseHosts.has(host) || [...knownDiscourseHosts].some(domain => host.endsWith(`.${domain}`)))
    return true

  const generator = document.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content ?? ''
  const applicationName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? ''
  const discourseRoot = document.querySelector('#data-preloaded, #discourse-modal, #reply-control, .d-header, .topic-list, .topic-post, #topic-title')
  const discourseAsset = document.querySelector('[href*="/assets/discourse"], [src*="/assets/discourse"], [href*="discourse-"], [src*="discourse-"]')
  const classText = `${document.documentElement.className} ${document.body?.className ?? ''}`
  return /discourse/i.test(generator)
    || /discourse/i.test(applicationName)
    || /discourse/i.test(classText)
    || Boolean(discourseRoot)
    || Boolean(discourseAsset)
    || 'Discourse' in window
    || '__DISCOURSE_CONFIG__' in window
}

function isForumTopicPage() {
  if (!isDiscourseLikePage())
    return false

  return /\/t\//.test(location.pathname)
    || Boolean(document.querySelector('#topic-title, .topic-post, article[data-post-id], [data-topic-id] .topic-title'))
}

function getForumTitle() {
  return normalizeText(
    document.querySelector<HTMLElement>('#topic-title h1, #topic-title .fancy-title, .topic-title, .fancy-title, [itemprop="headline"]')?.textContent
    || document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
    || document.title.split(' - ')[0],
  )
}

function getForumCategory() {
  return normalizeText(
    document.querySelector<HTMLElement>('#topic-title .category-name, .badge-category__name, .badge-category, [class*="category-name"]')?.textContent,
  )
}

function getForumTags() {
  return uniq(Array.from(document.querySelectorAll<HTMLElement>('.discourse-tag, .topic-meta-data .discourse-tag, a[href^="/tag/"], a[href*="/tags/"]'))
    .map(element => element.textContent ?? '')).slice(0, 10)
}

function getForumAuthor() {
  return normalizeText(
    document.querySelector<HTMLElement>('.topic-post .names .username, article[data-post-id] .username, .topic-meta-data .username')?.textContent,
  )
}

function getPostTexts() {
  const selectors = [
    '.topic-post .cooked',
    'article[data-post-id] .cooked',
    '[itemprop="articleBody"]',
    '.post-stream .regular .cooked',
  ].join(',')
  const posts = Array.from(document.querySelectorAll<HTMLElement>(selectors))
    .map(element => normalizeText(element.textContent))
    .filter(text => text.length >= 20)

  return uniq(posts).slice(0, 12)
}

function getPageText() {
  const main = document.querySelector<HTMLElement>('#main-outlet, main, .contents, #topic')
  return normalizeText(main?.textContent ?? document.body.textContent).slice(0, 6200)
}

function normalizeUrl(url = location.href) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    const topicMatch = parsed.pathname.match(/^(\/t\/[^/]+\/\d+)/)
    if (topicMatch)
      parsed.pathname = topicMatch[1]
    return parsed.toString()
  }
  catch {
    return url.split('#')[0].split('?')[0]
  }
}

function collectForumInfo(): ForumDigestInfo | undefined {
  const title = getForumTitle()
  const posts = getPostTexts()
  const pageText = getPageText()
  if (!title || (!posts.length && pageText.length < 120))
    return undefined

  const digestPosts = posts.slice(0, maxDigestPosts)
  const source = JSON.stringify({ title, posts: digestPosts, url: normalizeUrl() })
  const sourceHash = simpleHash(source)
  return {
    key: `${location.hostname}:${normalizeUrl()}`.toLowerCase(),
    host: location.hostname,
    title,
    author: getForumAuthor(),
    category: getForumCategory(),
    tags: getForumTags(),
    posts: digestPosts,
    pageText: digestPosts.join('\n\n') || pageText.slice(0, 2200),
    url: normalizeUrl(),
    sourceHash,
  }
}

function isUsableSidebarTarget(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return rect.width >= 100 && rect.right > window.innerWidth * 0.5
}

function findDiscourseSidebarPlacement() {
  const navigation = document.querySelector<HTMLElement>('.topic-navigation')
  if (navigation && isUsableSidebarTarget(navigation)) {
    const before = navigation.querySelector<HTMLElement>('#topic-progress-wrapper, .topic-progress-wrapper, .timeline-container, .topic-timeline')
    return { parent: navigation, before }
  }

  const selectors = [
    '#topic-progress-wrapper',
    '.topic-progress-wrapper',
    '.timeline-container',
    '.topic-timeline',
  ]

  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector)
    const parent = element?.parentElement
    if (element && parent && parent !== document.body && isUsableSidebarTarget(parent))
      return { parent, before: element }
  }

  return undefined
}

function removeSidebarMount() {
  document.querySelector<HTMLElement>('[data-lexi-forum-digest-mount="true"]')?.remove()
}

function getSidebarMount() {
  const placement = findDiscourseSidebarPlacement()
  const existing = document.querySelector<HTMLElement>('[data-lexi-forum-digest-mount="true"]')
  if (!placement) {
    existing?.remove()
    return undefined
  }

  if (existing?.parentElement === placement.parent) {
    if (placement.before && existing.nextElementSibling !== placement.before)
      placement.parent.insertBefore(existing, placement.before)
    return existing
  }

  existing?.remove()
  const mount = document.createElement('div')
  mount.className = 'lexi-forum-digest-mount'
  mount.dataset.lexiForumDigestMount = 'true'
  placement.parent.insertBefore(mount, placement.before ?? null)
  return mount
}

function placeCard(element: HTMLElement) {
  const mount = getSidebarMount()
  const parent = mount ?? document.body
  if (element.parentElement !== parent)
    parent.append(element)

  element.dataset.lexiPlacement = mount ? 'sidebar' : 'fixed'
}

function createList(items: string[], emptyText: string) {
  if (!items.length)
    return `<p class="lexi-forum-digest__muted">${escapeHtml(emptyText)}</p>`

  return `<ul>${items.map(item => `<li class="lexi-forum-digest__typewriter">${escapeHtml(item)}</li>`).join('')}</ul>`
}

function getFallbackDigest(info: ForumDigestInfo): ForumDigestResult {
  return {
    oneLine: `${info.title} 尚未生成速读。`,
    summary: [`将只读取主贴和前 ${Math.max(0, info.posts.length - 1)} 个可见回复，避免消耗过多 tokens。`],
    keyPoints: [],
    terms: info.tags,
  }
}

function getDigestBody(digest: ForumDigestResult, options: { cached?: boolean, stale?: boolean }) {
  return `
    <p class="lexi-forum-digest__desc lexi-forum-digest__typewriter">${escapeHtml(digest.oneLine)}</p>
    <div class="lexi-forum-digest__section"><strong>主贴 + 前几楼摘要</strong>${createList(digest.summary, '暂无摘要')}</div>
    <div class="lexi-forum-digest__section"><strong>关键点</strong>${createList(digest.keyPoints, '暂无关键点')}</div>
    ${digest.terms.length ? `<p class="lexi-forum-digest__terms"><strong>术语 / 线索</strong> ${digest.terms.map(escapeHtml).join(' · ')}</p>` : ''}
    ${digest.sentiment ? `<p class="lexi-forum-digest__muted">讨论氛围：${escapeHtml(digest.sentiment)}</p>` : ''}
    <div class="lexi-forum-digest__actions">
      <button data-lexi-forum-action="generate">生成 / 刷新</button>
      <button data-lexi-forum-action="copy">复制</button>
      <button data-lexi-forum-action="collapse">收起</button>
    </div>
    ${options.cached ? '<p class="lexi-forum-digest__hint">来自本地缓存</p>' : ''}
    ${options.stale ? '<p class="lexi-forum-digest__hint">检测到主贴/前几楼有变化，已优先保留本地缓存；需要更新时可手动点击生成。</p>' : ''}
  `
}

function formatVersionTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getHistorySwitcher(state: ForumDigestCardState) {
  if (!state.history.length)
    return ''

  const buttons = state.history.map((item, index) => {
    const active = index === state.selectedHistoryIndex
    const current = item.sourceHash === state.info.sourceHash
    return `<button class="${active ? 'is-active' : ''}" data-lexi-forum-action="history" data-lexi-forum-history-index="${index}">${current ? '当前' : '历史'} · ${formatVersionTime(item.createdAt)}</button>`
  }).join('')

  return `<div class="lexi-forum-digest__versions"><span>缓存版本</span>${buttons}</div>`
}

function updateCardContent(element: HTMLElement, html: string) {
  morphCardContent(element, html)
}

function renderCard() {
  if (!cardState)
    return

  const { element, info, status, cached, error } = cardState
  const selectedVersion = cardState.selectedHistoryIndex >= 0
    ? cardState.history[cardState.selectedHistoryIndex]
    : undefined
  const activeDigest = selectedVersion?.digest ?? cardState.digest
  const hasCurrentVersion = cardState.history.some(item => item.sourceHash === info.sourceHash)
  const showingHistoricalVersion = Boolean(selectedVersion && selectedVersion.sourceHash !== info.sourceHash)
  const stale = Boolean(cardState.history.length && !hasCurrentVersion)
  element.className = `lexi-forum-digest${cardState.collapsed ? ' lexi-forum-digest--collapsed' : ''}`
  element.dataset.lexiCollapsed = cardState.collapsed ? 'true' : 'false'
  const statusLabel = status === 'loading'
    ? '速读中...'
    : status === 'error'
      ? '生成失败'
      : showingHistoricalVersion || stale
        ? '有更新'
        : '速读'
  const statusClass = status === 'error'
    ? 'lexi-forum-digest__status lexi-forum-digest__status--error'
    : stale || showingHistoricalVersion
      ? 'lexi-forum-digest__status lexi-forum-digest__status--stale'
      : 'lexi-forum-digest__status'
  const body = status === 'loading'
    ? `${getDigestBody(activeDigest ?? getFallbackDigest(info), { cached, stale })}<div class="lexi-forum-digest__loading">正在总结主贴和前几楼...</div>`
    : status === 'ready'
      ? `${getDigestBody(activeDigest ?? getFallbackDigest(info), { cached, stale: stale || showingHistoricalVersion })}${getHistorySwitcher(cardState)}`
      : `<p class="lexi-forum-digest__desc lexi-forum-digest__error">${escapeHtml(error || '生成失败')}</p><div class="lexi-forum-digest__actions"><button data-lexi-forum-action="generate">重试</button><button data-lexi-forum-action="hide">关闭</button></div>`

  placeCard(element)

  const html = `
    <button class="lexi-forum-digest__collapsed-toggle" type="button" data-lexi-forum-action="expand" aria-label="展开 Lexi 速读">
      <span>Lexi 速读</span>
      <strong>${escapeHtml(info.title)}</strong>
    </button>
    <div class="lexi-forum-digest__content">
      <div class="lexi-forum-digest__head">
        <div>
          <div class="lexi-forum-digest__eyebrow">Forum Digest</div>
          <div class="lexi-forum-digest__title">Lexi 速读</div>
        </div>
        <span class="${statusClass}">${statusLabel}</span>
      </div>
      <div class="lexi-forum-digest__meta">${escapeHtml([info.host, info.category, info.author ? `by ${info.author}` : ''].filter(Boolean).join(' · '))}</div>
      <div class="lexi-forum-digest__topic">${escapeHtml(info.title)}</div>
      ${body}
    </div>
  `

  if (cardState.lastRenderedHtml === html)
    return

  cardState.lastRenderedHtml = html
  updateCardContent(element, html)
}

function ensureStyles() {
  ensureStyleSheet('lexi-forum-digest-style', `
    .lexi-forum-digest-mount { width: 100%; margin: 14px 0; }
    .lexi-forum-digest { ${digestCardTokens} --lexi-text: #111827; --lexi-muted: #64748b; --lexi-secondary: #475569; --lexi-accent: #4f46e5; --lexi-accent-strong: #4338ca; --lexi-card-bg: #ffffff; --lexi-card-border: rgba(129,140,248,.32); --lexi-card-shadow: 0 18px 50px rgba(15,23,42,.18), 0 0 0 1px rgba(255,255,255,.64) inset; --lexi-sidebar-shadow: 0 12px 32px rgba(15,23,42,.12), 0 0 0 1px rgba(255,255,255,.62) inset; --lexi-pill-bg: rgba(79,70,229,.1); --lexi-button-bg: #fff; --lexi-button-border: rgba(203,213,225,.9); --lexi-divider: rgba(226,232,240,.8); --lexi-error-bg: rgba(254,242,242,.9); --lexi-error-text: #dc2626; --lexi-stale-bg: rgba(251,191,36,.16); --lexi-stale-text: #b45309; --lexi-loading-bg: rgba(79,70,229,.1); box-sizing: border-box; color-scheme: light; position: fixed; right: 18px; top: 96px; z-index: 2147483646; width: min(360px, calc(100vw - 36px)); max-height: min(54vh, 540px); overflow: auto; border: 1px solid var(--lexi-card-border); border-radius: 14px; background: var(--lexi-card-bg); box-shadow: var(--lexi-card-shadow); color: var(--lexi-text); padding: 13px; font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .lexi-forum-digest *, .lexi-forum-digest *::before, .lexi-forum-digest *::after { box-sizing: border-box; }
    .lexi-forum-digest[data-lexi-placement="sidebar"] { position: static; right: auto; top: auto; z-index: auto; width: 100%; min-width: 0; max-height: min(43.5vh, 390px); border-radius: 12px; padding: 11px; box-shadow: var(--lexi-sidebar-shadow); }
    .lexi-forum-digest--collapsed { width: 142px; min-height: 0; overflow: hidden; border-radius: 999px; padding: 9px 10px; }
    .lexi-forum-digest[data-lexi-placement="sidebar"].lexi-forum-digest--collapsed { width: 100%; border-radius: 12px; padding: 8px 9px; }
    .lexi-forum-digest__collapsed-toggle { display: none; width: 100%; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
    .lexi-forum-digest--collapsed .lexi-forum-digest__collapsed-toggle { display: block; }
    .lexi-forum-digest--collapsed .lexi-forum-digest__content { display: none; }
    .lexi-forum-digest__collapsed-toggle span { display: block; color: var(--lexi-accent); font-size: 11px; font-weight: 800; }
    .lexi-forum-digest__collapsed-toggle strong { display: block; overflow: hidden; margin-top: 1px; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .lexi-forum-digest__content { animation: lexi-forum-digest-content-enter 260ms cubic-bezier(.2,.9,.2,1) both; }
    .lexi-forum-digest__head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    .lexi-forum-digest[data-lexi-placement="sidebar"] .lexi-forum-digest__head { gap: 6px; }
    .lexi-forum-digest__eyebrow { color: var(--lexi-accent); font-size: 11px; font-weight: 800; letter-spacing: .02em; }
    .lexi-forum-digest__title { margin-top: 1px; font-size: 15px; font-weight: 800; }
    .lexi-forum-digest[data-lexi-placement="sidebar"] .lexi-forum-digest__title { font-size: 14px; }
    .lexi-forum-digest__status { border-radius: 999px; background: var(--lexi-pill-bg); color: var(--lexi-accent); padding: 2px 7px; font-size: 11px; white-space: nowrap; }
    .lexi-forum-digest__status--error { background: var(--lexi-error-bg); color: var(--lexi-error-text); }
    .lexi-forum-digest__status--stale { background: var(--lexi-stale-bg); color: var(--lexi-stale-text); }
    .lexi-forum-digest__meta { margin-top: 8px; color: var(--lexi-muted); font-size: 12px; word-break: break-word; }
    .lexi-forum-digest__topic { margin-top: 7px; font-size: 13px; font-weight: 700; word-break: break-word; }
    .lexi-forum-digest__desc { margin: 10px 0 0; color: var(--lexi-text); }
    .lexi-forum-digest__error { color: var(--lexi-error-text); }
    .lexi-forum-digest__section { margin-top: 11px; }
    .lexi-forum-digest__section strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .lexi-forum-digest ul { margin: 0; padding-left: 18px; }
    .lexi-forum-digest li { margin: 3px 0; color: var(--lexi-secondary); }
    .lexi-forum-digest__terms, .lexi-forum-digest__hint, .lexi-forum-digest__muted { margin: 10px 0 0; color: var(--lexi-muted); font-size: 12px; }
    .lexi-forum-digest__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .lexi-forum-digest[data-lexi-placement="sidebar"] .lexi-forum-digest__actions { gap: 6px; }
    .lexi-forum-digest__actions button { border: 1px solid var(--lexi-button-border); border-radius: 999px; background: var(--lexi-button-bg); color: var(--lexi-text); cursor: pointer; font: 12px/1 ui-sans-serif, system-ui, sans-serif; padding: 7px 10px; }
    .lexi-forum-digest[data-lexi-placement="sidebar"] .lexi-forum-digest__actions button { font-size: 11px; padding: 6px 8px; }
    .lexi-forum-digest__actions button:first-child { border-color: #312e81; background: #312e81; color: #fff; }
    .lexi-forum-digest__versions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; border-top: 1px solid var(--lexi-divider); padding-top: 10px; }
    .lexi-forum-digest__versions span { width: 100%; color: var(--lexi-muted); font-size: 11px; font-weight: 700; }
    .lexi-forum-digest__versions button { border: 1px solid var(--lexi-button-border); border-radius: 999px; background: var(--lexi-button-bg); color: var(--lexi-secondary); cursor: pointer; font-size: 11px; padding: 5px 8px; }
    .lexi-forum-digest__versions button.is-active { border-color: rgba(79,70,229,.45); background: var(--lexi-pill-bg); color: var(--lexi-accent-strong); }
    .lexi-forum-digest__loading { margin-top: 12px; border-radius: 12px; background: var(--lexi-loading-bg); padding: 10px; color: var(--lexi-accent); animation: lexi-forum-digest-loading-pulse 1.2s ease-in-out infinite; }
    [data-lexi-forum-digest="true"] .lexi-forum-digest__actions button { font: 12px/1 ui-sans-serif, system-ui, sans-serif; }
    ${digestCardKeyframes('lexi-forum-digest')}
    @media (prefers-color-scheme: dark) {
      .lexi-forum-digest { --lexi-text: #f5f5f5; --lexi-muted: #a3a3a3; --lexi-secondary: #d4d4d4; --lexi-accent: #e5e5e5; --lexi-accent-strong: #fafafa; --lexi-card-bg: #171717; --lexi-card-border: rgba(115,115,115,.34); --lexi-card-shadow: 0 18px 50px rgba(0,0,0,.42), 0 0 0 1px rgba(255,255,255,.07) inset; --lexi-sidebar-shadow: 0 12px 32px rgba(0,0,0,.36), 0 0 0 1px rgba(255,255,255,.06) inset; --lexi-pill-bg: rgba(245,245,245,.1); --lexi-button-bg: rgba(23,23,23,.92); --lexi-button-border: rgba(82,82,82,.92); --lexi-divider: rgba(82,82,82,.72); --lexi-error-bg: rgba(127,29,29,.38); --lexi-error-text: #fca5a5; --lexi-stale-bg: rgba(120,53,15,.34); --lexi-stale-text: #facc15; --lexi-loading-bg: rgba(64,64,64,.3); color-scheme: dark; }
    }
    @media (prefers-reduced-motion: reduce) { .lexi-forum-digest__content, .lexi-forum-digest__loading { animation: none; opacity: 1; filter: none; transform: none; } }
  `)
}

function mountCard(info: ForumDigestInfo) {
  ensureStyles()
  cardState?.element.removeEventListener('click', onCardClick)
  cardState?.element.remove()

  const element = document.createElement('section')
  element.className = 'lexi-forum-digest'
  element.dataset.lexiForumDigest = 'true'
  cardState = { element, info, status: 'ready', collapsed: false, history: [], selectedHistoryIndex: -1, requestId: 0 }
  element.addEventListener('click', onCardClick)
  placeCard(element)
  renderCard()
}

function removeCard() {
  window.clearTimeout(autoTimer)
  cardState?.element.removeEventListener('click', onCardClick)
  cardState?.element.remove()
  removeSidebarMount()
  cardState = undefined
}

function getCachedEntry(cache: ForumDigestCache, info: ForumDigestInfo, settings: LexiSettings) {
  return getCachedForumDigestEntry(cache, info.key, settings.forumDigest.cacheDays)
}

function createCacheEntry(info: ForumDigestInfo, digest: ForumDigestResult, current?: ForumDigestCacheEntry): ForumDigestCacheEntry {
  return createForumDigestCacheEntry({
    host: info.host,
    title: info.title,
    url: info.url,
    sourceHash: info.sourceHash,
  }, digest, current)
}

function isCurrentDigestRequest(state: ForumDigestCardState, info: ForumDigestInfo, requestId: number) {
  return cardState === state
    && state.requestId === requestId
    && state.info.key === info.key
    && state.info.sourceHash === info.sourceHash
}

async function generateDigest(force = false) {
  if (!cardState || cardState.status === 'loading')
    return

  const state = cardState
  const requestId = state.requestId
  const requestInfo = { ...state.info, posts: [...state.info.posts], tags: [...state.info.tags] }
  const settings = await getSettings()
  if (!settings.forumDigest.enabled || !isCurrentDigestRequest(state, requestInfo, requestId))
    return

  const cache = await getDigestCache()
  if (!isCurrentDigestRequest(state, requestInfo, requestId))
    return

  const cachedEntry = getCachedEntry(cache, requestInfo, settings)
  const cached = !force && getForumDigestVersion(cachedEntry, requestInfo.sourceHash)?.digest
  if (cached && cachedEntry) {
    state.digest = cached
    state.history = cachedEntry.history
    state.selectedHistoryIndex = cachedEntry.history.findIndex(item => item.sourceHash === requestInfo.sourceHash)
    state.cached = true
    state.status = 'ready'
    renderCard()
    return
  }

  state.status = 'loading'
  state.error = undefined
  renderCard()

  try {
    const digest = await withTimeout(requestForumDigest(settings, requestInfo), 30000, '论坛速读生成超时，请稍后重试或检查 AI 后端。')
    if (!digest)
      throw new Error('AI 未返回有效论坛速读。请确认每日推荐 AI 场景已配置。')
    if (!isCurrentDigestRequest(state, requestInfo, requestId))
      return

    const entry = createCacheEntry(requestInfo, digest, cachedEntry ?? cache[requestInfo.key])
    await saveDigestCacheEntry(requestInfo.key, entry)
    if (!isCurrentDigestRequest(state, requestInfo, requestId))
      return

    state.digest = digest
    state.history = entry.history
    state.selectedHistoryIndex = 0
    state.cached = false
    state.status = 'ready'
  }
  catch (error) {
    if (!isCurrentDigestRequest(state, requestInfo, requestId))
      return

    state.status = 'error'
    state.error = error instanceof Error ? error.message : '生成失败'
  }
  finally {
    if (cardState === state)
      renderCard()
  }
}

async function copyDigest() {
  const digest = cardState?.digest
  if (!cardState || !digest)
    return

  const text = [
    `# Lexi 速读：${cardState.info.title}`,
    '',
    `范围：主贴 + 前 ${Math.max(0, cardState.info.posts.length - 1)} 个可见回复`,
    '',
    `一句话：${digest.oneLine}`,
    '',
    digest.summary.length ? `主贴 + 前几楼摘要：\n${digest.summary.map(item => `- ${item}`).join('\n')}` : '',
    digest.keyPoints.length ? `关键点：\n${digest.keyPoints.map(item => `- ${item}`).join('\n')}` : '',
    digest.terms.length ? `术语 / 线索：${digest.terms.join(' · ')}` : '',
  ].filter(Boolean).join('\n\n')

  await navigator.clipboard.writeText(text)
}

function onCardClick(event: Event) {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-lexi-forum-action]')
    : undefined
  if (!target)
    return

  const action = target.dataset.lexiForumAction
  if (action === 'history' && cardState) {
    const index = Number(target.dataset.lexiForumHistoryIndex)
    if (Number.isInteger(index) && cardState.history[index]) {
      cardState.lastRenderedHtml = undefined
      cardState.selectedHistoryIndex = index
      cardState.digest = cardState.history[index].digest
      renderCard()
    }
  }
  else if (action === 'expand' && cardState) {
    cardState.lastRenderedHtml = undefined
    cardState.collapsed = false
    renderCard()
  }
  else if (action === 'generate') {
    void generateDigest(true)
  }
  else if (action === 'copy') {
    void copyDigest()
  }
  else if (action === 'collapse' && cardState) {
    cardState.lastRenderedHtml = undefined
    cardState.collapsed = true
    renderCard()
  }
  else if (action === 'hide') {
    removeCard()
  }
}

async function scheduleAutoGenerate(info: ForumDigestInfo) {
  window.clearTimeout(autoTimer)
  const settings = await getSettings()
  if (!settings.forumDigest.enabled || !settings.forumDigest.autoGenerate)
    return

  const delay = Math.max(300, settings.forumDigest.autoDelaySeconds * 1000)
  autoTimer = window.setTimeout(() => {
    if (!cardState || cardState.info.key !== info.key || cardState.info.sourceHash !== info.sourceHash)
      return

    void generateDigest(false).catch(error => handleRefreshError('[Lexi] Forum Digest auto generate failed', error))
  }, delay)
}

async function refresh() {
  if (watcher?.disposed)
    return

  if (!isForumTopicPage()) {
    removeCard()
    return
  }

  const settings = await getSettings()
  if (!settings.forumDigest.enabled) {
    removeCard()
    return
  }

  const info = collectForumInfo()
  if (!info)
    return

  const current = cardState
  const sameTopic = current?.info.key === info.key
  const sameSource = sameTopic && current?.info.sourceHash === info.sourceHash
  if (sameSource && current) {
    current.info = info
    renderCard()
    return
  }

  if (sameTopic && current) {
    current.requestId += 1
    current.info = info
    current.status = 'ready'
    current.error = undefined
    current.cached = false
    current.digest = undefined
    current.history = []
    current.selectedHistoryIndex = -1
    renderCard()
  }
  else {
    mountCard(info)
  }

  const state = cardState
  if (!state)
    return

  const requestId = state.requestId
  const cache = await getDigestCache()
  if (!isCurrentDigestRequest(state, info, requestId))
    return

  const cached = getCachedEntry(cache, info, settings)
  const currentVersion = getForumDigestVersion(cached, info.sourceHash)
  const currentVersionIndex = currentVersion
    ? cached?.history.findIndex(item => item.sourceHash === info.sourceHash) ?? -1
    : -1

  if (cached) {
    state.history = cached.history
    state.digest = currentVersion?.digest ?? cached.history[0]?.digest
    state.selectedHistoryIndex = currentVersionIndex >= 0 ? currentVersionIndex : 0
    state.cached = Boolean(currentVersion)
    state.status = 'ready'
    renderCard()
  }

  if (shouldAutoGenerateForumDigest(cached, info.sourceHash))
    await scheduleAutoGenerate(info)
}

function onVisible() {
  if (cardState?.status === 'ready' && !cardState.digest)
    void scheduleAutoGenerate(cardState.info)
}

export function startForumDigest() {
  if (!isDiscourseLikePage())
    return () => {}

  watcher = startRouteWatcher({
    label: 'Forum Digest',
    refresh,
    onDispose: () => {
      window.clearTimeout(autoTimer)
      removeCard()
    },
    onVisible,
    onHidden: () => window.clearTimeout(autoTimer),
    mutationDelayMs: 1200,
  })

  return watcher.stop
}
