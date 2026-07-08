import browser from 'webextension-polyfill'
import { requestGitHubDigest } from '~/logic/aiClient'
import { mergeSettings } from '~/logic/defaults'
import { githubDigestStorageKey, settingsStorageKey } from '~/logic/storageKeys'
import type { GitHubDigestCache, GitHubDigestCacheEntry, GitHubDigestResult, LexiSettings } from '~/logic/types'

interface GitHubRepoInfo {
  owner: string
  name: string
  repo: string
  key: string
  description: string
  topics: string[]
  languages: string[]
  files: string[]
  readme: string
  pageText: string
  private: boolean
  sourceHash: string
}

interface DigestCardState {
  element: HTMLElement
  info: GitHubRepoInfo
  status: 'quick-loading' | 'quick-ready' | 'detail-loading' | 'detail-ready' | 'error'
  collapsed: boolean
  isHome: boolean
  quickDigest?: GitHubDigestResult
  detailDigest?: GitHubDigestResult
  error?: string
  cachedQuick?: boolean
  cachedDetail?: boolean
  lastRenderedHtml?: string
}

let cardState: DigestCardState | undefined
let routeInterval: number | undefined
let mutationTimer: number | undefined
let autoTimer: number | undefined
let lastUrl = ''
let disposed = false
let stopGitHubDigest: (() => void) | undefined

function isExtensionContextInvalidated(error: unknown) {
  return error instanceof Error && /Extension context invalidated/i.test(error.message)
}

function isGitHubRepoPage() {
  if (location.hostname !== 'github.com')
    return false

  const parts = location.pathname.split('/').filter(Boolean)
  if (parts.length < 2)
    return false

  const blockedOwners = new Set([
    'about',
    'account',
    'apps',
    'codespaces',
    'collections',
    'contact',
    'customer-stories',
    'dashboard',
    'enterprise',
    'enterprises',
    'events',
    'explore',
    'features',
    'issues',
    'login',
    'logout',
    'marketplace',
    'new',
    'notifications',
    'orgs',
    'organizations',
    'pricing',
    'pulls',
    'search',
    'security',
    'sessions',
    'settings',
    'signup',
    'site',
    'sponsors',
    'topics',
  ])
  if (blockedOwners.has(parts[0]))
    return false

  return true
}

function isGitHubRepoHomePage() {
  if (location.hostname !== 'github.com')
    return false

  return location.pathname.split('/').filter(Boolean).length === 2
}

function getRepoPath() {
  const [owner, name] = location.pathname.split('/').filter(Boolean)
  if (!owner || !name)
    return undefined

  return { owner, name, repo: `${owner}/${name}` }
}

function normalizeText(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function uniq(values: string[]) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
}

function simpleHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1)
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0

  return Math.abs(hash).toString(36)
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

async function getSettings() {
  const stored = await browser.storage.local.get(settingsStorageKey)
  return mergeSettings(readJsonValue<Partial<LexiSettings> | undefined>(stored[settingsStorageKey], undefined))
}

async function getDigestCache() {
  const stored = await browser.storage.local.get(githubDigestStorageKey)
  return readJsonValue<GitHubDigestCache>(stored[githubDigestStorageKey], {})
}

async function saveDigestCache(cache: GitHubDigestCache) {
  await browser.storage.local.set({ [githubDigestStorageKey]: JSON.stringify(cache) })
}

function findRepoSidebar() {
  return document.querySelector<HTMLElement>('.Layout-sidebar, [data-testid="repository-sidebar"]')
    ?? document.querySelector<HTMLElement>('aside[aria-label*="Repository"], aside.Layout-sidebar')
}

function findAboutBox() {
  return document.querySelector<HTMLElement>('[data-testid="repository-about"], .BorderGrid')
}

function getDescription() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content
    ?.replace(/^GitHub - [^:]+:\s*/i, '')
  const about = document.querySelector<HTMLElement>('[data-testid="repository-about"] p, .BorderGrid p')?.textContent
  const header = document.querySelector<HTMLElement>('[itemprop="about"]')?.textContent
  return normalizeText(about || header || meta)
}

function getTopics() {
  return uniq([
    ...Array.from(document.querySelectorAll<HTMLElement>('[data-testid="repository-topic"], a.topic-tag'))
      .map(element => element.textContent ?? ''),
  ]).slice(0, 12)
}

