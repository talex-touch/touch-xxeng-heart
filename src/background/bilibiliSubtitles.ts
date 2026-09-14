import { readBoundedText } from './subtitleResources'
import { isRecord } from '~/logic/providers/protocol'
import { isBilibiliVideoPage } from '~/logic/subtitles/bilibili'
import type { BilibiliSubtitleResponse, BilibiliSubtitleTrack } from '~/logic/subtitles/bilibili'
import { normalizeSubtitleCues } from '~/logic/subtitles/webvtt'
import type { SubtitleCue } from '~/logic/subtitles/types'

const bilibiliApiOrigin = 'https://api.bilibili.com'
const maxMetadataBytes = 512 * 1024
const maxSubtitleBytes = 2 * 1024 * 1024
const maxSubtitleTracks = 16
const maxSubtitleCues = 20_000
const maxCueTextLength = 1000

interface BilibiliVideoIdentity {
  bvid?: string
  aid?: number
  page: number
}

function readVideoIdentity(pageUrl: string): BilibiliVideoIdentity | undefined {
  if (!isBilibiliVideoPage(pageUrl))
    return undefined

  const url = new URL(pageUrl)
  const segment = url.pathname.split('/').filter(Boolean)[1] ?? ''
  const requestedPage = Number(url.searchParams.get('p'))
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  if (/^BV[0-9A-Z]+$/i.test(segment))
    return { bvid: segment, page }

  const aid = Number(/^av(\d+)$/i.exec(segment)?.[1])
  return Number.isSafeInteger(aid) && aid > 0 ? { aid, page } : undefined
}

function isAllowedBilibiliApiUrl(value: string) {
  try {
    const url = new URL(value)
    return url.origin === bilibiliApiOrigin
      && (url.pathname === '/x/web-interface/view' || url.pathname === '/x/player/v2')
  }
  catch {
    return false
  }
}

export function isAllowedBilibiliSubtitleUrl(value: string) {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    const subtitlePath = /^\/bfs\/(?:ai_)?subtitle\//.test(url.pathname)
    return url.protocol === 'https:'
      && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))
      && subtitlePath
  }
  catch {
    return false
  }
}

async function fetchBoundedJson(
  url: string,
  options: {
    credentials: RequestCredentials
    maxBytes: number
    allowedUrl: (value: string) => boolean
    fetchImpl: typeof fetch
  },
): Promise<unknown> {
  if (!options.allowedUrl(url))
    throw new Error('Bilibili 请求地址不允许')

  const response = await options.fetchImpl(url, {
    credentials: options.credentials,
    redirect: 'follow',
    headers: { accept: 'application/json' },
  })
  if ((response.url && !options.allowedUrl(response.url)) || !response.ok)
    throw new Error('Bilibili 字幕服务不可用')

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes)
    throw new Error('Bilibili 字幕响应过大')

  const body = await readBoundedText(response, options.maxBytes)
  if ('error' in body)
    throw new Error(body.error)

  try {
    return JSON.parse(body.text) as unknown
  }
  catch {
    throw new Error('Bilibili 字幕响应无法解析')
  }
}

