import type { BrowserContext, Page } from '@playwright/test'
import { expect, settingsStorageKey, test } from './fixtures'

/**
 * The bilingual subtitle track in a real browser.
 *
 * jsdom can only prove the wiring; the behaviour that actually breaks in the wild lives in
 * Chrome's own text-track machinery: a native `<track>` is fetched by the browser only once
 * its mode leaves `disabled`, cue times come back through the browser's WebVTT parser, and the
 * attached `Lexi 双语` track is a real `VTTCue` list on the media element. These tests drive
 * exactly that path, so what they assert is what a viewer reading the video would see.
 */

declare const chrome: {
  storage: {
    local: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

interface NativeTrackFixture {
  srclang: string
  label: string
  src: string
}

interface TrackSnapshot {
  label: string
  language: string
  mode: string
  cues: Array<{ start: number, end: number, text: string }>
}

const mediaHost = 'lexi.test'
const bilingualTrackLabel = 'Lexi 双语'

const dualTrackPath = '/dual-track'
const englishOnlyPath = '/english-only'

const englishTrack: NativeTrackFixture = { srclang: 'en', label: 'English', src: '/en.vtt' }
const chineseTrack: NativeTrackFixture = { srclang: 'zh-Hans', label: '简体中文', src: '/zh.vtt' }

/**
 * The two languages are cut independently, which is the whole point.
 *
 * English: 0-2, 5-7, 8-12. Chinese: a shifted first cue, a cue at 3-4 that no English line
 * covers, and two cues that both sit under the single 8-12 English line. An implementation
 * that zips the two lists by index pairs the second English line with 这句只出现在中文字幕里 and
 * drops 再看监控大盘; only timeline pairing produces the pairs asserted below.
 */
const englishWebVtt = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:02.000',
  'Good morning everyone',
  '',
  '00:00:05.000 --> 00:00:07.000',
  'Review the release checklist with the team',
  '',
  '00:00:08.000 --> 00:00:12.000',
  'Watch the dashboards after the rollout',
  '',
].join('\n')

const chineseWebVtt = [
  'WEBVTT',
  '',
  '00:00:00.250 --> 00:00:02.300',
  '大家早上好',
  '',
  '00:00:03.000 --> 00:00:04.000',
  '这句只出现在中文字幕里',
  '',
  '00:00:05.400 --> 00:00:07.500',
  '我们来过一遍发布检查清单',
  '',
  '00:00:08.200 --> 00:00:10.000',
  '先发布上线',
  '',
  '00:00:10.100 --> 00:00:12.400',
  '再看监控大盘',
  '',
].join('\n')

const expectedPairs = [
  { start: 0, end: 2, text: 'Good morning everyone\n大家早上好' },
  { start: 5, end: 7, text: 'Review the release checklist with the team\n我们来过一遍发布检查清单' },
  { start: 8, end: 12, text: 'Watch the dashboards after the rollout\n先发布上线\n再看监控大盘' },
]

/**
 * Points the one shared page-translation path at a working provider, and deliberately leaves
 * `subtitles.autoTranslate` at its default.
 *
 * Arming it is what gives the "no AI cost" assertions teeth: a build that ignored the setting,
 * or that translated the official Chinese track through the AI instead of reading it, would
 * call this server and be recorded. Unarmed, both tests would stay green through that bug.
 */
async function armSelectionProvider(page: Page, extensionId: string, endpoint: string) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  // The options page owns the first write of the settings object, so this waits for that write
  // before patching — an edit made earlier is silently overwritten.
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)

  await page.evaluate(async ({ settingsKey, providerEndpoint }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    settings.selection.enabled = true
    settings.ai.selection.enabled = true
    settings.ai.approvedHttpEndpoints = [providerEndpoint]
    settings.ai.providers[0].enabled = true
    settings.ai.providers[0].protocol = 'openai-chat'
    settings.ai.providers[0].endpoint = providerEndpoint
    settings.ai.providers[0].model = 'smoke-model'
    settings.ai.providers[0].apiKey = ''
    await chrome.storage.local.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey: settingsStorageKey, providerEndpoint: endpoint })
}

/**
 * Page and subtitle files share one routed origin, because Chrome refuses to load a
 * cross-origin `<track>` that carries no CORS headers. The returned list records every path the
 * browser asked for, which is how a test can tell that a native track was really read.
 */