function getLanguages() {
  return uniq(Array.from(document.querySelectorAll<HTMLElement>('[data-ga-click*="Repository, language stats search click"], .Progress + ul a, [data-testid="repository-language-stats"] a'))
    .map(element => normalizeText(element.textContent).replace(/\s+[0-9.]+%$/, ''))).slice(0, 8)
}

function getVisibleFiles() {
  return uniq(Array.from(document.querySelectorAll<HTMLElement>('[aria-labelledby="files"] a.Link--primary, div[role="row"] a.Link--primary, .react-directory-row-name-cell-large-screen a'))
    .map(element => element.textContent ?? '')).slice(0, 28)
}

function getReadmeText() {
  const readme = document.querySelector<HTMLElement>('#readme article, [data-testid="readme"] article, article.markdown-body')
  return normalizeText(readme?.textContent).slice(0, 5200)
}

function getPageText() {
  const main = document.querySelector<HTMLElement>('main')
  return normalizeText(main?.textContent ?? document.body.textContent).slice(0, 5200)
}

function isPrivateRepo() {
  return /\bPrivate\b/i.test(document.querySelector<HTMLElement>('[title="Label: Private"], .Label')?.textContent ?? '')
    || /\bPrivate\b/i.test(document.querySelector<HTMLElement>('[data-testid="repository-header"]')?.textContent ?? '')
}

function collectRepoInfo(): GitHubRepoInfo | undefined {
  const repoPath = getRepoPath()
  if (!repoPath)
    return undefined

  const description = getDescription()
  const topics = getTopics()
  const languages = getLanguages()
  const files = getVisibleFiles()
  const readme = getReadmeText()
  const pageText = getPageText()
  const source = JSON.stringify({ description, topics, languages, files, readme: readme.slice(0, 4200), pageText: pageText.slice(0, 1800) })

  return {
    ...repoPath,
    key: `github.com:${repoPath.owner}/${repoPath.name}`.toLowerCase(),
    description,
    topics,
    languages,
    files,
    readme,
    pageText,
    private: isPrivateRepo(),
    sourceHash: simpleHash(source),
  }
}

function createList(items: string[], emptyText: string) {
  if (!items.length)
    return `<p class="lexi-github-digest__muted">${emptyText}</p>`

  return `<ul>${items.map(item => `<li class="lexi-github-digest__typewriter">${escapeHtml(item)}</li>`).join('')}</ul>`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getFallbackQuickSummary(info: GitHubRepoInfo) {
  return {
    oneLine: `${info.repo} 项目速读生成中。`,
    details: '正在翻译项目介绍并生成 AI 点评。',
    audience: [],
    techStack: [],
    startHere: [],
    terms: [],
  }
}

function getDigestSummary(digest: GitHubDigestResult, options: { detail: boolean, cached?: boolean }) {
  return `
    <p class="lexi-github-digest__desc lexi-github-digest__typewriter">${escapeHtml(digest.oneLine)}</p>
    ${digest.details ? `<p class="lexi-github-digest__detail-text lexi-github-digest__typewriter">${escapeHtml(digest.details)}</p>` : ''}
    ${options.detail ? `<div class="lexi-github-digest__section"><strong>适合谁</strong>${createList(digest.audience, '暂无受众信息')}</div>` : ''}
    ${options.detail ? `<div class="lexi-github-digest__section"><strong>先看哪里</strong>${createList(digest.startHere, '暂无入口建议')}</div>` : ''}
    <div class="lexi-github-digest__actions">
      <button data-lexi-github-action="generate">${options.detail ? '重新生成详细总览' : '生成详细总览'}</button>
      ${options.detail ? '<button data-lexi-github-action="copy">复制</button>' : ''}
      ${cardState?.isHome ? '' : '<button data-lexi-github-action="collapse">收起</button>'}
    </div>
    ${options.cached ? '<p class="lexi-github-digest__hint">来自本地缓存</p>' : ''}
  `
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer))
  })
}

function runTypewriterAnimation(element: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return

  const targets = Array.from(element.querySelectorAll<HTMLElement>('.lexi-github-digest__typewriter'))
  let groupDelay = 0
  for (const target of targets) {
    const text = target.textContent ?? ''
    if (!text.trim())
      continue

    target.textContent = ''
    target.setAttribute('aria-label', text)
    Array.from(text).forEach((char, index) => {
      const span = document.createElement('span')
      span.className = 'lexi-github-digest__char'
      span.textContent = char
      span.style.animationDelay = `${groupDelay + Math.min(index * 16, 1200)}ms`
      target.append(span)
    })
    groupDelay += Math.min(520, Math.max(180, text.length * 10))
  }
}

