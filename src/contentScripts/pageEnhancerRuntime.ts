import { startForumDigest } from './forumDigest'
import { startGitHubDigest } from './githubDigest'
import { startPageEnhancer } from './pageEnhancer'
import type { PageStats } from './pageEnhancer'

const fallbackStats: PageStats = {
  replacements: 0,
  records: 0,
  enabled: false,
  showFloatingStatus: false,
}

let currentStats = fallbackStats
let stopEnhancer: (() => void) | undefined
const listeners = new Set<(stats: PageStats) => void>()

export function ensurePageEnhancer() {
  if (stopEnhancer)
    return

  stopEnhancer = startPageEnhancer({
    onStats(stats) {
      currentStats = stats
      listeners.forEach(listener => listener(stats))
    },
  })
  if (window.top !== window)
    return

  const startTopFrameFeatures = () => {
    startGitHubDigest()
    startForumDigest()
  }
  if (document.body)
    startTopFrameFeatures()
  else
    document.addEventListener('DOMContentLoaded', startTopFrameFeatures, { once: true })
}

export function subscribePageStats(listener: (stats: PageStats) => void) {
  listener(currentStats)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