async function serveSubtitleFixture(context: BrowserContext, options: { pagePath: string, tracks: NativeTrackFixture[] }) {
  const requestedPaths: string[] = []
  await context.route(`https://${mediaHost}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    requestedPaths.push(pathname)

    if (pathname === englishTrack.src)
      return route.fulfill({ status: 200, contentType: 'text/vtt; charset=utf-8', body: englishWebVtt })
    if (pathname === chineseTrack.src)
      return route.fulfill({ status: 200, contentType: 'text/vtt; charset=utf-8', body: chineseWebVtt })
    if (pathname === options.pagePath) {
      // The box is explicit because the enhancer only adopts a video it can see: anything under
      // 32x32 or hidden is skipped. No media source is needed — the browser loads an out-of-band
      // track on its own, and those native tracks are all the subtitle reader touches.
      const trackTags = options.tracks
        .map(track => `<track kind="subtitles" srclang="${track.srclang}" label="${track.label}" src="${track.src}">`)
        .join('')
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lexi subtitle smoke</title></head><body><video id="player" style="display:block;width:640px;height:360px" controls>${trackTags}</video></body></html>`,
      })
    }

    return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: `unexpected path ${pathname}` })
  })
  return requestedPaths
}

/** Every text track the media element currently exposes, exactly as a reader would find them. */
function readVideoTextTracks(page: Page): Promise<TrackSnapshot[]> {
  return page.evaluate(() => {
    const video = document.querySelector('video')
    if (!video)
      return []

    const tracks: TrackSnapshot[] = []
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index]
      if (!track)
        continue

      const cues: TrackSnapshot['cues'] = []
      const loaded = track.cues
      if (loaded) {
        for (let cueIndex = 0; cueIndex < loaded.length; cueIndex += 1) {
          const cue = loaded[cueIndex]
          if (!cue)
            continue

          // `TextTrackCue` is the base type; only a VTTCue carries the payload text.
          const text = 'text' in cue && typeof cue.text === 'string' ? cue.text : ''
          cues.push({ start: cue.startTime, end: cue.endTime, text })
        }
      }

      tracks.push({ label: track.label, language: track.language, mode: track.mode, cues })
    }
    return tracks
  })
}

test('a video carrying its own English and Chinese tracks gets one bilingual track at no AI cost', async ({ context, page, extensionId, aiServer }) => {
  await armSelectionProvider(page, extensionId, aiServer.endpoint('openai-chat'))
  await serveSubtitleFixture(context, { pagePath: dualTrackPath, tracks: [englishTrack, chineseTrack] })

  const contentPage = await context.newPage()
  await contentPage.goto(`https://${mediaHost}${dualTrackPath}`)

  // The enhancer discovers the player through its route watcher (~1s poll plus a debounced
  // mutation observer), then the browser parses both subtitle files.
  await expect.poll(
    async () => (await readVideoTextTracks(contentPage)).map(track => track.label),
    { timeout: 15_000 },
  ).toEqual(['English', '简体中文', bilingualTrackLabel])

  const bilingual = (await readVideoTextTracks(contentPage)).find(track => track.label === bilingualTrackLabel)
  expect(bilingual?.language).toBe('zh-Hans')
  expect(bilingual?.mode).toBe('showing')
  // Each pair keeps the ENGLISH cue's interval — not the Chinese cue's shifted one, and not a
  // Chinese-only cue — and carries every Chinese line the timeline puts under it, in time order.
  expect(bilingual?.cues).toEqual(expectedPairs)

  // Both languages came from the page's own official tracks, so the armed provider stays untouched.
  expect(aiServer.requests).toHaveLength(0)
})

test('a video carrying only an English track stays untranslated and unbilled while autoTranslate is off', async ({ context, page, extensionId, aiServer }) => {
  await armSelectionProvider(page, extensionId, aiServer.endpoint('openai-chat'))
  const requestedPaths = await serveSubtitleFixture(context, { pagePath: englishOnlyPath, tracks: [englishTrack] })

  const contentPage = await context.newPage()
  const subtitleFailures: string[] = []
  contentPage.on('console', (message) => {
    const text = message.text()
    if (text.includes('[Lexi]') && (text.includes('字幕') || text.includes('Subtitles')))
      subtitleFailures.push(text)
  })

  await contentPage.goto(`https://${mediaHost}${englishOnlyPath}`)

  // Chrome fetches a `<track>` only once its mode leaves `disabled`, so this request is proof the
  // enhancer reached the page's own English track and read its cues. Without it, the absence of a
  // bilingual track below would only mean the fixture never ran.
  await expect.poll(() => requestedPaths.includes(englishTrack.src), { timeout: 15_000 }).toBe(true)
  // The enhancer's own discovery is a ~900ms debounce plus ~500ms retry steps, and a build that
  // ignored the setting reaches the provider within milliseconds of reading the track; wait past
  // that window so such a build would already have spoken up.
  await contentPage.waitForTimeout(2_000)

  expect((await readVideoTextTracks(contentPage)).map(track => track.label)).toEqual(['English'])
  // A silent crash inside the enhancer would also explain a missing track, so rule it out.
  expect(subtitleFailures).toEqual([])
  expect(aiServer.requests).toHaveLength(0)
})
