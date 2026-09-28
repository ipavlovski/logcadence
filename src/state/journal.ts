import { createStore } from './store.ts'

// Where the journal "cursor" is (last focused entry), used to inherit tags for new entries,
// and pending requests to reveal an entry/node once its day has loaded.

export interface Cursor {
  date: string
  entryId: string
  tags: string[]
}

export interface Reveal {
  date: string
  entryId: string
  nodeId?: string
  /** title/node: put the caret there; flash: scroll to and highlight. */
  mode: 'title' | 'node' | 'flash'
}

export const journalStore = createStore<{ cursor: Cursor | null; reveal: Reveal | null }>({ cursor: null, reveal: null })

export function setCursor(cursor: Cursor | null) {
  journalStore.set((s) =>
    s.cursor?.entryId === cursor?.entryId && s.cursor?.tags.join() === cursor?.tags.join() && s.cursor?.date === cursor?.date ? s : { ...s, cursor },
  )
}

export function requestReveal(reveal: Reveal | null) {
  journalStore.set((s) => ({ ...s, reveal }))
}
