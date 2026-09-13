import { describe, expect, it } from 'vitest'
import { isAllowedSubtitleResourceUrl } from './resourcePolicy'

describe('isAllowedSubtitleResourceUrl', () => {
  it('allows exactly the HTTPS Apple delivery host', () => {
    expect(isAllowedSubtitleResourceUrl('https://events-delivery.apple.com/2026/master.m3u8?sig=abc')).toBe(true)
    expect(isAllowedSubtitleResourceUrl('https://events-delivery.apple.com/subtitles/en/prog_index.m3u8')).toBe(true)
  })

  it.each([
    ['plain http', 'http://events-delivery.apple.com/master.m3u8'],
    ['a suffix lookalike host', 'https://events-delivery.apple.com.evil.example/master.m3u8'],
    ['a subdomain of the allowed host', 'https://sub.events-delivery.apple.com/master.m3u8'],
    ['userinfo that impersonates the host', 'https://events-delivery.apple.com@evil.example/master.m3u8'],
    ['embedded credentials', 'https://user:pass@events-delivery.apple.com/master.m3u8'],
    ['a non-default port', 'https://events-delivery.apple.com:8443/master.m3u8'],
    ['a non-http scheme', 'ftp://events-delivery.apple.com/master.m3u8'],
    ['a near-miss domain', 'https://events-delivery.apple.co/master.m3u8'],
    ['a relative path', '/master.m3u8'],
    ['malformed input', 'not a url'],
  ])('rejects %s', (_name, raw) => {
    expect(isAllowedSubtitleResourceUrl(raw)).toBe(false)
  })
})
