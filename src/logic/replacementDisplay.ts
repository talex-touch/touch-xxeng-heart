import type { ReplacementDisplayMode, VocabularyCandidate } from './types'

export function getReplacementDisplayText(
  candidate: Pick<VocabularyCandidate, 'original' | 'replacement'>,
  displayMode: ReplacementDisplayMode,
) {
  if (displayMode === 'chinese')
    return candidate.original
  if (displayMode === 'bilingual')
    return `${candidate.replacement}（${candidate.original}）`

  return candidate.replacement
}
