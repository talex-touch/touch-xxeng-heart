import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBilibiliSubtitleProvider, isBilibiliVideoPage } from './bilibili'
import type { BilibiliSubtitleTrack } from './bilibili'

const mocks = vi.hoisted(() => ({ sendRuntimeMessage: vi.fn() }))

vi.mock('../runtimeMessaging', () => ({ sendRuntimeMessage: mocks.sendRuntimeMessage }))

const videoUrl = new URL('https://www.bilibili.com/video/BV1xx411c7mD')
const media = {} as HTMLVideoElement
const track: BilibiliSubtitleTrack = {
  language: 'zh-Hans',
  label: '简体中文',
  kind: 'native',
  cues: [{ start: 0, end: 1.5, text: '你好' }],
}

function createProvider(media: HTMLVideoElement | undefined) {
  return createBilibiliSubtitleProvider({ getMedia: () => media })
}

beforeEach(() => {
  mocks.sendRuntimeMessage.mockReset()
})

describe('isBilibiliVideoPage', () => {
  it.each([
    ['the desktop watch page', 'https://www.bilibili.com/video/BV1xx411c7mD'],
    ['a trailing slash', 'https://www.bilibili.com/video/BV1xx411c7mD/'],
    ['a part/timestamp query', 'https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=30'],
    ['the legacy av id', 'https://www.bilibili.com/video/av12345'],
    ['the mobile host', 'https://m.bilibili.com/video/BV1xx411c7mD'],
    ['case-insensitive ids', 'https://www.bilibili.com/video/bv1xx411c7md'],
  ])('matches %s', (_name, url) => {
    expect(isBilibiliVideoPage(url)).toBe(true)
  })

  it.each([
    ['plain http', 'http://www.bilibili.com/video/BV1xx411c7mD'],
    ['the bare host', 'https://bilibili.com/video/BV1xx411c7mD'],
    ['a lookalike suffix host', 'https://www.bilibili.com.evil.example/video/BV1xx411c7mD'],
    ['a userinfo impostor', 'https://www.bilibili.com@evil.example/video/BV1xx411c7mD'],
    ['an unrelated host', 'https://evil.example/video/BV1xx411c7mD'],
    ['a non-video path', 'https://www.bilibili.com/bangumi/play/ep123'],
    ['a space page', 'https://space.bilibili.com/123'],
    ['a missing video id', 'https://www.bilibili.com/video/'],
    ['malformed input', 'not a url'],
  ])('rejects %s', (_name, url) => {
    expect(isBilibiliVideoPage(url)).toBe(false)
  })
})

describe('createBilibiliSubtitleProvider', () => {
  it('asks the worker for exactly this page url and nothing else', async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({ ok: true, mediaId: 'bilibili:BV1xx411c7mD:456', tracks: [track] })
    const provider = createProvider(media)

    const source = await provider.resolve(videoUrl)

    expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1)
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith(
      'lexi-resolve-bilibili-subtitles',
      { pageUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    )
    expect(source).toMatchObject({ mediaId: 'bilibili:BV1xx411c7mD:456' })
  })

  it('exposes the worker track and its cues unchanged', async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({ ok: true, mediaId: 'm', tracks: [track] })
    const provider = createProvider(media)

    const source = await provider.resolve(videoUrl)
    const [handle] = await source!.listTracks()

    expect(handle).toMatchObject({ language: 'zh-Hans', label: '简体中文', kind: 'native' })
    expect(await handle!.load()).toEqual(track.cues)
  })

  it('caches a resolved page and only re-asks after the hit window', async () => {
    vi.useFakeTimers()
    try {
      mocks.sendRuntimeMessage.mockResolvedValue({ ok: true, mediaId: 'm', tracks: [track] })
      const provider = createProvider(media)

      await provider.resolve(videoUrl)
      await provider.resolve(videoUrl)
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 4 * 60 * 1000)
      await provider.resolve(videoUrl)
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 2 * 60 * 1000)
      await provider.resolve(videoUrl)
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('re-asks a declined page after the shorter negative window', async () => {
    vi.useFakeTimers()
    try {
      mocks.sendRuntimeMessage.mockResolvedValue({ ok: false, error: '暂不可用' })
      const provider = createProvider(media)

      expect(await provider.resolve(videoUrl)).toBeUndefined()
      expect(await provider.resolve(videoUrl)).toBeUndefined()
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 10 * 1000)
      expect(await provider.resolve(videoUrl)).toBeUndefined()
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 6 * 1000)
      expect(await provider.resolve(videoUrl)).toBeUndefined()
      expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('declines an ok response that carries no usable track', async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({ ok: true, mediaId: 'm', tracks: [] })

    expect(await createProvider(media).resolve(videoUrl)).toBeUndefined()
  })

  it('returns nothing without a player and sends nothing for an aborted caller', async () => {
    expect(await createProvider(undefined).resolve(videoUrl)).toBeUndefined()
    expect(mocks.sendRuntimeMessage).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort()
    expect(await createProvider(media).resolve(videoUrl, controller.signal)).toBeUndefined()
    expect(mocks.sendRuntimeMessage).not.toHaveBeenCalled()
  })

  it('matches only supported video pages', () => {
    const provider = createProvider(media)

    expect(provider.match(videoUrl)).toBe(true)
    expect(provider.match(new URL('https://www.bilibili.com/bangumi/play/ep123'))).toBe(false)
  })

  it('yields no tracks or cues once the caller aborts', async () => {
    mocks.sendRuntimeMessage.mockResolvedValue({ ok: true, mediaId: 'm', tracks: [track] })
    const provider = createProvider(media)
    const source = await provider.resolve(videoUrl)

    const controller = new AbortController()
    controller.abort()

    expect(await source!.listTracks(controller.signal)).toEqual([])
    const [handle] = await source!.listTracks()
    expect(await handle!.load({ signal: controller.signal })).toEqual([])
  })
})
