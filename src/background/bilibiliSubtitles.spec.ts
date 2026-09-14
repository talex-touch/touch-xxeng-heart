import { describe, expect, it, vi } from 'vitest'
import { isAllowedBilibiliSubtitleUrl, resolveBilibiliSubtitles } from './bilibiliSubtitles'

// The resolver imports `isBilibiliVideoPage`, which reaches the runtime-messaging module;
// this spec never sends a message, but the polyfill refuses to load outside an extension.
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } },
}))

interface ResponsePlan {
  status?: number
  payload?: unknown
  body?: string
  contentLength?: number
  /** Where the platform says the response actually came from after any redirect. */
  redirectedTo?: string
}

function jsonResponse(url: string, plan: ResponsePlan): Response {
  const status = plan.status ?? 200
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (plan.contentLength != null)
    headers['content-length'] = String(plan.contentLength)

  return {
    url: plan.redirectedTo ?? url,
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => plan.body ?? JSON.stringify(plan.payload ?? {}),
  } as unknown as Response
}

/** A fetch boundary keyed by exact url: an unexpected request fails instead of silently passing. */
function fakeFetch(plan: Record<string, ResponsePlan | (() => ResponsePlan)>) {
  const calls: Array<{ url: string, init?: RequestInit }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const entry = plan[url]
    if (!entry)
      throw new Error(`unexpected fetch: ${url}`)

    return jsonResponse(url, typeof entry === 'function' ? entry() : entry)
  })

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const videoPage = 'https://www.bilibili.com/video/BV1xx411c7mD'
const viewUrl = 'https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD'
const playerUrl = 'https://api.bilibili.com/x/player/v2?aid=123&cid=456&bvid=BV1xx411c7mD'
const subtitleUrl = 'https://i0.hdslb.com/bfs/subtitle/abc.json'

const viewPayload = {
  code: 0,
  data: { aid: 123, bvid: 'BV1xx411c7mD', cid: 456, pages: [{ cid: 456 }] },
}
const subtitleBody = {
  body: [
    { from: 0, to: 1.5, content: ' 你好 ' },
    { from: 1.5, to: 2, content: '世界' },
  ],
}

function playerPayload(subtitles: unknown[]) {
  return { code: 0, data: { subtitle: { subtitles } } }
}

describe('isAllowedBilibiliSubtitleUrl', () => {
  it.each([
    ['a protocol-relative cdn url', '//i0.hdslb.com/bfs/subtitle/a.json'],
    ['an absolute cdn url', 'https://i0.hdslb.com/bfs/subtitle/a.json'],
    ['an ai subtitle rendition', 'https://i1.hdslb.com/bfs/ai_subtitle/a.json'],
    ['the bare hdslb host', 'https://hdslb.com/bfs/subtitle/a.json'],
    ['a regional subdomain', 'https://s1.hdslb.com/bfs/subtitle/a.json'],
  ])('allows %s', (_name, url) => {
    expect(isAllowedBilibiliSubtitleUrl(url)).toBe(true)
  })

  it.each([
    ['plain http', 'http://i0.hdslb.com/bfs/subtitle/a.json'],
    ['a non-subtitle path', 'https://i0.hdslb.com/x/player/v2'],
    ['a suffix lookalike host', 'https://i0.hdslb.com.evil.example/bfs/subtitle/a.json'],
    ['a no-dot lookalike host', 'https://evil-hdslb.com/bfs/subtitle/a.json'],
    ['a path that only starts like a subtitle dir', 'https://i0.hdslb.com/bfs/subtitleevil/a.json'],
    ['an unrelated host', 'https://evil.example/bfs/subtitle/a.json'],
    ['malformed input', 'not a url'],
  ])('rejects %s', (_name, url) => {
    expect(isAllowedBilibiliSubtitleUrl(url)).toBe(false)
  })
})

