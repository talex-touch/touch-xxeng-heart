import { expect, settingsStorageKey, test } from './fixtures'

declare const chrome: {
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>
  }
  tabs: {
    query: (query: Record<string, unknown>) => Promise<Array<{ id?: number }>>
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>
  }
  storage: {
    local: {
      get: (key: string | null) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
    sync: {
      get: (key: string | null) => Promise<Record<string, unknown>>
    }
  }
}

test('popup opens Lexi controls', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)

  await expect(page.getByText('Lexi', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开设置' })).toBeVisible()
})

test('options exposes site and AI configuration', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)

  await expect(page.locator('.options-header')).toContainText('Lexi')

  const settingsTabs = page.getByRole('tablist', { name: '基础设置分区' })
  const vocabularyReplacement = settingsTabs.getByRole('tab', { name: '词汇替换', exact: true })
  await expect(vocabularyReplacement).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: '替换强度' })).toBeVisible()

  await settingsTabs.getByRole('tab', { name: '网页范围', exact: true }).click()
  await expect(page.getByRole('heading', { name: '网页启用范围' })).toBeVisible()

  await settingsTabs.getByRole('tab', { name: '内容速读', exact: true }).click()
  await expect(page.getByRole('heading', { name: '多平台内容速读' })).toBeVisible()
  await expect(page.getByRole('switch', { name: '允许 NSFW 内容速读' })).toHaveAttribute('aria-checked', 'false')

  await page.getByRole('tab', { name: '供应商与功能' }).click()
  await page.getByRole('tablist', { name: '供应商与功能分区' }).getByRole('tab', { name: 'Provider 与功能', exact: true }).click()
  await expect(page.getByRole('heading', { name: '通用 Provider' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '协议' })).toBeVisible()
  await expect(page.getByRole('switch', { name: '内容速读' })).toBeVisible()
})

test('vocabulary tabs switch between overview and settings', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tab', { name: '词库记录' }).click()

  const vocabularyTabs = page.getByRole('tablist', { name: '词库记录分区' })
  const overview = vocabularyTabs.getByRole('tab', { name: '概览', exact: true })
  const settings = vocabularyTabs.getByRole('tab', { name: '设置', exact: true })

  await settings.click()
  await expect(settings).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('备份与迁移', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 搜索' })).toBeHidden()

  await overview.click()
  await expect(overview).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'AI 搜索' })).toBeVisible()
  await expect(page.getByText('备份与迁移', { exact: true })).toBeHidden()
})

test('providers are created, tested and removed from the table', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tab', { name: '供应商与功能' }).click()
  await page.getByRole('tablist', { name: '供应商与功能分区' }).getByRole('tab', { name: 'Provider 与功能', exact: true }).click()

  // Wait for the stored settings to land; edits made before that first read are lost.
  await expect(page.getByRole('row', { name: /默认 Provider/ })).toBeVisible()

  const editor = page.getByRole('dialog', { name: '添加 Provider' })
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await expect(editor).toBeVisible()

  await editor.getByLabel('名称').fill('Responses 网关')
  await editor.getByLabel('协议').selectOption('openai-responses')
  await editor.getByLabel('Endpoint').fill('https://api.example.test/v1')
  await editor.getByLabel('模型').fill('gpt-5')
  await editor.getByRole('button', { name: '保存' }).click()
  await expect(editor).toBeHidden()

  const row = page.getByRole('row', { name: /Responses 网关/ })
  await expect(row).toContainText('OpenAI Responses')
  await expect(row).toContainText('gpt-5')

  await row.getByRole('button', { name: '删除' }).click()
  await expect(page.getByRole('row', { name: /Responses 网关/ })).toHaveCount(0)
})