function updateCardContent(element: HTMLElement, html: string) {
  const from = element.getBoundingClientRect()
  const fromRadius = getComputedStyle(element).borderRadius
  element.innerHTML = html
  runTypewriterAnimation(element)
  const to = element.getBoundingClientRect()
  const toRadius = getComputedStyle(element).borderRadius
  if (!from.height || (!Math.abs(from.height - to.height) && !Math.abs(from.width - to.width)))
    return

  element.animate([
    {
      width: `${from.width}px`,
      height: `${from.height}px`,
      borderRadius: fromRadius,
      opacity: 0.86,
      filter: 'blur(1px) saturate(1.12)',
      transform: 'perspective(900px) rotateX(-7deg) scale(0.985)',
    },
    {
      width: `${to.width}px`,
      height: `${to.height}px`,
      borderRadius: toRadius,
      opacity: 1,
      filter: 'blur(0) saturate(1)',
      transform: 'perspective(900px) rotateX(0) scale(1)',
    },
  ], {
    duration: 360,
    easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
  })
}

function renderCard() {
  if (!cardState)
    return

  const { element, info, status, quickDigest, detailDigest, error, cachedQuick, cachedDetail } = cardState
  const collapsedClass = cardState.collapsed ? ' lexi-github-digest--collapsed' : ''
  const placeClass = cardState.isHome ? ' lexi-github-digest--home' : ' lexi-github-digest--repo-subpage'
  element.className = `lexi-github-digest${collapsedClass}${placeClass}${element.classList.contains('lexi-github-digest--floating') ? ' lexi-github-digest--floating' : ''}${element.classList.contains('lexi-github-digest--sticky') ? ' lexi-github-digest--sticky' : ''}`
  element.dataset.lexiCollapsed = cardState.collapsed ? 'true' : 'false'
  const statusLabel = status === 'quick-loading'
    ? '速读中...'
    : status === 'detail-loading'
      ? '总览中...'
      : status === 'detail-ready'
        ? '详细总览'
        : status === 'error'
          ? '生成失败'
          : '速读'
  const statusClass = status === 'error'
    ? 'lexi-github-digest__status lexi-github-digest__status--error'
    : 'lexi-github-digest__status'
  const fallbackQuick = getFallbackQuickSummary(info)
  const body = status === 'quick-loading'
    ? `${getDigestSummary(fallbackQuick, { detail: false })}<div class="lexi-github-digest__loading">正在翻译项目介绍、生成 AI 点评...</div>`
    : status === 'detail-loading'
      ? `${getDigestSummary(quickDigest ?? fallbackQuick, { detail: false, cached: cachedQuick })}<div class="lexi-github-digest__loading">正在结合 README 和当前页面内容生成详细总览...</div>`
      : status === 'detail-ready' && detailDigest
        ? getDigestSummary(detailDigest, { detail: true, cached: cachedDetail })
        : status === 'quick-ready' && quickDigest
          ? getDigestSummary(quickDigest, { detail: false, cached: cachedQuick })
          : status === 'error'
            ? `<p class="lexi-github-digest__desc lexi-github-digest__error">${escapeHtml(error || '生成失败')}</p><div class="lexi-github-digest__actions"><button data-lexi-github-action="generate">重试</button><button data-lexi-github-action="hide">关闭</button></div>`
            : getDigestSummary(fallbackQuick, { detail: false })

  const html = `
    <button class="lexi-github-digest__collapsed-toggle" type="button" data-lexi-github-action="expand" aria-label="展开 Lexi 速读">
      <span>Lexi 速读</span>
      <strong>${escapeHtml(info.name)}</strong>
    </button>
    <div class="lexi-github-digest__content">
      <div class="lexi-github-digest__head">
        <div>
          <div class="lexi-github-digest__eyebrow">GitHub Digest</div>
          <div class="lexi-github-digest__title">Lexi 速读</div>
        </div>
        <span class="${statusClass}">${statusLabel}</span>
      </div>
      <div class="lexi-github-digest__repo">${escapeHtml(info.repo)}${info.private ? ' · Private' : ''}</div>
      ${body}
    </div>
  `

  if (cardState.lastRenderedHtml === html)
    return

  cardState.lastRenderedHtml = html
  updateCardContent(element, html)
}

