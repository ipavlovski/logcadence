import { useEffect, useRef } from 'react'
import { today } from '../../shared/dates.ts'
import { journalDateOf, openDate, panesStore } from './panes.ts'
import { createStore, useStore } from './store.ts'
import { prefsStore, setPref } from './ui.ts'

// The canvas tabs and the journal's day (Settings → Canvas, ctrl+l). Following, the day tabs (Map, Spotify,
// Activity) show the journal's day and step it along, and the scrolling tabs (YouTube, Reddit, Bookmarks,
// Progress, AI chats) scroll to it whenever it changes. Not following, the day tabs share a day of their own and
// the journal is browsed separately.

/** The day tabs' own day while not following. Starts on today. */
const ownDay = createStore(today())

/** Tabs that keep their scroll position in a store: the journal day each one last scrolled to. */
const synced = new Map<string, string>()

export const followsJournal = () => prefsStore.get().canvasFollowsJournal

export function setFollowJournal(on: boolean) {
  // Unfollowing keeps the day in view; following again scrolls every tab to the journal's day.
  if (!on) ownDay.set(() => journalDateOf(panesStore.get()))
  else synced.clear()
  setPref('canvasFollowsJournal', on)
}

export const toggleFollowJournal = () => setFollowJournal(!followsJournal())

/** A day tab's day, and the way to move it: the journal's while following, else the canvas's own. */
export function useCanvasDay(): [string, (date: string) => void] {
  const follows = useStore(prefsStore, (s) => s.canvasFollowsJournal)
  const journal = useStore(panesStore, journalDateOf)
  const own = useStore(ownDay, (d) => d)
  return follows ? [journal, (d) => openDate(d)] : [own, (d) => ownDay.set(() => d)]
}

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
