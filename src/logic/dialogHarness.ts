import { rankSegments, selectForCoverage, selectSegments } from './contextRetrieval'
import { clampToTokens, createTokenBudget, estimateTokens } from './tokenBudget'
import type { PageDocument, PageSegment } from './contextRetrieval'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface DialogTurn {
  role: 'user' | 'assistant'
  content: string
  /** Segment ids attached to this turn, so later turns can skip resending them. */
  segmentIds?: string[]
}

export interface DialogSelectionContext {
  text?: string
  translation?: string
  detail?: string
  /** Segment nearest the selection; gives retrieval a locality anchor. */
  anchorSegmentId?: string
}

export interface DialogBudget {
  /** Hard ceiling for everything the harness assembles, excluding the system prompt. */
  total: number
  outline: number
  retrieved: number
  history: number
  selection: number
  /** Longest single excerpt; keeps one huge block from eating the retrieval budget. */
  segment: number
}

export const defaultDialogBudget: DialogBudget = {
  total: 4200,
  outline: 400,
  retrieved: 1500,
  history: 2000,
  selection: 600,
  segment: 700,
}

export interface DialogHarnessInput {
  question: string
  history?: DialogTurn[]
  page?: PageDocument
  selection?: DialogSelectionContext
  budget?: Partial<DialogBudget>
  /**
   * Terms the model asked for after seeing the first batch.
   *
   * Retrieval runs on these instead of the question — the point of the search tool is that
   * the question's own wording already failed to find what the answer needs.
   */
  retrievalQuery?: string
}

export interface DialogHarnessStageTrace {
  name: 'selection' | 'history' | 'retrieve' | 'outline' | 'assemble'
  tokens: number
  note: string
}

export interface DialogHarnessResult {
  messages: ChatMessage[]
  /** Segment ids attached to the current question; store them on the user turn. */
  attachedSegmentIds: string[]
  /** Human-readable provenance for the dialog's context strip. */
  sources: string[]
  trace: DialogHarnessStageTrace[]
  totalTokens: number
}

export const dialogSystemPrompt = [
  '你是 Lexi 的网页阅读助手。',
  '你只能看到 <page> 给出的页面目录，以及每轮 <excerpt> 提供的正文片段——这不是整篇页面。',
  '优先依据 <excerpt> 与 <selection> 回答；引用具体内容时可以带上片段所属的小节名。',
  '<excerpt> 前的说明会写清这批片段覆盖了多少正文，按它给出的范围作答，不要否认手上已有的片段。',
  '如果需要页面上尚未给到的内容，就只输出一行 `<search>关键词</search>`（最多三个关键词，空格分隔），不要附带任何其他文字；系统会检索并把结果发回给你，然后你再正式作答。',
  '只有在检索结果依然不足时，才说明缺少哪部分并建议用户选中对应段落，不要凭空推测页面内容。',
  '回答简洁、直接、中文优先；涉及术语时给出一句短解释。',
  '可以使用简洁 Markdown（列表、行内代码、代码块、引用）。不要输出 JSON 或思考过程。',
].join(' ')

/**
 * Questions about the page as a whole rather than something in it.
 *
 * These share no vocabulary with the body, so relevance ranking returns nothing and the
 * answer degrades to "I only have the outline". They are routed to coverage instead.
 */
const wholePageQuestionPattern = /总结|概括|摘要|大意|主旨|讲了什么|说了什么|讲的什么|写了什么|全文|整体|通篇|要点|重点|梗概|介绍一下|是什么内容|tl;?dr|summar|overview|gist|key\s?points?|main\s?(?:idea|point)|what.{1,16}\babout\b/i

export function isWholePageQuestion(question: string) {
  return wholePageQuestionPattern.test(question)
}

/** Tells the model how much of the body this batch represents, so it answers in scope. */
function renderCoverageNote(attached: number, available: number, complete: boolean) {
  if (!attached)
    return ''

  if (complete)
    return `以下片段覆盖本页全部正文（共 ${attached} 段），可据此完整作答。`

  return `以下片段按文档顺序均匀取自本页正文（${attached}/${available} 段），足以概括全文脉络；可以据此总结，但不要声称逐句读过。`
}