function ensureStyles() {
  if (document.getElementById('lexi-github-digest-style'))
    return

  const style = document.createElement('style')
  style.id = 'lexi-github-digest-style'
  style.textContent = `
    .lexi-github-digest {
      box-sizing: border-box;
      margin: 0 0 16px;
      border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de));
      border-radius: 12px;
      background: color-mix(in srgb, var(--bgColor-default, var(--color-canvas-default, #ffffff)) 92%, transparent);
      box-shadow: 0 8px 22px rgba(27, 31, 36, 0.08);
      backdrop-filter: blur(8px) saturate(1.04);
      -webkit-backdrop-filter: blur(8px) saturate(1.04);
      color: var(--fgColor-default, var(--color-fg-default, #1f2328));
      padding: 12px;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      transform-origin: top center;
      will-change: height, transform, opacity;
    }
    .lexi-github-digest *, .lexi-github-digest *::before, .lexi-github-digest *::after { box-sizing: border-box; }
    .lexi-github-digest--floating { position: fixed; right: 18px; top: 96px; z-index: 2147483647; width: min(340px, calc(100vw - 36px)); }
    .lexi-github-digest--sticky { position: sticky; top: 16px; z-index: 20; align-self: flex-start; }
    .lexi-github-digest__content { transform-origin: top right; animation: lexi-github-digest-content-flip 320ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }
    .lexi-github-digest__collapsed-toggle { display: none; width: 100%; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; transform-origin: center; animation: lexi-github-digest-toggle-flip 260ms cubic-bezier(0.2, 0.9, 0.2, 1) both; }
    .lexi-github-digest__collapsed-toggle span { display: block; color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); font-size: 11px; font-weight: 700; }
    .lexi-github-digest__collapsed-toggle strong { display: block; overflow: hidden; margin-top: 1px; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .lexi-github-digest--collapsed { width: 132px; min-height: 0; padding: 9px 10px; border-radius: 999px; box-shadow: 0 10px 28px rgba(27, 31, 36, 0.14); }
    .lexi-github-digest--collapsed .lexi-github-digest__collapsed-toggle { display: block; }
    .lexi-github-digest--collapsed .lexi-github-digest__content { display: none; }
    .lexi-github-digest--collapsed.lexi-github-digest--floating { right: 14px; top: 96px; width: 132px; }
    .lexi-github-digest__head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    .lexi-github-digest__status { border-radius: 999px; background: var(--bgColor-accent-muted, var(--color-accent-subtle, #ddf4ff)); color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); padding: 2px 7px; font-size: 11px; white-space: nowrap; }
    .lexi-github-digest__status--error { background: var(--bgColor-danger-muted, var(--color-danger-subtle, #ffebe9)); color: var(--fgColor-danger, var(--color-danger-fg, #cf222e)); }
    .lexi-github-digest__eyebrow { color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); font-size: 11px; font-weight: 700; letter-spacing: .02em; }
    .lexi-github-digest__title { margin-top: 1px; font-size: 15px; font-weight: 700; }
    .lexi-github-digest__repo { margin-top: 8px; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; word-break: break-word; }
    .lexi-github-digest__desc { margin: 10px 0 0; color: var(--fgColor-default, var(--color-fg-default, #1f2328)); }
    .lexi-github-digest__error { color: var(--fgColor-danger, var(--color-danger-fg, #cf222e)); }
    .lexi-github-digest__detail-text { margin: 8px 0 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; }
    .lexi-github-digest__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .lexi-github-digest__chips span { border: 1px solid var(--borderColor-accent-muted, var(--color-accent-muted, #b6e3ff)); border-radius: 999px; background: var(--bgColor-accent-muted, var(--color-accent-subtle, #ddf4ff)); color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); padding: 2px 7px; font-size: 11px; }
    .lexi-github-digest__section { margin-top: 11px; }
    .lexi-github-digest__section strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .lexi-github-digest ul { margin: 0; padding-left: 18px; }
    .lexi-github-digest li { margin: 2px 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); }
    .lexi-github-digest__terms, .lexi-github-digest__hint, .lexi-github-digest__muted { margin: 10px 0 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; }
    .lexi-github-digest__char { display: inline-block; opacity: 0; filter: blur(2px); transform: translateY(2px); animation: lexi-github-digest-char-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards; white-space: pre-wrap; }
    .lexi-github-digest__loading { margin-top: 12px; border-radius: 10px; background: linear-gradient(100deg, rgba(99,102,241,0.12), rgba(14,165,233,0.18), rgba(168,85,247,0.12), rgba(99,102,241,0.12)); background-size: 240% 100%; padding: 10px; color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); animation: lexi-github-digest-ai-gradient 1.15s ease-in-out infinite; }
    .lexi-github-digest__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .lexi-github-digest__actions button { border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de)); border-radius: 6px; background: var(--bgColor-default, var(--color-canvas-default, #ffffff)); color: var(--fgColor-default, var(--color-fg-default, #1f2328)); cursor: pointer; font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 7px 9px; }
    .lexi-github-digest__actions button:first-child { border-color: var(--button-primary-borderColor-rest, #1f883d); background: var(--button-primary-bgColor-rest, #1f883d); color: var(--button-primary-fgColor-rest, #ffffff); }
    @keyframes lexi-github-digest-content-flip { from { opacity: 0; filter: blur(5px); transform: perspective(900px) rotateX(-12deg) translateY(-6px) scale(0.98); } to { opacity: 1; filter: blur(0); transform: perspective(900px) rotateX(0) translateY(0) scale(1); } }
    @keyframes lexi-github-digest-toggle-flip { from { opacity: 0; filter: blur(4px); transform: perspective(600px) rotateX(16deg) scale(0.94); } to { opacity: 1; filter: blur(0); transform: perspective(600px) rotateX(0) scale(1); } }
    @keyframes lexi-github-digest-char-in { to { opacity: 1; filter: blur(0); transform: translateY(0); } }
    @keyframes lexi-github-digest-ai-gradient { from { background-position-x: 120%; filter: saturate(1); } 50% { filter: saturate(1.32); } to { background-position-x: -120%; filter: saturate(1); } }
    @media (prefers-reduced-motion: reduce) {
      .lexi-github-digest__content, .lexi-github-digest__collapsed-toggle, .lexi-github-digest__char, .lexi-github-digest__loading { animation: none; opacity: 1; filter: none; transform: none; }
    }
  `
  document.documentElement.appendChild(style)
}

