/**
 * The worker is the only context allowed to reach Apple's media CDN: a content script
 * cannot complete a cross-origin read, and the page's cookies must not travel with the
 * request. This handler is deliberately inert — it forwards exactly one host over HTTPS
 * and refuses anything else, so it can never become an open fetch proxy for a page.
 */

import { isAllowedSubtitleResourceUrl, maxSubtitleResourceBytes } from '~/logic/subtitles/resourcePolicy'

// Re-exported so the policy stays discoverable from the worker module that enforces it.
export { isAllowedSubtitleResourceUrl, maxSubtitleResourceBytes, subtitleResourceHost } from '~/logic/subtitles/resourcePolicy'

export type SubtitleResourceResult =
  | { ok: true, text: string, contentType: string }
  | { ok: false, error: string }

export interface SubtitleResourceFetchOptions {
  fetchImpl?: typeof fetch
  maxBytes?: number
  signal?: AbortSignal
}

function clampMaxBytes(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0)
    return maxSubtitleResourceBytes

  return Math.min(Math.max(Math.floor(value), 1024), maxSubtitleResourceBytes)
}

function decodeBody(chunks: Uint8Array[], total: number) {
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder('utf-8').decode(merged)
}

/**
 * Bounded body read. `Content-Length` is checked first, but it is advisory — a chunked
 * or lying response must still be cut off mid-stream rather than buffered whole.
 */
export async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string } | { error: string }> {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    // Measure encoded bytes, not code units: a CJK subtitle would otherwise slip past a
    // character-count limit several times over.
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      return { error: '字幕资源过大' }

    return { text }
  }

  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    if (!value)
      continue

    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { error: '字幕资源过大' }
    }

    chunks.push(value)
  }

  return { text: decodeBody(chunks, total) }
}

export async function fetchSubtitleResource(
  url: string,
  options: SubtitleResourceFetchOptions = {},
): Promise<SubtitleResourceResult> {
  if (!isAllowedSubtitleResourceUrl(url))
    return { ok: false, error: '字幕资源地址不允许' }

  const maxBytes = clampMaxBytes(options.maxBytes)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)

  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: options.signal,
    })

    // Redirects are followed by the platform, so the origin is re-checked on the final
    // response URL. A redirect off the allowed host is rejected, not silently read.
    if (response.url && !isAllowedSubtitleResourceUrl(response.url))
      return { ok: false, error: '字幕资源重定向到不允许的地址' }

    if (!response.ok)
      return { ok: false, error: `字幕资源获取失败（HTTP ${response.status}）` }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
      return { ok: false, error: '字幕资源过大' }

    const text = await readBoundedText(response, maxBytes)
    if ('error' in text)
      return { ok: false, error: text.error }

    return { ok: true, text: text.text, contentType: response.headers.get('content-type') ?? '' }
  }
  catch (error) {
    if (options.signal?.aborted)
      return { ok: false, error: '字幕资源请求已取消' }

    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
