import { normalizeText, simpleHash } from '~/logic/text'
import type { ContentBlock, ContentBlockKind, ContentDocument, ContentDocumentType, ContentPlatform } from '~/logic/types'

export interface ContentAdapter {
  platform: ContentPlatform
  label: string
  hosts: string[]
  match: (url: URL) => boolean
  isNsfw: (document: Document, url: URL) => boolean
  extract: (document: Document, url: URL) => ContentDocument | undefined
}

interface DocumentInput {
  platform: ContentPlatform
  contentType: ContentDocumentType
  canonicalId: string
  canonicalUrl: string
  title: string
  author?: string
  blocks: ContentBlock[]
  completeness: ContentDocument['completeness']
  coverage: string
  limitations?: string[]
  nsfw?: boolean
}

function clean(value: string | null | undefined) {
  return normalizeText(value ?? '')
}

function firstText(root: ParentNode, selectors: string[]) {
  for (const selector of selectors) {
    const value = clean(root.querySelector<HTMLElement>(selector)?.textContent)
    if (value)
      return value
  }
  return ''
}

function metaContent(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const value = clean(document.querySelector<HTMLMetaElement>(selector)?.content)
    if (value)
      return value
  }
  return ''
}

function uniqueTexts(root: ParentNode, selectors: string[], limit: number, minLength = 8) {
  const seen = new Set<string>()
  const texts: string[] = []
  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const text = clean(element.textContent)
      if (text.length < minLength || seen.has(text))
        continue
      if ([...seen].some(existing => existing.includes(text) || text.includes(existing)))
        continue

      seen.add(text)
      texts.push(text)
      if (texts.length >= limit)
        return texts
    }
  }
  return texts
}

function toBlocks(kind: ContentBlockKind, texts: string[], maxChars = 1800): ContentBlock[] {
  return texts.map((text, index) => ({
    id: `${kind}-${index}`,
    kind,
    text: text.slice(0, maxChars),
  }))
}

function canonicalUrl(url: URL, pathname: string, search = '') {
  return `${url.origin}${pathname}${search}`
}

function fallbackTitle(document: Document, platform: string) {
  return clean(metaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
    || document.title.replace(/\s*[-|].*$/, '')
    || platform)
}

function hasSensitiveMarker(document: Document, selectors: string[], patterns: RegExp[]) {
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 240)) {
      const marker = clean(`${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`)
      if (patterns.some(pattern => pattern.test(marker)))
        return true
    }
  }
  return false
}

const explicitNsfwPatterns = [/\bnsfw\b/i, /adult content/i, /18\s*\+/, /age[- ]restricted/i, /成人内容/, /未满\s*18\s*岁/, /限制级/, /敏感内容/]

function hasExplicitNsfwMarker(document: Document, platformSelectors: string[] = []) {
  const rating = metaContent(document, ['meta[name="rating"]', 'meta[property="og:restrictions:age"]'])
  return explicitNsfwPatterns.some(pattern => pattern.test(rating))
    || hasSensitiveMarker(document, [
      '[data-nsfw="true"]',
      '[class*="nsfw"]',
      '[aria-label*="NSFW"]',
      ...platformSelectors,
    ], explicitNsfwPatterns)
}

function makeDocument(input: DocumentInput): ContentDocument | undefined {
  const blocks = input.blocks
    .filter(block => clean(block.text).length >= (block.kind === 'metadata' ? 2 : 8))
    .slice(0, 100)
    .map((block, index) => ({ ...block, id: `${block.kind}-${index}`, text: clean(block.text) }))
  const title = clean(input.title)
  if (!title || !blocks.length)
    return undefined

  const sourceHash = simpleHash(JSON.stringify({
    title,
    author: clean(input.author),
    blocks: blocks.map(block => [block.kind, block.timestamp, block.text]),
    coverage: input.coverage,
  }))

  return {
    platform: input.platform,
    contentType: input.contentType,
    canonicalId: input.canonicalId,
    canonicalUrl: input.canonicalUrl,
    title,
    author: clean(input.author) || undefined,
    blocks,
    completeness: input.completeness,
    coverage: input.coverage,
    limitations: input.limitations ?? [],
    nsfw: input.nsfw ?? false,
    sourceHash,
  }
}