function updateStickyCardMode(element: HTMLElement) {
  if (!findRepoSidebar() || element.classList.contains('lexi-github-digest--floating'))
    return

  element.classList.add('lexi-github-digest--sticky')
}

function placeCard(element: HTMLElement) {
  if (cardState?.isHome) {
    const target = findRepoSidebar() ?? findAboutBox()
    if (target) {
      element.classList.remove('lexi-github-digest--floating')
      if (element.parentElement !== target)
        target.prepend(element)
      updateStickyCardMode(element)
      return
    }
  }

  element.classList.add('lexi-github-digest--floating')
  element.classList.remove('lexi-github-digest--sticky')
  if (element.parentElement !== document.body)
    document.body.appendChild(element)
}

function mountCard(info: GitHubRepoInfo) {
  ensureStyles()
  cardState?.element.remove()

  const element = document.createElement('section')
  element.className = 'lexi-github-digest'
  element.dataset.lexiGithubDigest = 'true'
  const isHome = isGitHubRepoHomePage()
  cardState = { element, info, status: 'quick-ready', collapsed: !isHome, isHome }

  placeCard(element)

  element.addEventListener('click', onCardClick)
  renderCard()
}

function removeCard() {
  window.clearTimeout(autoTimer)
  cardState?.element.removeEventListener('click', onCardClick)
  cardState?.element.remove()
  cardState = undefined
}

function getLegacyCacheKeys(info: GitHubRepoInfo) {
  return [
    info.key,
    `github.com:${info.repo}`,
    `github.com:${info.repo}`.toLowerCase(),
    info.repo,
    info.repo.toLowerCase(),
    info.name,
  ].filter(Boolean)
}

function getCachedEntry(cache: GitHubDigestCache, info: GitHubRepoInfo, settings: LexiSettings) {
  const entry = getLegacyCacheKeys(info).map(key => cache[key]).find(Boolean)
  if (!entry)
    return undefined

  const ttl = Math.max(1, settings.githubDigest.cacheDays) * 24 * 60 * 60 * 1000
  return Date.now() - entry.updatedAt <= ttl ? entry : undefined
}

