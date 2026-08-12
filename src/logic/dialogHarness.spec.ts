import { describe, expect, it } from 'vitest'
import { buildDialogMessages } from './dialogHarness'
import { rankSegments, selectSegments, tokenizeForSearch } from './contextRetrieval'
import { clampToTokens, createTokenBudget, estimateTokens } from './tokenBudget'
import type { PageDocument, PageSegment } from './contextRetrieval'

function createSegment(id: string, text: string, overrides: Partial<PageSegment> = {}): PageSegment {
  return {
    id,
    heading: '',
    text,
    kind: 'paragraph',
    order: Number(id.replace(/\D/g, '')) || 0,
    ...overrides,
  }
}

function createPage(segments: PageSegment[]): PageDocument {
  return {
    title: '测试文档',
    url: 'https://example.com/doc',
    segments,
    outline: ['安装', '安装 › 快速开始'],
    charCount: segments.reduce((sum, segment) => sum + segment.text.length, 0),
  }
}

const samplePage = createPage([
  createSegment('s0', '安装', { kind: 'heading' }),
  createSegment('s1', '使用 pnpm install 安装依赖，然后运行 pnpm dev 启动开发服务器。', { heading: '安装' }),
  createSegment('s2', '本项目的许可证是 MIT，允许商业使用和二次分发。', { heading: '许可证' }),
  createSegment('s3', '常见问题：端口被占用时可以通过 PORT 环境变量修改监听端口。', { heading: '常见问题' }),
])

describe('tokenBudget', () => {
  it('charges CJK more than latin per character', () => {
    expect(estimateTokens('中文中文中文中文')).toBeGreaterThan(estimateTokens('abcdefgh'))
  })

  it('clamps to the allowance and appends an ellipsis', () => {
    const clamped = clampToTokens('一二三四五六七八九十'.repeat(20), 12)
    expect(clamped.endsWith('…')).toBe(true)
    expect(estimateTokens(clamped)).toBeLessThanOrEqual(13)
  })

  it('never overspends across takes', () => {
    const budget = createTokenBudget(30)
    budget.take('中文'.repeat(100))
    budget.take('more text that will not fit'.repeat(20))
    expect(budget.spent).toBeLessThanOrEqual(30)
    expect(budget.remaining).toBe(0)
  })
})

describe('contextRetrieval', () => {
  it('tokenizes latin words and CJK bigrams', () => {
    const terms = tokenizeForSearch('安装 pnpm')
    expect(terms).toContain('pnpm')
    expect(terms).toContain('安装')
  })

  it('ranks the segment that answers the question highest', () => {
    const ranked = rankSegments('怎么修改端口', samplePage.segments)
      .sort((left, right) => right.score - left.score)
    expect(ranked[0].segment.id).toBe('s3')
  })

  it('beats the old "first N characters" heuristic', () => {
    // s1 is the first body segment; a leading-slice strategy would always return it.
    const ranked = rankSegments('许可证是什么', samplePage.segments)
      .sort((left, right) => right.score - left.score)
    expect(ranked[0].segment.id).toBe('s2')
  })

  it('skips segments already delivered in earlier turns', () => {
    const ranked = rankSegments('怎么修改端口', samplePage.segments)
    const result = selectSegments(ranked, { maxTokens: 500, deliveredIds: ['s3'] })
    expect(result.segments.map(segment => segment.id)).not.toContain('s3')
  })

  it('restores document order after picking by score', () => {
    const ranked = rankSegments('安装 端口 许可证', samplePage.segments)
    const result = selectSegments(ranked, { maxTokens: 500 })
    const orders = result.segments.map(segment => segment.order)
    expect(orders).toEqual([...orders].sort((left, right) => left - right))
  })

  it('reports segments dropped because the budget ran out', () => {
    const ranked = rankSegments('安装 端口 许可证', samplePage.segments)
    const result = selectSegments(ranked, { maxTokens: 12 })
    expect(result.usedTokens).toBeLessThanOrEqual(12)
    expect(result.droppedForBudget).toBeGreaterThan(0)
  })
})

