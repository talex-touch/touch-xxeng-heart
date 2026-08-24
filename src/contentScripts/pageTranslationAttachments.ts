const attachmentSelectors = [
  'a[download]',
  'a.attachment',
  '[data-attachment]',
  '[data-download-href]',
]

export function isAttachmentElement(element: Element) {
  return Boolean(element.closest(attachmentSelectors.join(',')))
}

export function isPageTranslationAttachment(element: HTMLElement) {
  const attachment = element.matches(attachmentSelectors.join(','))
    ? element
    : element.querySelector<HTMLElement>(attachmentSelectors.join(','))
  if (!attachment)
    return false

  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const attachmentText = attachment.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return text.length > 0 && text === attachmentText
}
