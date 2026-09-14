/**
 * Real-Chromium proof for the Discourse Livestream / Chat bilingual adapter.
 *
 * The unit suite drives it from jsdom, where every message is already in the document when
 * the adapter starts and `IntersectionObserver` is a stub. A livestream is the opposite
 * shape: the channel is mounted once, then messages arrive one at a time long after the page
 * settled, and each arrival has to be noticed, admitted and translated on its own. That
 * late-arrival path is the reader-visible regression this file pins.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { expect, settingsStorageKey, test } from './fixtures'

declare const chrome: {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
  }
}

const chatHost = 'chat.example.com'
const chatUrl = `https://${chatHost}/live`
/** Both request ids and translation ids are the adapter's `${channelId}:${messageId}`. */
const channelId = '42'

const welcomeId = '1'
const chineseId = '2'
const deletedId = '3'
const livestreamId = '4'

const welcomeMessage = 'Welcome to the livestream, tonight we review the new release together.'
/**
 * Mostly Chinese but carrying a Latin brand name: it clears the "has letters" admission gate
 * and must still be refused by the language gate, which is the branch worth pinning.
 */
const chineseMessage = '这条中文消息已经是目标语言 in Lexi，不应该再被送去翻译。'
const deletedMessage = 'DeletedProbeQuill this message was removed before anyone could read it.'
const livestreamMessage = 'Just joined from the phone app, could you show the settings panel again?'

interface ChatMessageFixture {
  id: string
  text: string
  className?: string
}

/** What the reader sees for one message: the message itself, plus the translation beside it. */
interface ChatMessageRender {
  /** The message body's own markup, which the adapter must never rewrite. */
  bodyHtml: string
  bodyText: string
  /** Id the neighbouring translation was mounted for, if there is one. */
  translationId: string | null
  translationText: string | null
  /** Whether that translation is the message body's immediate sibling. */
  translationIsSibling: boolean
}

function chatMessageHtml(message: ChatMessageFixture) {
  const className = message.className ?? 'chat-message-container'
  return `<div class="${className}" data-id="${message.id}"><div class="chat-message-text">${message.text}</div></div>`
}

/**
 * A chat channel shaped the way the adapter reads it, served off the network.
 *
 * The channel needs a real, on-screen box: with an `IntersectionObserver` present, intersection
 * is the only visibility authority, and a zero-size node never intersects — nothing would ever
 * be translated.
 */
function routeChatChannel(context: BrowserContext, messages: ChatMessageFixture[]) {
  const rows = messages.map(chatMessageHtml).join('')
  return context.route(`https://${chatHost}/**`, route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><title>Lexi livestream smoke</title><style>
      body { margin: 0 }
      .chat-channel { display: block; width: 900px; min-height: 600px; padding: 12px }
      .chat-message-container { display: block; min-height: 32px; margin: 8px 0 }
      .chat-message-text { display: block; min-height: 20px }
    </style></head><body><div class="chat-channel" data-chat-channel-id="${channelId}">${rows}</div></body></html>`,
  }))
}

/**
 * The options page owns the first write of the settings object, so this waits for that write
 * before patching — an edit made earlier is silently overwritten.
 */
async function seedChatTranslation(page: Page, extensionId: string, endpoint: string) {
  await page.goto(`chrome-extension://${extensionId}/dist/options/index.html`)
  await expect.poll(() => page.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key)
    return typeof stored[key] === 'string'
  }, settingsStorageKey)).toBe(true)

  await page.evaluate(async ({ settingsKey, endpoint }) => {
    const stored = await chrome.storage.local.get(settingsKey)
    const settings = JSON.parse(stored[settingsKey] as string)
    settings.selection.enabled = true
    settings.selection.pageTranslation.direction = 'en-to-zh'
    settings.selection.pageTranslation.autoSites.discourse = true
    settings.ai.selection.enabled = true
    settings.ai.approvedHttpEndpoints = [endpoint]
    settings.ai.providers[0].enabled = true
    settings.ai.providers[0].protocol = 'openai-chat'
    settings.ai.providers[0].endpoint = endpoint
    settings.ai.providers[0].model = 'smoke-model'
    settings.ai.providers[0].apiKey = ''
    await chrome.storage.local.set({ [settingsKey]: JSON.stringify(settings) })
  }, { settingsKey: settingsStorageKey, endpoint })
}

/**
 * Request ids the payload carried. The instruction quotes the reply schema back
 * (`"id":"same-id"`), so only the ids shaped like a channel and a message count.
 */
function chatRequestIds(rawBody: string) {
  return [...rawBody.matchAll(/\\?"id\\?":\s*\\?"([^"\\]+)\\?"/g)]
    .map(match => match[1]!)
    .filter(id => /^\d+:\d+$/.test(id))
}

/** Chat translation is addressed by id, so the reply has to quote the ids the request carried. */
function answerChatTranslations(rawBody: string) {
  return JSON.stringify({
    items: chatRequestIds(rawBody).map(id => ({ id, translation: `译文-${id}` })),
  })
}

/** A livestream appends into the channel after the page settled; this does the same to the DOM. */
async function appendChatMessage(page: Page, message: ChatMessageFixture) {
  await page.evaluate(({ id, text }) => {
    const channel = document.querySelector('.chat-channel')
    if (!channel)
      throw new Error('the chat channel is not mounted')

    const container = document.createElement('div')
    container.className = 'chat-message-container'
    container.setAttribute('data-id', id)

    const body = document.createElement('div')
    body.className = 'chat-message-text'
    body.textContent = text

    container.append(body)
    channel.append(container)
  }, { id: message.id, text: message.text })
}

