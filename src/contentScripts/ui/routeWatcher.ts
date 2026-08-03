import { isExtensionContextInvalidated } from '~/contentScripts/extensionContext'

export interface RouteWatcherOptions {
  /** Label used in console warnings, e.g. "GitHub Digest". */
  label: string
  /** Re-evaluate the page. Called on init, SPA navigation, DOM mutation and tab focus. */
  refresh: () => Promise<void>
  /** Called when the extension context dies, so the caller can tear its UI down. */
  onDispose: () => void
  /** Skip mutation refreshes while the caller has no relevant page mounted. */
  shouldRefreshMutation?: () => boolean
  /** Debounce for DOM-mutation triggered refreshes. */
  mutationDelayMs?: number
  /** Delay after a URL change, giving the SPA time to swap the view in. */
  navigationDelayMs?: number
  /** Fires when the tab becomes visible again; used to resume deferred work. */
  onVisible?: () => void
  /** Fires when the tab is hidden; used to cancel timers. */
  onHidden?: () => void
}

export interface RouteWatcher {
  stop: () => void
  /** True once the watcher has been torn down. */
  readonly disposed: boolean
}

/**
 * The SPA lifecycle every content-script surface needs: poll for URL changes, debounce
 * DOM mutations, pause on hidden tabs, and self-destruct when the extension reloads.
 * Previously duplicated verbatim in githubDigest and forumDigest.
 */
export function startRouteWatcher(options: RouteWatcherOptions): RouteWatcher {
  const mutationDelayMs = options.mutationDelayMs ?? 900
  const navigationDelayMs = options.navigationDelayMs ?? 700

  let disposed = false
  let lastUrl = location.href
  let routeInterval: number | undefined
  let mutationTimer: number | undefined
  let navigationTimer: number | undefined
  let observer: MutationObserver | undefined

  const stop = () => {
    if (disposed)
      return

    disposed = true
    observer?.disconnect()
    window.clearInterval(routeInterval)
    window.clearTimeout(mutationTimer)
    window.clearTimeout(navigationTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    options.onDispose()
  }

  const run = (reason: string) => {
    if (disposed)
      return

    options.refresh().catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        stop()
        return
      }

      console.warn(`[Lexi] ${options.label} ${reason} failed`, error)
    })
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible')
      options.onVisible?.()
    else
      options.onHidden?.()
  }

  const checkRoute = () => {
    if (lastUrl === location.href)
      return

    lastUrl = location.href
    window.clearTimeout(navigationTimer)
    navigationTimer = window.setTimeout(() => run('navigation refresh'), navigationDelayMs)
  }

  run('init')
  routeInterval = window.setInterval(checkRoute, 1000)
  document.addEventListener('visibilitychange', onVisibilityChange)

  observer = new MutationObserver(() => {
    if (options.shouldRefreshMutation && !options.shouldRefreshMutation())
      return

    window.clearTimeout(mutationTimer)
    mutationTimer = window.setTimeout(() => run('mutation refresh'), mutationDelayMs)
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return {
    stop,
    get disposed() {
      return disposed
    },
  }
}
