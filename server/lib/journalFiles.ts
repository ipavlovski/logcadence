import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { formatJournalDate } from '../../shared/dates.ts'
import { isVideo, type EntryDTO } from '../../shared/types.ts'
import { JOURNALS_DIR } from '../db/client.ts'
import { entriesForDate } from './content.ts'

// Mirrors each journal day to journals/YYYY_MM_DD.md. The database is the source of truth;
// the files keep the notes readable (and greppable) without the app.

const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined

// Bumped when what the mirror holds changes, so a library's files are all rewritten on the next start:
// 2: AI chats left the journal (0017_split_ai_youtube); entries carry category:: lines (0016_unified_entries).
// 3: bookmarks and the image board's days are entries of their days, captured pages with a url:: line (0018_entries_only).
// 4: the fabrication category is called fab (0019_fab_category).
// 5: entries' tags lose their category's (0020_category_tags).
const MIRROR_VERSION = '5'
const VERSION_FILE = () => path.join(JOURNALS_DIR, '.mirror-version')

/**
 * Rewrites the whole mirror when it is missing (e.g. after a data import) or older than MIRROR_VERSION: every day
 * with entries, and every file already there (a day left without entries loses its file).
 */
export function refreshMirror(datesWithEntries: () => string[]) {
  const files = readdirSync(JOURNALS_DIR).filter((f) => /^\d{4}_\d{2}_\d{2}\.md$/.test(f))
  const current = existsSync(VERSION_FILE()) && readFileSync(VERSION_FILE(), 'utf8').trim() === MIRROR_VERSION
  if (files.length && current) return
  touchDates(...datesWithEntries(), ...files.map((f) => f.slice(0, 10).replaceAll('_', '-')))
  writeFileSync(VERSION_FILE(), MIRROR_VERSION)
}

export function touchDates(...dates: string[]) {
  for (const d of dates) pending.add(d)
  timer ??= setTimeout(flushJournalFiles, 300)
}

export function flushJournalFiles() {
  clearTimeout(timer)
  timer = undefined
  for (const date of pending) {
    const file = path.join(JOURNALS_DIR, `${date.replaceAll('-', '_')}.md`)
    try {
      const list = entriesForDate(date)
      if (list.length) writeFileSync(file, renderJournal(date, list))
      else rmSync(file, { force: true })
    } catch (err) {
      console.error(`journal mirror failed for ${date}:`, err)
    }
  }
  pending.clear()
}

const indent = (text: string, pad: string) => text.replaceAll('\n', '\n' + pad)

export function renderJournal(date: string, list: EntryDTO[]): string {
  const out = [`# ${formatJournalDate(date)}`, '']
  for (const e of list) {
    out.push(`## ${e.title || '(untitled)'}`)
    if (e.source) out.push(`url:: ${e.source.url}`)
    if (e.category) out.push(`category:: ${e.category}`)
    if (e.tags.length) out.push(`tags:: ${e.tags.join(', ')}`)
    if (e.archived) out.push('archived:: true')
    out.push(`id:: ${e.id}`, '')
    for (const n of e.nodes) {
      out.push(`- ${indent(n.content, '  ')}${n.archived ? ' <!-- archived -->' : ''}`)
      for (const img of n.images) out.push(isVideo(img) ? `  [video](..${img.url})` : `  ![](..${img.url})`)
    }
    out.push('')
  }
  return out.join('\n')
}
