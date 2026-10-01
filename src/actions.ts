import { isChatTag } from '../shared/tags.ts'
import { api, unwrap } from './api.ts'
import { emitChange } from './state/bus.ts'
import { journalStore, requestReveal } from './state/journal.ts'
import { activeJournalDate, openDate, panesStore, parseKey } from './state/panes.ts'
import { notify, openNewEntry, type NewEntryDefaults } from './state/ui.ts'

/** Creates an entry on the server, then opens its day and puts the caret in it. */
export async function createEntry(opts: NewEntryDefaults & { title?: string; content?: string; focus?: 'title' | 'node' }) {
  try {
    const entry = await unwrap(
      api.entries.$post({
        json: {
          date: opts.date,
          title: opts.title ?? '',
          tags: opts.tags,
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
 * (same day, same tags, placed right after it) or the tag open in the tags pane. AI chat source
 * tags are not inherited: they belong to imported chats only.
 */
export function newEntryDefaults(): NewEntryDefaults {
  const { focus, panes } = panesStore.get()
  const date = activeJournalDate()
  if (focus === 'tags') {
    const loc = parseKey(panes.tags.active)
    return { date, tags: loc.kind === 'tag' && !isChatTag(loc.tag) ? [loc.tag] : [] }
  }
  const cursor = journalStore.get().cursor
  if (cursor && cursor.date === date) return { date, tags: cursor.tags.filter((t) => !isChatTag(t)), afterEntryId: cursor.entryId }
  return { date, tags: [] }
}

export function newEntryAtCursor() {
  void createEntry(newEntryDefaults())
}

export function newEntryWithDialog() {
  openNewEntry(newEntryDefaults())
}
