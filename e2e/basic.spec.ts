import { expect, test } from './fixtures'

declare const chrome: {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

test('popup opens Lexi controls', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)

  await expect(page.getByText('Lexi', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '配置' })).toBeVisible()
})

test('options exposes site and AI configuration', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)

  await expect(page.locator('header')).toContainText('Lexi')
  await expect(page.getByRole('heading', { name: '网页启用范围' })).toBeVisible()
  await page.getByRole('button', { name: 'AI 场景' }).click()
  await expect(page.getByRole('heading', { name: 'AI 场景配置' })).toBeVisible()
})

test('side panel shows daily learning workspace', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)

  await expect(page.getByText('Lexical')).toBeVisible()
  await page.getByRole('button', { name: /历史复盘/ }).click()
  await expect(page.getByText('今日推荐')).toBeVisible()
  await expect(page.getByText('待复盘')).toBeVisible()
})

test('reviewing a due vocabulary record persists remembered feedback', async ({ page, context, extensionId }) => {
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
  const extensionWorker = context.serviceWorkers().find(worker => worker.url().includes(extensionId))
  if (!extensionWorker)
    throw new Error('Extension service worker was not available for storage setup')

  await extensionWorker.evaluate(async ({ key, record }) => {
    await chrome.storage.local.set({ [key]: JSON.stringify([record]) })
  }, { key: vocabularyStorageKey, record: dueRecord })

  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)
  await page.getByRole('button', { name: /历史复盘/ }).click()

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

  const readPersistedRecord = () => extensionWorker.evaluate(async ({ id, key }) => {
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
