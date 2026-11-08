import { SUBTYPE_LABEL, TYPE_LABEL, typeRef } from '../shared/entryTypes.ts'
import type { EntryDTO, ImageDTO } from '../shared/types.ts'

// How an entry of any type shows in a listing (a day, a tag view).

/** "YouTube", "Reddit", "Claude Code"…; the type's name when it has no subtype. */
export const typeLabel = (e: Pick<EntryDTO, 'type' | 'subtype'>) => SUBTYPE_LABEL[typeRef(e.type, e.subtype)] ?? TYPE_LABEL[e.type]

/** The picture an entry shows: a node's first image, a video's or bookmark's thumbnail, a media item itself. */
export function thumbOf(e: EntryDTO): ImageDTO | undefined {
  const d = e.detail
  if (d?.kind === 'video') return { id: d.id, url: d.thumbUrl ?? `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`, mime: 'image/jpeg' }
  if (d?.kind === 'bookmark') return d.thumbUrl ? { id: d.id, url: d.thumbUrl, mime: 'image/jpeg' } : undefined
  if (d?.kind === 'media') return d.thumbUrl ? { id: d.id, url: d.thumbUrl, mime: 'image/jpeg' } : { id: d.id, url: d.url, mime: d.mime }
  return e.nodes.find((n) => n.images.length)?.images[0]
}
