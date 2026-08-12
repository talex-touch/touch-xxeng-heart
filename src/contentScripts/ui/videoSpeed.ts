import { createListenerGroup, pointerEventName } from './listenerGroup'
import { positionAgainstAnchor } from './position'

interface VideoSpeedMenuState {
  menu: HTMLDialogElement
  video: HTMLVideoElement
  previousRate: number
  selectedRate: number
}

const styleId = 'lexi-video-speed-style'

function ensureVideoSpeedStyles() {
  if (document.getElementById(styleId))
    return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    .lexi-video-speed-menu {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      inset: auto;
      z-index: 2147483647;
      display: grid;
      margin: 0;
      gap: 10px;
      width: min(300px, calc(100vw - 24px));
      border: 1px solid #272c36;
      border-radius: 12px;
      background: #0d0f14;
      box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.4);
      color: #ffffff;
      padding: 12px;
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .lexi-video-speed-menu:not([open]) { display: none; }
    .lexi-video-speed-menu::backdrop { background: transparent; }
    .lexi-video-speed-menu * { box-sizing: border-box; font-family: inherit; }
    .lexi-video-speed-menu__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .lexi-video-speed-menu__title { font-weight: 750; letter-spacing: 0; }
    .lexi-video-speed-menu__hint { color: #a6adbb; font-size: 11px; }
    .lexi-video-speed-menu__rates { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
    .lexi-video-speed-menu__rate {
      min-width: 36px;
      min-height: 36px;
      border: 1px solid #272c36;
      border-radius: 8px;
      background: #161a21;
      color: #a6adbb;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      padding: 8px 4px;
      text-align: center;
    }
    .lexi-video-speed-menu__rate:hover,
    .lexi-video-speed-menu__rate:focus-visible,
    .lexi-video-speed-menu__rate--active {
      border-color: #6fa8ff;
      outline: 2px solid transparent;
      background: #1976ff;
      color: #fff;
    }
    @media (prefers-reduced-motion: reduce) {
      .lexi-video-speed-menu, .lexi-video-speed-menu * { scroll-behavior: auto !important; }
    }
  `
  document.documentElement.append(style)
}

function isMacPlatform() {
  return /\bMac|iPhone|iPad|iPod\b/i.test(navigator.platform)
}

function getVideoFromEventTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : undefined
  if (!element)
    return undefined

  if (element instanceof HTMLVideoElement)
    return element

  return element.closest<HTMLVideoElement>('video') ?? undefined
}

function getVideoAtPoint(clientX: number, clientY: number, root: Document | ShadowRoot = document) {
  let bestMatch: HTMLVideoElement | undefined
  let bestArea = Number.POSITIVE_INFINITY

  for (const video of Array.from(root.querySelectorAll<HTMLVideoElement>('video'))) {
    const rect = video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      continue

    const style = getComputedStyle(video)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0)
      continue

    const area = rect.width * rect.height
    if (area < bestArea) {
      bestMatch = video
      bestArea = area
    }
  }

  const elements = root instanceof Document
    ? root.elementsFromPoint(clientX, clientY)
    : Array.from(root.querySelectorAll('*'))
  for (const element of elements) {
    if (!element.shadowRoot)
      continue

    const shadowVideo = getVideoAtPoint(clientX, clientY, element.shadowRoot)
    if (!shadowVideo)
      continue

    const rect = shadowVideo.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area < bestArea) {
      bestMatch = shadowVideo
      bestArea = area
    }
  }

  return bestMatch
}

function getVideoFromPointerTarget(target: EventTarget | null, clientX: number, clientY: number) {
  const video = getVideoFromEventTarget(target)
  if (video)
    return video

  const element = target instanceof Element ? target : undefined
  return element?.shadowRoot ? getVideoAtPoint(clientX, clientY, element.shadowRoot) : undefined
}

function getVideoFromPointerEvent(event: MouseEvent | PointerEvent) {
  for (const target of event.composedPath()) {
    const video = getVideoFromPointerTarget(target, event.clientX, event.clientY)
    if (video)
      return video
  }

  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    const video = getVideoFromPointerTarget(element, event.clientX, event.clientY)
    if (video)
      return video
  }

  return getVideoAtPoint(event.clientX, event.clientY)
}

function positionVideoSpeedMenu(menu: HTMLElement, video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect()
  positionAgainstAnchor(menu, {
    ...rect.toJSON(),
    bottom: rect.top,
    top: rect.top - 16,
  }, { align: 'end', gap: 0, fallbackWidth: 300, fallbackHeight: 100 })
}

function promoteVideoSpeedMenu(menu: HTMLDialogElement) {
  if (menu.parentElement !== document.documentElement)
    document.documentElement.append(menu)

  if (menu.open)
    menu.close()

  if (document.fullscreenElement)
    menu.showModal()
  else
    menu.show()
}

export function startVideoSpeedControl() {
  const listeners = createListenerGroup()
  let state: VideoSpeedMenuState | undefined
  let activeGesture: { video: HTMLVideoElement, pointerId?: number } | undefined
  let lastGesture: { video: HTMLVideoElement, at: number } | undefined

  const onVideoSpeedChange = (event: Event) => {
    const video = event.currentTarget
    if (state && video === state.video && video instanceof HTMLVideoElement && video.playbackRate !== state.selectedRate)
      video.playbackRate = state.selectedRate
  }

  const close = () => {
    if (!state)
      return

    const current = state
    state = undefined
    current.video.removeEventListener('playing', onVideoSpeedChange)
    current.video.removeEventListener('ratechange', onVideoSpeedChange)
    if (current.menu.open)
      current.menu.close()
    current.menu.remove()
    current.video.playbackRate = current.previousRate
  }

  const update = (current: VideoSpeedMenuState) => {
    current.video.playbackRate = current.selectedRate
    current.menu.querySelectorAll<HTMLButtonElement>('[data-lexi-video-rate]').forEach((button) => {
      button.classList.toggle('lexi-video-speed-menu__rate--active', Number(button.dataset.lexiVideoRate) === current.selectedRate)
    })
  }

  const show = (video: HTMLVideoElement) => {
    if (state?.video === video) {
      positionVideoSpeedMenu(state.menu, video)
      return
    }

    close()
    ensureVideoSpeedStyles()
    const menu = document.createElement('dialog')
    const head = document.createElement('div')
    const title = document.createElement('strong')
    const hint = document.createElement('span')
    const rates = document.createElement('div')
    const current: VideoSpeedMenuState = {
      menu,
      video,
      previousRate: video.playbackRate,
      selectedRate: 2,
    }

    menu.dataset.lexiVideoSpeedMenu = 'true'
    menu.className = 'lexi-video-speed-menu'
    menu.setAttribute('aria-label', '视频倍速')
    menu.addEventListener('cancel', (event) => {
      event.preventDefault()
      close()
    })
    head.className = 'lexi-video-speed-menu__head'
    title.className = 'lexi-video-speed-menu__title'
    hint.className = 'lexi-video-speed-menu__hint'
    rates.className = 'lexi-video-speed-menu__rates'
    title.textContent = '倍速播放'
    hint.textContent = isMacPlatform()
      ? '⌘ + 双指点按/右键再次关闭 · Esc 恢复原速'
      : 'Ctrl + 左键再次关闭 · Esc 恢复原速'

    for (const rate of [1, 1.25, 1.5, 2, 3, 4]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'lexi-video-speed-menu__rate'
      button.dataset.lexiVideoRate = String(rate)
      button.textContent = `${rate}×`
      button.setAttribute('aria-label', `${rate} 倍速`)
      button.addEventListener('click', () => {
        current.selectedRate = rate
        update(current)
      })
      rates.append(button)
    }

    head.append(title, hint)
    menu.append(head, rates)
    promoteVideoSpeedMenu(menu)
    state = current
    video.addEventListener('playing', onVideoSpeedChange)
    video.addEventListener('ratechange', onVideoSpeedChange)
    update(current)
    positionVideoSpeedMenu(menu, video)
  }

  const getGestureVideo = (event: MouseEvent | PointerEvent) => {
    const target = event.target instanceof Element ? event.target : undefined
    if (target?.closest('[data-lexi-video-speed-menu]'))
      return undefined

    const matches = isMacPlatform()
      ? event.button === 2 && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      : event.button === 0 && event.ctrlKey
    return matches ? getVideoFromPointerEvent(event) : undefined
  }

  const consume = (event: MouseEvent | PointerEvent) => {
    if (!getGestureVideo(event))
      return false

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return true
  }

  const toggle = (video: HTMLVideoElement) => {
    if (state?.video === video)
      close()
    else
      show(video)
    lastGesture = { video, at: performance.now() }
  }

  const onPointerDown = (event: MouseEvent | PointerEvent) => {
    const video = getGestureVideo(event)
    if (!video)
      return

    toggle(video)
    activeGesture = { video, pointerId: event instanceof PointerEvent ? event.pointerId : undefined }
    consume(event)
  }

  const onPointerUp = (event: MouseEvent | PointerEvent) => {
    const video = getGestureVideo(event)
    if (!video)
      return

    const active = activeGesture?.video === video
      && (!(event instanceof PointerEvent) || activeGesture.pointerId === event.pointerId)
    if (active) {
      activeGesture = undefined
      lastGesture = { video, at: performance.now() }
    }
    else if (lastGesture?.video !== video || performance.now() - lastGesture.at > 500) {
      toggle(video)
    }
    consume(event)
  }

  const onContextMenu = (event: MouseEvent) => {
    const video = getGestureVideo(event)
    if (!video)
      return

    if (activeGesture?.video !== video && (lastGesture?.video !== video || performance.now() - lastGesture.at > 500))
      toggle(video)
    consume(event)
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (activeGesture?.pointerId !== event.pointerId)
      return

    lastGesture = { video: activeGesture.video, at: performance.now() }
    activeGesture = undefined
  }

  const reposition = () => {
    if (state)
      positionVideoSpeedMenu(state.menu, state.video)
  }
  const onFullscreenChange = () => {
    if (!state)
      return
    promoteVideoSpeedMenu(state.menu)
    reposition()
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape')
      close()
  }

  listeners.add(window, pointerEventName('down'), onPointerDown, true)
  listeners.add(window, pointerEventName('up'), onPointerUp, true)
  listeners.add(window, 'pointercancel', onPointerCancel, true)
  listeners.add(window, 'contextmenu', onContextMenu, true)
  listeners.add(window, 'click', consume, true)
  listeners.add(window, 'auxclick', consume, true)
  listeners.add(window, 'scroll', reposition, { passive: true, capture: true })
  listeners.add(window, 'resize', reposition)
  listeners.add(document, 'fullscreenchange', onFullscreenChange)
  listeners.add(document, 'keydown', onKeydown, true)

  return () => {
    activeGesture = undefined
    listeners.removeAll()
    close()
  }
}
