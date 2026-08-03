import browser from 'webextension-polyfill'
import { sendMessage } from 'webext-bridge/content-script'
import { findContentAdapter, hasContentAdapterHost } from './contentAdapters'
import { digestCardKeyframes, digestCardTokens, ensureStyleSheet } from './ui/digestCard'
import { startRouteWatcher } from './ui/routeWatcher'
import type { RouteWatcher } from './ui/routeWatcher'
import { requestContentDigest } from '~/logic/aiClient'
import { createContentDigestCacheEntry, getContentDigestCacheKey, getContentDigestModelFingerprint, resolveContentDigestCache } from '~/logic/contentDigestCache'
import { mergeSettings } from '~/logic/defaults'
import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'
import { sendRuntimeMessage } from '~/logic/runtimeMessaging'
import { isSceneEnabled } from '~/logic/siteRules'
import { readJsonValue } from '~/logic/storageJson'
import { contentDigestStorageKey, settingsStorageKey } from '~/logic/storageKeys'
import { escapeHtml, simpleHash } from '~/logic/text'
import type { ContentDigestCache, ContentDigestResult, ContentDocument, LexiSettings } from '~/logic/types'

interface ContentDigestCardState {
  status: 'idle' | 'loading' | 'ready' | 'busy' | 'blocked' | 'error'
  platformLabel: string
  document?: ContentDocument
  digest?: ContentDigestResult
  cached?: boolean
  stale?: boolean
  collapsed: boolean
  message?: string
  requestId: number
}