const redditAdapter: ContentAdapter = {
  platform: 'reddit',
  label: 'Reddit',
  hosts: ['reddit.com'],
  match: url => /\/comments\/[^/]+/i.test(url.pathname),
  isNsfw(document) {
    return Boolean(document.querySelector('shreddit-post[nsfw], [data-nsfw="true"]'))
      || hasSensitiveMarker(document, ['[data-testid*="nsfw"]', '[aria-label*="NSFW"]', '[class*="nsfw"]'], [/\bnsfw\b/i, /over 18/i, /成人内容/])
  },
  extract(document, url) {
    const id = url.pathname.match(/\/comments\/([^/]+)/i)?.[1]
    if (!id)
      return undefined

    const post = document.querySelector<HTMLElement>(`shreddit-post[post-id="${id}"]`)
      ?? document.querySelector<HTMLElement>('shreddit-post, [data-testid="post-container"], article')
      ?? document.body
    const title = firstText(post, ['[slot="title"]', '[data-testid="post-title"]', 'h1']) || fallbackTitle(document, 'Reddit')
    const author = firstText(post, ['[slot="authorName"]', '[data-testid="post_author_link"]', 'a[href*="/user/"]'])
    const body = uniqueTexts(post, ['[slot="text-body"]', '[data-post-click-location="text-body"]', '[data-click-id="text"]', '.md p'], 4)
    const replies = uniqueTexts(document, ['shreddit-comment [slot="comment"]', '[data-testid="comment"] p', '.Comment .md'], 10, 12)
    const blocks = [...toBlocks('body', body), ...toBlocks('reply', replies, 1200)]
    if (!body.length)
      blocks.unshift(...toBlocks('metadata', [metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])], 1200))

    return makeDocument({
      platform: 'reddit',
      contentType: 'discussion',
      canonicalId: id,
      canonicalUrl: canonicalUrl(url, url.pathname.match(/^(.*?\/comments\/[^/]+(?:\/[^/]+)?)/i)?.[1] ?? url.pathname),
      title,
      author,
      blocks,
      completeness: replies.length ? 'partial' : body.length ? 'partial' : 'metadata-only',
      coverage: `已读取主贴${replies.length ? `及 ${replies.length} 条已加载评论` : '；未读取到评论'}`,
      limitations: ['折叠、分页及尚未加载的评论不在摘要范围内'],
      nsfw: redditAdapter.isNsfw(document, url),
    })
  },
}

const xAdapter: ContentAdapter = {
  platform: 'x',
  label: 'X',
  hosts: ['x.com', 'twitter.com'],
  match: url => /\/status\/\d+/i.test(url.pathname),
  isNsfw(document) {
    return Boolean(document.querySelector('[data-testid="sensitiveMediaInterstitial"]'))
      || hasSensitiveMarker(document, ['article [role="button"]', 'article [data-testid*="sensitive"]'], [/sensitive content/i, /敏感内容/, /成人内容/])
  },
  extract(document, url) {
    const id = url.pathname.match(/\/status\/(\d+)/i)?.[1]
    if (!id)
      return undefined

    const articles = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"], article'))
    const target = articles.find(article => article.querySelector(`a[href*="/status/${id}"]`)) ?? articles[0]
    const threadTexts = articles
      .map(article => firstText(article, ['[data-testid="tweetText"]', 'div[lang]']))
      .filter(Boolean)
      .slice(0, 10)
    const primary = target ? firstText(target, ['[data-testid="tweetText"]', 'div[lang]']) : threadTexts[0]
    const replies = threadTexts.filter(text => text !== primary)
    const author = target ? firstText(target, ['[data-testid="User-Name"]', 'a[role="link"] span']) : ''
    const blocks = [...toBlocks('body', primary ? [primary] : []), ...toBlocks('reply', replies, 1200)]
    if (!blocks.length)
      blocks.push(...toBlocks('metadata', [metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])], 1200))

    return makeDocument({
      platform: 'x',
      contentType: 'social-post',
      canonicalId: id,
      canonicalUrl: canonicalUrl(url, url.pathname.match(/^(.*?\/status\/\d+)/i)?.[1] ?? url.pathname),
      title: primary?.slice(0, 100) || fallbackTitle(document, 'X'),
      author,
      blocks,
      completeness: primary ? 'partial' : 'metadata-only',
      coverage: `已读取当前帖子${replies.length ? `及 ${replies.length} 条页面内可见串文/回复` : '；未读取到串文或回复'}`,
      limitations: ['虚拟列表之外及尚未加载的回复不在摘要范围内'],
      nsfw: xAdapter.isNsfw(document, url),
    })
  },
}

