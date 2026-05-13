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
  quickDigest?: GitHubDigestResult
  detailDigest?: GitHubDigestResult
  error?: string
  cachedQuick?: boolean
  cachedDetail?: boolean
}

let cardState: DigestCardState | undefined
let routeInterval: number | undefined
let mutationTimer: number | undefined
let autoTimer: number | undefined
let lastUrl = ''
let disposed = false

function isGitHubRepoPage() {
  if (location.hostname !== 'github.com')
    return false

  const parts = location.pathname.split('/').filter(Boolean)
  if (parts.length < 2)
    return false

  const blocked = new Set(['settings', 'notifications', 'pulls', 'issues', 'explore', 'marketplace', 'topics', 'collections', 'sponsors', 'orgs', 'enterprises'])
  return !blocked.has(parts[0]) && !blocked.has(parts[1])
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
  return document.querySelector<HTMLElement>('.Layout-sidebar, [data-testid="repository-sidebar"], aside')
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
    key: `github.com:${repoPath.repo}`,
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

  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
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
    <p class="lexi-github-digest__desc">${escapeHtml(digest.oneLine)}</p>
    ${digest.details ? `<p class="lexi-github-digest__detail-text">${escapeHtml(digest.details)}</p>` : ''}
    ${options.detail ? `<div class="lexi-github-digest__section"><strong>适合谁</strong>${createList(digest.audience, '暂无受众信息')}</div>` : ''}
    ${options.detail ? `<div class="lexi-github-digest__section"><strong>先看哪里</strong>${createList(digest.startHere, '暂无入口建议')}</div>` : ''}
    <div class="lexi-github-digest__actions">
      <button data-lexi-github-action="generate">${options.detail ? '重新生成详细总览' : '生成详细总览'}</button>
      ${options.detail ? '<button data-lexi-github-action="copy">复制</button>' : ''}
    </div>
    <p class="lexi-github-digest__hint">${options.cached ? '来自本地缓存 · ' : ''}${options.detail ? '详细总览' : '基础速读'} · ${options.detail ? '已结合 README 和当前页面内容' : '停留约 18 秒或点击按钮生成详细总览'}</p>
  `
}

function updateCardContent(element: HTMLElement, html: string) {
  const from = element.getBoundingClientRect()
  element.innerHTML = html
  const to = element.getBoundingClientRect()
  if (!from.height || Math.abs(from.height - to.height) < 1)
    return

  element.animate([
    { height: `${from.height}px`, transform: 'scale(0.995)', opacity: 0.92 },
    { height: `${to.height}px`, transform: 'scale(1)', opacity: 1 },
  ], {
    duration: 220,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  })
}

function renderCard() {
  if (!cardState)
    return

  const { element, info, status, quickDigest, detailDigest, error, cachedQuick, cachedDetail } = cardState
  const statusLabel = status === 'quick-loading'
    ? '速读中...'
    : status === 'detail-loading'
      ? '总览中...'
      : status === 'detail-ready'
        ? '详细总览'
        : status === 'error'
          ? '生成失败'
          : '速读'
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
            ? `<p class="lexi-github-digest__desc">${escapeHtml(error || '生成失败')}</p><div class="lexi-github-digest__actions"><button data-lexi-github-action="generate">重试</button><button data-lexi-github-action="hide">关闭</button></div>`
            : getDigestSummary(fallbackQuick, { detail: false })

  updateCardContent(element, `
    <div class="lexi-github-digest__head">
      <div>
        <div class="lexi-github-digest__eyebrow">GitHub Digest</div>
        <div class="lexi-github-digest__title">Lexi 速读</div>
      </div>
      <span>${statusLabel}</span>
    </div>
    <div class="lexi-github-digest__repo">${escapeHtml(info.repo)}${info.private ? ' · Private' : ''}</div>
    ${body}
  `)
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
    .lexi-github-digest--sticky { position: sticky; top: 16px; z-index: 20; }
    .lexi-github-digest__head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    .lexi-github-digest__head span { border-radius: 999px; background: var(--bgColor-accent-muted, var(--color-accent-subtle, #ddf4ff)); color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); padding: 2px 7px; font-size: 11px; white-space: nowrap; }
    .lexi-github-digest__eyebrow { color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); font-size: 11px; font-weight: 700; letter-spacing: .02em; }
    .lexi-github-digest__title { margin-top: 1px; font-size: 15px; font-weight: 700; }
    .lexi-github-digest__repo { margin-top: 8px; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; word-break: break-word; }
    .lexi-github-digest__desc { margin: 10px 0 0; color: var(--fgColor-default, var(--color-fg-default, #1f2328)); }
    .lexi-github-digest__detail-text { margin: 8px 0 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; }
    .lexi-github-digest__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .lexi-github-digest__chips span { border: 1px solid var(--borderColor-accent-muted, var(--color-accent-muted, #b6e3ff)); border-radius: 999px; background: var(--bgColor-accent-muted, var(--color-accent-subtle, #ddf4ff)); color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); padding: 2px 7px; font-size: 11px; }
    .lexi-github-digest__section { margin-top: 11px; }
    .lexi-github-digest__section strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .lexi-github-digest ul { margin: 0; padding-left: 18px; }
    .lexi-github-digest li { margin: 2px 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); }
    .lexi-github-digest__terms, .lexi-github-digest__hint, .lexi-github-digest__muted { margin: 10px 0 0; color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); font-size: 12px; }
    .lexi-github-digest__loading { margin-top: 12px; border-radius: 10px; background: linear-gradient(100deg, rgba(99,102,241,0.12), rgba(14,165,233,0.18), rgba(168,85,247,0.12), rgba(99,102,241,0.12)); background-size: 240% 100%; padding: 10px; color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); animation: lexi-github-digest-ai-gradient 1.15s ease-in-out infinite; }
    .lexi-github-digest__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .lexi-github-digest__actions button { border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de)); border-radius: 6px; background: var(--bgColor-default, var(--color-canvas-default, #ffffff)); color: var(--fgColor-default, var(--color-fg-default, #1f2328)); cursor: pointer; font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 7px 9px; }
    .lexi-github-digest__actions button:first-child { border-color: var(--button-primary-borderColor-rest, #1f883d); background: var(--button-primary-bgColor-rest, #1f883d); color: var(--button-primary-fgColor-rest, #ffffff); }
    @keyframes lexi-github-digest-ai-gradient { from { background-position-x: 120%; filter: saturate(1); } 50% { filter: saturate(1.32); } to { background-position-x: -120%; filter: saturate(1); } }
    @media (prefers-reduced-motion: reduce) {
      .lexi-github-digest__loading { animation: none; }
    }
  `
  document.documentElement.appendChild(style)
}

