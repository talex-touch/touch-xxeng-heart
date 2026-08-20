import { describe, expect, it } from 'vitest'
import type { VocabularyCandidate } from './types'
import { getReplacementDisplayText } from './replacementDisplay'

const candidate: VocabularyCandidate = {
  original: '缓存策略',
  replacement: 'cache strategy',
  meaning: '决定数据暂存与失效的规则。',
  example: 'Use a cache strategy for repeated lookups.',
  tags: ['web'],
  difficulty: 4,
}

describe('replacement display text', () => {
  it.each([
    { name: 'English', displayMode: 'english' as const, expected: 'cache strategy' },
    { name: 'Chinese', displayMode: 'chinese' as const, expected: '缓存策略' },
    { name: 'bilingual', displayMode: 'bilingual' as const, expected: 'cache strategy（缓存策略）' },
  ])('renders $name replacement text', ({ displayMode, expected }) => {
    expect(getReplacementDisplayText(candidate, displayMode)).toBe(expected)
  })
})
