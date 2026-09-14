import { ensurePageStyles } from './pageEnhancerStyles'
import { renderAnimatedText } from './ui/animatedText'
import { elementToDataUrl } from './ui/canvas'
import { createCollapsible } from './ui/collapsible'
import type { CollapsibleHandle } from './ui/collapsible'
import { overlayRect, positionAgainstAnchor } from './ui/position'
import { requestMediaAnalysis } from '~/logic/aiClient'
import { defaultSettings } from '~/logic/defaults'
import { sendRuntimeMessage } from '~/logic/runtimeMessaging'
import { getStoredState } from '~/logic/settingsCache'
import { isSceneEnabled } from '~/logic/siteRules'
import type { SiteDetectionHints } from '~/logic/siteRules'

export interface MediaTargetInfo {
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
  answer: HTMLElement
  copy: HTMLButtonElement
  collapsible: CollapsibleHandle
  promptText?: string
  frameDataUrl?: string
  mediaDataUrl?: string
}

export interface MediaToolsController {
  findTarget: (target: EventTarget | null) => MediaTargetInfo | undefined
  open: (target: MediaTargetInfo) => void
  close: () => void
  reposition: () => void
}

interface MediaToolsOptions {
  readSiteHints: () => SiteDetectionHints
  showToast: (message: string, customCss: string) => void
}

function readMediaTarget(target: EventTarget | null): MediaTargetInfo | undefined {
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

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, location.href)
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '')
    return name || fallback
  }
  catch {
    return fallback
  }
}

function mediaRadius(anchor: Element) {
  const radius = getComputedStyle(anchor).borderRadius
  if (radius && radius !== '0px')
    return radius

  const parentRadius = anchor.parentElement ? getComputedStyle(anchor.parentElement).borderRadius : ''
  return parentRadius && parentRadius !== '0px' ? parentRadius : '12px'
}

function positionMediaUi(state: MediaToolbarState) {
  overlayRect(state.highlight, state.element, mediaRadius(state.element))
  positionAgainstAnchor(state.toolbar, state.element.getBoundingClientRect(), {
    fallbackWidth: Math.min(360, window.innerWidth - 24),
    fallbackHeight: 160,
  })
}

function mediaPageContext(element: Element) {
  const container = element.closest('figure, article, section, main, div')
  return (container?.textContent || document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 900)
}