function renderSelectionBlock(selection: DialogSelectionContext, budget: ReturnType<typeof createTokenBudget>, cap: number) {
  const text = selection.text ? budget.take(selection.text, Math.round(cap * 0.6)) : ''
  const translation = selection.translation ? budget.take(selection.translation, Math.round(cap * 0.25)) : ''
  const detail = selection.detail ? budget.take(selection.detail, Math.round(cap * 0.15)) : ''
  const lines = [
    text ? `选中文本：${text}` : '',
    translation ? `已有译文：${translation}` : '',
    detail ? `翻译说明：${detail}` : '',
  ].filter(Boolean)

  return lines.length ? `<selection>\n${lines.join('\n')}\n</selection>` : ''
}

function renderOutlineBlock(page: PageDocument, budget: ReturnType<typeof createTokenBudget>, cap: number) {
  const head = [
    page.title ? `标题：${page.title}` : '',
    page.url ? `URL：${page.url}` : '',
  ].filter(Boolean).join('\n')

  const outline = page.outline.length
    ? budget.take(`目录：\n${page.outline.map(item => `- ${item}`).join('\n')}`, cap)
    : ''
  const scale = `正文规模：约 ${page.charCount} 字，${page.segments.length} 个片段（按需检索，不会整篇注入）。`
  budget.reserve(estimateTokens(scale))

  return `<page>\n${[head, outline, scale].filter(Boolean).join('\n')}\n</page>`
}

/**
 * Renders excerpts one at a time, charging each (tags included) against the pool and
 * dropping any that no longer fit — so the wrapper markup can never overshoot the budget.
 */
function renderExcerptBlock(
  segments: PageSegment[],
  segmentCap: number,
  budget: ReturnType<typeof createTokenBudget>,
) {
  const blocks: string[] = []
  const attached: PageSegment[] = []

  for (const segment of segments) {
    const section = segment.heading ? ` section="${segment.heading}"` : ''
    const block = `<excerpt id="${segment.id}"${section}>\n${clampToTokens(segment.text, segmentCap)}\n</excerpt>`
    if (!budget.fits(block))
      continue

    budget.reserve(estimateTokens(block))
    blocks.push(block)
    attached.push(segment)
  }

  return { text: blocks.join('\n'), attached }
}

/**
 * Keep the most recent turns that fit the history allowance, always preserving
 * whole user/assistant pairs so the transcript never starts mid-exchange.
 */
function clampHistory(history: DialogTurn[], maxTokens: number) {
  const kept: DialogTurn[] = []
  let used = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]
    const cost = estimateTokens(turn.content)
    if (used + cost > maxTokens)
      break

    kept.unshift(turn)
    used += cost
  }

  // Never lead with an assistant turn — some strict APIs reject it and it reads as a non sequitur.
  while (kept.length && kept[0].role === 'assistant') {
    used -= estimateTokens(kept[0].content)
    kept.shift()
  }

  return { turns: kept, tokens: Math.max(0, used) }
}

/**
 * Lightweight, inspectable orchestration: selection → history → retrieve → outline → assemble.
 * Every stage charges a shared token budget and records what it spent, so a bad prompt can be
 * diagnosed from `trace` instead of guessing.
 */
