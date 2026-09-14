import { readBoundedText } from './subtitleResources'
import { isAllowedYoutubeCaptionUrl } from '~/logic/subtitles/youtubeBridge'

const maxYoutubeCaptionBytes = 4 * 1024 * 1024

export type YoutubeCaptionFetchResult
  = | { ok: true, text: string }
  | { ok: false, error: string }

export interface YoutubeCaptionFetchOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function fetchYoutubeCaptionTrack(
  value: string,
  options: YoutubeCaptionFetchOptions = {},
): Promise<YoutubeCaptionFetchResult> {
  if (!isAllowedYoutubeCaptionUrl(value))
    return { ok: false, error: 'YouTube 字幕地址不允许' }

  const url = new URL(value)
  url.searchParams.set('fmt', 'json3')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  try {
    const response = await fetchImpl(url.href, {
      credentials: 'omit',
      redirect: 'follow',
      signal: options.signal,
      headers: { accept: 'application/json' },
    })
    if ((response.url && !isAllowedYoutubeCaptionUrl(response.url)) || !response.ok)
      return { ok: false, error: `YouTube 字幕获取失败（HTTP ${response.status}）` }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxYoutubeCaptionBytes)
      return { ok: false, error: 'YouTube 字幕响应过大' }

    const body = await readBoundedText(response, maxYoutubeCaptionBytes)
    return 'error' in body ? { ok: false, error: body.error } : { ok: true, text: body.text }
  }
  catch (error) {
    if (options.signal?.aborted)
      return { ok: false, error: 'YouTube 字幕请求已取消' }
    return { ok: false, error: error instanceof Error ? error.message : 'YouTube 字幕读取失败' }
  }
}
