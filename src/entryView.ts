import type { EntryDTO, ImageDTO } from '../shared/types.ts'

// How an entry shows in a listing (a day, a tag view).

/** The picture an entry shows: its first node image. */
export const thumbOf = (e: EntryDTO): ImageDTO | undefined => e.nodes.find((n) => n.images.length)?.images[0]
