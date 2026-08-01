import { sendRuntimeMessage } from './runtimeMessaging'
import { formatDay } from './format'
import type { AiCallLog, PageVisitLog } from './types'

export type AnalyticsLogPayload =
  | { kind: 'ai', item: AiCallLog }
  | { kind: 'page', item: PageVisitLog }

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function sendAnalyticsLog(payload: AnalyticsLogPayload) {
  try {
    await sendRuntimeMessage('lexi-record-analytics', payload)
  }
  catch (error) {
    console.warn('[Lexi] analytics log write failed', error)
  }
}

export async function recordAiCall(log: Omit<AiCallLog, 'id' | 'createdAt'>) {
  await sendAnalyticsLog({
    kind: 'ai',
    item: {
      ...log,
      id: createId('ai'),
      createdAt: Date.now(),
    },
  })
}

export async function recordPageVisit(log: Omit<PageVisitLog, 'id' | 'createdAt'>) {
  await sendAnalyticsLog({
    kind: 'page',
    item: {
      ...log,
      id: createId('page'),
      createdAt: Date.now(),
    },
  })
}

/**
 * Buckets logs into the last `days` days.
 *
 * `weight` decides what each log contributes: the default counts calls, and passing
 * `log => log.totalTokens ?? 0` sums tokens.
 */
export function summarizeByDay<T extends { createdAt: number }>(
  logs: T[],
  days = 7,
  weight: (log: T) => number = () => 1,
) {
  const result = new Map<string, number>()

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - index)
    result.set(formatDay(date.getTime()), 0)
  }

  for (const log of logs) {
    const key = formatDay(log.createdAt)
    if (result.has(key))
      result.set(key, (result.get(key) ?? 0) + weight(log))
  }

  return Array.from(result.entries()).map(([label, value]) => ({ label, value }))
}
