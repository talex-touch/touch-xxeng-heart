// Formatters are hoisted to module scope: constructing an `Intl.DateTimeFormat` is
// expensive and these are called once per row inside `v-for` lists.
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
})

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
})

export function formatTime(value: number) {
  return timeFormatter.format(new Date(value))
}

export function formatDateTime(value: number) {
  return dateTimeFormatter.format(new Date(value))
}

export function formatDay(value: number) {
  return dayFormatter.format(new Date(value))
}

/** Serialized size of a value, used for the storage breakdown. */
export function estimateStorageBytes(value: unknown) {
  try {
    return new Blob([JSON.stringify(value ?? null)]).size
  }
  catch {
    return 0
  }
}

/**
 * Human-readable byte count. The previous copies jumped straight to KB, so anything
 * under a kilobyte rendered as "0.3 KB"; bytes are now shown as bytes.
 */
export function formatBytes(bytes: number | undefined) {
  if (!Number.isFinite(bytes) || (bytes ?? 0) < 0)
    return '—'

  const value = bytes ?? 0
  if (value < 1024)
    return `${value} B`
  if (value < 1024 * 1024)
    return `${(value / 1024).toFixed(1)} KB`

  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

export function formatPercent(ratio: number | undefined, digits = 0) {
  if (!Number.isFinite(ratio))
    return '0%'

  return `${((ratio ?? 0) * 100).toFixed(digits)}%`
}

/** Percentage as a plain number, for slider values and inline labels. */
export function toPercent(ratio: number | undefined) {
  return Math.round(((Number.isFinite(ratio) ? ratio : 0) ?? 0) * 100)
}

export function formatDuration(ms: number | undefined) {
  if (!Number.isFinite(ms) || (ms ?? 0) <= 0)
    return '现在'

  const value = ms ?? 0
  const minutes = Math.round(value / 60000)
  if (minutes < 60)
    return `${Math.max(1, minutes)} 分钟`

  const hours = Math.round(minutes / 60)
  if (hours < 24)
    return `${hours} 小时`

  return `${Math.round(hours / 24)} 天`
}