test('enabling sync mirrors settings into the browser account', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tab', { name: '基础设置' }).click()
  await page.getByRole('tablist', { name: '基础设置分区' }).getByRole('tab', { name: '同步', exact: true }).click()

  await expect(page.getByRole('heading', { name: '同步到 Google 账号' })).toBeVisible()
  // Let the options page persist its initial settings before interacting; otherwise that
  // initial write can overwrite the toggle and leave the background worker nothing to mirror.
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)

  await page.getByRole('switch', { name: '启用同步' }).click()

  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    if (typeof stored[key] !== 'string')
      return false

    return JSON.parse(stored[key]).sync.enabled === true
  }, settingsStorageKey)).toBe(true)

  const expectedSettings = await page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    const settings = JSON.parse(String(stored[key]))
    const { sync, ai, ...rest } = settings

    return {
      ...rest,
      ai: {
        ...ai,
        approvedHttpEndpoints: [],
        providers: ai.providers.map((provider: Record<string, unknown>) => (
          sync.includeApiKeys ? provider : { ...provider, apiKey: '' }
        )),
      },
    }
  }, settingsStorageKey)

  // The mirror is complete only when the canonical meta record names every contiguous
  // chunk, the joined chunks match its recorded length, and their decoded settings equal
  // the local user settings that are safe to sync.
  await expect.poll(async () => page.evaluate(async (expected) => {
    const items = await chrome.storage.sync.get(null)
    const rawMeta = items['lexi-sync-settings-meta']
    if (typeof rawMeta !== 'string')
      return undefined

    let meta: { chunks?: unknown, length?: unknown }
    try {
      meta = JSON.parse(rawMeta)
    }
    catch {
      return undefined
    }

    const chunkCount = meta.chunks
    const payloadLength = meta.length
    if (typeof chunkCount !== 'number' || !Number.isInteger(chunkCount) || chunkCount < 1
      || typeof payloadLength !== 'number' || !Number.isInteger(payloadLength)) {
      return undefined
    }

    const chunkKeys = Array.from(
      { length: chunkCount },
      (_, index) => `lexi-sync-settings-chunk-${index}`,
    )
    const mirrorKeys = Object.keys(items)
      .filter(key => key.startsWith('lexi-sync-settings'))
      .sort()
    if (JSON.stringify(mirrorKeys) !== JSON.stringify(['lexi-sync-settings-meta', ...chunkKeys].sort()))
      return undefined

    const chunks = chunkKeys.map(key => items[key])
    if (chunks.some(chunk => typeof chunk !== 'string'))
      return undefined

    const payload = chunks.join('')
    if (payload.length !== payloadLength)
      return undefined

    try {
      const snapshot = JSON.parse(payload)
      return JSON.stringify(snapshot.settings) === JSON.stringify(expected)
    }
    catch {
      return undefined
    }
  }, expectedSettings), { timeout: 15000 }).toBe(true)
})

test('replacement strength maps levels and density tiers to plain language', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)

  const card = page.locator('.settings-card--wide')
  const level = card.locator('input[type="range"]')

  await expect(level).toHaveValue('5')
  await expect(card.getByText('大学四级 CET-4 · 中等标准').first()).toBeVisible()

  await card.getByRole('button', { name: '极少' }).click()
  await expect(card.getByText('实际生效约 0.8%')).toBeVisible()

  await card.getByRole('button', { name: '9 个等级分别对应什么' }).click()
  await card.getByRole('button', { name: /零基础 \/ 小学/ }).click()
  await expect(level).toHaveValue('1')
  await expect(card.getByText('当前等级 1 折算系数 ×0.4，实际生效约 0.4%。')).toBeVisible()
})

