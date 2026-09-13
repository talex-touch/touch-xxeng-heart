// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { blockIsTranslationTarget, pageLanguageIsTranslationTarget, pageTextLooksEnglish, readPageLanguage, resolvePageTranslationTarget } from './pageTranslationLanguage'

const englishBody = 'This detailed English article explains how contributors can review changes, understand the design, and safely ship the update to readers.'
const chineseBody = '这篇文章说明了贡献者如何审阅改动、理解整体设计，并把更新安全地发布给所有读者，同时列出了发布前必须完成的检查事项与常见问题。'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resolvePageTranslationTarget', () => {
  it.each([
    { direction: 'en-to-zh' as const, expected: 'zh' as const },
    { direction: 'zh-to-en' as const, expected: 'en' as const },
  ])('turns $direction into $expected', ({ direction, expected }) => {
    expect(resolvePageTranslationTarget(direction)).toBe(expected)
  })
})

describe('pageLanguageIsTranslationTarget', () => {
  function read(body: string, html?: string) {
    document.body.innerHTML = html ?? `<article><p>${body}</p></article>`
    return readPageLanguage(document)
  }

  it.each([
    // The reader asked for Chinese; a Chinese page has nothing to translate.
    { name: 'a Chinese body for en→zh', body: chineseBody, direction: 'en-to-zh' as const, expected: true },
    { name: 'an English body for zh→en', body: englishBody, direction: 'zh-to-en' as const, expected: true },
    { name: 'an English body for en→zh', body: englishBody, direction: 'en-to-zh' as const, expected: false },
    { name: 'a Chinese body for zh→en', body: chineseBody, direction: 'zh-to-en' as const, expected: false },
    {
      name: 'a Chinese article quoting English code and logs',
      body: `安装依赖后运行 pnpm install && pnpm dev，如果出现 ENOENT 或 ECONNRESET 请先检查 proxy 设置。${chineseBody}`,
      direction: 'en-to-zh' as const,
      expected: true,
    },
    // "译成中文" covers Japanese and Korean pages too — only the target language is refused.
    {
      name: 'a Japanese body for en→zh',
      body: 'これは日本語の技術文書です。設定を配置してからビルドを実行してください。詳しい手順は公式ドキュメントにまとまっています。',
      direction: 'en-to-zh' as const,
      expected: false,
    },
    // A verdict we cannot reach must not overrule a rule the user saved on purpose.
    { name: 'a body too short to judge', body: '安装依赖后运行。', direction: 'en-to-zh' as const, expected: false },
  ])('answers $expected for $name', ({ body, direction, expected }) => {
    expect(pageLanguageIsTranslationTarget(read(body), direction)).toBe(expected)
  })

  it('does not refuse an English body that quotes a single Chinese glyph', () => {
    expect(pageLanguageIsTranslationTarget(read(`${englishBody} 的`), 'en-to-zh')).toBe(false)
  })
})

describe('readPageLanguage', () => {
  it('lets the article speak for the page, not the English site chrome around it', () => {
    const article = chineseBody.repeat(4)
    const navigation = Array.from({ length: 10 }, () => `<li>${englishBody.repeat(4)}</li>`).join('')
    document.body.innerHTML = `<nav><ul>${navigation}</ul></nav><main><article><p>${article}</p></article></main>`

    const reading = readPageLanguage(document)

    expect(reading.language).toBe('zh')
    expect(pageLanguageIsTranslationTarget(reading, 'en-to-zh')).toBe(true)
  })

  it('falls back to the whole page when the article is too small to speak for it', () => {
    const navigation = Array.from({ length: 10 }, () => `<li>${englishBody.repeat(4)}</li>`).join('')
    document.body.innerHTML = `<nav><ul>${navigation}</ul></nav><main><article><p>${chineseBody}</p></article></main>`

    const reading = readPageLanguage(document)

    // The stub is not allowed to refuse the page on its own: a few lines of Chinese
    // inside a large English navigation is not a verdict we can act on.
    expect(reading.confidence).toBeLessThan(0.7)
    expect(pageLanguageIsTranslationTarget(reading, 'en-to-zh')).toBe(false)
  })

  it('reads a platform page through that platform\'s own prose', () => {
    document.body.innerHTML = `<nav><p>${chineseBody}</p></nav><section id="readme"><article><p>${englishBody}</p></article></section>`

    expect(readPageLanguage(document, 'github-readme').language).toBe('en')
    expect(pageTextLooksEnglish(readPageLanguage(document, 'github-readme'))).toBe(true)
  })

  it('reports an empty reading when the page has no prose to read', () => {
    document.body.innerHTML = '<div><img src="chart.png"></div>'

    const reading = readPageLanguage(document)

    expect(reading.textLength).toBe(0)
    expect(reading.language).toBe('other')
  })
})

describe('pageTextLooksEnglish', () => {
  it.each([
    { name: 'English prose', body: englishBody, expected: true },
    // Latin characters alone passed Spanish and German, and the auto path then translated
    // them with a hardcoded English source.
    { name: 'Spanish prose', body: 'Este artículo explica cómo los contribuyentes revisan los cambios y publican la actualización para los lectores sin romper el comportamiento.', expected: false },
    { name: 'Chinese prose', body: chineseBody, expected: false },
    { name: 'too little English to call it an English page', body: 'Read the docs.', expected: false },
  ])('answers $expected for $name', ({ body, expected }) => {
    document.body.innerHTML = `<article><p>${body}</p></article>`

    expect(pageTextLooksEnglish(readPageLanguage(document))).toBe(expected)
  })
})

describe('blockIsTranslationTarget', () => {
  it.each([
    { name: 'a Chinese block while translating into Chinese', text: chineseBody, target: 'zh' as const, expected: true },
    { name: 'an English block while translating into English', text: englishBody, target: 'en' as const, expected: true },
    { name: 'a Chinese block while translating into English', text: chineseBody, target: 'en' as const, expected: false },
    { name: 'an English block while translating into Chinese', text: englishBody, target: 'zh' as const, expected: false },
    // Short Latin text with no stop word is not confident enough to be called English,
    // and a block is only dropped when we can name its language.
    { name: 'a short heading without a stop word', text: 'Shipped v2.3.1 today', target: 'en' as const, expected: false },
    { name: 'an empty block', text: '', target: 'zh' as const, expected: false },
  ])('answers $expected for $name', ({ text, target, expected }) => {
    expect(blockIsTranslationTarget(text, target)).toBe(expected)
  })
})
