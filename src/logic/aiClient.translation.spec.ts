import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPageTranslationBatch, requestSelectionTranslation } from './aiClient'
import { mergeSettings } from './defaults'

/**
 * Translation callers must describe their work as typed translation, not as an anonymous
 * prompt: only the descriptor lets a Nexus provider answer with `text.translate` instead of
 * charging the batch as `text.chat`. The prompt messages stay attached, because a provider
 * that cannot honour the descriptor still has to answer the old way.
 */

const mocks = vi.hoisted(() => ({ runAiScene: vi.fn() }))

vi.mock('./aiTransport', () => ({
  runAiScene: mocks.runAiScene,
  testAiConnection: vi.fn(),
  requestProviderModels: vi.fn(),
}))

function answerWith(text: string) {
  mocks.runAiScene.mockResolvedValue({ text, streamed: false })
}

describe('selection translation caller', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('attaches a single-text translation descriptor and reads plain text back', async () => {
    const settings = mergeSettings()
    answerWith('乐观更新')

    const result = await requestSelectionTranslation(settings, 'optimistic update', 'context')

    const request = mocks.runAiScene.mock.calls[0][0]
    expect(request).toMatchObject({
      scene: 'selection',
      translation: true,
      directTranslation: {
        items: [{ id: 'selection', text: 'optimistic update' }],
        direction: settings.selection.translationDirection,
        output: 'text',
      },
    })
    // The prompt path stays intact for providers that cannot translate directly.
    expect(JSON.stringify(request.messages)).toContain('<selected>optimistic update</selected>')
    expect(result).toMatchObject({ original: 'optimistic update', translation: '乐观更新', source: 'ai' })
  })

  it('refuses an empty selection answer instead of showing a blank translation', async () => {
    const settings = mergeSettings()
    answerWith('')

    await expect(requestSelectionTranslation(settings, 'hello', 'context')).rejects.toThrow(/AI response text is empty/)
  })
})

describe('page translation batch caller', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('attaches an items-json descriptor and rebuilds the item array', async () => {
    const settings = mergeSettings()
    answerWith(JSON.stringify({ items: [{ id: 'a', translation: '你好' }, { id: 'b', translation: ' 世界 ' }] }))

    const result = await requestPageTranslationBatch(
      settings,
      [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
      'context',
    )

    const request = mocks.runAiScene.mock.calls[0][0]
    expect(request).toMatchObject({
      scene: 'selection',
      translation: true,
      directTranslation: {
        items: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
        direction: settings.selection.pageTranslation.direction,
        output: 'items-json',
      },
    })
    expect(JSON.parse(String(request.messages[0].content))).toMatchObject({
      scene: 'selection',
      items: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }],
      context: 'context',
    })
    expect(result).toEqual([{ id: 'a', translation: '你好' }, { id: 'b', translation: '世界' }])
  })

  it('keeps tolerating the legacy reply shape and drops incomplete rows', async () => {
    const settings = mergeSettings()
    answerWith(JSON.stringify({
      items: [
        { id: 'a', translation: '你好', extra: 'ignored' },
        { id: 'b' },
        { translation: 'orphan' },
      ],
      note: 'legacy',
    }))

    const result = await requestPageTranslationBatch(settings, [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }], 'context')

    expect(result).toEqual([{ id: 'a', translation: '你好' }])
  })

  it('returns no items when the reply carries no items array', async () => {
    const settings = mergeSettings()
    answerWith(JSON.stringify({ note: 'legacy reply without items' }))

    expect(await requestPageTranslationBatch(settings, [{ id: 'a', text: 'hello' }], 'context')).toEqual([])
  })

  it('does not call anybody when there is nothing to translate', async () => {
    const settings = mergeSettings()

    expect(await requestPageTranslationBatch(settings, [], 'context')).toEqual([])
    expect(mocks.runAiScene).not.toHaveBeenCalled()
  })
  it('aligns multi-sentence translations when sentences array is provided or splits 1:1', async () => {
    const settings = mergeSettings()
    answerWith(JSON.stringify({
      items: [
        {
          id: 'multi-explicit',
          translation: '第一句。第二句。',
          sentences: ['第一句。', '第二句。'],
        },
        {
          id: 'multi-inferred',
          translation: '第三句。第四句！',
        },
        {
          id: 'mismatched',
          translation: '单句合并翻译',
        },
      ],
    }))

    const result = await requestPageTranslationBatch(settings, [
      { id: 'multi-explicit', text: 'Sentence one. Sentence two.' },
      { id: 'multi-inferred', text: 'Sentence three. Sentence four!' },
      { id: 'mismatched', text: 'Sentence five. Sentence six.' },
    ], 'context')

    expect(result).toEqual([
      {
        id: 'multi-explicit',
        translation: '第一句。第二句。',
        sentences: ['第一句。', '第二句。'],
      },
      {
        id: 'multi-inferred',
        translation: '第三句。第四句！',
        sentences: ['第三句。', '第四句！'],
      },
      {
        id: 'mismatched',
        translation: '单句合并翻译',
        sentences: undefined,
      },
    ])
  })
})
