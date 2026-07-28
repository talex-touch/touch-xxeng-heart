const maxSnapshotSize = 960

/**
 * Downscales a video frame or image into a JPEG data URL for the vision model.
 *
 * Callers pass the element's intrinsic size because `<video>` reports it as
 * `videoWidth/videoHeight` while `<img>` uses `naturalWidth/naturalHeight` — the only
 * thing that differed between the two copies this replaces.
 * Returns `undefined` for unloaded media or a tainted (cross-origin) canvas.
 */
export function elementToDataUrl(
  element: CanvasImageSource,
  intrinsicWidth: number,
  intrinsicHeight: number,
) {
  if (!intrinsicWidth || !intrinsicHeight)
    return undefined

  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, maxSnapshotSize / Math.max(intrinsicWidth, intrinsicHeight))
    canvas.width = Math.max(1, Math.round(intrinsicWidth * scale))
    canvas.height = Math.max(1, Math.round(intrinsicHeight * scale))

    const context = canvas.getContext('2d')
    if (!context)
      return undefined

    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  }
  catch {
    // Cross-origin media taints the canvas; the caller falls back to metadata only.
    return undefined
  }
}
