import { configureDigestProvider, digestPostUrl, expect, routeDigestPost, test } from './fixtures'

/**
 * The AI gateway is a real local server rather than a `context.route` handler: the request
 * leaves from the extension service worker, which page routing does not intercept.
 */

const answer = {
  oneLine: '帖子讨论浏览器摘要缓存。',
  summary: ['使用内容哈希进行缓存失效。'],
  keyPoints: ['跨标签页请求需要去重。'],
  viewpoints: [],
  actions: ['为动态评论设置较短 TTL。'],
  terms: ['cache'],
}

test('content digest suppresses rapid duplicate generation clicks', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify(answer))
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: 'smoke-model',
    approvals: [endpoint],
  })

  await routeDigestPost(context, {
    id: 'abc123',
    title: 'Browser cache architecture',
    body: 'The post compares source hashes, TTLs, and cross-tab request leases.',
  })

  const contentPage = await context.newPage()
  await contentPage.goto(digestPostUrl('abc123'))
  const card = contentPage.locator('[data-lexi-content-digest="true"]')
  const generate = card.getByRole('button', { name: '生成摘要' })
  await expect(generate).toBeVisible()
  await generate.evaluate((button) => {
    const element = button as HTMLButtonElement
    element.click()
    element.click()
  })

  await expect(card.getByText(answer.oneLine)).toBeVisible()
  expect(aiServer.requests).toHaveLength(1)
})

test('NSFW-off blocks extraction before any AI request', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWith(JSON.stringify(answer))
  await configureDigestProvider(page, extensionId, {
    protocol: 'openai-chat',
    endpoint,
    model: 'smoke-model',
    approvals: [endpoint],
    autoGenerate: true,
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

  const contentPage = await context.newPage()
  await contentPage.goto(digestPostUrl('restricted'))
  const card = contentPage.locator('[data-lexi-content-digest="true"]')
  await expect(card.locator('.lexi-content-digest__status--blocked')).toHaveText('NSFW 内容速读默认关闭，当前内容没有提取或发送给 AI。')
  await contentPage.waitForTimeout(1_300)
  expect(aiServer.requests).toHaveLength(0)
})
