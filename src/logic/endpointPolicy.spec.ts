import { describe, expect, it } from 'vitest'
import {
  approveHttpEndpoint,
  assertEndpointAllowed,
  assertRequestUrlAllowed,
  normalizeEndpointApproval,
  revokeHttpEndpoint,
} from './endpointPolicy'

describe('ai endpoint policy', () => {
  it('allows HTTPS without approval', () => {
    expect(() => assertEndpointAllowed('https://api.example.com/v1', [])).not.toThrow()
  })

  it('requires approval for every HTTP address', () => {
    expect(() => assertEndpointAllowed('http://api.example.com/v1', [])).toThrow(/确认/)

    const approved = approveHttpEndpoint([], 'http://API.example.com:80/v1/')
    expect(approved).toEqual(['http://api.example.com/v1'])
    expect(() => assertEndpointAllowed('http://api.example.com/v1/', approved)).not.toThrow()
    expect(() => assertEndpointAllowed('http://api.example.com/v2', approved)).toThrow(/确认/)
  })

  it('normalizes and revokes one exact HTTP endpoint', () => {
    expect(normalizeEndpointApproval(' HTTP://Example.com:80/v1/ ')).toBe('http://example.com/v1')
    expect(revokeHttpEndpoint([
      'http://example.com/v1',
      'http://example.com/v2',
    ], 'http://example.com/v1/')).toEqual(['http://example.com/v2'])
  })

  it('rejects unsupported endpoint protocols', () => {
    expect(() => assertEndpointAllowed('ftp://api.example.com/v1', [])).toThrow(/HTTPS 或经确认的 HTTP/)
  })
})

describe('resolved request url policy', () => {
  it('allows any HTTPS route without approval', () => {
    expect(() => assertRequestUrlAllowed('https://router.example.com/v1/responses', [])).not.toThrow()
  })

  it('accepts an HTTP route under an approved base', () => {
    const approved = ['http://localhost:11434/v1']
    expect(() => assertRequestUrlAllowed('http://localhost:11434/v1/chat/completions', approved)).not.toThrow()
    expect(() => assertRequestUrlAllowed('http://localhost:11434/v1', approved)).not.toThrow()
  })

  it('does not let an approval leak to another origin or sibling path', () => {
    const approved = ['http://localhost:11434/v1']
    expect(() => assertRequestUrlAllowed('http://localhost:11435/v1/chat/completions', approved)).toThrow(/尚未确认/)
    expect(() => assertRequestUrlAllowed('http://evil.example.com/v1/chat/completions', approved)).toThrow(/尚未确认/)
    expect(() => assertRequestUrlAllowed('http://localhost:11434/v1x/chat/completions', approved)).toThrow(/尚未确认/)
  })

  it('rejects non-HTTP protocols and malformed urls', () => {
    expect(() => assertRequestUrlAllowed('file:///etc/passwd', [])).toThrow(/HTTPS 或经确认的 HTTP/)
    expect(() => assertRequestUrlAllowed('not a url', [])).toThrow(/地址无效/)
  })
})
