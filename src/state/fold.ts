import { persistedStore } from './store.ts'

// Folded journal entries (only their title and tags show), by entry id. Kept per browser, like the other view
// preferences; the oldest folds are dropped past MAX so the list can't grow without bound.

const MAX = 5000

export const foldStore = persistedStore<{ folded: string[] }>('fold.v1', { folded: [] }, (s) => {
  const folded = (s as { folded?: unknown })?.folded
  return { folded: Array.isArray(folded) ? folded.filter((x): x is string => typeof x === 'string') : [] }
})

export function setFolded(ids: string[], folded: boolean) {
  foldStore.set((s) => {
    const rest = s.folded.filter((id) => !ids.includes(id))
    const next = folded ? [...rest, ...ids].slice(-MAX) : rest
    return next.length === s.folded.length && next.every((id, i) => id === s.folded[i]) ? s : { folded: next }
  })
}

export const toggleFolded = (id: string) => setFolded([id], !foldStore.get().folded.includes(id))
