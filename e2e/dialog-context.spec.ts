import type { Page } from '@playwright/test'
import { configureDigestProvider, expect, test } from './fixtures'
import type { MockAiServer } from './mockAiServer'

/**
 * Guards the failure this whole path exists to avoid: the panel reports "N segments
 * indexed", the user asks for a summary, and the model is handed nothing but the outline
 * because the question shares no vocabulary with the page.
 */

const pageUrl = 'https://lexi.test/context'

const body = [
  '本页介绍一个用于浏览器扩展的检索方案，重点解释为什么整页注入不可行以及片段化索引如何降低成本。',
  '第二节讨论缓存失效：使用内容哈希判断页面是否变化，避免相同页面在多个标签页重复请求模型。',
  '第三节给出评测方法，包括人工标注的问答对、命中率统计，以及在长页面上的采样覆盖策略。',
]

async function openDialogOn(page: Page, aiServer: MockAiServer) {
  await page.route('https://lexi.test/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><body><main><article>
      <h1>片段化检索</h1>
      <h2>为什么不整页注入</h2>
      <div>${body[0]}</div>
      <h2>缓存失效</h2>
      <div>${body[1]}</div>
      <h2>评测方法</h2>
      <div>${body[2]}</div>
    </article></main></body></html>`,
  }))
  await page.goto(pageUrl)
  await expect(page.locator('#touch-xxeng-heart')).toBeAttached()

  aiServer.answerWith('这是一篇关于片段化检索的文档。')
  await page.keyboard.press('ControlOrMeta+Shift+M')
  const dialog = page.locator('[data-lexi-dialog]')
  await expect(dialog).toBeVisible()
  return dialog
}

function sentPrompts(aiServer: MockAiServer) {
  return aiServer.requests
    .filter(request => request.route === 'openai-chat')
    .map(request => JSON.stringify(request.body?.messages ?? ''))
}

test.beforeEach(async ({ page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: 'smoke-model',
    approvals: [endpoint],
    enableSelection: true,
  })
})

test('总结类提问会把正文发给模型，而不是只发目录', async ({ context, aiServer }) => {
  const page = await context.newPage()
  const dialog = await openDialogOn(page, aiServer)

  await dialog.getByRole('button', { name: '总结这个页面' }).click()
  await expect(dialog.locator('.lexi-dialog__msg--assistant')).toContainText('片段化检索')

  const prompts = sentPrompts(aiServer)
  expect(prompts.length).toBeGreaterThan(0)
  const summarise = prompts.find(prompt => prompt.includes('总结这个页面'))
  expect(summarise).toBeDefined()
  // Every section's body text, not just the heading trail that the outline already carries.
  for (const paragraph of body)
    expect(summarise).toContain(paragraph.slice(0, 20))

  expect(summarise).toContain('覆盖本页全部正文')
})

test('模型可以请求检索页面中的其他内容', async ({ context, aiServer }) => {
  const page = await context.newPage()
  const dialog = await openDialogOn(page, aiServer)

  // First turn asks for the section the question's own wording never matched.
  aiServer.answerWith('<search>评测方法</search>')
  await dialog.locator('.lexi-dialog__input').fill('它怎么证明这套方案有效')
  await dialog.locator('.lexi-dialog__input').press('Enter')

  await expect.poll(() => sentPrompts(aiServer).length, { timeout: 15_000 }).toBeGreaterThan(1)

  const followUp = sentPrompts(aiServer).at(-1)
  expect(followUp).toContain('评测')
  // The tool call is machinery; it must never reach the transcript.
  await expect(dialog.locator('.lexi-dialog__messages')).not.toContainText('<search>')
})
