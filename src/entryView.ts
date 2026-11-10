import { SUBTYPE_LABEL, TYPE_LABEL, typeRef } from '../shared/entryTypes.ts'
import type { EntryDTO, ImageDTO } from '../shared/types.ts'

// How an entry of any type shows in a listing (a day, a tag view).

/** "Reddit", "Images"…; the type's name when it has no subtype. */
export const typeLabel = (e: Pick<EntryDTO, 'type' | 'subtype'>) => SUBTYPE_LABEL[typeRef(e.type, e.subtype)] ?? TYPE_LABEL[e.type]

/** The picture an entry shows: a node's first image, a bookmark's thumbnail, a media item itself. */
export function thumbOf(e: EntryDTO): ImageDTO | undefined {
  const d = e.detail
  if (d?.kind === 'bookmark') return d.thumbUrl ? { id: d.id, url: d.thumbUrl, mime: 'image/jpeg' } : undefined
  if (d?.kind === 'media') return d.thumbUrl ? { id: d.id, url: d.thumbUrl, mime: 'image/jpeg' } : { id: d.id, url: d.url, mime: d.mime }
  return e.nodes.find((n) => n.images.length)?.images[0]
}