test('HTTP endpoints require per-address confirmation', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await page.getByRole('tab', { name: '供应商与功能' }).click()
  await page.getByRole('tablist', { name: '供应商与功能分区' }).getByRole('tab', { name: 'Provider 与功能', exact: true }).click()
  await page.getByRole('row', { name: /默认 Provider/ }).getByRole('button', { name: '编辑' }).click()

  const editor = page.getByRole('dialog', { name: '编辑 Provider' })
  const endpoint = editor.getByLabel('Endpoint')
  const approval = page.getByRole('dialog', { name: '确认使用 HTTP Endpoint' })

  await endpoint.fill('http://API.example.com:80/v1/')
  await endpoint.blur()
  await expect(approval).toBeVisible()
  await approval.getByRole('button', { name: '取消' }).click()
  await expect(endpoint).toHaveValue('')

  await endpoint.fill('http://API.example.com:80/v1/')
  await endpoint.blur()
  await approval.getByRole('button', { name: '理解风险并允许' }).click()
  await expect(endpoint).toHaveValue('http://api.example.com/v1')
  await expect(page.getByText('http://api.example.com/v1', { exact: true })).toBeVisible()

  await endpoint.fill('http://api.example.com/v2')
  await endpoint.blur()
  await expect(approval).toBeVisible()
})

test('analytics keeps concurrent background writes', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)

  await page.evaluate(async () => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => chrome.runtime.sendMessage({
      channel: 'lexi',
      type: 'lexi-record-analytics',
      data: {
        kind: 'page',
        item: {
          id: `concurrent-${index}`,
          url: `https://example.com/${index}`,
          title: `Page ${index}`,
          host: 'example.com',
          enabled: true,
          replacements: 0,
          records: 0,
          createdAt: Date.now() + index,
        },
      },
    })))
  })

  const ids = await page.evaluate(async () => {
    const key = 'touch-xxeng-heart-page-visit-logs'
    const stored = await chrome.storage.local.get(key)
    const logs = JSON.parse(String(stored[key] ?? '[]')) as Array<{ id: string }>
    return logs.map(log => log.id)
  })
  expect(ids).toHaveLength(20)
  expect(new Set(ids).size).toBe(20)
})

test('stopping a pending page translation invalidates its start', async ({ page, context, extensionId }) => {
  await context.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main><p>这是一个足够长的页面翻译测试段落，用于验证快速停止后旧的启动流程不会重新启用自动翻译功能。</p></main></body></html>',
  }))
  const contentPage = await context.newPage()
  await contentPage.goto('https://lexi.test/pending-translation')
  await expect(contentPage.locator('#touch-xxeng-heart')).toBeAttached()

  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)
  const result = await page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://lexi.test/*' })
    if (!tab?.id)
      throw new Error('Translation test tab was not found')

    const start = chrome.tabs.sendMessage(tab.id, {
      channel: 'lexi',
      type: 'lexi-page-translate-start',
      data: {},
    })
    const stop = chrome.tabs.sendMessage(tab.id, {
      channel: 'lexi',
      type: 'lexi-page-translate-stop',
      data: {},
    })
    const [startResult, stopResult] = await Promise.all([start, stop])
    const stored = await chrome.storage.local.get(null)
    return { startResult, stopResult, stored }
  }) as {
    startResult: { ok?: boolean }
    stopResult: { ok?: boolean }
    stored: Record<string, unknown>
  }

  expect(result.startResult.ok).toBe(false)
  expect(result.stopResult.ok).toBe(true)
  const activations = JSON.parse(String(result.stored['touch-xxeng-heart-page-translation-activations'] ?? '{}'))
  expect(Object.keys(activations)).toHaveLength(0)
  const caches = Object.entries(result.stored)
    .filter(([key]) => key.startsWith('touch-xxeng-heart-page-translations:'))
    .map(([, value]) => JSON.parse(String(value)))
  expect(caches.every(cache => cache.enabled === false)).toBe(true)
  await contentPage.close()
})

test('side panel shows daily learning workspace', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)

  await expect(page.getByText('Lexical')).toBeVisible()
  await expect(page.getByRole('heading', { name: '本页功能不可用' })).toBeVisible()
  await expect(page.getByText('Lexi 管理页和浏览器内部页面不会加载网页增强脚本。')).toBeVisible()
  await expect(page.getByText('当前页面还未加载新版 Lexi 内容脚本')).toBeHidden()
  await page.getByRole('tab', { name: /记录/ }).click()
  await expect(page.getByText('今日推荐')).toBeVisible()
  await expect(page.getByText('待复盘')).toBeVisible()
})

