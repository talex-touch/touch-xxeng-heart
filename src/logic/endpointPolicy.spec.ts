import { describe, expect, it } from 'vitest'
import {
  approveHttpEndpoint,
  assertEndpointAllowed,
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
