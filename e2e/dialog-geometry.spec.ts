import type { Locator, Page } from '@playwright/test'
import { configureDigestProvider, expect, test } from './fixtures'

/**
 * The dialog is a floating panel over someone else's page, so it has to get out of the
 * way: drag it by the header, pull it bigger from the corner, and stay put afterwards
 * even though scroll and resize both re-run the anchoring code.
 *
 * Assertions read the inline geometry rather than the rendered box — the panel animates on
 * enter and on every collapse morph, and a measured box mid-morph is not the panel's state.
 */

const pageUrl = 'https://lexi.test/dialog'

interface Geometry {
  left: number
  top: number
  width: string
  height: string
}

async function openDialog(page: Page) {
  await page.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><body style="height: 4000px"><main><article>
      <h1>下载政策更新</h1>
      <p>这是一段足够长的正文内容，用于让 Lexi 建立页面索引并渲染对话面板，方便验证拖动与缩放行为。</p>
    </article></main></body></html>`,
  }))
  await page.goto(pageUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  await page.keyboard.press('ControlOrMeta+Shift+M')
  const dialog = page.locator('[data-lexi-dialog]')
  await expect(dialog).toBeVisible()
  return dialog
}

function geometryOf(dialog: Locator): Promise<Geometry> {
  return dialog.evaluate((element) => {
    const style = (element as HTMLElement).style
    return {
      left: Number.parseFloat(style.left) || 0,
      top: Number.parseFloat(style.top) || 0,
      width: style.width,
      height: style.height,
    }
  })
}

async function boxOf(target: Locator) {
  const box = await target.boundingBox()
  if (!box)
    throw new Error('element has no box')

  return box
}

async function dragBy(page: Page, from: { x: number, y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Two moves: the first starts the gesture, the second is the one being measured.
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2)
  await page.mouse.move(from.x + dx, from.y + dy)
  await page.mouse.up()
}

async function dragFrom(page: Page, target: Locator, dx: number, dy: number) {
  const box = await boxOf(target)
  await dragBy(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy)
}

test.beforeEach(async ({ page, extensionId }) => {
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint: 'https://api.example.test/v1',
    model: 'smoke-model',
    approvals: [],
  })
})

test('对话面板可以从标题栏拖动', async ({ context }) => {
  const page = await context.newPage()
  const dialog = await openDialog(page)
  const before = await geometryOf(dialog)

  await dragFrom(page, dialog.locator('.lexi-dialog__head'), 120, 90)

  const after = await geometryOf(dialog)
  expect(after.left - before.left).toBeCloseTo(120, 0)
  expect(after.top - before.top).toBeCloseTo(90, 0)
  // Dragging moves the panel and nothing else.
  expect(after.width).toBe(before.width)
})

test('拖动后滚动页面不会把面板弹回原位', async ({ context }) => {
  const page = await context.newPage()
  const dialog = await openDialog(page)

  await dragFrom(page, dialog.locator('.lexi-dialog__head'), 100, 70)
  const placed = await geometryOf(dialog)

  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(250)

  expect(await geometryOf(dialog)).toMatchObject({ left: placed.left, top: placed.top })
})

test('对话面板可以从右下角拉伸', async ({ context }) => {
  const page = await context.newPage()
  const dialog = await openDialog(page)
  const before = await boxOf(dialog)

  await dragFrom(page, dialog.locator('.lexi-dialog__resizer'), -160, 120)

  const after = await boxOf(dialog)
  expect(Math.round(before.width - after.width)).toBeGreaterThan(120)
  expect(Math.round(after.height - before.height)).toBeGreaterThan(80)
})

test('打开时给出快捷提问，发出后收起', async ({ context }) => {
  const page = await context.newPage()
  const dialog = await openDialog(page)

  const suggestions = dialog.locator('.lexi-dialog__suggestion')
  await expect(suggestions).toHaveCount(3)
  await expect(suggestions.first()).toHaveText('总结这个页面')

  await suggestions.first().click()

  await expect(dialog.locator('.lexi-dialog__msg--user')).toContainText('总结这个页面')
  await expect(dialog.locator('.lexi-dialog__suggestion')).toHaveCount(0)
})

test('收起时释放手动尺寸，展开后恢复', async ({ context }) => {
  const page = await context.newPage()
  const dialog = await openDialog(page)

  await dragFrom(page, dialog.locator('.lexi-dialog__resizer'), -200, 60)
  const resized = await geometryOf(dialog)
  expect(resized.width).not.toBe('')

  // The collapsed pill sizes itself from a class rule, which an inline width would beat.
  await dialog.getByRole('button', { name: '收起Lexi 对话' }).click()
  await expect(dialog.locator('.lexi-dialog__collapsed-pill')).toBeVisible()
  expect(await geometryOf(dialog)).toMatchObject({ width: '', height: '' })

  await dialog.locator('.lexi-dialog__collapsed-pill').click()
  await expect(dialog.locator('.lexi-dialog__head')).toBeVisible()
  expect(await geometryOf(dialog)).toMatchObject({ width: resized.width, height: resized.height })
})
