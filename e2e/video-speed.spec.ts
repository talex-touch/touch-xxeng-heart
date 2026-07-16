import type { BrowserContext } from '@playwright/test'
import { expect, test } from './fixtures'

const videoTestUrl = 'https://lexi.test/video'

function routeVideoTestPage(context: BrowserContext) {
  return context.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main>Lexi video test</main></body></html>',
  }))
}

test('video speed menu persists and resists player rate resets', async ({ context, page }) => {
  await routeVideoTestPage(context)
  await page.goto(videoTestUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  const center = await page.evaluate(() => {
    const video = document.createElement('video')
    video.dataset.testVideo = 'true'
    video.style.cssText = 'display:block;width:800px;height:450px'
    document.body.prepend(video)
    const rect = video.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  })

  await page.keyboard.down('Control')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Control')

  const video = page.locator('video[data-test-video]')
  const menu = page.locator('[data-lexi-video-speed-menu]')
  await expect(menu).toBeVisible()
  const getPlaybackRate = () => video.evaluate(element => (element as HTMLVideoElement).playbackRate)
  await expect.poll(getPlaybackRate).toBe(2)

  await page.locator('[data-lexi-video-rate="3"]').click()
  await expect.poll(getPlaybackRate).toBe(3)

  await video.evaluate(element => element.dispatchEvent(new Event('pause')))
  await expect(menu).toBeVisible()
  await expect.poll(getPlaybackRate).toBe(3)

  await video.evaluate((element) => {
    const media = element as HTMLVideoElement
    media.playbackRate = 1
  })
  await expect.poll(getPlaybackRate).toBe(3)

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect.poll(getPlaybackRate).toBe(1)

  await page.keyboard.down('Control')
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  await page.keyboard.up('Control')
  await expect(menu).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect.poll(getPlaybackRate).toBe(1)
})

test('video speed menu detects a preview behind an earlier document interceptor', async ({ context, page }) => {
  await context.addInitScript(() => {
    for (const type of ['pointerdown', 'mousedown', 'click'])
      document.addEventListener(type, event => event.stopImmediatePropagation(), true)
  })
  await routeVideoTestPage(context)
  await page.goto(videoTestUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  const center = await page.evaluate(() => {
    const card = document.createElement('div')
    const video = document.createElement('video')
    const cover = document.createElement('img')
    card.style.cssText = 'position:relative;width:800px;height:450px'
    video.dataset.testCoveredVideo = 'true'
    video.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none'
    cover.alt = 'Video preview cover'
    cover.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    cover.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
    card.append(video, cover)
    document.body.prepend(card)
    const rect = video.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  })

  await page.keyboard.down('Control')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Control')

  const video = page.locator('video[data-test-covered-video]')
  await expect(page.locator('[data-lexi-video-speed-menu]')).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(2)
})

test('macOS trackpad uses Command plus secondary click without hijacking Command primary click', async ({ context, page }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setNavigatorOverrides', { platform: 'MacIntel' })
  await context.addInitScript(() => {
    for (const type of ['pointerdown', 'mousedown', 'contextmenu', 'mouseup'])
      document.addEventListener(type, event => event.stopImmediatePropagation(), true)
  })
  await routeVideoTestPage(context)
  await page.goto(videoTestUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  const center = await page.evaluate(() => {
    const video = document.createElement('video')
    video.dataset.testMacVideo = 'true'
    video.style.cssText = 'display:block;width:800px;height:450px'
    document.body.prepend(video)
    const rect = video.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  })
  const menu = page.locator('[data-lexi-video-speed-menu]')

  await page.keyboard.down('Meta')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Meta')
  await expect(menu).toHaveCount(0)

  await page.keyboard.down('Meta')
  await page.mouse.click(center.x, center.y, { button: 'right' })
  await page.keyboard.up('Meta')

  const video = page.locator('video[data-test-mac-video]')
  await expect(menu).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(2)
})

test('video speed menu detects video tags inside open shadow players', async ({ context, page }) => {
  await routeVideoTestPage(context)
  await page.goto(videoTestUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  const center = await page.evaluate(() => {
    const player = document.createElement('div')
    const shadow = player.attachShadow({ mode: 'open' })
    const video = document.createElement('video')
    const overlay = document.createElement('button')
    player.dataset.testShadowPlayer = 'true'
    player.style.cssText = 'display:block;position:relative;width:800px;height:450px'
    video.style.cssText = 'display:block;width:800px;height:450px'
    overlay.textContent = 'Custom player overlay'
    overlay.style.cssText = 'position:absolute;inset:0;border:0;background:transparent'
    shadow.append(video, overlay)
    document.body.prepend(player)
    const rect = video.getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  })

  await page.keyboard.down('Control')
  await page.mouse.click(center.x, center.y)
  await page.keyboard.up('Control')

  await expect(page.locator('[data-lexi-video-speed-menu]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const player = document.querySelector<HTMLElement>('[data-test-shadow-player]')
    return player?.shadowRoot?.querySelector('video')?.playbackRate
  })).toBe(2)

  await page.evaluate(() => {
    const player = document.querySelector<HTMLElement>('[data-test-shadow-player]')
    const video = player?.shadowRoot?.querySelector('video')
    if (video)
      video.playbackRate = 1
  })
  await expect.poll(() => page.evaluate(() => {
    const player = document.querySelector<HTMLElement>('[data-test-shadow-player]')
    return player?.shadowRoot?.querySelector('video')?.playbackRate
  })).toBe(2)
})

test('video speed menu detects video tags in embedded media frames', async ({ context, page }) => {
  await context.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0"><iframe data-test-media-frame src="https://media.test/player" style="display:block;width:800px;height:450px;border:0"></iframe></body></html>',
  }))
  await context.route('https://media.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body style="margin:0"><video data-test-frame-video style="display:block;width:800px;height:450px"></video></body></html>',
  }))
  await page.goto(videoTestUrl)

  const mediaFrame = page.frameLocator('[data-test-media-frame]')
  const video = mediaFrame.locator('video[data-test-frame-video]')
  await expect(mediaFrame.locator('#touch-xxeng-heart')).toHaveCount(0)

  await page.keyboard.down('Control')
  await page.mouse.click(400, 225)
  await page.keyboard.up('Control')

  await expect(mediaFrame.locator('[data-lexi-video-speed-menu]')).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(2)

  await video.evaluate((element) => {
    (element as HTMLVideoElement).playbackRate = 1
  })
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).playbackRate)).toBe(2)
})
