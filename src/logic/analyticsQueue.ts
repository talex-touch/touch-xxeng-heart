export function appendBoundedLog<T>(current: T[], item: T, limit: number) {
  return [item, ...current].slice(0, Math.max(0, limit))
}
