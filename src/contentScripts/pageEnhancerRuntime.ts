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
  startGitHubDigest()
}

export function subscribePageStats(listener: (stats: PageStats) => void) {
  listener(currentStats)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