function youtubeTranscriptBlocks(document: Document) {
  return Array.from(document.querySelectorAll<HTMLElement>('ytd-transcript-segment-renderer, [class*="transcript-segment"]'))
    .slice(0, 80)
    .map((segment, index): ContentBlock | undefined => {
      const text = firstText(segment, ['.segment-text', '[class*="segment-text"]', 'yt-formatted-string'])
      if (!text)
        return undefined
      return {
        id: `transcript-${index}`,
        kind: 'transcript',
        text: text.slice(0, 700),
        timestamp: firstText(segment, ['.segment-timestamp', '[class*="timestamp"]']) || undefined,
      }
    })
    .filter((block): block is ContentBlock => block != null)
}

const youtubeAdapter: ContentAdapter = {
  platform: 'youtube',
  label: 'YouTube',
  hosts: ['youtube.com', 'youtu.be'],
  match: url => Boolean(url.searchParams.get('v')) || /\/shorts\/[^/]+/i.test(url.pathname) || url.hostname === 'youtu.be',
  isNsfw(document) {
    return hasSensitiveMarker(document, ['yt-playability-error-supported-renderers', '#error-screen', '#reason'], [/age[- ]restricted/i, /成人内容/, /年龄限制/])
  },
  extract(document, url) {
    const id = url.searchParams.get('v') || url.pathname.match(/\/(?:shorts\/)?([^/]+)/i)?.[1]
    if (!id)
      return undefined

    const title = firstText(document, ['ytd-watch-metadata h1', '#title h1', 'h1.title']) || fallbackTitle(document, 'YouTube')
    const author = firstText(document, ['#owner #channel-name', 'ytd-channel-name', '#upload-info #channel-name'])
    const description = firstText(document, ['#description-inline-expander', '#description', 'ytd-text-inline-expander'])
      || metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])
    const transcript = youtubeTranscriptBlocks(document)
    const blocks = [...toBlocks('body', description ? [description] : [], 2400), ...transcript]

    return makeDocument({
      platform: 'youtube',
      contentType: 'video',
      canonicalId: id,
      canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      title,
      author,
      blocks,
      completeness: transcript.length ? 'partial' : 'metadata-only',
      coverage: transcript.length ? `已读取视频简介及 ${transcript.length} 段页面内可见字幕` : '仅读取视频标题和公开简介；未取得字幕',
      limitations: transcript.length ? ['未加载的字幕段和画面内容不在摘要范围内'] : ['没有字幕时不会根据标题推断完整视频内容'],
      nsfw: youtubeAdapter.isNsfw(document, url),
    })
  },
}

