import { useEffect, useRef } from 'react'
import { journalDateOf, panesStore } from './panes.ts'
import { useStore } from './store.ts'
import { prefsStore, setPref } from './ui.ts'

// The canvas tabs and the journal's day (Settings → Canvas, ctrl+l). Following, the scrolling tabs (YouTube,
// Bookmarks, AI chats) scroll to the journal tab's day whenever it changes. Not following, they keep
// their own place.

/** Tabs that keep their scroll position in a store: the journal day each one last scrolled to. */
const synced = new Map<string, string>()

export const followsJournal = () => prefsStore.get().canvasFollowsJournal

export function setFollowJournal(on: boolean) {
  // Following again scrolls every tab to the journal's day.
  if (on) synced.clear()
  setPref('canvasFollowsJournal', on)
}

export const toggleFollowJournal = () => setFollowJournal(!followsJournal())

/**
 * A scrolling tab, while following: calls `scrollTo` with the journal's day once `ready`, and again whenever that
 * day changes. With `key`, a tab whose position is kept in a store (it survives the tab being switched away)
 * scrolls only when the day has changed since; without, each mount scrolls.
 */
export function useFollowJournal(scrollTo: (date: string) => void, { ready = true, key }: { ready?: boolean; key?: string } = {}) {
  const follows = useStore(prefsStore, (s) => s.canvasFollowsJournal)
  const date = useStore(panesStore, journalDateOf)
  const last = useRef<string | null>(null)
  const fn = useRef(scrollTo)
  fn.current = scrollTo
  useEffect(() => {
    if (!follows || !ready) return
    if ((key ? synced.get(key) : last.current) === date) return
    if (key) synced.set(key, date)
    else last.current = date
    fn.current(date)
  }, [follows, ready, date, key])
}
