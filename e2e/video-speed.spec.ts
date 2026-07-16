import { expect, test } from './fixtures'

test('video speed menu persists and resists player rate resets', async ({ page }) => {
  await page.goto('http://localhost:3303/popup/index.html')
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
})

test('video speed menu detects a preview behind an earlier document interceptor', async ({ context, page }) => {
  await context.addInitScript(() => {
    for (const type of ['pointerdown', 'mousedown', 'click'])
      document.addEventListener(type, event => event.stopImmediatePropagation(), true)
  })
  await page.goto('http://localhost:3303/popup/index.html')
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
  await page.goto('http://localhost:3303/popup/index.html')
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