describe('buildDialogMessages', () => {
  it('emits a real multi-turn message array instead of one flattened blob', () => {
    const result = buildDialogMessages({
      question: '端口怎么改',
      page: samplePage,
      history: [
        { role: 'user', content: '这个项目怎么装' },
        { role: 'assistant', content: '用 pnpm install。' },
      ],
    })

    expect(result.messages[0].role).toBe('system')
    expect(result.messages.filter(message => message.role === 'assistant').length).toBeGreaterThan(1)
    expect(result.messages.at(-1)?.role).toBe('user')
    expect(result.messages.at(-1)?.content).toContain('问题：端口怎么改')
  })

  it('sends the page outline once as a stable, cacheable prefix', () => {
    const first = buildDialogMessages({ question: '端口怎么改', page: samplePage })
    const second = buildDialogMessages({
      question: '许可证呢',
      page: samplePage,
      history: [
        { role: 'user', content: '端口怎么改', segmentIds: first.attachedSegmentIds },
        { role: 'assistant', content: '用 PORT 环境变量。' },
      ],
    })

    expect(second.messages[1].content).toBe(first.messages[1].content)
  })

  it('attaches only retrieved excerpts, never the whole page', () => {
    const result = buildDialogMessages({ question: '端口怎么改', page: samplePage })
    const lastMessage = String(result.messages.at(-1)?.content)
    expect(lastMessage).toContain('常见问题')
    expect(lastMessage).not.toContain('MIT')
  })

  it('does not resend excerpts already delivered in retained history', () => {
    const first = buildDialogMessages({ question: '端口怎么改', page: samplePage })
    expect(first.attachedSegmentIds).toContain('s3')

    const second = buildDialogMessages({
      question: '端口怎么改',
      page: samplePage,
      history: [
        { role: 'user', content: '端口怎么改', segmentIds: first.attachedSegmentIds },
        { role: 'assistant', content: '用 PORT 环境变量。' },
      ],
    })

    expect(second.attachedSegmentIds).not.toContain('s3')
  })

  it('resends an excerpt once the turn carrying it is trimmed out of history', () => {
    const history = Array.from({ length: 40 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这是一段很长的历史对话内容，用来把预算撑满。'.repeat(6),
      segmentIds: index === 0 ? ['s3'] : undefined,
    }))

    const result = buildDialogMessages({ question: '端口怎么改', page: samplePage, history })
    const historyStage = result.trace.find(stage => stage.name === 'history')
    expect(historyStage?.note).toContain('裁掉')
    expect(result.attachedSegmentIds).toContain('s3')
  })

  it('keeps the transcript from starting on an assistant turn', () => {
    const result = buildDialogMessages({
      question: '端口怎么改',
      page: samplePage,
      history: [{ role: 'assistant', content: '你好' }],
      budget: { history: 2000 },
    })

    const afterPrefix = result.messages.slice(3)
    expect(afterPrefix[0]?.role).not.toBe('assistant')
  })

  it('stays inside the total token budget', () => {
    const hugePage = createPage(
      Array.from({ length: 120 }, (_, index) =>
        createSegment(`s${index}`, `端口配置说明第 ${index} 段。${'内容'.repeat(200)}`)),
    )

    const result = buildDialogMessages({
      question: '端口怎么改',
      page: hugePage,
      selection: { text: '端口'.repeat(2000) },
      history: Array.from({ length: 30 }, () => ({ role: 'user' as const, content: '历史'.repeat(500) })),
      budget: { total: 1500 },
    })

    expect(result.totalTokens).toBeLessThanOrEqual(1500)
  })

  it('works with no page context at all', () => {
    const result = buildDialogMessages({ question: '你好' })
    expect(result.messages).toHaveLength(2)
    expect(result.attachedSegmentIds).toEqual([])
    expect(result.trace.find(stage => stage.name === 'retrieve')?.note).toBe('无页面上下文')
  })
})

/**
 * A whole-page question shares no vocabulary with the page, so relevance ranking scores
 * every segment zero. Without coverage the prompt degrades to an outline and the model
 * answers, correctly, that it was never given any body text.
 */
describe('whole-page questions', () => {
  const lastMessage = (result: ReturnType<typeof buildDialogMessages>) =>
    result.messages[result.messages.length - 1].content

  it('sends body excerpts for a summary request', () => {
    const result = buildDialogMessages({ question: 'summarise', page: samplePage })

    expect(result.attachedSegmentIds.length).toBeGreaterThan(0)
    expect(lastMessage(result)).toContain('MIT')
  })

  it('recognises the same intent in Chinese', () => {
    const result = buildDialogMessages({ question: '总结一下这个页面', page: samplePage })
    expect(result.attachedSegmentIds.length).toBeGreaterThan(0)
  })

  it('falls back to coverage when the question matched nothing', () => {
    const result = buildDialogMessages({ question: 'zzzz qqqq wwww', page: samplePage })

    expect(result.attachedSegmentIds.length).toBeGreaterThan(0)
    expect(result.trace.find(stage => stage.name === 'retrieve')?.note).toContain('全文覆盖')
  })

  it('tells the model how much of the body the batch represents', () => {
    expect(lastMessage(buildDialogMessages({ question: 'summarise', page: samplePage })))
      .toContain('覆盖本页全部正文')

    const long = createPage(Array.from({ length: 60 }, (_, index) =>
      createSegment(`s${index}`, `第 ${index} 段正文，内容足够长以便占用检索预算并触发采样行为。`)))
    const sampled = lastMessage(buildDialogMessages({ question: 'summarise', page: long }))
    expect(sampled).toContain('均匀取自本页正文')
    expect(sampled).not.toContain('覆盖本页全部正文')
  })

  it('keeps a targeted question on relevance instead of coverage', () => {
    const result = buildDialogMessages({ question: '端口被占用怎么改', page: samplePage })

    expect(result.trace.find(stage => stage.name === 'retrieve')?.note).toContain('按问题检索')
    expect(lastMessage(result)).toContain('PORT')
    expect(lastMessage(result)).not.toContain('MIT')
  })

  it('retrieves on the terms the model asked for, not the original question', () => {
    const result = buildDialogMessages({
      question: '总结一下这个页面',
      page: samplePage,
      retrievalQuery: '许可证',
    })

    expect(lastMessage(result)).toContain('MIT')
    expect(result.trace.find(stage => stage.name === 'retrieve')?.note).toContain('按问题检索')
  })
})