const bilibiliAdapter: ContentAdapter = {
  platform: 'bilibili',
  label: 'Bilibili',
  hosts: ['bilibili.com'],
  match: url => /\/video\/(?:BV|av)[a-z0-9]+/i.test(url.pathname),
  isNsfw(document) {
    return hasExplicitNsfwMarker(document, ['[class*="age-limit"]', '[class*="sensitive"]', '.video-error-panel', '.error-panel'])
  },
  extract(document, url) {
    const id = url.pathname.match(/\/video\/((?:BV|av)[a-z0-9]+)/i)?.[1]
    if (!id)
      return undefined

    const title = firstText(document, ['h1.video-title', '.video-info-title', 'h1']) || fallbackTitle(document, 'Bilibili')
    const author = firstText(document, ['.up-name', '.up-info-container .name', '.username'])
    const description = firstText(document, ['.basic-desc-info', '.desc-info-text', '.video-desc-container'])
      || metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])
    const transcriptTexts = uniqueTexts(document, ['.bpx-player-subtitle-panel-text', '.subtitle-item-text', '[class*="subtitle"] [class*="text"]'], 80, 2)
    const comments = uniqueTexts(document, ['.reply-content', '.root-reply .content-warp', 'bili-comment-renderer'], 6, 12)
    const blocks = [
      ...toBlocks('body', description ? [description] : [], 2400),
      ...toBlocks('transcript', transcriptTexts, 700),
      ...toBlocks('reply', comments, 1000),
    ]

    return makeDocument({
      platform: 'bilibili',
      contentType: 'video',
      canonicalId: id,
      canonicalUrl: `https://www.bilibili.com/video/${id}`,
      title,
      author,
      blocks,
      completeness: transcriptTexts.length ? 'partial' : 'metadata-only',
      coverage: transcriptTexts.length
        ? `已读取简介、${transcriptTexts.length} 段页面内可见字幕${comments.length ? `及 ${comments.length} 条可见评论` : ''}`
        : `仅读取标题、简介${comments.length ? `及 ${comments.length} 条可见评论` : ''}；未取得字幕`,
      limitations: ['弹幕不会作为视频正文；未加载字幕和画面内容不在摘要范围内'],
      nsfw: bilibiliAdapter.isNsfw(document, url),
    })
  },
}

const xiaohongshuAdapter: ContentAdapter = {
  platform: 'xiaohongshu',
  label: '小红书',
  hosts: ['xiaohongshu.com'],
  match: url => /\/(?:explore|discovery\/item)\/[^/]+/i.test(url.pathname),
  isNsfw(document) {
    return hasSensitiveMarker(document, ['[class*="warning"]', '[class*="sensitive"]', '[aria-label]'], [/\bnsfw\b/i, /成人内容/, /敏感内容/])
  },
  extract(document, url) {
    const id = url.pathname.match(/\/(?:explore|discovery\/item)\/([^/]+)/i)?.[1]
    if (!id)
      return undefined

    const title = firstText(document, ['#detail-title', '.note-content .title', '[class*="note"] h1', 'h1']) || fallbackTitle(document, '小红书')
    const author = firstText(document, ['.author-wrapper .name', '.username', '[class*="author"] [class*="name"]'])
    const body = firstText(document, ['#detail-desc', '.note-content .desc', '.desc', '[class*="note-content"]'])
      || metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]'])
    const comments = uniqueTexts(document, ['.comment-item .content', '.comment-inner-container .note-text', '[class*="comment"] [class*="content"]'], 8, 10)

    return makeDocument({
      platform: 'xiaohongshu',
      contentType: 'social-post',
      canonicalId: id,
      canonicalUrl: canonicalUrl(url, url.pathname),
      title,
      author,
      blocks: [...toBlocks('body', body ? [body] : [], 2800), ...toBlocks('reply', comments, 1000)],
      completeness: body ? 'partial' : 'metadata-only',
      coverage: `已读取笔记文字${comments.length ? `及 ${comments.length} 条已加载评论` : '；未读取到评论'}`,
      limitations: ['图片内文字、折叠及尚未加载的评论不在摘要范围内'],
      nsfw: xiaohongshuAdapter.isNsfw(document, url),
    })
  },
}

