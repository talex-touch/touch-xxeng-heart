import { describe, expect, it } from 'vitest'
import { confidentEnough, countChineseCharacters, detectLanguage, isChineseText } from './languageDetection'

describe('detectLanguage', () => {
  it('reads Han without kana or hangul as Chinese', () => {
    expect(detectLanguage('这是一段中文技术文档，用来说明配置的方法。').language).toBe('zh')
    expect(detectLanguage('繁體中文的說明文件，描述設定方式。').language).toBe('zh')
    expect(detectLanguage('配置文件').language).toBe('zh')
  })

  it('reads kana as Japanese even when Han characters dominate', () => {
    // The bug this replaces: real Japanese almost always carries kanji, so a Han-only
    // test called it Chinese and translated the page into English.
    expect(detectLanguage('これは日本語の技術文書です。設定の方法を説明します。').language).toBe('ja')
    expect(detectLanguage('配置を変更する').language).toBe('ja')
    expect(detectLanguage('ひらがなだけのぶんしょう').language).toBe('ja')
    expect(detectLanguage('カタカナダケノブンショウ').language).toBe('ja')
  })

  it('reads hangul as Korean, including mixed hanja', () => {
    expect(detectLanguage('이것은 한국어 기술 문서입니다.').language).toBe('ko')
    expect(detectLanguage('設定을 변경합니다').language).toBe('ko')
  })

  it('keeps a Chinese page Chinese when it quotes a little Japanese', () => {
    // Guards the kana-share threshold: an incidental product name must not flip the page.
    const text = '这篇文章介绍了宝可梦（ポケモン）系列的技术实现细节，以及相关的配置方法和常见问题。'
    expect(detectLanguage(text).language).toBe('zh')
  })

  it('reads Latin script as English by default and raises confidence with stop words', () => {
    const long = detectLanguage('This is a technical document that explains how the configuration works and what you should do next.')
    expect(long.language).toBe('en')
    expect(long.confidence).toBeGreaterThanOrEqual(confidentEnough)

    expect(detectLanguage('rate limit').language).toBe('en')
  })

  it('does not call Spanish, French or German English', () => {
    // pageTextLooksEnglish only counted Latin characters, so these all passed as English
    // and were force-translated with a hardcoded en-to-zh direction.
    expect(detectLanguage('Esta es una guía técnica que explica cómo funciona la configuración.').language).not.toBe('en')
    expect(detectLanguage('Ceci est un guide technique qui explique comment la configuration fonctionne.').language).not.toBe('en')
    expect(detectLanguage('Dies ist eine technische Anleitung, die erklärt wie die Konfiguration funktioniert.').language).not.toBe('en')
  })

  it('reports no confidence for text with no detectable script', () => {
    const result = detectLanguage('123 456 —— ???')
    expect(result.confidence).toBe(0)
    expect(result.counts.total).toBe(0)
  })
})

describe('isChineseText', () => {
  it('accepts Chinese and rejects Japanese kanji', () => {
    // The live mistranslation this fixes: 配置 means "arrangement" in Japanese, so the
    // vocabulary layer was replacing it with "configuration" on Japanese pages.
    expect(isChineseText('配置文件的说明')).toBe(true)
    expect(isChineseText('配置を変更する')).toBe(false)
    expect(isChineseText('이것은 한국어입니다')).toBe(false)
    expect(isChineseText('plain english text')).toBe(false)
  })
})

describe('countChineseCharacters', () => {
  it('counts Han only when the text reads as Chinese', () => {
    expect(countChineseCharacters('中文四个字')).toBe(5)
    expect(countChineseCharacters('配置を変更する')).toBe(0)
  })
})
