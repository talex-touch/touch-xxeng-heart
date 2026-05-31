import { describe, expect, it } from 'vitest'
import { canAutoReplaceCandidate, createCandidateFromTerm, createManualCandidate, createTechnicalCandidate, isLowValueShortChineseCandidate, shouldRecordSelectionCandidate } from './selectionVocabulary'
import type { SelectionTranslation, VocabularyCandidate } from './types'

function candidate(value: Partial<VocabularyCandidate>): VocabularyCandidate {
  return {
    original: '上下文',
    replacement: 'context',
    meaning: '背景信息。',
    example: 'The model needs enough context.',
    tags: ['technical'],
    difficulty: 2,
    ...value,
  }
}

function translation(value: Partial<SelectionTranslation>): SelectionTranslation {
  return {
    original: 'context',
    translation: '上下文',
    explanation: '由 AI 生成。',
    source: 'ai',
    ...value,
  }
}

describe('selection vocabulary filters', () => {
  it('rejects short low-value Chinese selection candidates', () => {
    const item = candidate({ original: '上下文', replacement: 'context' })

    expect(canAutoReplaceCandidate(item)).toBe(true)
    expect(isLowValueShortChineseCandidate(item)).toBe(true)
    expect(shouldRecordSelectionCandidate(item, '上下文')).toBe(false)
    expect(createManualCandidate(translation({
      original: '上下文',
      translation: 'context',
    }))).toBeUndefined()
  })

  it('keeps longer Chinese technical terms with concise English replacement', () => {
    const item = candidate({ original: '上下文工程', replacement: 'context engineering' })

    expect(isLowValueShortChineseCandidate(item)).toBe(false)
    expect(shouldRecordSelectionCandidate(item, '上下文工程')).toBe(true)
    expect(createManualCandidate(translation({
      original: '上下文工程',
      translation: 'context engineering',
    }))).toMatchObject({ original: '上下文工程' })
  })

  it('rejects plain English words but keeps technical shaped English terms', () => {
    expect(createTechnicalCandidate(translation({
      original: 'context',
      translation: '上下文',
    }), '')).toBeUndefined()

    expect(createTechnicalCandidate(translation({
      original: 'optimistic update',
      translation: '乐观更新',
    }), '')).toMatchObject({ original: 'optimistic update' })
    expect(createTechnicalCandidate(translation({
      original: 'OAuth2',
      translation: 'OAuth2',
    }), '')).toMatchObject({ original: 'OAuth2' })
  })

  it('records only useful terms returned from detail response', () => {
    const base = translation({
      original: 'The UI applies an optimistic update.',
      translation: '界面会应用乐观更新。',
    })

    expect(createCandidateFromTerm(base, {
      term: 'UI',
      explanation: '用户界面。',
    })).toMatchObject({ original: 'UI' })
    expect(createCandidateFromTerm(base, {
      term: 'the',
      explanation: '冠词。',
    })).toBeUndefined()
    expect(createCandidateFromTerm(base, {
      term: 'optimistic update',
      explanation: '先展示成功状态。',
    })).toMatchObject({ original: 'optimistic update' })
  })
})
