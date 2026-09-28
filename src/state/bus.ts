import { createStore, useStore } from './store.ts'

// Content-change notifications. Every successful mutation bumps the revision; views refetch
// when it changes. A view that applies its own mutations optimistically passes its origin
// so it only reacts to changes made elsewhere (otherwise a slow refetch could drop an insert).

const revision = createStore(0)
const log: { rev: number; origin: string }[] = []

export function emitChange(origin = 'global') {
  const rev = revision.get() + 1
  log.push({ rev, origin })
  if (log.length > 200) log.splice(0, log.length - 200)
  revision.set(() => rev)
}

/** Latest revision, or with `origin`, the latest one caused by someone else. */
export function useRevision(origin?: string): number {
  const rev = useStore(revision, (r) => r)
  if (!origin) return rev
  for (let i = log.length - 1; i >= 0; i--) if (log[i]!.origin !== origin) return log[i]!.rev
  return 0
}
