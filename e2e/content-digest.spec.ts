import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

declare const chrome: {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

const settingsKey = 'touch-xxeng-heart-settings'

async function configureDigest(page: Page, extensionId: string, autoGenerate: boolean) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.getByRole('heading', { name: '多平台内容速读' })).toBeVisible()
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsKey)).toBe(true)
  await page.evaluate(async ({ key, auto }) => {
    const stored = await chrome.storage.local.get(key)
    const settings = JSON.parse(stored[key] as string)
    settings.contentDigest.enabled = true
    settings.contentDigest.autoGenerate = auto
    settings.contentDigest.autoDelaySeconds = 1
    settings.contentDigest.allowNsfw = false
    settings.ai.digest.enabled = true
    settings.ai.providers[0].enabled = true
    settings.ai.providers[0].endpoint = 'https://api.example.test/v1'
    settings.ai.providers[0].model = 'o1-test'
    await chrome.storage.local.set({ [key]: JSON.stringify(settings) })
  }, { key: settingsKey, auto: autoGenerate })
}

function aiResponse() {
  return JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          oneLine: '帖子讨论浏览器摘要缓存。',
          summary: ['使用内容哈希进行缓存失效。'],
          keyPoints: ['跨标签页请求需要去重。'],
          viewpoints: [],
          actions: ['为动态评论设置较短 TTL。'],
          terms: ['cache'],
        }),
      },
    }],
  })
}

test('content digest suppresses rapid duplicate generation clicks', async ({ context, page, extensionId }) => {
  await configureDigest(page, extensionId, false)
  let aiRequests = 0
  await context.route('https://api.example.test/**', async (route) => {
    aiRequests += 1
    await new Promise(resolve => setTimeout(resolve, 250))
    await route.fulfill({ status: 200, contentType: 'application/json', body: aiResponse() })
  })
  await context.route('https://www.reddit.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <shreddit-post post-id="abc123">
        <h1 slot="title">Browser cache architecture</h1>
        <div slot="text-body">The post compares source hashes, TTLs, and cross-tab request leases.</div>
      </shreddit-post>
      <shreddit-comment><div slot="comment">Keep the cache payload small and avoid storing source text.</div></shreddit-comment>
    </body></html>`,
  }))

  await page.goto('https://www.reddit.com/r/webdev/comments/abc123/cache/')
  const card = page.locator('[data-lexi-content-digest="true"]')
  const generate = card.getByRole('button', { name: '生成摘要' })
  await expect(generate).toBeVisible()
  await generate.evaluate((button) => {
    const element = button as HTMLButtonElement
    element.click()
    element.click()
  })

  await expect(card.getByText('帖子讨论浏览器摘要缓存。')).toBeVisible()
  expect(aiRequests).toBe(1)
})

test('NSFW-off blocks extraction before any AI request', async ({ context, page, extensionId }) => {
  await configureDigest(page, extensionId, true)
  let aiRequests = 0
  await context.route('https://api.example.test/**', (route) => {
    aiRequests += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: aiResponse() })
  })
  await context.route('https://www.reddit.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <shreddit-post post-id="restricted" nsfw>
        <h1 slot="title">Restricted post</h1>
        <div slot="text-body">This body must not be extracted or sent while NSFW is disabled.</div>
      </shreddit-post>
    </body></html>`,
  }))

  await page.goto('https://www.reddit.com/r/test/comments/restricted/post/')
  const card = page.locator('[data-lexi-content-digest="true"]')
  await expect(card.locator('.lexi-content-digest__status--blocked')).toHaveText('NSFW 内容速读默认关闭，当前内容没有提取或发送给 AI。')
  await page.waitForTimeout(1_300)
  expect(aiRequests).toBe(0)
})
