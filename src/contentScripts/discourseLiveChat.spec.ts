// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDiscourseLiveChat } from './discourseLiveChat'
import { mergeSettings } from '~/logic/defaults'
import type { LexiSettings } from '~/logic/types'

/**
 * The livestream adapter's contract is about cost and correctness at once: a message that
 * is off screen, still streaming, or already Chinese must not spend a request, and a
 * message that was translated must keep its translation — or get exactly one new one when
 * it is edited — without ever letting an outdated translation stand in for the new text.
 */

const english = 'The chat message explains how the cache keys survive later replies so nobody reuses an outdated digest result.'
const secondEnglish = 'Another visible message asks whether every channel keeps its own translation identity and cache.'
const editedEnglish = 'This message was edited after the translation landed, so the adapter has to translate it again.'
const chinese = '这篇文章说明了缓存策略的基本思路，并结合 Lexi 的设计解释为什么编辑后的消息必须重新翻译。'

const mocks = vi.hoisted(() => ({
  settings: undefined as LexiSettings | undefined,
  requestPageTranslationBatch: vi.fn(),
}))

vi.mock('~/logic/settingsCache', () => ({
  getStoredState: vi.fn(async () => ({ settings: mocks.settings, records: [] })),
}))

vi.mock('~/logic/aiClient', () => ({
  requestPageTranslationBatch: mocks.requestPageTranslationBatch,
}))

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: { local: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn() } },
    runtime: { sendMessage: vi.fn() },
  },
}))

vi.mock('webext-bridge/content-script', () => ({ sendMessage: vi.fn() }))

/** jsdom paints nothing, so scroll visibility is driven by the observer entry itself. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  private readonly observed = new Set<Element>()

  constructor(private readonly callback: (entries: Array<{ target: Element, isIntersecting: boolean }>) => void) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  disconnect() {
    this.observed.clear()
  }

  takeRecords() {
    return []
  }

  /** Fails loudly when the adapter never watched the message, so a silent skip cannot pass. */
  static intersect(target: Element, isIntersecting = true) {
    const watcher = FakeIntersectionObserver.instances.find(instance => instance.observed.has(target))
    if (!watcher)
      throw new Error('no IntersectionObserver is watching this chat message')

    watcher.callback([{ target, isIntersecting }])
  }

  /** For the negative cases: report visibility only if the adapter really watched it. */
  static intersectIfObserved(target: Element) {
    const watcher = FakeIntersectionObserver.instances.find(instance => instance.observed.has(target))
    watcher?.callback([{ target, isIntersecting: true }])
  }
}

function chatMessage(id: string, text: string, extraAttribute = '') {
  return `<div class="chat-message-container" data-id="${id}" ${extraAttribute}><div class="chat-message-text">${text}</div></div>`
}

function mountChat(messages: string, channelId = '42') {
  document.body.innerHTML = `<div id="custom-chat-container" data-chat-channel-id="${channelId}">${messages}</div>`
}

/**
 * Merged defaults with the one rule this adapter follows switched on. Patching a merged
 * object keeps every other auto-site key (github-readme, reddit) intact.
 */
function chatSettings(patch: (settings: LexiSettings) => void = () => {}) {
  const settings = mergeSettings()
  settings.selection.pageTranslation.autoSites.discourse = true
  patch(settings)
  return settings
}

function messageBody(id: string) {
  const body = document.querySelector<HTMLElement>(`.chat-message-container[data-id="${id}"] .chat-message-text`)
  if (!body)
    throw new Error(`chat message ${id} is not mounted`)

  return body
}

async function settleChatWork(milliseconds = 600) {
  for (let tick = 0; tick < 4; tick++)
    await Promise.resolve()

  await vi.advanceTimersByTimeAsync(milliseconds)

  for (let tick = 0; tick < 12; tick++)
    await Promise.resolve()

  await vi.advanceTimersByTimeAsync(50)

  for (let tick = 0; tick < 12; tick++)
    await Promise.resolve()
}

function requestItems() {
  return mocks.requestPageTranslationBatch.mock.calls.map(call => call[1])
}