function translationIdOf(messageId: string) {
  return `${channelId}:${messageId}`
}

function readMessage(page: Page, messageId: string): Promise<ChatMessageRender | undefined> {
  return page.evaluate((id) => {
    const body = document.querySelector(`.chat-message-container[data-id="${id}"] .chat-message-text`)
    if (!(body instanceof HTMLElement))
      return undefined

    const next = body.nextElementSibling
    const translation = next instanceof HTMLElement && next.hasAttribute('data-lexi-chat-translation')
      ? next
      : null

    return {
      bodyHtml: body.outerHTML,
      bodyText: body.textContent ?? '',
      translationId: translation?.getAttribute('data-lexi-chat-translation-id') ?? null,
      translationText: translation?.textContent ?? null,
      translationIsSibling: Boolean(translation),
    }
  }, messageId)
}

/** The translation the adapter mounted for one message, as the reader would read it. */
function translationText(page: Page, messageId: string) {
  return page.evaluate((id) => {
    return document.querySelector(`[data-lexi-chat-translation-id="${id}"]`)?.textContent ?? null
  }, translationIdOf(messageId))
}

test('a livestream message that arrives after the page settled is translated like one already there', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWithResolver(answerChatTranslations)
  await seedChatTranslation(page, extensionId, endpoint)
  await routeChatChannel(context, [{ id: welcomeId, text: welcomeMessage }])

  const contentPage = await context.newPage()
  await contentPage.goto(chatUrl)

  // Read before the adapter can have answered, so a rewrite of the message body — instead of
  // a sibling translation — would show up as a difference below.
  const bodyBefore = await contentPage
    .locator(`.chat-message-container[data-id="${welcomeId}"] .chat-message-text`)
    .evaluate(node => node.outerHTML)
  expect(bodyBefore).toBe(`<div class="chat-message-text">${welcomeMessage}</div>`)

  await expect.poll(() => translationText(contentPage, welcomeId), { timeout: 15_000 })
    .toBe(`译文-${translationIdOf(welcomeId)}`)

  // The reader keeps the original message and gains a translation beside it — the message
  // body itself is byte-identical.
  expect(await readMessage(contentPage, welcomeId)).toEqual({
    bodyHtml: bodyBefore,
    bodyText: welcomeMessage,
    translationId: translationIdOf(welcomeId),
    translationText: `译文-${translationIdOf(welcomeId)}`,
    translationIsSibling: true,
  })

  // Now the livestream: a message appended into the channel after the page settled.
  await appendChatMessage(contentPage, { id: livestreamId, text: livestreamMessage })

  await expect.poll(() => translationText(contentPage, livestreamId), { timeout: 15_000 })
    .toBe(`译文-${translationIdOf(livestreamId)}`)

  expect(await readMessage(contentPage, livestreamId)).toEqual({
    bodyHtml: `<div class="chat-message-text">${livestreamMessage}</div>`,
    bodyText: livestreamMessage,
    translationId: translationIdOf(livestreamId),
    translationText: `译文-${translationIdOf(livestreamId)}`,
    translationIsSibling: true,
  })

  // The late message was really asked about — it is not a cache hit from the first pass.
  const sent = JSON.stringify(aiServer.requests.map(request => request.body))
  expect(sent).toContain(welcomeMessage)
  expect(sent).toContain(livestreamMessage)
})

test('messages that are already Chinese or already deleted are never sent for translation', async ({ context, page, extensionId, aiServer }) => {
  const endpoint = aiServer.endpoint('openai-chat')
  aiServer.answerWithResolver(answerChatTranslations)
  await seedChatTranslation(page, extensionId, endpoint)
  await routeChatChannel(context, [
    { id: welcomeId, text: welcomeMessage },
    { id: chineseId, text: chineseMessage },
    { id: deletedId, text: deletedMessage, className: 'chat-message-container -deleted' },
  ])

  const contentPage = await context.newPage()
  await contentPage.goto(chatUrl)

  // Control: the adapter is live on this page and does translate the message it should, so a
  // message missing from the requests below was refused rather than never considered.
  await expect.poll(() => translationText(contentPage, welcomeId), { timeout: 15_000 })
    .toBe(`译文-${translationIdOf(welcomeId)}`)

  // Attaching that translation is itself a mutation, so one more debounce cycle has by now
  // re-scanned every message on the page with the same incentive as the admitted one.
  await contentPage.waitForTimeout(700)

  const sent = JSON.stringify(aiServer.requests.map(request => request.body))
  expect(sent).toContain(translationIdOf(welcomeId))
  expect(sent).not.toContain(chineseMessage)
  expect(sent).not.toContain(translationIdOf(chineseId))
  expect(sent).not.toContain(deletedMessage)
  expect(sent).not.toContain(translationIdOf(deletedId))

  await expect(contentPage.locator(`.chat-message-container[data-id="${chineseId}"] [data-lexi-chat-translation]`))
    .toHaveCount(0)
  await expect(contentPage.locator(`.chat-message-container[data-id="${deletedId}"] [data-lexi-chat-translation]`))
    .toHaveCount(0)
})
