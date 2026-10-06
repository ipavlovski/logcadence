import type { ClipboardEvent } from 'react'

// Pasting and dropping images, gifs and videos into a gallery (journal nodes, YouTube notes).

export const mediaFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type))

/** Pasted text that is just the path of a media file, as some tools put next to a copied file. */
const MEDIA_PATH = /^[^\n]+\.(png|jpe?g|gif|webp|mp4|webm|mov|mkv)"?$/i

/** Hands pasted media to `onFiles`; any other paste goes on as usual. */
export function pasteMedia(e: ClipboardEvent, onFiles: (files: File[]) => void) {
  const files = mediaFiles(e.clipboardData.files)
  if (files.length) {
    e.preventDefault()
    onFiles(files)
    return
  }
  // A file copied as a file (Explorer, ShareX recordings) may not reach the page; the desktop app reads it.
  const desktop = window.desktop
  const text = e.clipboardData.getData('text/plain').trim()
  if (!desktop || (text && !MEDIA_PATH.test(text))) return
  e.preventDefault()
  void desktop.clipboardFile().then((f) => {
    if (f) onFiles([new File([f.data as Uint8Array<ArrayBuffer>], f.name, { type: f.type })])
    else if (text) document.execCommand('insertText', false, text)
  })
}
