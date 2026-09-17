import { describe, expect, it } from 'vitest'
import { segmentSentences, splitSentences } from './sentenceSegmentation'

describe('sentenceSegmentation', () => {
  it('returns empty array for empty or whitespace text', () => {
    expect(segmentSentences('')).toEqual([])
    expect(segmentSentences('   \n\t  ')).toEqual([])
    expect(splitSentences('')).toEqual([])
  })

  it('handles a single sentence without trailing punctuation', () => {
    const text = 'This is a single line without period'
    const segments = segmentSentences(text)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      text,
      start: 0,
      end: text.length,
    })
    expect(splitSentences(text)).toEqual([text])
  })

  it('splits standard English sentences on periods, exclamations, and questions', () => {
    const text = 'First sentence. Second sentence! Third sentence?'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'First sentence.',
      'Second sentence!',
      'Third sentence?',
    ])

    const segments = segmentSentences(text)
    for (const seg of segments)
      expect(text.slice(seg.start, seg.end)).toBe(seg.text)
  })

  it('respects abbreviations and does not split them prematurely', () => {
    const text = 'Dr. Watson met Mr. Holmes. They discussed e.g. the case vs. the suspect at 3.14 pm. It ended well.'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'Dr. Watson met Mr. Holmes.',
      'They discussed e.g. the case vs. the suspect at 3.14 pm.',
      'It ended well.',
    ])
  })

  it('does not split on domain names or decimals', () => {
    const text = 'Check out github.com for release v1.0.4. It is fast!'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'Check out github.com for release v1.0.4.',
      'It is fast!',
    ])
  })

  it('preserves quotes and brackets around sentence terminators', () => {
    const text = 'He asked, "Are you ready?" She whispered, "Yes!" Then they started.'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'He asked, "Are you ready?"',
      'She whispered, "Yes!"',
      'Then they started.',
    ])
  })

  it('splits CJK sentences on full-width punctuation', () => {
    const text = '这是第一句话。这是第二句话！这是第三句话？还有第四句；结束了。'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      '这是第一句话。',
      '这是第二句话！',
      '这是第三句话？',
      '还有第四句；',
      '结束了。',
    ])
  })

  it('preserves CJK quotes and brackets around sentence terminators', () => {
    const text = '他说：“太棒了！”接着问：“你觉得呢？”大家都点头。'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      '他说：“太棒了！”',
      '接着问：“你觉得呢？”',
      '大家都点头。',
    ])
  })

  it('handles mixed English and Chinese sentences', () => {
    const text = 'Lexi 是一个浏览器扩展。It helps programmers learn English! 试试看吧。'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'Lexi 是一个浏览器扩展。',
      'It helps programmers learn English!',
      '试试看吧。',
    ])
  })

  it('handles double newlines as paragraph boundaries', () => {
    const text = 'Paragraph one\n\nParagraph two'
    const sentences = splitSentences(text)
    expect(sentences).toEqual([
      'Paragraph one',
      'Paragraph two',
    ])
  })
})
