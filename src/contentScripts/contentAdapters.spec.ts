// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { extractContentDocument, findContentAdapter } from './contentAdapters'

function mount(html: string) {
  document.head.innerHTML = ''
  document.body.innerHTML = html
}

describe('content platform adapters', () => {
  beforeEach(() => mount(''))

  it('extracts a Reddit post and visible comments with an NSFW marker', () => {
    mount(`
      <shreddit-post post-id="abc123" nsfw>
        <h1 slot="title">Cache invalidation discussion</h1>
        <a slot="authorName">alice</a>
        <div slot="text-body">The post compares several cache invalidation strategies for a browser extension.</div>
      </shreddit-post>
      <shreddit-comment><div slot="comment">Use a source hash so changed content cannot reuse a fresh result.</div></shreddit-comment>
    `)

    const value = 'https://www.reddit.com/r/webdev/comments/abc123/cache_invalidation/'
    const adapter = findContentAdapter(value)
    const result = extractContentDocument(document, value)

    expect(adapter?.isNsfw(document, new URL(value))).toBe(true)
    expect(result).toMatchObject({ platform: 'reddit', contentType: 'discussion', canonicalId: 'abc123', nsfw: true })
    expect(result?.blocks.map(block => block.kind)).toContain('reply')
    expect(result?.coverage).toContain('1 条已加载评论')
  })

  it('extracts the target X post and visible thread replies', () => {
    mount(`
      <article data-testid="tweet">
        <a href="/alice/status/123456">status</a>
        <div data-testid="User-Name">Alice @alice</div>
        <div data-testid="tweetText">A concise explanation of optimistic updates.</div>
      </article>
      <article data-testid="tweet"><div data-testid="tweetText">A reply describing the rollback case.</div></article>
    `)

    const result = extractContentDocument(document, 'https://x.com/alice/status/123456?s=20')

    expect(result).toMatchObject({ platform: 'x', contentType: 'social-post', canonicalId: '123456' })
    expect(result?.canonicalUrl).toBe('https://x.com/alice/status/123456')
    expect(result?.blocks.some(block => block.kind === 'reply')).toBe(true)
  })

  it('uses visible YouTube transcript segments and timestamps', () => {
    mount(`
      <ytd-watch-metadata><h1>How browser caches work</h1></ytd-watch-metadata>
      <div id="owner"><div id="channel-name">Lexi Labs</div></div>
      <div id="description-inline-expander">A practical cache architecture walkthrough.</div>
      <ytd-transcript-segment-renderer><span class="segment-timestamp">0:12</span><span class="segment-text">Start with a canonical content identity.</span></ytd-transcript-segment-renderer>
      <ytd-transcript-segment-renderer><span class="segment-timestamp">1:05</span><span class="segment-text">Invalidate summaries with a source hash.</span></ytd-transcript-segment-renderer>
    `)

    const result = extractContentDocument(document, 'https://www.youtube.com/watch?v=video123')

    expect(result).toMatchObject({ platform: 'youtube', contentType: 'video', canonicalId: 'video123', completeness: 'partial' })
    expect(result?.blocks.find(block => block.kind === 'transcript')).toMatchObject({ timestamp: '0:12' })
    expect(result?.coverage).toContain('2 段')
  })

  it('falls back to Bilibili metadata when subtitles are unavailable', () => {
    mount(`
      <h1 class="video-title">浏览器扩展缓存实践</h1>
      <div class="up-name">Lexi UP</div>
      <div class="basic-desc-info">介绍摘要缓存、失效和并发去重。</div>
    `)

    const result = extractContentDocument(document, 'https://www.bilibili.com/video/BV1abc123')

    expect(result).toMatchObject({ platform: 'bilibili', contentType: 'video', canonicalId: 'BV1abc123', completeness: 'metadata-only' })
    expect(result?.coverage).toContain('未取得字幕')
  })

  it('detects explicit Bilibili age and sensitive-content warnings', () => {
    mount(`
      <h1 class="video-title">受限视频</h1>
      <div class="basic-desc-info">这是页面公开的视频简介，用于验证敏感内容拦截流程。</div>
      <div class="video-error-panel">成人内容，仅限 18+ 用户查看</div>
    `)

    const result = extractContentDocument(document, 'https://www.bilibili.com/video/BV1restricted')

    expect(result?.nsfw).toBe(true)
  })

  it('extracts a Xiaohongshu note and loaded comments', () => {
    mount(`
      <h1 id="detail-title">通勤背包使用笔记</h1>
      <div class="author-wrapper"><span class="name">小林</span></div>
      <div id="detail-desc">记录容量、肩带和防水表现，适合日常通勤。</div>
      <div class="comment-item"><div class="content">下雨天测试过，短时间防水表现不错。</div></div>
    `)

    const result = extractContentDocument(document, 'https://www.xiaohongshu.com/explore/note123?xsec_token=secret')

    expect(result).toMatchObject({ platform: 'xiaohongshu', contentType: 'social-post', canonicalId: 'note123' })
    expect(result?.canonicalUrl).toBe('https://www.xiaohongshu.com/explore/note123')
    expect(result?.coverage).toContain('1 条已加载评论')
  })

  it('extracts the current Zhihu answer without claiming all answers', () => {
    mount(`
      <h1 class="QuestionHeader-title">怎样设计可靠的本地缓存？</h1>
      <div class="AnswerItem">
        <a href="/question/42/answer/99">answer</a>
        <div class="AuthorInfo-name">陈工</div>
        <div class="RichContent-inner">缓存键需要包含内容身份，版本和模型指纹也要参与失效判断。</div>
      </div>
      <div class="CommentContent">还需要处理多个标签页同时请求的问题。</div>
    `)

    const result = extractContentDocument(document, 'https://www.zhihu.com/question/42/answer/99')

    expect(result).toMatchObject({ platform: 'zhihu', contentType: 'discussion', canonicalId: 'answer:42:99' })
    expect(result?.coverage).toContain('当前回答')
    expect(result?.limitations.join(' ')).toContain('尚未加载')
  })

  it('detects explicit Zhihu content warnings', () => {
    mount(`
      <h1 class="QuestionHeader-title">受限问题</h1>
      <div class="QuestionRichText">这是页面公开的问题描述内容，用于验证敏感标记会在正文抽取之前被拦截。</div>
      <div class="ContentWarning">敏感内容，仅限 18+ 用户查看</div>
    `)

    const result = extractContentDocument(document, 'https://www.zhihu.com/question/100')

    expect(result?.nsfw).toBe(true)
  })
})
