import type { BrowserContext, Page } from '@playwright/test'
import { expect, settingsStorageKey, test } from './fixtures'

declare const chrome: {
  tabs: {
    query: (query: Record<string, unknown>) => Promise<Array<{ id?: number, url?: string }>>
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>
  }
  storage: {
    local: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

interface PageTranslationStatus {
  running: boolean
  blocks: number
  skipped?: 'target-language'
  pageLanguage?: 'zh' | 'ja' | 'ko' | 'en' | 'other'
  targetLanguage?: 'zh' | 'ja' | 'ko' | 'en' | 'other'
}

const activationsStorageKey = 'touch-xxeng-heart-page-translation-activations'
const articleHost = 'docs.example.com'
const chineseBody = '这篇文章说明了贡献者如何审阅改动、理解整体设计，并把更新安全地发布给所有读者，同时列出了发布前必须完成的检查事项与常见问题。'
const chineseArticle = `${chineseBody}文中还说明了每一步的判断依据、需要记录的证据，以及出现分歧时应该由谁来决定最终结论。`.repeat(2)
const englishBody = 'This article explains how contributors review incoming changes, understand the design behind them, and ship the update to readers without breaking published behaviour.'

function routeHtml(context: BrowserContext, body: string) {
  return context.route('https://docs.example.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><title>Lexi page translation smoke</title></head><body>${body}</body></html>`,
  }))
}

function routeArticle(context: BrowserContext, body: string) {
  return routeHtml(context, `<main><article><p>${body}</p></article></main>`)
}

/**
 * The options page owns the first write of the settings object, so this waits for that
 * write before patching — an edit made earlier is silently overwritten.
 */
async function seedTranslationSettings(
  page: Page,
  extensionId: string,
  endpoint: string,
  direction: 'en-to-zh' | 'zh-to-en',
) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)

  await page.evaluate(async ({ settingsKey, endpoint, direction }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    settings.selection.enabled = true
    settings.selection.pageTranslation.direction = direction
    settings.ai.selection.enabled = true
    settings.ai.approvedHttpEndpoints = [endpoint]
    settings.ai.providers[0].enabled = true
    settings.ai.providers[0].protocol = 'openai-chat'
    settings.ai.providers[0].endpoint = endpoint
    settings.ai.providers[0].model = 'smoke-model'
    settings.ai.providers[0].apiKey = ''
    await chrome.storage.local.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey: settingsStorageKey, endpoint, direction })
}

async function seedPageTranslationRule(page: Page, extensionId: string, endpoint: string) {
  await seedTranslationSettings(page, extensionId, endpoint, 'en-to-zh')
  await page.evaluate(async ({ activationsKey, host }) => {
    await chrome.storage.local.set({
      [activationsKey]: JSON.stringify({
        [`site:${host}`]: { enabled: true, scope: 'site', url: `https://${host}/`, host, regex: '', updatedAt: 1 },
      }),
    })
  }, { activationsKey: activationsStorageKey, host: articleHost })
}

/** The documented whole-page shortcut: two Ctrl key-ups inside the gesture window. */
async function doubleTapCtrl(page: Page) {
  await page.keyboard.press('Control')
  await page.keyboard.press('Control')
}

/** Block ids the request carried, however the provider wrapped the payload. */
function requestBlockIds(rawBody: string) {
  return [...rawBody.matchAll(/\\?"id\\?":\s*\\?"([^"\\]+)\\?"/g)].map(match => match[1])
}

function readPageTranslationStatus(page: Page, url: string) {
  return page.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find(candidate => candidate.url?.startsWith(targetUrl))
    if (!tab?.id)
      throw new Error(`no tab for ${targetUrl}`)

    return chrome.tabs.sendMessage(tab.id, {
      channel: 'lexi',
      type: 'lexi-page-translate-status',
      data: {},
    }) as Promise<PageTranslationStatus>
  }, url)
}

test('a saved site rule skips a page already written in the target language', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  await routeArticle(context, chineseBody)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/chinese')

  await expect.poll(async () => (await readPageTranslationStatus(page, 'https://docs.example.com/chinese')).skipped)
    .toBe('target-language')
  await contentPage.waitForTimeout(1_000)

  await expect(contentPage.locator('[data-lexi-page-translation="true"]')).toHaveCount(0)
  expect(aiServer.requests).toHaveLength(0)
})

