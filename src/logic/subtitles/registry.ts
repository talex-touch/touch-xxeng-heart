import type { SubtitleProvider, SubtitleSource } from './types'

export interface ResolvedSubtitleSource {
  provider: SubtitleProvider
  source: SubtitleSource
}

/**
 * Walks providers in priority order and returns the first that can serve the page.
 *
 * A provider that throws is treated as one that declined — a broken YouTube bridge should
 * fall through to the plain `<track>` reader, not take the feature down with it.
 */
export async function resolveSubtitleSource(
  providers: SubtitleProvider[],
  url: URL,
  options: { signal?: AbortSignal, allowBillable?: boolean } = {},
): Promise<ResolvedSubtitleSource | undefined> {
  const candidates = providers
    .filter(provider => options.allowBillable !== false || !provider.billable)
    .filter(provider => provider.match(url))
    .sort((a, b) => a.priority - b.priority)

  for (const provider of candidates) {
    if (options.signal?.aborted)
      return undefined

    try {
      const source = await provider.resolve(url, options.signal)
      if (source)
        return { provider, source }
    }
    catch {
      continue
    }
  }

  return undefined
}
