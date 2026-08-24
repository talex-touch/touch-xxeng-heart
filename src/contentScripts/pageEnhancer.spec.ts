// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isPageTranslationAttachment } from './pageTranslationAttachments'

describe('isPageTranslationAttachment', () => {
  it('excludes attachment-only download rows while retaining adjacent prose with a normal link', () => {
    document.body.innerHTML = `
      <main>
        <p id="discourse-upload"><a class="attachment" href="/uploads/short-url/release-notes.pdf">release-notes.pdf</a></p>
        <p id="download"><a download href="/downloads/guide.pdf">guide.pdf</a></p>
        <p id="prose">Read the <a href="/docs/translation">translation guide</a> before enabling this feature on a production page.</p>
      </main>
    `

    const discourseUpload = document.querySelector<HTMLElement>('#discourse-upload')
    const download = document.querySelector<HTMLElement>('#download')
    const prose = document.querySelector<HTMLElement>('#prose')

    expect(discourseUpload).not.toBeNull()
    expect(download).not.toBeNull()
    expect(prose).not.toBeNull()
    expect(isPageTranslationAttachment(discourseUpload!)).toBe(true)
    expect(isPageTranslationAttachment(download!)).toBe(true)
    expect(isPageTranslationAttachment(prose!)).toBe(false)
  })
})