const zhihuAdapter: ContentAdapter = {
  platform: 'zhihu',
  label: '知乎',
  hosts: ['zhihu.com', 'zhuanlan.zhihu.com'],
  match: url => /\/(?:question|p)\/\d+/i.test(url.pathname),
  isNsfw(document) {
    return hasExplicitNsfwMarker(document, ['[class*="ContentWarning"]', '[class*="Sensitive"]', '[class*="content-warning"]'])
  },
  extract(document, url) {
    const articleId = url.pathname.match(/\/p\/(\d+)/i)?.[1]
    const questionId = url.pathname.match(/\/question\/(\d+)/i)?.[1]
    const answerId = url.pathname.match(/\/answer\/(\d+)/i)?.[1]
    const canonicalId = articleId ? `article:${articleId}` : answerId ? `answer:${questionId}:${answerId}` : questionId ? `question:${questionId}` : ''
    if (!canonicalId)
      return undefined

    const isArticle = Boolean(articleId)
    const title = firstText(document, ['h1.Post-Title', 'h1.QuestionHeader-title', '.QuestionHeader-title', 'h1']) || fallbackTitle(document, '知乎')
    const author = firstText(document, ['.AuthorInfo-name', '.Post-Author .UserLink-link', '[itemprop="author"]'])
    const answerRoot = answerId
      ? Array.from(document.querySelectorAll<HTMLElement>('.AnswerItem')).find(element => element.innerHTML.includes(`/answer/${answerId}`))
      : undefined
    const bodyRoot = answerRoot ?? document
    const body = uniqueTexts(bodyRoot, isArticle
      ? ['.Post-RichTextContainer .RichText', '.Post-RichText', 'article .RichContent-inner']
      : ['.AnswerItem .RichContent-inner', '.QuestionRichText', '.RichContent-inner'], answerId || isArticle ? 4 : 6, 20)
    const comments = uniqueTexts(document, ['.CommentContent', '.NestComment--rootComment .CommentContent'], 8, 10)

    return makeDocument({
      platform: 'zhihu',
      contentType: isArticle ? 'article' : 'discussion',
      canonicalId,
      canonicalUrl: canonicalUrl(url, articleId ? `/p/${articleId}` : answerId ? `/question/${questionId}/answer/${answerId}` : `/question/${questionId}`),
      title,
      author,
      blocks: [...toBlocks('body', body, 2200), ...toBlocks('reply', comments, 1000)],
      completeness: body.length ? 'partial' : 'metadata-only',
      coverage: isArticle
        ? `已读取文章正文${comments.length ? `及 ${comments.length} 条已加载评论` : ''}`
        : `已读取问题${answerId ? '及当前回答' : `及 ${body.length} 个已加载正文块`}${comments.length ? `、${comments.length} 条评论` : ''}`,
      limitations: ['折叠、付费及尚未加载的回答或评论不在摘要范围内'],
      nsfw: zhihuAdapter.isNsfw(document, url),
    })
  },
}

export const contentAdapters: ContentAdapter[] = [
  redditAdapter,
  xAdapter,
  youtubeAdapter,
  bilibiliAdapter,
  xiaohongshuAdapter,
  zhihuAdapter,
]

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function findContentAdapter(value = location.href) {
  try {
    const url = new URL(value)
    return contentAdapters.find(adapter => adapter.hosts.some(host => hostMatches(url.hostname, host)) && adapter.match(url))
  }
  catch {
    return undefined
  }
}

export function hasContentAdapterHost(hostname = location.hostname) {
  return contentAdapters.some(adapter => adapter.hosts.some(host => hostMatches(hostname, host)))
}

export function extractContentDocument(document: Document, value: string) {
  const adapter = findContentAdapter(value)
  if (!adapter)
    return undefined

  return adapter.extract(document, new URL(value))
}
