import { api, unwrap } from './api.ts'
import { emitChange } from './state/bus.ts'
import { journalStore, requestReveal } from './state/journal.ts'
import { parseQuery } from '../shared/query.ts'
import { activeJournalDate, openDate, panesStore, tabQuery } from './state/panes.ts'
import { notify, openNewEntry, type NewEntryDefaults } from './state/ui.ts'
import { uploadForm } from './thumbs.ts'

/** Creates an entry on the server, then opens its day and puts the caret in it. */
export async function createEntry(opts: NewEntryDefaults & { title?: string; content?: string; focus?: 'title' | 'node' | 'flash' }) {
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
 * (same day, category and tags, placed right after it) or the query open in the tags pane (its category and tags), when that has focus.
 */
export function newEntryDefaults(): NewEntryDefaults {
  const s = panesStore.get()
  const date = activeJournalDate()
  if (s.focus === 'tags') {
    const q = parseQuery(tabQuery(s, s.panes.tags.active))
    return { date, category: q.category ?? null, tags: q.tags ?? [] }
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

/** Images pasted with nothing being edited: a new entry at the cursor (as ctrl+n's), its first node holding them. */
export async function pasteAsEntry(files: File[]) {
  const entry = await createEntry({ ...newEntryDefaults(), focus: 'flash' })
  const node = entry?.nodes[0]
  if (!node) return
  for (const file of files)
    try {
      const form = (await uploadForm(file)) as Parameters<(typeof api.nodes)[':id']['images']['$post']>[0]['form']
      await unwrap(api.nodes[':id'].images.$post({ param: { id: node.id }, form }))
      emitChange()
    } catch (err) {
      notify((err as Error).message)
    }
}
