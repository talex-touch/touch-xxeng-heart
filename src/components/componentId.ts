let componentIdSequence = 0

export function createComponentId(prefix: string) {
  componentIdSequence += 1
  return `${prefix}-${componentIdSequence}`
}
