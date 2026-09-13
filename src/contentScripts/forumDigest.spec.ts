// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectForumInfo, startForumDigest } from './forumDigest'
import { mergeSettings } from '~/logic/defaults'
import { forumDigestStorageKey, settingsStorageKey } from '~/logic/storageKeys'
import type { ForumDigestCache, ForumDigestResult, LexiSettings } from '~/logic/types'

/**
 * The digest identity and the card's refresh behaviour are what a reader sees: an identity
 * that ignores later replies, or a refresh that blanks the card, are both silent until the
 * reader notices the summary no longer matches the thread.
 */

const mocks = vi.hoisted(() => ({
  settings: undefined as LexiSettings | undefined,
  digestCache: {} as ForumDigestCache,
  requestForumDigest: vi.fn(),
  sendMessage: vi.fn(),
}))

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => key === settingsStorageKey
          ? { [settingsStorageKey]: JSON.stringify(mocks.settings) }
          : { [forumDigestStorageKey]: JSON.stringify(mocks.digestCache) }),
      },
      onChanged: { addListener: vi.fn() },
    },
  },
}))

vi.mock('webext-bridge/content-script', () => ({ sendMessage: mocks.sendMessage }))

vi.mock('~/logic/aiClient', () => ({ requestForumDigest: mocks.requestForumDigest }))

/** A Discourse topic whose reply count and reply ids are the only things a test changes. */
function mountTopic(count: number, startId = 100) {
  document.body.innerHTML = `
    <div id="topic-title"><h1>How cache keys survive later replies</h1></div>
    <div class="post-stream">
      ${Array.from({ length: count }, (_, index) => `
        <article class="topic-post" data-post-id="${startId + index}">
          <div class="cooked">Reply number ${index + 1} explains how the cache keys are derived from loaded content, so a later reply can never reuse an outdated digest result.</div>
        </article>
      `).join('')}
    </div>
  `
}

function replyMarkup(id: number, index: number) {
  return `
    <article class="topic-post" data-post-id="${id}">
      <div class="cooked">Reply number ${index} explains how the cache keys are derived from loaded content, so a later reply can never reuse an outdated digest result.</div>
    </article>
  `
}

function readForumInfo() {
  const info = collectForumInfo()
  if (!info)
    throw new Error('collectForumInfo returned nothing for the mounted Discourse topic')

  return info
}

/** Microtasks -> mutation debounce -> async refresh chain, without depending on real time. */
async function settleDigestWork() {
  for (let tick = 0; tick < 4; tick++)
    await Promise.resolve()

  await vi.advanceTimersByTimeAsync(1400)

  for (let tick = 0; tick < 12; tick++)
    await Promise.resolve()

  await vi.advanceTimersByTimeAsync(50)
}

async function settleUntil(condition: () => boolean, milliseconds = 4000) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    if (condition())
      return
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()
  }
}

