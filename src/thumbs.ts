// What the app works out about a pasted or dropped image or video before uploading it into a node: its size, and a
// smaller still (or a video's poster) for image mode's grid. Gifs keep no thumbnail so they animate (the server
// stores an animated one as an mp4, which plays like the gif).

/** Twice the default row height, so tiles stay sharp when zoomed in a little and on high-dpi screens. */
const THUMB_H = 400

export interface Prepared {
  /** Unknown for a video the browser can't decode. */
  width?: number
  height?: number
  thumb?: Blob
}

export async function prepare(file: File): Promise<Prepared> {
  if (file.type.startsWith('video/')) return videoPoster(file)
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) return {}
  try {
    const { width, height } = bmp
    // Small enough to show as is.
    if (file.type === 'image/gif' || height <= THUMB_H * 1.25) return { width, height }
    return { width, height, thumb: await encode(bmp, Math.max(1, Math.round((width * THUMB_H) / height)), THUMB_H) }
  } finally {
    bmp.close()
  }
}

function encode(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
}

/** A frame near the start. A video the browser can't decode is uploaded without a size or a poster. */
async function videoPoster(file: File): Promise<Prepared> {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  try {
    await once(v, 'loadeddata')
    v.currentTime = Math.min(0.1, (v.duration || 0) / 2)
    await once(v, 'seeked')
    const { videoWidth: width, videoHeight: height } = v
    if (!width || !height) return {}
    const h = Math.min(THUMB_H, height)
    return { width, height, thumb: await encode(v, Math.max(1, Math.round((width * h) / height)), h) }
  } catch {
    return {}
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

function once(el: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    el.addEventListener(event, () => resolve(), { once: true })
    el.addEventListener('error', () => reject(new Error('unreadable video')), { once: true })
  })
}

/** The upload form of a node image: the file, with its size and thumbnail when they could be worked out. */
export async function uploadForm(file: File): Promise<{ file: File; thumb?: File; width?: string; height?: string }> {
  const p = await prepare(file).catch((): Prepared => ({}))
  return {
    file,
    ...(p.thumb && { thumb: new File([p.thumb], 'thumb.webp', { type: p.thumb.type || 'image/webp' }) }),
    ...(p.width && p.height && { width: String(p.width), height: String(p.height) }),
  }
}