export function buildDialogMessages(input: DialogHarnessInput): DialogHarnessResult {
  const budget = { ...defaultDialogBudget, ...input.budget }
  const pool = createTokenBudget(budget.total)
  const trace: DialogHarnessStageTrace[] = []
  const question = clampToTokens(input.question.trim(), 800)
  pool.reserve(estimateTokens(question))

  // 1. Selection — the user pointed at this, so it outranks anything we retrieve.
  let mark = pool.spent
  const selectionBlock = input.selection
    ? renderSelectionBlock(input.selection, pool, budget.selection)
    : ''
  trace.push({
    name: 'selection',
    tokens: pool.spent - mark,
    note: selectionBlock ? '已注入选区' : '无选区',
  })

  // 2. History — clamp first, because what survives determines what was already delivered.
  mark = pool.spent
  const history = clampHistory(input.history ?? [], Math.min(budget.history, pool.remaining))
  pool.reserve(history.tokens)
  const dropped = (input.history?.length ?? 0) - history.turns.length
  trace.push({
    name: 'history',
    tokens: pool.spent - mark,
    note: `保留 ${history.turns.length} 轮${dropped > 0 ? `，裁掉 ${dropped} 轮` : ''}`,
  })

  // 3. Retrieve — only segments not already visible in the retained transcript.
  mark = pool.spent
  const deliveredIds = new Set(history.turns.flatMap(turn => turn.segmentIds ?? []))
  const lastQuestion = [...history.turns].reverse().find(turn => turn.role === 'user')?.content
  const retrieveTokens = Math.min(budget.retrieved, pool.remaining)
  const searchQuery = input.retrievalQuery?.trim()
  const relevance = input.page && (searchQuery || !isWholePageQuestion(question))
    ? selectSegments(
      rankSegments(searchQuery || question, input.page.segments, {
        contextQuery: searchQuery ? question : lastQuestion,
        anchorSegmentId: input.selection?.anchorSegmentId,
      }),
      { maxTokens: retrieveTokens, deliveredIds },
    )
    : undefined

  // Coverage catches both the whole-page question and the query that matched nothing;
  // either way, falling through to an outline-only prompt is never the useful answer.
  const coverage = input.page && !relevance?.segments.length
    ? selectForCoverage(input.page.segments, { maxTokens: retrieveTokens, deliveredIds })
    : undefined
  const retrieval = coverage ?? relevance ?? { segments: [], droppedForBudget: 0, usedTokens: 0 }
  const excerpts = renderExcerptBlock(retrieval.segments, budget.segment, pool)
  const coverageNote = coverage
    ? renderCoverageNote(excerpts.attached.length, coverage.available, coverage.complete && excerpts.attached.length === coverage.segments.length)
    : ''
  if (coverageNote)
    pool.reserve(estimateTokens(coverageNote))

  const droppedSegments = retrieval.droppedForBudget + (retrieval.segments.length - excerpts.attached.length)
  trace.push({
    name: 'retrieve',
    tokens: pool.spent - mark,
    note: input.page
      ? `${coverage ? '全文覆盖' : '按问题检索'} ${excerpts.attached.length}/${input.page.segments.length} 片段${droppedSegments ? `，预算内丢弃 ${droppedSegments}` : ''}${deliveredIds.size ? `，跳过 ${deliveredIds.size} 个已发送` : ''}`
      : '无页面上下文',
  })

  // 4. Outline — small, stable across turns, so it stays a cacheable prompt prefix.
  mark = pool.spent
  const outlineBlock = input.page ? renderOutlineBlock(input.page, pool, budget.outline) : ''
  trace.push({
    name: 'outline',
    tokens: pool.spent - mark,
    note: input.page ? `${input.page.outline.length} 个标题` : '无页面上下文',
  })

  // 5. Assemble a real multi-turn message array — no flattening, no re-uploading the page.
  mark = pool.spent
  const messages: ChatMessage[] = [{ role: 'system', content: dialogSystemPrompt }]
  if (outlineBlock) {
    messages.push({ role: 'user', content: outlineBlock })
    messages.push({ role: 'assistant', content: '已读取页面结构，请提问，我会按需要引用具体片段。' })
  }
  for (const turn of history.turns)
    messages.push({ role: turn.role, content: turn.content })

  messages.push({
    role: 'user',
    content: [selectionBlock, coverageNote, excerpts.text, `问题：${question}`].filter(Boolean).join('\n\n'),
  })
  trace.push({ name: 'assemble', tokens: pool.spent - mark, note: `${messages.length} 条消息` })

  const sources = excerpts.attached.map(segment => segment.heading || segment.text.slice(0, 24))

  return {
    messages,
    attachedSegmentIds: excerpts.attached.map(segment => segment.id),
    sources,
    trace,
    totalTokens: pool.spent,
  }
}
