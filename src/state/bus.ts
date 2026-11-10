import { api, unwrap } from '../api.ts'
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

const POLL_MS = 3000

/**
 * Changes made outside the app (a page captured with the browser extension) bump the server's revision: checked
 * every few seconds while the window is visible, and when it gets focus. A new one is a change.
 */
export function watchServerChanges() {
  let last: string | undefined
  const check = () => {
    if (document.visibilityState !== 'visible') return
    unwrap(api.revision.$get()).then(({ revision }) => {
      if (last !== undefined && revision !== last) emitChange('server')
      last = revision
    }, () => {})
  }
  check()
  setInterval(check, POLL_MS)
  window.addEventListener('focus', check)
}
