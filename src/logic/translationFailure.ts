/**
 * Turns a translation failure into something the reader can act on.
 *
 * Page translation used to swallow every failure into a `console.warn` while the loading
 * placeholder was removed in a `finally`, so hitting a daily cap looked exactly like the
 * spinner vanishing for no reason. Worse, the scroll and mutation observers kept firing
 * scans afterwards, so a capped page retried — and failed — for as long as it stayed open.
 */

export type TranslationFailureKind =
  | 'quota'
  | 'schedule'
  | 'auth'
  | 'timeout'
  | 'rateLimit'
  | 'unknown'

/** Kinds that will keep failing until the reader changes something. Stop scanning on these. */
const terminalKinds = new Set<TranslationFailureKind>(['quota', 'schedule', 'auth'])

export function classifyTranslationFailure(error: unknown): TranslationFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const name = error instanceof Error ? error.name : ''

  if (/仅允许在.+运行/.test(message))
    return 'schedule'
  // Covers 已达上限 / 已达渠道上限 / 已达翻译上限 — the quota layer varies the middle.
  if (/已达.{0,4}上限|余额不足|额度不足/.test(message))
    return 'quota'
  if (name === 'TimeoutError' || /无响应|timed? ?out/i.test(message))
    return 'timeout'
  if (/unauthorized|invalid[_\s-]*api[_\s-]*key|认证|鉴权/i.test(message))
    return 'auth'
  if (/rate[_\s-]*limit|too many requests|请求过多/i.test(message))
    return 'rateLimit'

  return 'unknown'
}

export function isTerminalTranslationFailure(kind: TranslationFailureKind) {
  return terminalKinds.has(kind)
}

/**
 * Quota and schedule messages already name the limit and the window, so they are passed
 * through rather than wrapped — a second layer would only bury the number that matters.
 */
export function describeTranslationFailure(kind: TranslationFailureKind, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')

  switch (kind) {
    case 'quota':
    case 'schedule':
      return message
    case 'auth':
      return 'AI 服务鉴权失败，请检查 API Key。'
    case 'timeout':
      return '翻译服务无响应，已暂停本页翻译。'
    case 'rateLimit':
      return '翻译请求过于频繁，请稍后再试。'
    default:
      return '本页翻译失败，请稍后重试。'
  }
}

export interface FailureReporter {
  /** False when this kind was already reported inside the cooldown. */
  shouldReport: (kind: TranslationFailureKind) => boolean
  reset: () => void
}

/**
 * Concurrent batches hitting the same cap would otherwise each raise their own toast.
 */
export function createFailureReporter(cooldownMs: number, now: () => number = Date.now): FailureReporter {
  const reportedAt = new Map<TranslationFailureKind, number>()

  return {
    shouldReport(kind) {
      const previous = reportedAt.get(kind)
      const timestamp = now()
      if (previous != null && timestamp - previous < cooldownMs)
        return false

      reportedAt.set(kind, timestamp)
      return true
    },
    reset() {
      reportedAt.clear()
    },
  }
}
