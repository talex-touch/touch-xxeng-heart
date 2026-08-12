import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type MockAiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini'

export interface MockAiRequest {
  route: MockAiProtocol | 'models' | 'preflight'
  method: string
  path: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
  /** Whether the caller asked for SSE, read from the body or the Gemini route. */
  streamed: boolean
}

export interface MockAiServer {
  origin: string
  requests: MockAiRequest[]
  /** Base URL to configure in Lexi, which is also the entry it needs in the approval list. */
  endpoint: (protocol: MockAiProtocol) => string
  /** Assistant text every subsequent chat request answers with. */
  answerWith: (text: string) => void
  close: () => Promise<void>
}

const geminiChatPattern = /^\/v1beta\/models\/[^:]+:(?:streamGenerateContent|generateContent)$/

const usage = {
  'openai-chat': { prompt_tokens: 120, completion_tokens: 48, total_tokens: 168 },
  'openai-responses': { input_tokens: 120, output_tokens: 48, total_tokens: 168 },
  'anthropic-messages': { input_tokens: 120, output_tokens: 48 },
  'gemini': { promptTokenCount: 120, candidatesTokenCount: 48, totalTokenCount: 168 },
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function readHeaders(request: IncomingMessage) {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value ?? '']),
  )
}

function buildJsonBody(protocol: MockAiProtocol, text: string) {
  if (protocol === 'openai-chat')
    return JSON.stringify({ choices: [{ message: { content: text } }], usage: usage[protocol] })

  if (protocol === 'openai-responses')
    return JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: usage[protocol] })

  if (protocol === 'anthropic-messages')
    return JSON.stringify({ content: [{ type: 'text', text }], usage: usage[protocol] })

  return JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage[protocol] })
}

/** Splits on code points so each SSE event stays valid JSON; bytes are split later. */
function splitText(text: string, parts: number) {
  const chars = [...text]
  const size = Math.max(1, Math.ceil(chars.length / parts))
  const slices: string[] = []
  for (let index = 0; index < chars.length; index += size)
    slices.push(chars.slice(index, index + size).join(''))

  return slices
}

function buildStreamBody(protocol: MockAiProtocol, text: string) {
  const deltas = splitText(text, 4)

  if (protocol === 'openai-chat') {
    return [
      ...deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`),
      'data: [DONE]\n\n',
    ].join('')
  }

  if (protocol === 'openai-responses') {
    return [
      ...deltas.map(delta => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`),
      `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { usage: usage[protocol] } })}\n\n`,
    ].join('')
  }

  if (protocol === 'anthropic-messages') {
    return [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      ...deltas.map(text => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`),
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('')
  }

  return deltas
    .map(text => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
}

/**
 * Flushes the payload in raw byte slices rather than whole strings.
 *
 * Cutting at arbitrary offsets splits multi-byte characters across chunks, which is what
 * the proxy's streaming `TextDecoder` has to survive — a naive per-chunk decode produces
 * replacement characters here and nowhere else.
 */
async function writeInByteSlices(response: ServerResponse, payload: string, slices = 7) {
  const buffer = Buffer.from(payload, 'utf8')
  const size = Math.max(1, Math.ceil(buffer.length / slices))

  for (let offset = 0; offset < buffer.length; offset += size) {
    response.write(buffer.subarray(offset, offset + size))
    await new Promise(resolve => setTimeout(resolve, 12))
  }

  response.end()
}

function resolveRoute(pathname: string): MockAiProtocol | 'models' | undefined {
  if (pathname === '/v1/chat/completions')
    return 'openai-chat'
  if (pathname === '/v1/responses')
    return 'openai-responses'
  if (pathname === '/v1/messages')
    return 'anthropic-messages'
  if (geminiChatPattern.test(pathname))
    return 'gemini'
  if (pathname === '/v1/models' || pathname === '/v1beta/models')
    return 'models'

  return undefined
}

/**
 * An AI gateway that refuses browser origins, which is the whole point of this fixture.
 *
 * It never emits an `Access-Control-*` header and answers preflights with 403, so a call
 * made from a content script cannot reach it. Anything that does reach it therefore went
 * through the extension service worker.
 */
export async function startMockAiServer(): Promise<MockAiServer> {
  const requests: MockAiRequest[] = []
  let answer = ''

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'OPTIONS') {
      requests.push({
        route: 'preflight',
        method: 'OPTIONS',
        path: `${url.pathname}${url.search}`,
        headers: readHeaders(request),
        body: undefined,
        streamed: false,
      })
      response.writeHead(403).end()
      return
    }

    const route = resolveRoute(url.pathname)
    const raw = await readBody(request)

    if (!route) {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"unknown route"}')
      return
    }

    let body: Record<string, unknown> | undefined
    try {
      body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined
    }
    catch {
      body = undefined
    }

    const streamed = route === 'gemini'
      ? url.pathname.includes(':streamGenerateContent')
      : body?.stream === true

    requests.push({
      route,
      method: request.method ?? '',
      path: `${url.pathname}${url.search}`,
      headers: readHeaders(request),
      body,
      streamed: Boolean(streamed),
    })

    if (route === 'models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        data: [{ id: 'smoke-model' }, { id: 'o1-smoke' }],
        models: [{ name: 'models/smoke-model' }, { name: 'models/o1-smoke' }],
      }))
      return
    }

    if (!streamed) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(buildJsonBody(route, answer))
      return
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    })
    await writeInByteSlices(response, buildStreamBody(route, answer))
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent)
        response.writeHead(500)
      response.end()
    })
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    origin,
    requests,
    // Gemini derives `/v1beta/models/...` itself, so it is configured with the bare origin.
    endpoint: protocol => (protocol === 'gemini' ? origin : `${origin}/v1`),
    answerWith: (text: string) => {
      answer = text
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close(error => (error ? reject(error) : resolve()))
    }),
  }
}