describe('startDiscourseLiveChat', () => {
  let stop: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    FakeIntersectionObserver.instances = []
    sessionStorage.clear()
    document.body.innerHTML = ''
    mocks.settings = chatSettings()
    mocks.requestPageTranslationBatch.mockReset()
    mocks.requestPageTranslationBatch.mockImplementation(async (_settings: LexiSettings, items: Array<{ id: string, text: string }>) => (
      items.map(item => ({ id: item.id, translation: `译:${item.text}` }))
    ))
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
    document.body.innerHTML = ''
  })

  it('translates a visible English message through the shared batch and only adds a Lexi node', async () => {
    mountChat(chatMessage('1', english))
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)
    const [, items, , , direction] = mocks.requestPageTranslationBatch.mock.calls[0]!
    expect(items).toEqual([{ id: '42:1', text: english }])
    expect(direction).toBe('en-to-zh')

    const body = messageBody('1')
    const node = document.querySelector<HTMLElement>('[data-lexi-chat-translation]')
    expect(node?.textContent).toBe(`译:${english}`)
    expect(node?.className).toBe('lexi-chat-translation')
    expect(node?.dataset.lexiChatTranslationId).toBe('42:1')
    expect(node?.previousElementSibling).toBe(body)
    // The message itself is byte-identical: the translation is a sibling, not a rewrite.
    expect(body.outerHTML).toBe(`<div class="chat-message-text">${english}</div>`)
  })

  it('batches every message that becomes visible in the same window into one request', async () => {
    mountChat(chatMessage('1', english) + chatMessage('2', secondEnglish))
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    FakeIntersectionObserver.intersect(messageBody('2'))
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)
    expect(mocks.requestPageTranslationBatch.mock.calls[0]![1].map((item: { text: string }) => item.text))
      .toEqual([english, secondEnglish])
    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(2)
  })

  it.each([
    { name: 'a deleted message', html: chatMessage('1', english, 'data-deleted="true"') },
    { name: 'a message deleted inside its container', html: `<div class="chat-message-container" data-id="1"><span data-deleted-at="2"></span><div class="chat-message-text">${english}</div></div>` },
    { name: 'a hidden message', html: chatMessage('1', english, 'data-hidden="true"') },
    { name: 'a streaming message', html: chatMessage('1', english, 'data-streaming="true"') },
    { name: 'a staged message', html: chatMessage('1', english, 'data-staged="true"') },
    { name: 'a core Chat message carrying the -deleted state class', html: `<div class="chat-message-container -deleted" data-id="1"><div class="chat-message-text">${english}</div></div>` },
    { name: 'a core Chat message carrying the -hidden state class', html: `<div class="chat-message-container -hidden" data-id="1"><div class="chat-message-text">${english}</div></div>` },
    { name: 'a core Chat message carrying the -streaming state class', html: `<div class="chat-message-container -streaming" data-id="1"><div class="chat-message-text">${english}</div></div>` },
    { name: 'a core Chat message carrying the -staged state class', html: `<div class="chat-message-container -staged" data-id="1"><div class="chat-message-text">${english}</div></div>` },
    { name: 'a message that has no persisted id yet', html: chatMessage('draft-7', english) },
    { name: 'a message carrying the zero placeholder id', html: chatMessage('0', english) },
  ])('never requests $name', async ({ html }) => {
    mountChat(html)
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersectIfObserved(document.querySelector<HTMLElement>('.chat-message-text')!)
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
  })

  it('skips a visible message that is already Chinese', async () => {
    mountChat(chatMessage('1', chinese))
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersectIfObserved(document.querySelector<HTMLElement>('.chat-message-text')!)
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
  })

  it.each([
    {
      name: 'the message is removed before the debounce elapses',
      leaveViewport: false,
    },
    {
      name: 'the observer reports it left the viewport',
      leaveViewport: true,
    },
  ])('does not request a message when $name', async ({ leaveViewport }) => {
    mountChat(chatMessage('1', english))
    stop = startDiscourseLiveChat()
    await settleChatWork()

    const body = messageBody('1')
    FakeIntersectionObserver.intersect(body)
    await vi.advanceTimersByTimeAsync(100)

    if (leaveViewport)
      FakeIntersectionObserver.intersect(body, false)
    else
      body.closest('.chat-message-container')!.remove()

    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
  })

  it('leaves messages that never became visible alone', async () => {
    mountChat(chatMessage('1', english) + chatMessage('2', secondEnglish))
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()

    expect(requestItems()).toEqual([[{ id: '42:1', text: english }]])
    expect(document.querySelector('.chat-message-container[data-id="2"] [data-lexi-chat-translation]')).toBeNull()
  })

  it('re-attaches the cached translation after Discourse replaces the message node', async () => {
    mountChat(chatMessage('1', english), '49')
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)

    const replacement = document.createElement('div')
    replacement.innerHTML = chatMessage('1', english)
    document.querySelector('.chat-message-container[data-id="1"]')!.replaceWith(replacement.firstElementChild!)

    await settleChatWork()
    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)
    const nodes = document.querySelectorAll<HTMLElement>('[data-lexi-chat-translation]')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.textContent).toBe(`译:${english}`)
    expect(nodes[0]!.previousElementSibling).toBe(messageBody('1'))
  })

  it('translates an edited message once and drops the outdated translation', async () => {
    mountChat(chatMessage('1', english), '50')
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    expect(document.querySelector('[data-lexi-chat-translation]')?.textContent).toBe(`译:${english}`)

    messageBody('1').textContent = editedEnglish
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(2)
    expect(requestItems()[1]).toEqual([{ id: '50:1', text: editedEnglish }])
    const nodes = document.querySelectorAll<HTMLElement>('[data-lexi-chat-translation]')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.textContent).toBe(`译:${editedEnglish}`)
    expect(nodes[0]!.textContent).not.toContain(english)
  })

  it('never mounts the superseded translation when a visible message is edited mid-flight', async () => {
    mountChat(chatMessage('1', english), '54')
    const releases: Array<() => void> = []
    mocks.requestPageTranslationBatch.mockImplementation((_settings: LexiSettings, items: Array<{ id: string, text: string }>) => {
      const { promise, resolve } = Promise.withResolvers<Array<{ id: string, translation: string }>>()
      releases.push(() => resolve(items.map(item => ({ id: item.id, translation: `译:${item.text}` }))))
      return promise
    })

    stop = startDiscourseLiveChat()
    await settleChatWork()
    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    expect(releases).toHaveLength(1)

    messageBody('1').textContent = editedEnglish
    await settleChatWork()

    // The first revision answers only now, after the text it described is gone.
    releases[0]!()
    await settleChatWork()

    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
    expect(requestItems()[1]).toEqual([{ id: '54:1', text: editedEnglish }])

    releases[1]!()
    await settleChatWork()

    const nodes = document.querySelectorAll<HTMLElement>('[data-lexi-chat-translation]')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.textContent).toBe(`译:${editedEnglish}`)
  })

  it('does not cool down a newly edited revision when the previous revision failed', async () => {
    mountChat(chatMessage('1', english), '55')
    mocks.requestPageTranslationBatch.mockRejectedValueOnce(new Error('provider unreachable'))

    stop = startDiscourseLiveChat()
    await settleChatWork()
    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()

    messageBody('1').textContent = editedEnglish
    await settleChatWork()

    expect(requestItems()[1]).toEqual([{ id: '55:1', text: editedEnglish }])
    expect(document.querySelector('[data-lexi-chat-translation]')?.textContent).toBe(`译:${editedEnglish}`)
  })

  it('does not duplicate a translation when visibility is reported again and the page churns', async () => {
    mountChat(chatMessage('1', english), '51')
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    document.body.appendChild(document.createElement('span'))
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(1)
  })

  it('removes only its own nodes when it is disposed', async () => {
    mountChat(chatMessage('1', english), '52')
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(1)

    stop()
    stop = undefined

    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(0)
    expect(messageBody('1').outerHTML).toBe(`<div class="chat-message-text">${english}</div>`)
  })

  it('removes its nodes when the reader turns the Discourse page translation off', async () => {
    mountChat(chatMessage('1', english), '53')
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersect(messageBody('1'))
    await settleChatWork()
    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(1)

    mocks.settings = mergeSettings()
    document.body.appendChild(document.createElement('span'))
    await settleChatWork()

    expect(document.querySelectorAll('[data-lexi-chat-translation]')).toHaveLength(0)
    expect(messageBody('1').textContent).toBe(english)
  })

  it.each([
    { name: 'the Discourse page translation setting is off', settings: mergeSettings() },
    {
      name: 'the selection scene is disabled',
      settings: chatSettings((settings) => { settings.selection.enabled = false }),
    },
    {
      name: 'the requested direction is not English to Chinese',
      settings: chatSettings((settings) => { settings.selection.pageTranslation.direction = 'zh-to-en' }),
    },
  ])('does not touch the chat when $name', async ({ settings }) => {
    mountChat(chatMessage('1', english))
    mocks.settings = settings
    stop = startDiscourseLiveChat()
    await settleChatWork()

    FakeIntersectionObserver.intersectIfObserved(document.querySelector<HTMLElement>('.chat-message-text')!)
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
  })

  it('does not touch a Discourse page that has no chat root', async () => {
    document.body.innerHTML = chatMessage('1', english)
    stop = startDiscourseLiveChat()
    await settleChatWork()

    expect(mocks.requestPageTranslationBatch).not.toHaveBeenCalled()
    expect(document.querySelector('[data-lexi-chat-translation]')).toBeNull()
  })
})
