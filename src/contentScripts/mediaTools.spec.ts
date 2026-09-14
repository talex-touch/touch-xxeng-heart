// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaToolsController } from './mediaTools'
import type { SiteDetectionHints } from '~/logic/siteRules'
import type { LexiSettings, SiteSceneRule } from '~/logic/types'
import { defaultSettings } from '~/logic/defaults'

/**
 * What a reader sees once the media toolbar was extracted from pageEnhancer: clicking a
 * picture opens exactly one toolbar pinned to that picture, reopening moves it instead of
 * stacking a second one, closing (or losing the picture) takes every owned node with it,
 * and an un-configured Omni scene refuses to spend a model call.
 */

const mocks = vi.hoisted(() => ({
  settings: undefined as LexiSettings | undefined,
  requestMediaAnalysis: vi.fn(),
  sendRuntimeMessage: vi.fn(),
}))

vi.mock('~/logic/settingsCache', () => ({
  getStoredState: vi.fn(async () => ({ settings: mocks.settings, records: [] })),
}))

vi.mock('~/logic/aiClient', () => ({ requestMediaAnalysis: mocks.requestMediaAnalysis }))

vi.mock('~/logic/runtimeMessaging', () => ({ sendRuntimeMessage: mocks.sendRuntimeMessage }))

function settingsWithOmni(enabled: boolean, sceneRules: SiteSceneRule[] = []): LexiSettings {
  return {
    ...defaultSettings,
    ai: { ...defaultSettings.ai, omni: { ...defaultSettings.ai.omni, enabled } },
    siteRules: { ...defaultSettings.siteRules, sceneRules },
  }
}

function createController() {
  return createMediaToolsController({
    readSiteHints: () => ({} as SiteDetectionHints),
    showToast: vi.fn(),
  })
}