test('side panel follows active page support without reloading', async ({ page, context, extensionId }) => {
  await context.route('https://sidepanel.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main><p>用于验证侧边栏页面上下文切换。</p></main></body></html>',
  }))
  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)
  await expect(page.getByRole('heading', { name: '本页功能不可用' })).toBeVisible()

  const supportedPage = await context.newPage()
  await supportedPage.goto('https://sidepanel.test/context')
  await expect(supportedPage.locator('#touch-xxeng-heart')).toBeAttached()
  await expect(page.getByRole('heading', { name: '页面双语翻译' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '本页功能不可用' })).toBeHidden()

  const internalPage = await context.newPage()
  await internalPage.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect(page.getByRole('heading', { name: '本页功能不可用' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始翻译' })).toBeHidden()

  await internalPage.close()
  await supportedPage.close()
})

test('reviewing a due vocabulary record persists remembered feedback', async ({ page, extensionId }) => {
  const minute = 60 * 1000
  const day = 24 * 60 * minute
  const vocabularyStorageKey = 'touch-xxeng-heart-vocabulary'
  const dueRecord = {
    id: 'e2e-review:remembered',
    original: '待复盘词',
    replacement: 'reviewe2e',
    meaning: 'A record prepared for end-to-end review.',
    example: 'Review this record in the side panel.',
    tags: ['technical'],
    difficulty: 2,
    source: 'manual' as const,
    seenCount: 1,
    selectedCount: 1,
    learnedLevel: 2,
    reviewCount: 4,
    lastReviewedAt: Date.now() - day,
    createdAt: Date.now() - 2 * day,
    updatedAt: Date.now() - day,
    nextReviewAt: Date.now() - minute,
  }
  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)
  await expect(page.getByText('Lexical')).toBeVisible()
  await page.evaluate(async ({ key, record }) => {
    await chrome.storage.local.set({ [key]: JSON.stringify([record]) })
  }, { key: vocabularyStorageKey, record: dueRecord })

  await page.getByRole('tab', { name: /记录/ }).click()

  const forgot = page.getByRole('button', { name: 'reviewe2e：不认识' })
  const hard = page.getByRole('button', { name: 'reviewe2e：有点模糊' })
  const remembered = page.getByRole('button', { name: 'reviewe2e：认识' })
  await expect(forgot).toBeVisible()
  await expect(hard).toBeVisible()
  await expect(remembered).toBeVisible()

  const reviewStartedAt = Date.now()
  await remembered.click()
  const reviewFinishedAt = Date.now()

  await expect(page.getByText('reviewe2e 已标记为认识')).toBeVisible()
  await expect(page.getByText(/今日已完成 1 \/ \d+ 个词/)).toBeVisible()
  await expect(remembered).toBeHidden()

  const readPersistedRecord = () => page.evaluate(async ({ id, key }) => {
    const stored = await chrome.storage.local.get(key)
    const records = JSON.parse(String(stored[key] ?? '[]'))
    return records.find((record: { id: string }) => record.id === id)
  }, { id: dueRecord.id, key: vocabularyStorageKey })

  await expect.poll(readPersistedRecord).toMatchObject({
    learnedLevel: 3,
    reviewCount: 5,
  })

  const persistedRecord = await readPersistedRecord()
  expect(persistedRecord.lastReviewedAt).toBeGreaterThanOrEqual(reviewStartedAt)
  expect(persistedRecord.lastReviewedAt).toBeLessThanOrEqual(reviewFinishedAt)
  expect(persistedRecord.nextReviewAt).toBe(persistedRecord.lastReviewedAt + 7 * day)
})