test('the same saved rule still translates a page written in the source language', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  await routeArticle(context, englishBody)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/english')

  await expect.poll(() => aiServer.requests.length).toBeGreaterThan(0)
  const status = await readPageTranslationStatus(page, 'https://docs.example.com/english')
  expect(status.running).toBe(true)
  expect(status.skipped).toBeUndefined()
  expect(JSON.stringify(aiServer.requests[0].body)).toContain('This article explains how contributors review')
})

test('the double Ctrl shortcut does not translate a page already in the target language', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedTranslationSettings(page, extensionId, endpoint, 'en-to-zh')
  await routeArticle(context, chineseBody)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/gesture-chinese')
  await doubleTapCtrl(contentPage)

  await expect.poll(async () => (await readPageTranslationStatus(page, 'https://docs.example.com/gesture-chinese')).skipped)
    .toBe('target-language')
  await contentPage.waitForTimeout(1_000)

  await expect(contentPage.locator('[data-lexi-page-translation="true"]')).toHaveCount(0)
  expect(aiServer.requests).toHaveLength(0)
})

test('the double Ctrl shortcut still translates a page in the source language', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedTranslationSettings(page, extensionId, endpoint, 'en-to-zh')
  await routeArticle(context, englishBody)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/gesture-english')
  await doubleTapCtrl(contentPage)

  await expect.poll(() => aiServer.requests.length).toBeGreaterThan(0)
  const status = await readPageTranslationStatus(page, 'https://docs.example.com/gesture-english')
  expect(status.running).toBe(true)
  expect(status.skipped).toBeUndefined()
})

test('a mixed page leaves the blocks that are already in the target language alone', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  // Page translation is addressed by block id, so the reply has to quote the ids the
  // request carried — a fixed answer would be routed to nothing and translated nothing.
  aiServer.answerWithResolver(rawBody => JSON.stringify({
    items: requestBlockIds(rawBody).map(id => ({ id, translation: 'LEXI-TRANSLATED-BLOCK' })),
  }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  await routeHtml(context, `<main><article><p>${englishBody}</p><p>${chineseBody}</p></article></main>`)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/mixed')

  await expect.poll(() => aiServer.requests.length).toBeGreaterThan(0)
  await expect.poll(() => contentPage.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('main article > p')).map(paragraph => ({
      translated: paragraph.nextElementSibling?.getAttribute('data-lexi-page-translation') === 'true',
      translation: paragraph.nextElementSibling?.getAttribute('data-lexi-page-translation') === 'true' ? paragraph.nextElementSibling.textContent : '',
    }))
  })).toEqual([
    { translated: true, translation: 'LEXI-TRANSLATED-BLOCK' },
    { translated: false, translation: '' },
  ])

  // The English paragraph is the work; the Chinese one would have been handed back in the
  // language the reader asked for.
  const sent = JSON.stringify(aiServer.requests.map(request => request.body))
  expect(sent).toContain('This article explains how contributors review')
  expect(sent).not.toContain('这篇文章说明了贡献者如何审阅改动')
})

test('the article speaks for the page, not the English chrome around it', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  const navigation = Array.from({ length: 12 }, () => `<li>${englishBody.repeat(2)}</li>`).join('')
  await routeHtml(context, `<nav><ul>${navigation}</ul></nav><main><article><p>${chineseArticle}</p></article></main>`)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/chinese-article')

  await expect.poll(async () => (await readPageTranslationStatus(page, 'https://docs.example.com/chinese-article')).skipped)
    .toBe('target-language')
  await contentPage.waitForTimeout(1_000)

  expect(aiServer.requests).toHaveLength(0)
  await expect(contentPage.locator('[data-lexi-page-translation="true"]')).toHaveCount(0)
})

test('the status reports which language it read and which one it aimed for', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  await routeArticle(context, chineseBody)

  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/labelled')

  await expect.poll(async () => {
    const status = await readPageTranslationStatus(page, 'https://docs.example.com/labelled')
    return `${status.pageLanguage ?? '?'}->${status.targetLanguage ?? '?'}`
  }).toBe('zh->zh')
  await contentPage.waitForTimeout(500)
})

test('the side panel names the language it read instead of a bare skip', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify({ items: [] }))
  await seedPageTranslationRule(page, extensionId, endpoint)
  await routeArticle(context, chineseArticle)

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)
  const contentPage = await context.newPage()
  await contentPage.goto('https://docs.example.com/panel')

  await expect(panel.getByText('本页正文是中文，正是「译成中文」的目标，已跳过自动翻译；需要时可在下方手动开始。')).toBeVisible()
  expect(aiServer.requests).toHaveLength(0)
})