function updateStickyCardMode(element: HTMLElement) {
  if (!findRepoSidebar() || element.classList.contains('lexi-github-digest--floating'))
    return

  element.classList.toggle('lexi-github-digest--sticky', window.scrollY > 160)
}

function placeCard(element: HTMLElement) {
  const target = findRepoSidebar() ?? findAboutBox()
  if (target) {
    element.classList.remove('lexi-github-digest--floating')
    if (element.parentElement !== target)
      target.prepend(element)
    updateStickyCardMode(element)
    return
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
  cardState = { element, info, status: 'quick-loading' }

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

function getCachedEntry(cache: GitHubDigestCache, info: GitHubRepoInfo, settings: LexiSettings) {
  const entry = cache[info.key]
  if (!entry || entry.sourceHash !== info.sourceHash)
    return undefined

  const ttl = Math.max(1, settings.githubDigest.cacheDays) * 24 * 60 * 60 * 1000
  return Date.now() - entry.updatedAt <= ttl ? entry : undefined
}

function createCacheEntry(info: GitHubRepoInfo, current?: GitHubDigestCacheEntry): GitHubDigestCacheEntry {
  return {
    repo: info.repo,
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
    const digest = await requestGitHubDigest(settings, {
      repo: state.info.repo,
      description: state.info.description,
      topics: state.info.topics,
      languages: state.info.languages,
      files: state.info.files,
      readme: state.info.readme,
      pageText: state.info.pageText,
      mode: 'quick',
    })
    if (!digest)
      throw new Error('AI 未返回有效速读。请确认每日推荐 AI 场景已配置。')

    const entry = createCacheEntry(state.info, cache[state.info.key])
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
    const digest = await requestGitHubDigest(settings, {
      repo: state.info.repo,
      description: state.info.description,
      topics: state.info.topics,
      languages: state.info.languages,
      files: state.info.files,
      readme: state.info.readme,
      pageText: state.info.pageText,
      mode: 'detail',
    })
    if (!digest)
      throw new Error('AI 未返回有效总览。请确认每日推荐 AI 场景已配置。')

    const entry = createCacheEntry(state.info, cache[state.info.key])
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
  if (action === 'generate')
    void generateDetailDigest(true)
  else if (action === 'refresh')
    void generateDetailDigest(true)
  else if (action === 'copy')
    void copyDigest()
  else if (action === 'collapse' || action === 'hide')
    removeCard()
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
    void generateDetailDigest(false)
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
    placeCard(cardState.element)
    if (cardState.status === 'quick-ready' || cardState.status === 'error')
      renderCard()
    return
  }

  mountCard(info)
  const cache = await getDigestCache()
  const cached = getCachedEntry(cache, info, settings)
  if (cached?.quickDigest && cardState) {
    cardState.quickDigest = cached.quickDigest
    cardState.cachedQuick = true
    cardState.status = 'quick-ready'
    renderCard()
  }
  else {
    void generateQuickDigest(false)
  }

  if (cached?.digest && cardState) {
    cardState.detailDigest = cached.digest
    cardState.cachedDetail = true
  }

  await scheduleAutoGenerate(info)
}

function checkRoute() {
  if (lastUrl === location.href)
    return

  lastUrl = location.href
  window.setTimeout(() => {
    refresh().catch(error => console.warn('[Lexi] GitHub Digest refresh failed', error))
  }, 700)
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    if (cardState?.status === 'quick-ready')
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

  disposed = false
  lastUrl = location.href
  refresh().catch(error => console.warn('[Lexi] GitHub Digest init failed', error))
  routeInterval = window.setInterval(checkRoute, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('scroll', onScroll, { passive: true })

  const observer = new MutationObserver(() => {
    window.clearTimeout(mutationTimer)
    mutationTimer = window.setTimeout(() => {
      refresh().catch(error => console.warn('[Lexi] GitHub Digest mutation refresh failed', error))
    }, 900)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    disposed = true
    observer.disconnect()
    window.clearInterval(routeInterval)
    window.clearTimeout(mutationTimer)
    window.clearTimeout(autoTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('scroll', onScroll)
    removeCard()
  }
}
