import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { formatJournalDate } from '../../shared/dates.ts'
import { isVideo, type EntryDTO } from '../../shared/types.ts'
import { JOURNALS_DIR } from '../db/client.ts'
import { entriesForDate } from './content.ts'

// Mirrors each journal day to journals/YYYY_MM_DD.md. The database is the source of truth;
// the files keep the notes readable (and greppable) without the app.

const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined

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
