/**
 * The allowlist for Apple's Events media CDN, kept in `logic` so both the worker and any
 * content-side caller share one pure predicate. The worker is the only context that acts
 * on it; the content side uses it merely to reject a captured link early.
 */

/** Apple delivers Events media from this origin and nowhere else. */
export const subtitleResourceHost = 'events-delivery.apple.com'

export const maxSubtitleResourceBytes = 4 * 1024 * 1024

/**
 * Fails closed: no local/LAN names, no plaintext, no ports, no embedded credentials, and
 * no host that merely *ends with* the allowed name (`events-delivery.apple.com.evil`).
 */
export function isAllowedSubtitleResourceUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    return false
  }

  return url.protocol === 'https:'
    && url.hostname === subtitleResourceHost
    && url.port === ''
    && !url.username
    && !url.password
}
