import type { EntryDTO } from '../shared/types.ts'
import { api, unwrap } from './api.ts'
import { openChat } from './state/ai.ts'
import { bookmarksNav } from './state/captures.ts'
import { emitChange } from './state/bus.ts'
import { journalStore, requestReveal } from './state/journal.ts'
import { activeJournalDate, openDate, openLoc, panesStore, parseKey, pluginKey } from './state/panes.ts'
import { notify, openNewEntry, type NewEntryDefaults } from './state/ui.ts'
import { openVideo } from './state/youtube.ts'

/** Creates an entry on the server, then opens its day and puts the caret in it. */
export async function createEntry(opts: NewEntryDefaults & { title?: string; content?: string; focus?: 'title' | 'node' }) {
  try {
    const entry = await unwrap(
      api.entries.$post({
        json: {
          date: opts.date,
          title: opts.title ?? '',
          tags: opts.tags,
          ...(opts.category ? { category: opts.category } : {}),
          ...(opts.afterEntryId ? { afterEntryId: opts.afterEntryId } : {}),
          ...(opts.content ? { nodes: [{ content: opts.content }] } : {}),
        },
      }),
    )
    emitChange()
    openDate(entry.date, { focus: true })
    requestReveal({ date: entry.date, entryId: entry.id, nodeId: entry.nodes[0]?.id, mode: opts.focus ?? 'title' })
    return entry
  } catch (err) {
    notify((err as Error).message)
  }
}

/**
 * Defaults for a new entry, inherited from where the user is: the journal cursor's entry
 * (same day, category and tags, placed right after it) or the tag open in the tags pane, when that has focus.
 */
export function newEntryDefaults(): NewEntryDefaults {
  const { focus, panes } = panesStore.get()
  const date = activeJournalDate()
  if (focus === 'tags') {
    const loc = parseKey(panes.tags.active)
    return { date, tags: loc.kind === 'tag' ? [loc.tag] : [] }
  }
  const cursor = journalStore.get().cursor
  if (cursor && cursor.date === date) return { date, category: cursor.category, tags: cursor.tags, afterEntryId: cursor.entryId }
  return { date, tags: [] }
}

export function newEntryAtCursor() {
  void createEntry(newEntryDefaults())
}

export function newEntryWithDialog() {
  openNewEntry(newEntryDefaults())
}

/**
 * Opens an entry that has a view of its own: an AI chat in the AI tab (at the prompt of `nodeId`), a video, a bookmark
 * or a media item in theirs. False for a journal entry, which shows in its day.
 */
export function openItem(entry: EntryDTO, nodeId?: string): boolean {
  if (entry.chat) {
    const turn = nodeId ? entry.chat.nodeIds.indexOf(nodeId) : -1
    openChat(entry.chat.id, turn >= 0 ? { turn } : {})
    return true
  }
  const d = entry.detail
  if (d?.kind === 'video') openVideo(d.id)
  else if (d?.kind === 'bookmark') bookmarksNav.open(d.id)
  else if (d?.kind === 'media') openLoc('canvas', pluginKey('images'))
  return !!d
}
