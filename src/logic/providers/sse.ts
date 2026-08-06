import type { SseEvent } from './protocol'

/**
 * Minimal `text/event-stream` reader.
 *
 * OpenAI chat only ever needed the `data:` lines, but Responses and Anthropic put the
 * meaning in `event:` — a delta and a completed snapshot are otherwise indistinguishable
 * and the text would be emitted twice.
 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  function dispatch() {
    if (dataLines.length) {
      onEvent({ event: eventName, data: dataLines.join('\n') })
      dataLines = []
    }

    eventName = ''
  }

  function handleLine(line: string) {
    const trimmed = line.replace(/\r$/, '')
    if (!trimmed) {
      dispatch()
      return
    }

    if (trimmed.startsWith(':'))
      return

    const separator = trimmed.indexOf(':')
    const field = separator < 0 ? trimmed : trimmed.slice(0, separator)
    const value = separator < 0 ? '' : trimmed.slice(separator + 1).replace(/^ /, '')

    if (field === 'event')
      eventName = value
    else if (field === 'data')
      dataLines.push(value)
  }

  return {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines)
        handleLine(line)
    },
    /** Flushes a trailing line that never got its blank-line terminator. */
    end() {
      if (buffer) {
        handleLine(buffer)
        buffer = ''
      }

      dispatch()
    },
  }
}