const maxDigestCacheEntries = 300
const maxDigestCacheBytes = 5 * 1024 * 1024
const requestOwner = `digest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

let card: HTMLElement | undefined
let state: ContentDigestCardState | undefined
let watcher: RouteWatcher | undefined
let autoTimer: number | undefined
let activeController: AbortController | undefined
let dismissedUrl = ''
let lastRouteUrl = location.href
let refreshEpoch = 0

function getSettings() {
  return browser.storage.local.get(settingsStorageKey)
    .then(stored => mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined)))
}

function getDigestCache() {
  return browser.storage.local.get(contentDigestStorageKey)
    .then(stored => readJsonValue<ContentDigestCache>(stored[contentDigestStorageKey], {}))
}

async function saveDigestCacheEntry(key: string, entry: ReturnType<typeof createContentDigestCacheEntry>) {
  const result = await sendMessage('lexi-upsert-digest-cache', {
    storageKey: contentDigestStorageKey,
    cacheKey: key,
    entry: JSON.stringify(entry),
    maxEntries: maxDigestCacheEntries,
    maxBytes: maxDigestCacheBytes,
  }, 'background') as { ok?: boolean, error?: string }
  if (!result.ok)
    throw new Error(result.error || '内容摘要缓存更新失败')
}

function ensureStyles() {
  ensureStyleSheet('lexi-content-digest-style', `
    .lexi-content-digest {
      ${digestCardTokens}
      --lexi-content-border: rgba(17, 24, 39, .14);
      --lexi-content-muted: #667085;
      --lexi-content-surface: #fff;
      --lexi-content-soft: #f5f7f8;
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483645;
      width: min(380px, calc(100vw - 24px));
      max-height: min(70vh, 640px);
      overflow: auto;
      box-sizing: border-box;
      border: 1px solid var(--lexi-content-border);
      border-radius: 8px;
      background: var(--lexi-content-surface);
      box-shadow: 0 12px 34px rgba(15, 23, 42, .16);
      color: #17191c;
      font: var(--lexi-digest-font);
      letter-spacing: 0;
    }
    .lexi-content-digest * { box-sizing: border-box; letter-spacing: 0; }
    .lexi-content-digest__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 12px 9px; border-bottom: 1px solid var(--lexi-content-border); }
    .lexi-content-digest__eyebrow { display: block; margin: 0 0 2px; color: #067647; font-size: 11px; font-weight: 700; }
    .lexi-content-digest__title { display: block; max-width: 290px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.35; }
    .lexi-content-digest__tools { display: flex; flex: 0 0 auto; gap: 4px; }
    .lexi-content-digest button { border: 1px solid var(--lexi-content-border); border-radius: 6px; background: var(--lexi-content-surface); color: inherit; cursor: pointer; font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif; }
    .lexi-content-digest button:hover { background: var(--lexi-content-soft); }
    .lexi-content-digest button:focus-visible { outline: 2px solid #067647; outline-offset: 2px; }
    .lexi-content-digest__icon { width: 28px; height: 28px; padding: 0; font-size: 17px !important; }
    .lexi-content-digest__body { padding: 12px; }
    .lexi-content-digest__one-line { margin: 0; font-size: 13px; font-weight: 650; line-height: 1.55; }
    .lexi-content-digest__section { margin-top: 12px; }
    .lexi-content-digest__section strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .lexi-content-digest__section ul { margin: 0; padding-left: 18px; }
    .lexi-content-digest__section li { margin: 3px 0; line-height: 1.5; }
    .lexi-content-digest__coverage { margin: 10px 0 0; border-top: 1px solid var(--lexi-content-border); padding-top: 8px; color: var(--lexi-content-muted); font-size: 11px; line-height: 1.5; }
    .lexi-content-digest__hint { margin: 8px 0 0; color: var(--lexi-content-muted); font-size: 11px; }
    .lexi-content-digest__status { margin: 0; color: var(--lexi-content-muted); line-height: 1.55; }
    .lexi-content-digest__status--blocked { color: #b54708; }
    .lexi-content-digest__status--error { color: #b42318; }
    .lexi-content-digest__actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .lexi-content-digest__actions button { min-height: 30px; padding: 6px 9px; }
    .lexi-content-digest__actions button[data-lexi-content-action="generate"] { border-color: #067647; background: #067647; color: #fff; }
    .lexi-content-digest--collapsed { width: min(280px, calc(100vw - 24px)); max-height: none; overflow: hidden; }
    .lexi-content-digest--collapsed .lexi-content-digest__body { display: none; }
    ${digestCardKeyframes('lexi-content-digest')}
    .lexi-content-digest__loading { animation: lexi-content-digest-loading-pulse 1.2s ease-in-out infinite; }
    @media (max-width: 640px) { .lexi-content-digest { right: 8px; bottom: 8px; width: calc(100vw - 16px); max-height: 58vh; } }
    @media (prefers-color-scheme: dark) {
      .lexi-content-digest { --lexi-content-border: rgba(255,255,255,.15); --lexi-content-muted: #a4acb9; --lexi-content-surface: #17191c; --lexi-content-soft: #24272c; color: #f5f7f8; box-shadow: 0 12px 34px rgba(0,0,0,.45); }
      .lexi-content-digest__eyebrow { color: #75e0a7; }
      .lexi-content-digest__actions button[data-lexi-content-action="generate"] { border-color: #17b26a; background: #17b26a; color: #071a10; }
    }
    @media (prefers-reduced-motion: reduce) { .lexi-content-digest__loading { animation: none; } }
  `)
}

function removeCard() {
  card?.remove()
  card = undefined
}

function createList(title: string, items: string[]) {
  if (!items.length)
    return ''
  return `<section class="lexi-content-digest__section"><strong>${escapeHtml(title)}</strong><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`
}

function renderBody(current: ContentDigestCardState) {
  if (current.status === 'blocked') {
    return `<p class="lexi-content-digest__status lexi-content-digest__status--blocked">${escapeHtml(current.message || '已阻止敏感内容速读。')}</p>
      <div class="lexi-content-digest__actions"><button type="button" data-lexi-content-action="settings">打开设置</button></div>`
  }
  if (current.status === 'loading')
    return `<p class="lexi-content-digest__status lexi-content-digest__loading">正在按页面可见范围生成摘要...</p>${current.document ? `<p class="lexi-content-digest__coverage">${escapeHtml(current.document.coverage)}</p>` : ''}`
  if (current.status === 'busy')
    return `<p class="lexi-content-digest__status">另一个标签页正在生成同一内容的摘要，完成后将复用缓存。</p>`
  if (current.status === 'error')
    return `<p class="lexi-content-digest__status lexi-content-digest__status--error">${escapeHtml(current.message || '摘要生成失败')}</p><div class="lexi-content-digest__actions"><button type="button" data-lexi-content-action="generate">重试</button><button type="button" data-lexi-content-action="settings">AI 设置</button></div>`
  if (current.status === 'ready' && current.digest) {
    return `<p class="lexi-content-digest__one-line">${escapeHtml(current.digest.oneLine)}</p>
      ${createList('摘要', current.digest.summary)}
      ${createList('关键点', current.digest.keyPoints)}
      ${createList('观点与分歧', current.digest.viewpoints)}
      ${createList('行动建议', current.digest.actions)}
      ${createList('术语', current.digest.terms)}
      <p class="lexi-content-digest__coverage">${escapeHtml(current.digest.coverage)}</p>
      <p class="lexi-content-digest__hint">${current.stale ? '缓存内容可能已过期，正在等待刷新' : current.cached ? '来自本地缓存' : '刚刚生成'}</p>
      <div class="lexi-content-digest__actions"><button type="button" data-lexi-content-action="generate">重新生成</button><button type="button" data-lexi-content-action="copy">复制</button></div>`
  }

  return `<p class="lexi-content-digest__status">已识别当前内容，可按页面已加载范围生成速读。</p>
    ${current.document ? `<p class="lexi-content-digest__coverage">${escapeHtml(current.document.coverage)}</p>` : ''}
    <div class="lexi-content-digest__actions"><button type="button" data-lexi-content-action="generate">生成摘要</button></div>`
}

function renderCard() {
  if (!state)
    return

  ensureStyles()
  if (!card) {
    card = document.createElement('aside')
    card.dataset.lexiContentDigest = 'true'
    card.addEventListener('click', onCardClick)
    document.body.append(card)
  }

  card.className = `lexi-content-digest${state.collapsed ? ' lexi-content-digest--collapsed' : ''}`
  const title = state.document?.title || state.message || `${state.platformLabel} 内容速读`
  card.innerHTML = `
    <header class="lexi-content-digest__head">
      <div><span class="lexi-content-digest__eyebrow">Lexi 速读 · ${escapeHtml(state.platformLabel)}</span><strong class="lexi-content-digest__title" title="${escapeHtml(title)}">${escapeHtml(title)}</strong></div>
      <div class="lexi-content-digest__tools">
        <button class="lexi-content-digest__icon" type="button" data-lexi-content-action="${state.collapsed ? 'expand' : 'collapse'}" aria-label="${state.collapsed ? '展开' : '收起'}" title="${state.collapsed ? '展开' : '收起'}">${state.collapsed ? '+' : '−'}</button>
        <button class="lexi-content-digest__icon" type="button" data-lexi-content-action="close" aria-label="关闭" title="关闭">×</button>
      </div>
    </header>
    <div class="lexi-content-digest__body">${renderBody(state)}</div>
  `
}

function getCopyText(current: ContentDigestCardState) {
  const digest = current.digest
  if (!digest)
    return ''
  return [
    digest.oneLine,
    ...digest.summary,
    ...digest.keyPoints,
    ...digest.viewpoints,
    ...digest.actions,
    `读取范围：${digest.coverage}`,
  ].filter(Boolean).join('\n')
}

function onCardClick(event: Event) {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-lexi-content-action]')
  if (!button || !state)
    return

  const action = button.dataset.lexiContentAction
  if (action === 'close') {
    dismissedUrl = location.href
    refreshEpoch += 1
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state.requestId += 1
    state = undefined
    removeCard()
  }
  else if (action === 'collapse' || action === 'expand') {
    state.collapsed = action === 'collapse'
    renderCard()
  }
  else if (action === 'generate') {
    startDigestGeneration(true)
  }
  else if (action === 'settings') {
    void browser.runtime.openOptionsPage()
  }
  else if (action === 'copy') {
    const text = getCopyText(state)
    if (text && navigator.clipboard)
      void navigator.clipboard.writeText(text)
  }
}

function startDigestGeneration(force = false) {
  const startedState = state
  const routeUrl = location.href
  void generateDigest(force).catch((error) => {
    if (!state || state !== startedState || location.href !== routeUrl)
      return
    state.status = 'error'
    state.message = error instanceof Error ? error.message : String(error)
    renderCard()
  })
}

function createLeaseKey(cacheKey: string, document: ContentDocument, modelFingerprint: string) {
  return `digest-${simpleHash(`${cacheKey}:${document.sourceHash}:${modelFingerprint}`).padStart(8, '0')}`
}

async function acquireLease(key: string) {
  return sendRuntimeMessage<{ ok?: boolean, busy?: boolean, retryAfterMs?: number, error?: string }, { key: string, owner: string, leaseMs: number }>(
    'lexi-acquire-digest-lease',
    { key, owner: requestOwner, leaseMs: 60_000 },
  )
}

async function releaseLease(key: string) {
  try {
    await sendRuntimeMessage('lexi-release-digest-lease', { key, owner: requestOwner })
  }
  catch (error) {
    if (!isExtensionContextInvalidated(error))
      console.warn('[Lexi] content digest lease release failed', error)
  }
}

async function generateDigest(force = false) {
  const current = state
  const content = current?.document
  if (!current || !content || current.status === 'loading')
    return

  current.status = 'loading'
  current.message = undefined
  renderCard()
  window.clearTimeout(autoTimer)
  const routeUrl = location.href
  const settings = await getSettings()
  if (state !== current || location.href !== routeUrl)
    return
  if (!settings.contentDigest.enabled || !isSceneEnabled(settings, 'digest', routeUrl)) {
    state = undefined
    removeCard()
    return
  }
  if (content.nsfw && !settings.contentDigest.allowNsfw) {
    current.status = 'blocked'
    current.message = 'NSFW 内容速读默认关闭，当前内容没有发送给 AI。'
    renderCard()
    return
  }

  const cacheKey = getContentDigestCacheKey(content)
  const modelFingerprint = getContentDigestModelFingerprint(settings)
  const cached = resolveContentDigestCache(await getDigestCache(), cacheKey, content, modelFingerprint, settings.contentDigest.cacheDays)
  if (state !== current || location.href !== routeUrl)
    return
  if (cached?.fresh && !force) {
    current.digest = cached.entry.digest
    current.cached = true
    current.stale = false
    current.status = 'ready'
    renderCard()
    return
  }

  const leaseKey = createLeaseKey(cacheKey, content, modelFingerprint)
  const lease = await acquireLease(leaseKey)
  if (state !== current || location.href !== routeUrl) {
    if (lease.ok)
      await releaseLease(leaseKey)
    return
  }
  if (!lease.ok) {
    if (lease.busy) {
      current.status = 'busy'
      renderCard()
      autoTimer = window.setTimeout(startDigestGeneration, Math.min(4_000, Math.max(800, lease.retryAfterMs ?? 2_000)))
      return
    }
    throw new Error(lease.error || '无法协调摘要请求')
  }

  const requestId = ++current.requestId
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const timeout = window.setTimeout(() => controller.abort(), 60_000)

  try {
    const digest = await requestContentDigest(settings, content, controller.signal)
    if (!digest)
      throw new Error('请先在 AI 场景中启用“内容速读”并配置可用 Provider')
    if (state !== current || current.requestId !== requestId || location.href !== routeUrl)
      return

    await saveDigestCacheEntry(cacheKey, createContentDigestCacheEntry(content, digest, modelFingerprint))
    if (state !== current || current.requestId !== requestId || location.href !== routeUrl)
      return
    current.digest = digest
    current.cached = false
    current.stale = false
    current.status = 'ready'
    renderCard()
  }
  catch (error) {
    if (state !== current || current.requestId !== requestId || location.href !== routeUrl)
      return
    current.status = 'error'
    current.message = controller.signal.aborted ? '摘要请求已取消或超时' : error instanceof Error ? error.message : String(error)
    renderCard()
  }
  finally {
    window.clearTimeout(timeout)
    if (activeController === controller)
      activeController = undefined
    await releaseLease(leaseKey)
  }
}

async function refresh() {
  const refreshId = ++refreshEpoch
  const routeUrl = location.href
  if (lastRouteUrl !== routeUrl) {
    lastRouteUrl = routeUrl
    dismissedUrl = ''
  }
  if (dismissedUrl === routeUrl)
    return

  const adapter = findContentAdapter(routeUrl)
  if (!adapter) {
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state = undefined
    removeCard()
    return
  }

  const settings = await getSettings()
  if (refreshId !== refreshEpoch || location.href !== routeUrl)
    return
  if (!settings.contentDigest.enabled || !isSceneEnabled(settings, 'digest', routeUrl)) {
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state = undefined
    removeCard()
    return
  }

  const url = new URL(routeUrl)
  if (!settings.contentDigest.allowNsfw && adapter.isNsfw(document, url)) {
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state = {
      status: 'blocked',
      platformLabel: adapter.label,
      collapsed: false,
      message: 'NSFW 内容速读默认关闭，当前内容没有提取或发送给 AI。',
      requestId: (state?.requestId ?? 0) + 1,
    }
    renderCard()
    return
  }

  const content = adapter.extract(document, url)
  if (!content) {
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state = undefined
    removeCard()
    return
  }
  if (content.nsfw && !settings.contentDigest.allowNsfw) {
    window.clearTimeout(autoTimer)
    activeController?.abort()
    state = {
      status: 'blocked',
      platformLabel: adapter.label,
      collapsed: false,
      message: '检测到 NSFW 标记，当前内容没有发送给 AI。',
      requestId: (state?.requestId ?? 0) + 1,
    }
    renderCard()
    return
  }

  const previous = state
  const identityChanged = previous?.document?.canonicalId !== content.canonicalId
    || previous?.document?.platform !== content.platform
  const sourceChanged = previous?.document?.sourceHash !== content.sourceHash
  if (!identityChanged && !sourceChanged && (previous.status === 'loading' || previous.status === 'ready'))
    return
  if (identityChanged || sourceChanged) {
    if (previous)
      previous.requestId += 1
    activeController?.abort()
  }

  const cacheKey = getContentDigestCacheKey(content)
  const modelFingerprint = getContentDigestModelFingerprint(settings)
  const cached = resolveContentDigestCache(await getDigestCache(), cacheKey, content, modelFingerprint, settings.contentDigest.cacheDays)
  if (refreshId !== refreshEpoch || location.href !== routeUrl)
    return
  if (cached && Date.now() - (cached.entry.lastAccessedAt ?? cached.entry.updatedAt) > 60 * 60 * 1000) {
    void saveDigestCacheEntry(cacheKey, { ...cached.entry, lastAccessedAt: Date.now() })
      .catch(error => console.warn('[Lexi] content digest cache touch failed', error))
  }
  state = {
    status: cached ? 'ready' : 'idle',
    platformLabel: adapter.label,
    document: content,
    digest: cached?.entry.digest,
    cached: Boolean(cached),
    stale: cached ? !cached.fresh : false,
    collapsed: identityChanged ? false : previous?.collapsed ?? false,
    requestId: (previous?.requestId ?? 0) + (identityChanged || sourceChanged ? 1 : 0),
  }
  renderCard()

  window.clearTimeout(autoTimer)
  if (settings.contentDigest.autoGenerate && !cached?.fresh) {
    const delay = Math.max(1_000, settings.contentDigest.autoDelaySeconds * 1000)
    autoTimer = window.setTimeout(startDigestGeneration, delay)
  }
}

export function startContentDigest() {
  if (!hasContentAdapterHost())
    return () => {}

  watcher = startRouteWatcher({
    label: 'Content Digest',
    refresh,
    shouldRefreshMutation: () => Boolean(findContentAdapter()),
    mutationDelayMs: 1400,
    onDispose: () => {
      refreshEpoch += 1
      window.clearTimeout(autoTimer)
      activeController?.abort()
      state = undefined
      removeCard()
    },
    onHidden: () => window.clearTimeout(autoTimer),
    onVisible: () => void refresh(),
  })
  return watcher.stop
}
