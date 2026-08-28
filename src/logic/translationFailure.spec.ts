import { describe, expect, it } from 'vitest'
import {
  classifyTranslationFailure,
  createFailureReporter,
  describeTranslationFailure,
  isTerminalTranslationFailure,
} from './translationFailure'

describe('classifyTranslationFailure', () => {
  it('recognises the messages the quota layer actually throws', () => {
    expect(classifyTranslationFailure(new Error('今日翻译已达上限（200 次）。'))).toBe('quota')
    expect(classifyTranslationFailure(new Error('Engine 今日已达渠道上限（50 次）。'))).toBe('quota')
    expect(classifyTranslationFailure(new Error('过去 6 小时已达翻译上限（30 次）。'))).toBe('quota')
    expect(classifyTranslationFailure(new Error('翻译仅允许在 09:00–18:00 运行。'))).toBe('schedule')
  })

  it('recognises timeout by error name as well as message', () => {
    const named = new Error('gone quiet')
    named.name = 'TimeoutError'

    expect(classifyTranslationFailure(named)).toBe('timeout')
    expect(classifyTranslationFailure(new Error('翻译服务无响应，请稍后重试。'))).toBe('timeout')
  })

  it('separates auth from rate limiting', () => {
    expect(classifyTranslationFailure(new Error('401 unauthorized'))).toBe('auth')
    expect(classifyTranslationFailure(new Error('rate limit exceeded'))).toBe('rateLimit')
    expect(classifyTranslationFailure(new Error('something else'))).toBe('unknown')
  })
})

describe('isTerminalTranslationFailure', () => {
  it('marks only the failures that repeat until the reader intervenes', () => {
    // These decide whether the scroll and mutation observers keep scanning.
    expect(isTerminalTranslationFailure('quota')).toBe(true)
    expect(isTerminalTranslationFailure('schedule')).toBe(true)
    expect(isTerminalTranslationFailure('auth')).toBe(true)
    expect(isTerminalTranslationFailure('timeout')).toBe(false)
    expect(isTerminalTranslationFailure('rateLimit')).toBe(false)
  })
})

describe('describeTranslationFailure', () => {
  it('passes quota and schedule messages through untouched', () => {
    const quota = new Error('今日翻译已达上限（200 次）。')
    expect(describeTranslationFailure('quota', quota)).toBe('今日翻译已达上限（200 次）。')

    const schedule = new Error('翻译仅允许在 09:00–18:00 运行。')
    expect(describeTranslationFailure('schedule', schedule)).toBe('翻译仅允许在 09:00–18:00 运行。')
  })

  it('replaces raw provider errors with something actionable', () => {
    expect(describeTranslationFailure('auth', new Error('401 unauthorized'))).toContain('API Key')
    expect(describeTranslationFailure('unknown', new Error('TypeError: fetch failed'))).not.toContain('TypeError')
  })
})

describe('createFailureReporter', () => {
  it('reports a kind once per cooldown', () => {
    let clock = 0
    const reporter = createFailureReporter(60_000, () => clock)

    expect(reporter.shouldReport('quota')).toBe(true)
    expect(reporter.shouldReport('quota')).toBe(false)

    clock = 59_999
    expect(reporter.shouldReport('quota')).toBe(false)

    clock = 60_000
    expect(reporter.shouldReport('quota')).toBe(true)
  })

  it('tracks kinds independently', () => {
    const reporter = createFailureReporter(60_000, () => 0)

    expect(reporter.shouldReport('quota')).toBe(true)
    expect(reporter.shouldReport('timeout')).toBe(true)
    expect(reporter.shouldReport('quota')).toBe(false)
  })

  it('reports again after a reset', () => {
    const reporter = createFailureReporter(60_000, () => 0)

    expect(reporter.shouldReport('quota')).toBe(true)
    reporter.reset()
    expect(reporter.shouldReport('quota')).toBe(true)
  })
})