function createCacheEntry(info: GitHubRepoInfo, current?: GitHubDigestCacheEntry): GitHubDigestCacheEntry {
  return {
    repo: info.repo,
    owner: info.owner,
    name: info.name,
    description: info.description,
    topics: info.topics,
    languages: info.languages,
    quickDigest: current?.quickDigest,
    digest: current?.digest,
    sourceHash: info.sourceHash,
    updatedAt: Date.now(),
  }
}

async function generateQuickDigest(force = false) {
  if (!cardState || cardState.status === 'quick-loading' || cardState.status === 'detail-loading')
    return

  const state = cardState
  const settings = await getSettings()
  if (!settings.githubDigest.enabled)
    return

  const cache = await getDigestCache()
  const cached = !force ? getCachedEntry(cache, state.info, settings)?.quickDigest : undefined
  if (cached) {
    state.quickDigest = cached
    state.cachedQuick = true
    state.status = 'quick-ready'
    renderCard()
    return
  }

  state.status = 'quick-loading'
  state.error = undefined
  renderCard()

  try {
    const digest = await withTimeout(requestGitHubDigest(settings, {
      repo: state.info.repo,
      description: state.info.description,
      topics: state.info.topics,
      languages: state.info.languages,
      files: state.info.files,
      readme: state.info.readme,
      pageText: state.info.pageText,
      mode: 'quick',
    }), 25000, '速读生成超时，请稍后重试或检查 AI 后端。')
    if (!digest)
      throw new Error('AI 未返回有效速读。请确认每日推荐 AI 场景已配置。')

    const entry = createCacheEntry(state.info, getCachedEntry(cache, state.info, settings))
    entry.quickDigest = digest
    cache[state.info.key] = entry
    await saveDigestCache(cache)
    state.quickDigest = digest
    state.cachedQuick = false
    state.status = 'quick-ready'
  }
  catch (error) {
    state.status = 'error'
    state.error = error instanceof Error ? error.message : '生成失败'
  }
  finally {
    renderCard()
  }
}

async function generateDetailDigest(force = false) {
  if (!cardState || cardState.status === 'quick-loading' || cardState.status === 'detail-loading')
    return

  const state = cardState
  const settings = await getSettings()
  if (!settings.githubDigest.enabled)
    return

  const cache = await getDigestCache()
  const cached = !force ? getCachedEntry(cache, state.info, settings)?.digest : undefined
  if (cached) {
    state.detailDigest = cached
    state.cachedDetail = true
    state.status = 'detail-ready'
    renderCard()
    return
  }

  state.status = 'detail-loading'
  state.error = undefined
  renderCard()

  try {
    const digest = await withTimeout(requestGitHubDigest(settings, {
      repo: state.info.repo,
      description: state.info.description,
      topics: state.info.topics,
      languages: state.info.languages,
      files: state.info.files,
      readme: state.info.readme,
      pageText: state.info.pageText,
      mode: 'detail',
    }), 45000, '详细总览生成超时，请稍后重试或检查 AI 后端。')
    if (!digest)
      throw new Error('AI 未返回有效总览。请确认每日推荐 AI 场景已配置。')

    const entry = createCacheEntry(state.info, getCachedEntry(cache, state.info, settings))
    entry.digest = digest
    cache[state.info.key] = entry
    await saveDigestCache(cache)
    state.detailDigest = digest
    state.cachedDetail = false
    state.status = 'detail-ready'
  }
  catch (error) {
    state.status = 'error'
    state.error = error instanceof Error ? error.message : '生成失败'
  }
  finally {
    renderCard()
  }
}

async function copyDigest() {
  const digest = cardState?.detailDigest ?? cardState?.quickDigest
  if (!cardState || !digest)
    return

  const text = [
    `# Lexi 速读：${cardState.info.repo}`,
    '',
    `一句话：${digest.oneLine}`,
    '',
    digest.techStack.length ? `技术线索：${digest.techStack.join(' · ')}` : '',
    digest.audience.length ? `适合谁：\n${digest.audience.map(item => `- ${item}`).join('\n')}` : '',
    digest.startHere.length ? `先看哪里：\n${digest.startHere.map(item => `- ${item}`).join('\n')}` : '',
    digest.terms.length ? `相关术语：${digest.terms.join(', ')}` : '',
  ].filter(Boolean).join('\n\n')

  await navigator.clipboard.writeText(text)
}