describe('forum digest source identity', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('changes when a ninth reply loads, while the digest payload stays bounded to eight posts', () => {
    mountTopic(8)
    const before = readForumInfo()

    document.querySelector('.post-stream')!.insertAdjacentHTML('beforeend', replyMarkup(200, 9))
    const after = readForumInfo()

    expect(before.posts).toHaveLength(8)
    expect(after.posts).toHaveLength(8)
    expect(after.posts).toEqual(before.posts)
    expect(after.sourceHash).not.toBe(before.sourceHash)
  })

  it.each([
    ['the first loaded post is replaced by a different id', 100, 900],
    ['the last loaded post is replaced by a different id', 107, 907],
  ])('changes when %s even though the digest payload is unchanged', (_name, from, to) => {
    mountTopic(8)
    const before = readForumInfo()

    document.querySelector(`[data-post-id="${from}"]`)!.setAttribute('data-post-id', String(to))
    const after = readForumInfo()

    expect(after.posts).toEqual(before.posts)
    expect(after.sourceHash).not.toBe(before.sourceHash)
  })

  it('changes when an already loaded reply is edited', () => {
    mountTopic(8)
    const before = readForumInfo()

    document.querySelector<HTMLElement>('[data-post-id="103"] .cooked')!.textContent
      = 'This reply was edited after the first summary was generated, which changes the loaded content identity of the topic.'
    const after = readForumInfo()

    expect(after.posts).not.toEqual(before.posts)
    expect(after.sourceHash).not.toBe(before.sourceHash)
  })

  it('changes when the loaded waterline grows past the scan bound, while the payload stays bounded', () => {
    mountTopic(12)
    const before = readForumInfo()

    document.querySelector('.post-stream')!.insertAdjacentHTML('beforeend', replyMarkup(200, 13))
    const after = readForumInfo()

    expect(before.posts).toHaveLength(8)
    expect(after.posts).toHaveLength(8)
    expect(after.posts).toEqual(before.posts)
    expect(after.sourceHash).not.toBe(before.sourceHash)
  })

  it('changes when a distinct reply repeats the text of an already loaded reply', () => {
    mountTopic(8)
    const before = readForumInfo()

    // Same words, different post: the thread gained a reply, so the summary on screen no
    // longer describes everything the reader can see — even though the new reply was not
    // summarized and reads exactly like an earlier one.
    document.querySelector('.post-stream')!.insertAdjacentHTML('beforeend', replyMarkup(200, 3))
    const after = readForumInfo()

    expect(after.posts).toHaveLength(8)
    expect(after.sourceHash).not.toBe(before.sourceHash)
  })
})

describe('forum digest refresh after later replies', () => {
  const previousDigest: ForumDigestResult = {
    oneLine: '上一版速读：缓存键由已加载内容派生。',
    summary: ['早先的摘要内容。'],
    keyPoints: [],
    terms: [],
  }

  let stop: (() => void) | undefined

  function mountCard() {
    return document.querySelector<HTMLElement>('[data-lexi-forum-digest="true"]')!
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.requestForumDigest.mockReset()
    mocks.requestForumDigest.mockResolvedValue(previousDigest)
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue({ ok: true })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the previous digest and history visible with a stale label when the loaded posts change', async () => {
    mountTopic(8)
    // Auto generation stays off so the summary the reader already has is what the change
    // is judged against, rather than a fresh request racing the assertion.
    mocks.settings = mergeSettings({
      forumDigest: { enabled: true, autoGenerate: false, autoDelaySeconds: 0, cacheDays: 7 },
    })

    stop = startForumDigest()
    await settleUntil(() => document.querySelector('[data-lexi-forum-digest="true"]') !== null)

    // Nothing cached for this topic yet: the reader asks for the first summary.
    mountCard().querySelector<HTMLElement>('[data-lexi-forum-action="generate"]')!.click()
    await settleUntil(() => mountCard().textContent?.includes(previousDigest.oneLine) === true)
    await settleDigestWork()

    expect(mountCard().textContent).toContain(previousDigest.oneLine)
    expect(mountCard().querySelectorAll('[data-lexi-forum-history-index]').length).toBeGreaterThan(0)
    expect(mountCard().querySelector('.lexi-forum-digest__status--stale')).toBeNull()
    expect(mountCard().dataset.lexiForumStale).toBe('false')

    document.querySelector('.post-stream')!.insertAdjacentHTML('beforeend', replyMarkup(200, 9))
    await settleDigestWork()

    // The ninth reply is a new identity: the old digest and its history stay readable...
    expect(mountCard().textContent).toContain(previousDigest.oneLine)
    expect(mountCard().textContent).not.toContain('尚未生成速读')
    expect(mountCard().querySelectorAll('[data-lexi-forum-history-index]').length).toBeGreaterThan(0)
    // ...and the card says so instead of pretending the summary still matches the thread.
    expect(mountCard().querySelector('.lexi-forum-digest__status--stale')?.textContent).toBe('有更新')
    expect(mountCard().dataset.lexiForumStale).toBe('true')
  })
})