const surface = {
  toolbars: () => document.querySelectorAll('[data-lexi-media-toolbar]'),
  highlights: () => document.querySelectorAll('[data-lexi-media-highlight]'),
  answer: () => document.querySelector('.lexi-media-toolbar__answer')?.textContent ?? '',
  button: (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.lexi-media-toolbar__button'))
      .find(element => element.textContent === label)!,
}

/** Microtask flush for the controller's async gate/analysis chain; no real timers involved. */
async function settle() {
  for (let tick = 0; tick < 8; tick++)
    await Promise.resolve()
}

function mountImage(src = 'https://cdn.test/cat.png', alt = '一只猫') {
  const img = document.createElement('img')
  img.src = src
  img.alt = alt
  document.body.append(img)
  return img
}

beforeEach(() => {
  document.body.replaceChildren()
  document
    .querySelectorAll('#lexi-page-style, [data-lexi-media-toolbar], [data-lexi-media-highlight]')
    .forEach(node => node.remove())
  mocks.settings = settingsWithOmni(false)
  mocks.requestMediaAnalysis.mockReset()
  mocks.sendRuntimeMessage.mockReset()
})

afterEach(() => {
  document.body.replaceChildren()
  document
    .querySelectorAll('#lexi-page-style, [data-lexi-media-toolbar], [data-lexi-media-highlight]')
    .forEach(node => node.remove())
})

describe('createMediaToolsController.findTarget', () => {
  it('classifies each media element with the source the user actually clicked', () => {
    document.body.innerHTML = `
      <img id="photo" src="https://cdn.test/cat.png" alt="一只猫" title="猫咪照片">
      <video id="clip" src="https://cdn.test/clip.mp4" poster="https://cdn.test/clip.jpg" title="片段"></video>
      <audio id="track" src="https://cdn.test/track.mp3"></audio>
    `
    const controller = createController()

    const photo = controller.findTarget(document.querySelector('#photo'))
    const clip = controller.findTarget(document.querySelector('#clip'))
    const track = controller.findTarget(document.querySelector('#track'))

    expect(photo).toMatchObject({
      kind: 'image',
      src: 'https://cdn.test/cat.png',
      alt: '一只猫',
      title: '猫咪照片',
    })
    expect(clip).toMatchObject({
      kind: 'video',
      src: 'https://cdn.test/clip.mp4',
      poster: 'https://cdn.test/clip.jpg',
      title: '片段',
    })
    expect(track).toMatchObject({ kind: 'audio', src: 'https://cdn.test/track.mp3' })
  })

  it('resolves a click on a <source> to its owning media element', () => {
    document.body.innerHTML = `
      <video id="clip"><source id="webm" src="https://cdn.test/clip.webm" type="video/webm"></video>
    `
    const controller = createController()
    const source = document.querySelector('#webm')
    const target = controller.findTarget(source)

    expect(target?.kind).toBe('video')
    expect(target?.src).toBe('https://cdn.test/clip.webm')
    expect(target?.mimeType).toBe('video/webm')
    expect(target?.element).toBe(document.querySelector('#clip'))
  })

  it('ignores non-media click targets and media without a source', () => {
    document.body.innerHTML = `
      <a id="link" href="https://example.test"><img id="wrapped" src="https://cdn.test/wrapped.png"></a>
      <img id="empty">
    `
    const controller = createController()

    expect(controller.findTarget(document.querySelector('#link'))).toBeUndefined()
    expect(controller.findTarget(document.querySelector('#empty'))).toBeUndefined()
    expect(controller.findTarget(document.body)).toBeUndefined()
    expect(controller.findTarget(null)).toBeUndefined()
  })
})

describe('createMediaToolsController toolbar lifecycle', () => {
  it.each([
    ['image', '图片操作'],
    ['video', '视频操作'],
    ['audio', '音频操作'],
    ['media', '媒体操作'],
  ] as const)('labels an opened %s target as %s', (kind, label) => {
    const controller = createController()
    controller.open({
      element: document.createElement('source'),
      kind,
      src: 'https://cdn.test/media.bin',
    })

    expect(surface.toolbars()).toHaveLength(1)
    expect(surface.highlights()).toHaveLength(1)
    expect(document.querySelector('.lexi-media-toolbar__title')?.textContent).toBe(label)
  })

  it('shows the media identity and starts with copy disabled', () => {
    const controller = createController()
    controller.open({
      element: document.createElement('img'),
      kind: 'image',
      src: 'https://cdn.test/diagram.png',
      title: '架构图',
      width: 640,
      height: 480,
    })

    expect(document.querySelector('.lexi-media-toolbar__meta')?.textContent).toBe('架构图 · 640×480')
    expect(surface.button('复制 Prompt').disabled).toBe(true)
  })

  it('replaces the previous toolbar instead of stacking a second one', () => {
    const controller = createController()
    const first = document.createElement('img')
    first.src = 'https://cdn.test/first.png'
    controller.open({ element: first, kind: 'image', src: first.src, title: '第一张' })

    const second = document.createElement('video')
    second.src = 'https://cdn.test/second.mp4'
    controller.open({ element: second, kind: 'video', src: second.src, title: '第二段' })

    expect(surface.toolbars()).toHaveLength(1)
    expect(surface.highlights()).toHaveLength(1)
    expect(document.querySelector('.lexi-media-toolbar__title')?.textContent).toBe('视频操作')
    expect(document.querySelector('.lexi-media-toolbar__meta')?.textContent).toContain('第二段')
  })

  it('removes every owned node on close', () => {
    const controller = createController()
    controller.open({
      element: document.createElement('img'),
      kind: 'image',
      src: 'https://cdn.test/cat.png',
    })
    expect(surface.toolbars()).toHaveLength(1)

    controller.close()

    expect(surface.toolbars()).toHaveLength(0)
    expect(surface.highlights()).toHaveLength(0)
  })

  it('drops the toolbar once its media element leaves the document', () => {
    const controller = createController()
    const img = mountImage()
    controller.open({ element: img, kind: 'image', src: img.src })
    expect(surface.toolbars()).toHaveLength(1)

    img.remove()
    controller.reposition()

    expect(surface.toolbars()).toHaveLength(0)
    expect(surface.highlights()).toHaveLength(0)
  })
})

describe('createMediaToolsController Omni gating', () => {
  it('refuses the model and explains what to enable when the Omni scene is switched off', async () => {
    mocks.settings = settingsWithOmni(false)
    const controller = createController()
    const img = mountImage()
    controller.open({ element: img, kind: 'image', src: img.src })

    surface.button('提取还原 Prompt').click()
    await settle()

    expect(mocks.requestMediaAnalysis).not.toHaveBeenCalled()
    expect(surface.answer()).toContain('Omni')
    expect(surface.answer()).toContain('选项页')
  })

  it('refuses the model when a site rule disables Omni for this host', async () => {
    mocks.settings = settingsWithOmni(true, [{
      domain: location.hostname,
      replacement: true,
      selection: true,
      daily: true,
      digest: true,
      omni: false,
      entity: true,
    }])
    const controller = createController()
    const img = mountImage()
    controller.open({ element: img, kind: 'image', src: img.src })

    surface.button('提取还原 Prompt').click()
    await settle()

    expect(mocks.requestMediaAnalysis).not.toHaveBeenCalled()
    expect(surface.answer()).toContain('选项页')
  })

  it('analyzes the opened media and renders the prompt the model returns', async () => {
    mocks.settings = settingsWithOmni(true)
    mocks.requestMediaAnalysis.mockResolvedValue('一只橘猫坐在窗台上，逆光。')
    const controller = createController()
    const img = mountImage('https://cdn.test/orange.png', '橘猫')
    controller.open({ element: img, kind: 'image', src: img.src, alt: '橘猫' })

    surface.button('提取还原 Prompt').click()
    await settle()

    expect(mocks.requestMediaAnalysis).toHaveBeenCalledTimes(1)
    expect(mocks.requestMediaAnalysis.mock.calls[0][1]).toMatchObject({
      kind: 'image',
      src: 'https://cdn.test/orange.png',
    })
    expect(surface.answer()).toBe('一只橘猫坐在窗台上，逆光。')
  })

  it('keeps the prompt uncopyable until the model produces one, then copies exactly it', async () => {
    mocks.settings = settingsWithOmni(true)
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async (text: string) => { written.push(text) }) },
    })
    let resolveRequest!: (text: string) => void
    mocks.requestMediaAnalysis.mockReturnValueOnce(
      new Promise<string>((resolve) => { resolveRequest = resolve }),
    )
    const controller = createController()
    const img = mountImage()
    controller.open({ element: img, kind: 'image', src: img.src })

    const copy = surface.button('复制 Prompt')
    expect(copy.disabled).toBe(true)

    surface.button('提取还原 Prompt').click()
    await settle()
    expect(copy.disabled).toBe(true)

    resolveRequest('还原用的 prompt')
    await settle()
    expect(copy.disabled).toBe(false)

    copy.click()
    await settle()
    expect(written).toEqual(['还原用的 prompt'])
  })
})
