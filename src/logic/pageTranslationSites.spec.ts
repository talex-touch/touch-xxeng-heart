// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { findEnabledEnglishAutoPageTranslationSite } from './pageTranslationSites'

const enabledSites = {
  'discourse': true,
  'github-readme': true,
  'reddit': true,
}

const englishBody = 'This detailed English article explains how contributors can review changes, understand the design, and safely ship the update to readers.'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findEnabledEnglishAutoPageTranslationSite', () => {
  it.each([
    {
      name: 'Discourse topic',
      html: `<div id="topic-title"><h1>${englishBody}</h1></div>`,
      url: 'https://forum.example.com/t/release-notes/42',
      hints: { discourse: true },
      expected: 'discourse',
    },
    {
      name: 'GitHub README',
      html: `<section id="readme"><article><p>${englishBody}</p></article></section>`,
      url: 'https://github.com/lexi/lexi',
      hints: {},
      expected: 'github-readme',
    },
    {
      name: 'Reddit post',
      html: `<shreddit-post><div slot="text-body">${englishBody}</div></shreddit-post>`,
      url: 'https://www.reddit.com/r/lexi/comments/abc123/a_discussion/',
      hints: {},
      expected: 'reddit',
    },
  ])('matches an enabled English $name', ({ html, url, hints, expected }) => {
    document.body.innerHTML = html

    expect(findEnabledEnglishAutoPageTranslationSite(document, url, hints, enabledSites)).toBe(expected)
  })

  it.each([
    {
      name: 'the matching site is disabled',
      html: `<section id="readme"><article><p>${englishBody}</p></article></section>`,
      url: 'https://github.com/lexi/lexi',
      hints: {},
      enabled: { ...enabledSites, 'github-readme': false },
    },
    {
      name: 'the supported page body is Chinese',
      html: '<section id="readme"><article><p>这是一个包含足够中文正文内容的页面，用于说明项目背景、使用方法、贡献流程以及发布前需要完成的检查事项。</p></article></section>',
      url: 'https://github.com/lexi/lexi',
      hints: {},
      enabled: enabledSites,
    },
    {
      name: 'the URL is not a supported content page',
      html: `<shreddit-post><div slot="text-body">${englishBody}</div></shreddit-post>`,
      url: 'https://www.reddit.com/r/lexi/about/',
      hints: {},
      enabled: enabledSites,
    },
  ])('does not match when $name', ({ html, url, hints, enabled }) => {
    document.body.innerHTML = html

    expect(findEnabledEnglishAutoPageTranslationSite(document, url, hints, enabled)).toBeUndefined()
  })
})