describe('resolveBilibiliSubtitles', () => {
  it('derives the exact api endpoints and keeps credentials off the subtitle cdn', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [viewUrl]: { payload: viewPayload },
      [playerUrl]: { payload: playerPayload([{ lan: 'zh-Hans', lan_doc: '简体中文', subtitle_url: '//i0.hdslb.com/bfs/subtitle/abc.json' }]) },
      [subtitleUrl]: { payload: subtitleBody },
    })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    expect(result).toEqual({
      ok: true,
      mediaId: 'bilibili:BV1xx411c7mD:456',
      tracks: [{
        language: 'zh-Hans',
        label: '简体中文',
        kind: 'native',
        cues: [
          { start: 0, end: 1.5, text: '你好' },
          { start: 1.5, end: 2, text: '世界' },
        ],
      }],
    })
    expect(calls.map(call => call.url)).toEqual([viewUrl, playerUrl, subtitleUrl])
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(calls[1]!.init?.credentials).toBe('include')
    expect(calls[2]!.init?.credentials).toBe('omit')
  })

  it('uses the numeric aid for legacy av pages and omits bvid when unknown', async () => {
    const avPage = 'https://www.bilibili.com/video/av12345'
    const avViewUrl = 'https://api.bilibili.com/x/web-interface/view?aid=12345'
    const avPlayerUrl = 'https://api.bilibili.com/x/player/v2?aid=123&cid=456'
    const { fetchImpl, calls } = fakeFetch({
      [avViewUrl]: { payload: { code: 0, data: { aid: 123, cid: 456, pages: [{ cid: 456 }] } } },
      [avPlayerUrl]: { payload: playerPayload([]) },
    })

    const result = await resolveBilibiliSubtitles(avPage, { fetchImpl })

    expect(result).toEqual({ ok: true, mediaId: 'bilibili:123:456', tracks: [] })
    expect(calls.map(call => call.url)).toEqual([avViewUrl, avPlayerUrl])
  })

  it('selects the cid belonging to the requested part', async () => {
    const partTwo = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
    const playerUrlPartTwo = 'https://api.bilibili.com/x/player/v2?aid=123&cid=789&bvid=BV1xx411c7mD'
    const { fetchImpl, calls } = fakeFetch({
      [viewUrl]: { payload: { code: 0, data: { aid: 123, bvid: 'BV1xx411c7mD', cid: 999, pages: [{ cid: 456 }, { cid: 789 }] } } },
      [playerUrlPartTwo]: { payload: playerPayload([]) },
    })

    const result = await resolveBilibiliSubtitles(partTwo, { fetchImpl })

    expect(result).toMatchObject({ ok: true, mediaId: 'bilibili:BV1xx411c7mD:789' })
    expect(calls.map(call => call.url)).toEqual([viewUrl, playerUrlPartTwo])
  })

  it('drops subtitle urls outside the hdslb subtitle host and never fetches them', async () => {
    const okUrl = 'https://i0.hdslb.com/bfs/subtitle/ok.json'
    const { fetchImpl, calls } = fakeFetch({
      [viewUrl]: { payload: viewPayload },
      [playerUrl]: {
        payload: playerPayload([
          { lan: 'evil', lan_doc: 'evil', subtitle_url: 'https://evil.example/bfs/subtitle/x.json' },
          { lan: 'plain', lan_doc: 'plain', subtitle_url: 'https://evil.example/steal' },
          { lan: 'zh-Hans', lan_doc: '简体中文', subtitle_url: okUrl },
        ]),
      },
      [okUrl]: { payload: subtitleBody },
    })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    expect(calls.map(call => call.url)).toEqual([viewUrl, playerUrl, okUrl])
    if (!result.ok)
      throw new Error(result.error)
    expect(result.tracks).toEqual([{
      language: 'zh-Hans',
      label: '简体中文',
      kind: 'native',
      cues: [{ start: 0, end: 1.5, text: '你好' }, { start: 1.5, end: 2, text: '世界' }],
    }])
  })

  it('keeps working renditions when one fails, redirects off the cdn, or exceeds the size cap', async () => {
    const brokenUrl = 'https://i1.hdslb.com/bfs/subtitle/broken.json'
    const redirectUrl = 'https://i2.hdslb.com/bfs/subtitle/redirect.json'
    const oversizedUrl = 'https://i3.hdslb.com/bfs/subtitle/oversized.json'
    const okUrl = 'https://i0.hdslb.com/bfs/subtitle/ok.json'
    const { fetchImpl } = fakeFetch({
      [viewUrl]: { payload: viewPayload },
      [playerUrl]: {
        payload: playerPayload([
          { lan: 'zh-Hans', lan_doc: 'broken', subtitle_url: brokenUrl },
          { lan: 'en', lan_doc: 'redirected', subtitle_url: redirectUrl },
          { lan: 'ja', lan_doc: 'oversized', subtitle_url: oversizedUrl },
          { lan: 'ko', lan_doc: 'working', subtitle_url: okUrl },
        ]),
      },
      [brokenUrl]: { status: 500 },
      [redirectUrl]: { payload: subtitleBody, redirectedTo: 'https://evil.example/bfs/subtitle/redirect.json' },
      [oversizedUrl]: { payload: subtitleBody, contentLength: 3 * 1024 * 1024 },
      [okUrl]: { payload: subtitleBody },
    })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    if (!result.ok)
      throw new Error(result.error)
    expect(result.tracks.map(track => track.language)).toEqual(['ko'])
  })

  it('marks an automatic rendition as auto', async () => {
    const okUrl = 'https://i0.hdslb.com/bfs/subtitle/auto.json'
    const { fetchImpl } = fakeFetch({
      [viewUrl]: { payload: viewPayload },
      [playerUrl]: { payload: playerPayload([{ lan: 'ai-zh', lan_doc: '自动生成', subtitle_url: okUrl, type: 1 }]) },
      [okUrl]: { payload: subtitleBody },
    })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    if (!result.ok)
      throw new Error(result.error)
    expect(result.tracks).toEqual([{
      language: 'ai-zh',
      label: '自动生成',
      kind: 'auto',
      cues: [{ start: 0, end: 1.5, text: '你好' }, { start: 1.5, end: 2, text: '世界' }],
    }])
  })

  it('keeps only well-formed, non-empty cues', async () => {
    const okUrl = 'https://i0.hdslb.com/bfs/subtitle/cues.json'
    const { fetchImpl } = fakeFetch({
      [viewUrl]: { payload: viewPayload },
      [playerUrl]: { payload: playerPayload([{ lan: 'zh-Hans', lan_doc: '简体中文', subtitle_url: okUrl }]) },
      [okUrl]: {
        payload: {
          body: [
            { from: 0, to: 1, content: '  keep  ' },
            { from: 1, to: 1, content: 'zero length' },
            { from: 2, to: 1, content: 'reversed' },
            { from: 2, to: 3, content: '   ' },
            { from: 'soon', to: 3, content: 'nan start' },
            { from: 4, to: 5 },
          ],
        },
      },
    })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    if (!result.ok)
      throw new Error(result.error)
    expect(result.tracks).toEqual([{
      language: 'zh-Hans',
      label: '简体中文',
      kind: 'native',
      cues: [{ start: 0, end: 1, text: 'keep' }],
    }])
  })

  it('refuses a non-video page without touching the network', async () => {
    const { fetchImpl, calls } = fakeFetch({})

    const result = await resolveBilibiliSubtitles('https://www.youtube.com/watch?v=abc', { fetchImpl })

    expect(result).toEqual({ ok: false, error: '不是受支持的 Bilibili 视频页' })
    expect(calls).toHaveLength(0)
  })

  it('reports an unrecognizable video instead of asking the player endpoint', async () => {
    const { fetchImpl, calls } = fakeFetch({ [viewUrl]: { payload: { code: -404, message: 'not found' } } })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    expect(result).toEqual({ ok: false, error: '无法识别 Bilibili 视频信息' })
    expect(calls.map(call => call.url)).toEqual([viewUrl])
  })

  it('rejects metadata that redirected off the api origin', async () => {
    const { fetchImpl, calls } = fakeFetch({ [viewUrl]: { payload: viewPayload, redirectedTo: 'https://evil.example/x' } })

    const result = await resolveBilibiliSubtitles(videoPage, { fetchImpl })

    expect(result).toEqual({ ok: false, error: 'Bilibili 字幕服务不可用' })
    expect(calls.map(call => call.url)).toEqual([viewUrl])
  })
})
