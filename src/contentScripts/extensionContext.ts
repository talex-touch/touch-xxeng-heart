export function isExtensionContextInvalidated(error: unknown) {
  return error instanceof Error && /Extension context invalidated/i.test(error.message)
}