export function createMediaToolsController(options: MediaToolsOptions): MediaToolsController {
  let state: MediaToolbarState | undefined

  const close = () => {
    state?.collapsible.destroy()
    state?.highlight.remove()
    state?.toolbar.remove()
    state = undefined
  }

  const reposition = () => {
    if (!state)
      return
    if (!state.element.isConnected) {
      close()
      return
    }

    positionMediaUi(state)
  }

  const analyze = async () => {
    const active = state
    if (!active)
      return

    const { settings } = await getStoredState()
    if (!isSceneEnabled(settings, 'omni', location.href, options.readSiteHints()) || !settings.ai.omni.enabled) {
      active.answer.textContent = 'AI Omni 多模态场景未启用。请在选项页启用并配置支持 vision 的模型。'
      return
    }

    const updateAnswer = (text: string, revealChunk = true) => {
      if (state !== active)
        return

      active.promptText = text
      active.copy.disabled = !text.trim() || text === '分析中...'
      const previous = active.answer.textContent ?? ''
      renderAnimatedText(active.answer, text, previous, revealChunk)
    }

    updateAnswer('分析中...', false)
    if (active.kind === 'video' && active.element instanceof HTMLVideoElement)
      active.frameDataUrl = elementToDataUrl(active.element, active.element.videoWidth, active.element.videoHeight)
    else if (active.kind === 'image' && active.element instanceof HTMLImageElement)
      active.mediaDataUrl = await elementToDataUrl(active.element, active.element.naturalWidth, active.element.naturalHeight)

    try {
      const text = await requestMediaAnalysis(settings, {
        kind: active.kind,
        src: active.src,
        pageUrl: location.href,
        pageTitle: document.title,
        title: active.title,
        alt: active.alt,
        mimeType: active.mimeType,
        currentTime: active.currentTime,
        duration: active.duration,
        width: active.width,
        height: active.height,
        poster: active.poster,
        frameDataUrl: active.frameDataUrl,
        mediaDataUrl: active.mediaDataUrl,
        context: mediaPageContext(active.element),
      }, updateAnswer)
      if (state === active && text)
        updateAnswer(text)
    }
    catch (error) {
      if (state === active)
        updateAnswer(error instanceof Error ? error.message : '分析失败', false)
    }
  }

  const download = async () => {
    const active = state
    if (!active)
      return

    const filename = `Lexi/${fileNameFromUrl(active.src, `media-${Date.now()}`)}`
    const response = await sendRuntimeMessage<{ ok?: boolean, error?: string }>('lexi-download-media', {
      url: active.src,
      filename,
    })
    const { settings } = await getStoredState()
    options.showToast(response.ok ? '已交给浏览器下载。' : response.error || '下载失败', settings.ui.customCss)
  }

  const copyPrompt = async () => {
    const prompt = state?.promptText?.trim()
    if (!prompt)
      return

    const { settings } = await getStoredState()
    await navigator.clipboard.writeText(prompt)
    options.showToast('Prompt 已复制。', settings.ui.customCss)
  }

  const open = (info: MediaTargetInfo) => {
    close()

    if (!document.getElementById('lexi-page-style'))
      ensurePageStyles(defaultSettings.ui.customCss)

    const highlight = document.createElement('div')
    const toolbar = document.createElement('section')
    const head = document.createElement('div')
    const title = document.createElement('div')
    const closeButton = document.createElement('button')
    const meta = document.createElement('div')
    const actions = document.createElement('div')
    const downloadButton = document.createElement('button')
    const analyzeButton = document.createElement('button')
    const copyButton = document.createElement('button')
    const answer = document.createElement('div')

    highlight.dataset.lexiMediaHighlight = 'true'
    highlight.className = 'lexi-media-highlight'
    toolbar.dataset.lexiMediaToolbar = 'true'
    toolbar.className = 'lexi-media-toolbar'
    head.className = 'lexi-media-toolbar__head'
    title.className = 'lexi-media-toolbar__title'
    closeButton.className = 'lexi-media-toolbar__close'
    meta.className = 'lexi-media-toolbar__meta'
    actions.className = 'lexi-media-toolbar__actions'
    downloadButton.className = 'lexi-media-toolbar__button'
    analyzeButton.className = 'lexi-media-toolbar__button'
    copyButton.className = 'lexi-media-toolbar__button'
    answer.className = 'lexi-media-toolbar__answer'

    closeButton.type = 'button'
    downloadButton.type = 'button'
    analyzeButton.type = 'button'
    copyButton.type = 'button'
    title.textContent = `${info.kind === 'image' ? '图片' : info.kind === 'video' ? '视频' : info.kind === 'audio' ? '音频' : '媒体'}操作`
    closeButton.textContent = '×'
    meta.textContent = [
      info.title || info.alt || fileNameFromUrl(info.src, info.src),
      info.width && info.height ? `${info.width}×${info.height}` : '',
    ].filter(Boolean).join(' · ')
    downloadButton.textContent = '下载媒体'
    analyzeButton.textContent = '提取还原 Prompt'
    copyButton.textContent = '复制 Prompt'
    copyButton.disabled = true
    answer.textContent = '点击“提取还原 Prompt”，会输出用于还原这张图的纯文本 prompt。'

    closeButton.addEventListener('click', close)
    downloadButton.addEventListener('click', () => download().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '下载失败'
    }))
    analyzeButton.addEventListener('click', () => analyze().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '分析失败'
    }))
    copyButton.addEventListener('click', () => copyPrompt().catch((error) => {
      answer.textContent = error instanceof Error ? error.message : '复制失败'
    }))

    const collapsible = createCollapsible(toolbar, {
      block: 'lexi-media-toolbar',
      label: '媒体操作',
      summary: info.title || info.alt || fileNameFromUrl(info.src, info.src),
      onToggle: reposition,
    })

    head.append(title, collapsible.toggle, closeButton)
    actions.append(analyzeButton, copyButton, downloadButton)
    const body = document.createElement('div')
    body.className = 'lexi-media-toolbar__body'
    body.append(meta, actions, answer)
    toolbar.append(collapsible.pill, head, body)
    document.documentElement.append(highlight, toolbar)
    state = { ...info, toolbar, highlight, answer, copy: copyButton, collapsible }
    positionMediaUi(state)
  }

  return {
    findTarget: readMediaTarget,
    open,
    close,
    reposition,
  }
}
