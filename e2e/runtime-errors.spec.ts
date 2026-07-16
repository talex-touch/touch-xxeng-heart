import { expect, test } from './fixtures'

test('content script survives synthetic key events and BFCache navigation', async ({ context, extensionId, page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main>Lexi runtime test</main></body></html>',
  }))

  await page.goto('https://lexi.test/first')
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()
  await page.evaluate(() => {
    document.dispatchEvent(new Event('keyup', { bubbles: true }))
  })

  await page.goto('https://lexi.test/second')
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()
  await page.goBack()
  await page.goForward()
  await page.waitForTimeout(300)

  expect(pageErrors).toEqual([])

  const extensionsPage = await context.newPage()
  await extensionsPage.goto('chrome://extensions')
  const errors = await extensionsPage.evaluate(async (id) => {
    const chromeValue: unknown = Reflect.get(globalThis, 'chrome')
    if (!chromeValue || typeof chromeValue !== 'object' || !('developerPrivate' in chromeValue))
      throw new Error('Chrome developerPrivate API is unavailable')

    const developerPrivate = chromeValue.developerPrivate
    if (!developerPrivate || typeof developerPrivate !== 'object' || !('getExtensionInfo' in developerPrivate) || typeof developerPrivate.getExtensionInfo !== 'function')
      throw new Error('Chrome getExtensionInfo API is unavailable')

    const info: unknown = await developerPrivate.getExtensionInfo(id)
    if (!info || typeof info !== 'object')
      throw new Error('Chrome returned invalid extension error info')

    const readMessages = (value: unknown) => {
      if (!Array.isArray(value))
        return []

      return value.map((entry) => {
        if (!entry || typeof entry !== 'object' || !('message' in entry) || typeof entry.message !== 'string')
          throw new Error('Chrome returned an invalid extension error entry')
        return entry.message
      })
    }
    const manifestErrors = 'manifestErrors' in info ? readMessages(info.manifestErrors) : []
    const runtimeErrors = 'runtimeErrors' in info ? readMessages(info.runtimeErrors) : []
    return [...manifestErrors, ...runtimeErrors]
  }, extensionId)

  expect(errors).toEqual([])
})