function onCardClick(event: Event) {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-lexi-github-action]')
    : undefined
  if (!target)
    return

  const action = target.dataset.lexiGithubAction
  if (action === 'expand' && cardState) {
    cardState.lastRenderedHtml = undefined
    cardState.collapsed = false
    renderCard()
  }
  else if (action === 'generate') {
    void generateDetailDigest(true)
  }
  else if (action === 'refresh') {
    void generateDetailDigest(true)
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

async function scheduleAutoGenerate(info: GitHubRepoInfo) {
  window.clearTimeout(autoTimer)
  const settings = await getSettings()
  if (!settings.githubDigest.enabled || !settings.githubDigest.autoGenerate)
    return

  if (info.private && !settings.githubDigest.allowPrivateAutoGenerate)
    return

  const delay = Math.max(1200, settings.githubDigest.autoDelaySeconds * 1000)
  autoTimer = window.setTimeout(() => {
    void generateDetailDigest(false).catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        stopGitHubDigest?.()
        return
      }

      console.warn('[Lexi] GitHub Digest auto generate failed', error)
    })
  }, delay)
}

async function refresh() {
  if (disposed)
    return

  if (!isGitHubRepoPage()) {
    removeCard()
    return
  }

  const settings = await getSettings()
  if (!settings.githubDigest.enabled) {
    removeCard()
    return
  }

  const info = collectRepoInfo()
  if (!info)
    return

  if (cardState?.info.key === info.key) {
    cardState.info = info
    cardState.isHome = isGitHubRepoHomePage()
    if (cardState.isHome)
      cardState.collapsed = false
    else if (lastUrl !== location.href)
      cardState.collapsed = true
    placeCard(cardState.element)
    renderCard()
    return
  }

  mountCard(info)
  const cache = await getDigestCache()
  const cached = getCachedEntry(cache, info, settings)
  if (cached?.quickDigest && cardState) {
    cardState.quickDigest = cached.quickDigest
    cardState.cachedQuick = true
    cardState.status = cached.digest ? 'detail-ready' : 'quick-ready'
  }

  if (cached?.digest && cardState) {
    cardState.detailDigest = cached.digest
    cardState.cachedDetail = true
    cardState.status = 'detail-ready'
  }

  if (cached?.quickDigest || cached?.digest) {
    renderCard()
  }
  else {
    void generateQuickDigest(false)
  }

  if (!cached?.digest)
    await scheduleAutoGenerate(info)
}

function checkRoute() {
  if (lastUrl === location.href)
    return

  lastUrl = location.href
  window.setTimeout(() => {
    refresh().catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        stopGitHubDigest?.()
        return
      }

      console.warn('[Lexi] GitHub Digest refresh failed', error)
    })
  }, 700)
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    if (cardState?.status === 'quick-ready' && !cardState.detailDigest)
      void scheduleAutoGenerate(cardState.info)
  }
  else {
    window.clearTimeout(autoTimer)
  }
}

function onScroll() {
  if (cardState)
    updateStickyCardMode(cardState.element)
}

export function startGitHubDigest() {
  if (location.hostname !== 'github.com')
    return () => {}

  let observer: MutationObserver | undefined
  const stop = () => {
    disposed = true
    observer?.disconnect()
    window.clearInterval(routeInterval)
    window.clearTimeout(mutationTimer)
    window.clearTimeout(autoTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('scroll', onScroll)
    removeCard()
  }
  const handleRefreshError = (message: string, error: unknown) => {
    if (isExtensionContextInvalidated(error)) {
      stop()
      return
    }

    console.warn(message, error)
  }
  stopGitHubDigest = stop

  disposed = false
  lastUrl = location.href
  refresh().catch(error => handleRefreshError('[Lexi] GitHub Digest init failed', error))
  routeInterval = window.setInterval(checkRoute, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('scroll', onScroll, { passive: true })

  observer = new MutationObserver(() => {
    window.clearTimeout(mutationTimer)
    mutationTimer = window.setTimeout(() => {
      refresh().catch(error => handleRefreshError('[Lexi] GitHub Digest mutation refresh failed', error))
    }, 900)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return stop
}