function finitePositive(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function finiteNonNegative(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function readVideoView(payload: unknown, requestedPage: number) {
  if (!isRecord(payload) || Number(payload.code) !== 0 || !isRecord(payload.data))
    return undefined

  const data = payload.data
  const aid = finitePositive(data.aid)
  const bvid = typeof data.bvid === 'string' && /^BV[0-9A-Z]+$/i.test(data.bvid) ? data.bvid : undefined
  const pages = Array.isArray(data.pages) ? data.pages : []
  const pageValue = pages[Math.min(Math.max(0, requestedPage - 1), Math.max(0, pages.length - 1))]
  const page = isRecord(pageValue) ? pageValue : undefined
  const cid = finitePositive(page?.cid) ?? finitePositive(data.cid)
  if (!aid || !cid)
    return undefined

  return { aid, bvid, cid }
}

function readTrackDescriptors(payload: unknown) {
  if (!isRecord(payload) || Number(payload.code) !== 0 || !isRecord(payload.data))
    return []

  const subtitle = isRecord(payload.data.subtitle) ? payload.data.subtitle : undefined
  if (!Array.isArray(subtitle?.subtitles))
    return []

  return subtitle.subtitles.slice(0, maxSubtitleTracks).flatMap((item): Array<{
    language: string
    label: string
    kind: 'native' | 'auto'
    url: string
  }> => {
    if (!isRecord(item))
      return []

    const source = item
    const language = typeof source.lan === 'string' ? source.lan.trim() : ''
    const label = typeof source.lan_doc === 'string' ? source.lan_doc.trim() : ''
    const rawUrl = typeof source.subtitle_url === 'string' ? source.subtitle_url.trim() : ''
    const url = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
    if (!language || !url || !isAllowedBilibiliSubtitleUrl(url))
      return []

    const automatic = /^ai[-_]/i.test(language) || /AI|自动/.test(label) || Number(source.type) === 1
    return [{ language, label: label || language, kind: automatic ? 'auto' : 'native', url }]
  })
}

function readSubtitleCues(payload: unknown): SubtitleCue[] {
  if (!isRecord(payload) || !Array.isArray(payload.body))
    return []

  const body = payload.body

  const cues: SubtitleCue[] = []
  for (const item of body.slice(0, maxSubtitleCues)) {
    if (!isRecord(item))
      continue

    const source = item
    const start = finiteNonNegative(source.from)
    const end = finitePositive(source.to)
    const text = typeof source.content === 'string'
      ? source.content.replace(/\s+/g, ' ').trim().slice(0, maxCueTextLength)
      : ''
    if (start === undefined || end === undefined || end <= start || !text)
      continue

    cues.push({ start, end, text })
  }

  return normalizeSubtitleCues(cues)
}

export interface ResolveBilibiliSubtitleOptions {
  fetchImpl?: typeof fetch
}

export async function resolveBilibiliSubtitles(
  pageUrl: string,
  options: ResolveBilibiliSubtitleOptions = {},
): Promise<BilibiliSubtitleResponse> {
  const identity = readVideoIdentity(pageUrl)
  if (!identity)
    return { ok: false, error: '不是受支持的 Bilibili 视频页' }

  // A bare `fetch` reference loses its global `this` inside the service worker, where the
  // call then throws "Illegal invocation" before any request is made.
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  try {
    const viewUrl = new URL('/x/web-interface/view', bilibiliApiOrigin)
    if (identity.bvid)
      viewUrl.searchParams.set('bvid', identity.bvid)
    else
      viewUrl.searchParams.set('aid', String(identity.aid))

    const viewPayload = await fetchBoundedJson(viewUrl.href, {
      credentials: 'include',
      maxBytes: maxMetadataBytes,
      allowedUrl: isAllowedBilibiliApiUrl,
      fetchImpl,
    })
    const view = readVideoView(viewPayload, identity.page)
    if (!view)
      return { ok: false, error: '无法识别 Bilibili 视频信息' }

    const playerUrl = new URL('/x/player/v2', bilibiliApiOrigin)
    playerUrl.searchParams.set('aid', String(view.aid))
    playerUrl.searchParams.set('cid', String(view.cid))
    if (view.bvid)
      playerUrl.searchParams.set('bvid', view.bvid)

    const playerPayload = await fetchBoundedJson(playerUrl.href, {
      credentials: 'include',
      maxBytes: maxMetadataBytes,
      allowedUrl: isAllowedBilibiliApiUrl,
      fetchImpl,
    })
    const descriptors = readTrackDescriptors(playerPayload)
    if (!descriptors.length)
      return { ok: true, mediaId: `bilibili:${view.bvid || view.aid}:${view.cid}`, tracks: [] }

    const tracks: BilibiliSubtitleTrack[] = []
    for (const descriptor of descriptors) {
      try {
        const payload = await fetchBoundedJson(descriptor.url, {
          credentials: 'omit',
          maxBytes: maxSubtitleBytes,
          allowedUrl: isAllowedBilibiliSubtitleUrl,
          fetchImpl,
        })
        const cues = readSubtitleCues(payload)
        if (cues.length) {
          tracks.push({
            language: descriptor.language,
            label: descriptor.label,
            kind: descriptor.kind,
            cues,
          })
        }
      }
      catch {
        // One broken rendition must not discard other languages or the HTML5 fallback.
      }
    }

    return {
      ok: true,
      mediaId: `bilibili:${view.bvid || view.aid}:${view.cid}`,
      tracks,
    }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Bilibili 字幕读取失败' }
  }
}
