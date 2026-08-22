import path from 'node:path'
import { type BrowserContext, type Page, test as base, chromium } from '@playwright/test'
import { startMockAiServer } from './mockAiServer'
import type { MockAiProtocol, MockAiServer } from './mockAiServer'

export { name } from '../package.json'

export const extensionPath = path.join(__dirname, '../extension')

export const settingsStorageKey = 'touch-xxeng-heart-settings'
export const aiCallLogsStorageKey = 'touch-xxeng-heart-ai-call-logs'

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  aiServer: MockAiServer
}>({
  context: async ({ headless }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless,
      args: [
        ...(headless ? ['--headless=new'] : []),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    // for manifest v3:
    let [background] = context.serviceWorkers()
    if (!background)
      background = await context.waitForEvent('serviceworker')

    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
  // eslint-disable-next-line no-empty-pattern
  aiServer: async ({}, use) => {
    const server = await startMockAiServer()
    await use(server)
    await server.close()
  },
})

export const expect = test.expect

declare const chrome: {
  storage: {
    local: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

export interface DigestProviderConfig {
  protocol: MockAiProtocol
  endpoint: string
  model: string
  apiKey?: string
  /** HTTP endpoints only run once the user has confirmed them, in both worlds. */
  approvals: string[]
  autoGenerate?: boolean
  /** The dialog panel runs on the selection scene, so it needs that one bound too. */
  enableSelection?: boolean
}

/**
 * Points the digest scene at one provider.
 *
 * The options page owns the first write of the settings object, so this waits for that
 * write before patching — an edit made earlier is silently overwritten.
 */
export async function configureDigestProvider(page: Page, extensionId: string, config: DigestProviderConfig) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tablist', { name: '设置分类' }).getByRole('tab', { name: '基础设置', exact: true }).click()
  await page.getByRole('tablist', { name: '基础设置分区' }).getByRole('tab', { name: '内容速读', exact: true }).click()
  await expect(page.getByRole('heading', { name: '多平台内容速读' })).toBeVisible()
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)

  await page.evaluate(async ({ key, config }) => {
    const stored = await chrome.storage.local.get(key)
    const settings = JSON.parse(stored[key] as string)
    settings.contentDigest.enabled = true
    settings.contentDigest.autoGenerate = config.autoGenerate ?? false
    settings.contentDigest.autoDelaySeconds = 1
    settings.contentDigest.allowNsfw = false
    settings.ai.digest.enabled = true
    settings.ai.selection.enabled = config.enableSelection ?? false
    settings.ai.approvedHttpEndpoints = config.approvals
    settings.ai.providers[0].enabled = true
    settings.ai.providers[0].protocol = config.protocol
    settings.ai.providers[0].endpoint = config.endpoint
    settings.ai.providers[0].model = config.model
    settings.ai.providers[0].apiKey = config.apiKey ?? ''
    await chrome.storage.local.set({ [key]: JSON.stringify(settings) })
  }, { key: settingsStorageKey, config })
}

/** A Reddit post shaped the way the content adapter expects, served off the network. */
export function routeDigestPost(context: BrowserContext, post: { id: string, title: string, body: string }) {
  return context.route('https://www.reddit.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <shreddit-post post-id="${post.id}">
        <h1 slot="title">${post.title}</h1>
        <div slot="text-body">${post.body}</div>
      </shreddit-post>
    </body></html>`,
  }))
}

export function digestPostUrl(id: string) {
  return `https://www.reddit.com/r/webdev/comments/${id}/smoke/`
}

export async function readAiCallLogs(page: Page) {
  return page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return JSON.parse(String(stored[key] ?? '[]')) as Array<{
      scene: string
      endpoint: string
      model: string
      ok: boolean
      status?: number
      streamed?: boolean
      error?: string
    }>
  }, aiCallLogsStorageKey)
}
