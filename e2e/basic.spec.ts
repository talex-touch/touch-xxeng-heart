import { expect, test } from './fixtures'

test('popup opens Lexi controls', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/popup/index.html`)

  await expect(page.getByText('Lexi', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '配置' })).toBeVisible()
})

test('options exposes site and AI configuration', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)

  await expect(page.getByText('Lexi', { exact: true })).toBeVisible()
  await expect(page.getByText('网页启用范围')).toBeVisible()
  await expect(page.getByText('AI 场景配置')).toBeVisible()
})

test('side panel shows daily learning workspace', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/dist/sidepanel/index.html`)

  await expect(page.getByText('Lexical')).toBeVisible()
  await expect(page.getByText('今日推荐')).toBeVisible()
  await expect(page.getByText('待复盘')).toBeVisible()
})
