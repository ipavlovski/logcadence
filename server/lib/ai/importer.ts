import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { toIsoDate } from '../../../shared/dates.ts'
import type { ChatDTO, ChatMessage, ChatSource, ChatSummary, ImportCounts, ImportReport } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { chats, entries, nodes } from '../../db/content-schema.ts'
import { entryPositionAfter, setEntryTags } from '../content.ts'
import { logEvent } from '../events.ts'
import { touchDates } from '../journalFiles.ts'
import { listAntigravity, parseAntigravity } from './antigravity.ts'
import { oneLine, type ParsedChat } from './chat.ts'
import { isClaudeExport, parseClaudeExport } from './claudeExport.ts'
import { desktopTitles, parseClaudeCode } from './claudeCode.ts'
import { isGeminiActivity, parseGeminiActivity } from './geminiTakeout.ts'
import { antigravityRoots, claudeCodeFiles, claudeDesktopSessionFiles, exportFiles } from './sources.ts'
import { isZip, withZip, type ZipMember } from './zip.ts'

// Imported chats become journal entries: titled like the chat, tagged ai:<source>, dated the
// day the chat started, one node per prompt (the prompt plus a preview of the reply).

const PROMPT_MAX = 600
const PREVIEW_MAX = 280

export const chatTag = (source: ChatSource) => `ai:${source}`

interface Turn {
  prompt: ChatMessage
  replies: ChatMessage[]
}

function toTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = []
  for (const m of messages) {
    if (m.role === 'user') turns.push({ prompt: m, replies: [] })
    else turns.at(-1)?.replies.push(m)
  }
  return turns
}

/** Cuts long markdown, closing a code fence left open by the cut. */
function clipMarkdown(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max)
  const br = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '))
  if (br > max * 0.6) cut = cut.slice(0, br)
  const fences = cut.split('\n').filter((l) => l.startsWith('```')).length
  return fences % 2 ? `${cut.trimEnd()}\n\`\`\`\n…` : `${cut.trimEnd()}…`
}

function preview(md: string): string {
  const flat = md
    .replace(/```[\s\S]*?(```|$)/g, ' [code] ')
    .replace(/^\s*(\|?\s*:?-{3,}:?\s*)+\|?\s*$/gm, '') // rules and table separators
    .replace(/^\s{0,3}(#+|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/\*\*/g, '')
  return oneLine(flat, PREVIEW_MAX)
}

/** A node for one turn. The last reply text is the most useful preview: agents end with a summary. */
export function turnContent(t: Turn): string {
  const prompt = clipMarkdown(t.prompt.text, PROMPT_MAX)
  const reply = t.replies.findLast((m) => m.text)?.text
  const tools = t.replies.reduce((n, m) => n + (m.tools?.length ?? 0), 0)
  const tail = reply ? preview(reply) : tools ? `(${tools} tool call${tools === 1 ? '' : 's'})` : ''
  return tail ? `${prompt}\n\n→ ${tail}` : prompt
}

const titleOf = (p: ParsedChat, turns: Turn[]) => oneLine(p.title || turns[0]!.prompt.text, 120)

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped'

export function upsertChat(p: ParsedChat, stamp: string | null = null): Outcome {
  const id = `${p.source}:${p.externalId}`
  const turns = toTurns(p.messages)
  if (!turns.length) return 'skipped'
  const title = titleOf(p, turns)
  const contents = turns.map(turnContent)
  const now = Date.now()
  const existing = db.select().from(chats).where(eq(chats.id, id)).get()
  const row = { title, startedAt: p.startedAt, updatedAt: p.updatedAt, turns: turns.length, messages: p.messages, meta: p.meta, sourceStamp: stamp, importedAt: now }

  if (!existing) {
    const date = toIsoDate(new Date(p.startedAt))
    const entryId = randomUUID()
    const nodeIds = contents.map(() => randomUUID())
    const tags = db.transaction(() => {
      db.insert(entries)
        .values({ id: entryId, date, title, position: entryPositionAfter(date, undefined), createdAt: now, updatedAt: now })
        .run()
      contents.forEach((content, i) =>
        db
          .insert(nodes)
          .values({ id: nodeIds[i]!, entryId, content, position: i + 1, createdAt: now, updatedAt: now })
          .run(),
      )
      db.insert(chats)
        .values({ id, source: p.source, externalId: p.externalId, entryId, nodeIds, ...row })
        .run()
      return setEntryTags(entryId, [chatTag(p.source)])
    })
    logEvent('entry', entryId, 'create', { date, title, tags, chatId: id })
    contents.forEach((content, i) => logEvent('node', nodeIds[i]!, 'create', { entryId, content }))
    touchDates(date)
    return 'created'
  }

  const same = existing.title === title && existing.turns === turns.length && JSON.stringify(existing.messages) === JSON.stringify(p.messages)
  if (same || p.updatedAt < existing.updatedAt) {
    if (stamp && stamp !== existing.sourceStamp) db.update(chats).set({ sourceStamp: stamp }).where(eq(chats.id, id)).run()
    return 'unchanged'
  }

  // Refresh the entry, but never over the user's edits: only a title or node that still reads
  // exactly as the previous import wrote it is rewritten. New turns are appended.
  const entry = existing.entryId ? db.select().from(entries).where(eq(entries.id, existing.entryId)).get() : undefined
  const oldContents = toTurns(existing.messages).map(turnContent)
  const nodeIds = [...existing.nodeIds]
  const edits: { id: string; content: string }[] = []
  const inserts: { id: string; content: string; position: number }[] = []
  const retitle = !!entry && entry.title === existing.title && title !== existing.title
  if (entry) {
    const current = new Map(
      db
        .select({ id: nodes.id, content: nodes.content })
        .from(nodes)
        .where(inArray(nodes.id, nodeIds.length ? nodeIds : ['']))
        .all()
        .map((n) => [n.id, n.content]),
    )
    let position =
      db
        .select({ p: sql<number | null>`max(${nodes.position})` })
        .from(nodes)
        .where(eq(nodes.entryId, entry.id))
        .get()?.p ?? 0
    contents.forEach((content, i) => {
      if (i < nodeIds.length) {
        if (current.get(nodeIds[i]!) === oldContents[i] && content !== oldContents[i]) edits.push({ id: nodeIds[i]!, content })
      } else {
        const node = { id: randomUUID(), content, position: ++position }
        inserts.push(node)
        nodeIds.push(node.id)
      }
    })
  }

  db.transaction(() => {
    db.update(chats)
      .set({ ...row, nodeIds })
      .where(eq(chats.id, id))
      .run()
    if (!entry) return
    if (retitle) db.update(entries).set({ title, updatedAt: now }).where(eq(entries.id, entry.id)).run()
    for (const e of edits) db.update(nodes).set({ content: e.content, updatedAt: now }).where(eq(nodes.id, e.id)).run()
    for (const n of inserts)
      db.insert(nodes)
        .values({ id: n.id, entryId: entry.id, content: n.content, position: n.position, createdAt: now, updatedAt: now })
        .run()
  })
  if (entry) {
    if (retitle) logEvent('entry', entry.id, 'edit', { title })
    for (const e of edits) logEvent('node', e.id, 'edit', { content: e.content })
    for (const n of inserts) logEvent('node', n.id, 'create', { entryId: entry.id, content: n.content })
    touchDates(entry.date)
  }
  return 'updated'
}

// ── reports ────────────────────────────────────────────────────────────────

function counts(report: ImportReport, source: ChatSource): ImportCounts {
  return (report[source] ??= { found: 0, created: 0, updated: 0, unchanged: 0, errors: [] })
}

function tally(report: ImportReport, source: ChatSource, outcome: Outcome) {
  if (outcome === 'skipped') return
  const c = counts(report, source)
  c.found++
  c[outcome]++
}

function importParsed(report: ImportReport, list: ParsedChat[]) {
  for (const p of [...list].sort((a, b) => a.startedAt - b.startedAt)) tally(report, p.source, upsertChat(p))
}

const stampOf = (file: string) => {
  const st = statSync(file)
  return `${Math.round(st.mtimeMs)}:${st.size}`
}

const storedStamps = (ids: string[]) =>
  new Map(
    ids.length
      ? db
          .select({ id: chats.id, stamp: chats.sourceStamp })
          .from(chats)
          .where(inArray(chats.id, ids))
          .all()
          .map((r) => [r.id, r.stamp])
      : [],
  )

// ── exports (Claude data export, Google Takeout) ───────────────────────────

/** Imports chats from export files (zip or JSON); members that are not chat exports are ignored. */
function importMembers(report: ImportReport, members: ZipMember[], label: string) {
  let recognized = false
  for (const m of members) {
    const base = m.name.split('/').at(-1)!
    if (base === 'conversations.json' || (/MyActivity\.json$/i.test(m.name) && /gemini/i.test(m.name))) {
      recognized = true
      importJson(report, m.read().toString('utf8'))
    } else if (/MyActivity\.html$/i.test(m.name) && /gemini/i.test(m.name)) {
      recognized = true
      counts(report, 'gemini').errors.push(`${label}: Takeout was exported as HTML; export “My Activity” again with format JSON`)
    }
  }
  return recognized
}

function importJson(report: ImportReport, text: string): boolean {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return false
  }
  if (isClaudeExport(data)) importParsed(report, parseClaudeExport(data))
  else if (isGeminiActivity(data)) importParsed(report, parseGeminiActivity(data))
  else return false
  return true
}

/** An uploaded file: Claude export (zip / conversations.json), Takeout (zip / MyActivity.json) or a Claude Code .jsonl. */
export async function importUpload(name: string, buf: Buffer): Promise<ImportReport> {
  const report: ImportReport = {}
  if (isZip(buf)) {
    if (!withZip(buf, (members) => importMembers(report, members, name))) throw new Error(`${name}: no conversations.json or Gemini MyActivity.json inside`)
  } else if (name.endsWith('.jsonl')) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-'))
    try {
      const file = path.join(dir, path.basename(name))
      writeFileSync(file, buf)
      const p = await parseClaudeCode(file)
      if (p) tally(report, 'claude-code', upsertChat(p))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } else if (!importJson(report, buf.toString('utf8'))) throw new Error(`${name}: not a Claude export, Gemini Takeout or Claude Code transcript`)
  return report
}

// ── scan of local sources ──────────────────────────────────────────────────

let running: Promise<ImportReport> | null = null

/** Imports everything found on this machine. Concurrent calls share one run. */
export function scanLocal(): Promise<ImportReport> {
  return (running ??= doScan().finally(() => (running = null)))
}

async function doScan(): Promise<ImportReport> {
  const report: ImportReport = {}
  const fail = (source: ChatSource, what: string, err: unknown) => counts(report, source).errors.push(`${what}: ${(err as Error).message}`)

  // Claude Code: skip transcripts whose file has not changed since the last import.
  const files = claudeCodeFiles()
  const titles = desktopTitles(claudeDesktopSessionFiles())
  const known = storedStamps(files.map((f) => `claude-code:${f.sessionId}`))
  for (const f of files) {
    try {
      const stamp = stampOf(f.file)
      if (known.get(`claude-code:${f.sessionId}`) === stamp) {
        tally(report, 'claude-code', 'unchanged')
        continue
      }
      const p = await parseClaudeCode(f.file, titles, f.origin)
      if (p) tally(report, 'claude-code', upsertChat(p, stamp))
    } catch (err) {
      fail('claude-code', path.basename(f.file), err)
    }
  }

  for (const root of antigravityRoots()) {
    try {
      const convs = listAntigravity(root)
      const seen = storedStamps(convs.map((c) => `antigravity:${c.id}`))
      for (const c of convs) {
        try {
          const stamp = `${stampOf(c.file)}:${c.title}`
          if (seen.get(`antigravity:${c.id}`) === stamp) {
            tally(report, 'antigravity', 'unchanged')
            continue
          }
          const p = parseAntigravity(c)
          if (p) tally(report, 'antigravity', upsertChat(p, stamp))
        } catch (err) {
          fail('antigravity', c.title || c.id, err)
        }
      }
    } catch (err) {
      fail('antigravity', root, err)
    }
  }

  for (const file of exportFiles()) {
    try {
      if (file.endsWith('.json')) importJson(report, readFileSync(file, 'utf8'))
      else withZip(file, (members) => importMembers(report, members, path.basename(file)))
    } catch (err) {
      fail(/takeout/i.test(file) ? 'gemini' : 'claude', path.basename(file), err)
    }
  }
  return report
}

// ── queries ────────────────────────────────────────────────────────────────

const summaryCols = {
  id: chats.id,
  source: chats.source,
  title: chats.title,
  startedAt: chats.startedAt,
  updatedAt: chats.updatedAt,
  turns: chats.turns,
  entryId: chats.entryId,
  entryDate: entries.date,
}

type SummaryRow = { id: string; source: string; title: string; startedAt: number; updatedAt: number; turns: number; entryId: string | null; entryDate: string | null }

const toSummary = ({ entryDate, ...r }: SummaryRow): ChatSummary => ({
  ...r,
  source: r.source as ChatSource,
  date: entryDate ?? toIsoDate(new Date(r.startedAt)),
})

export function listChats(): ChatSummary[] {
  return db.select(summaryCols).from(chats).leftJoin(entries, eq(entries.id, chats.entryId)).orderBy(desc(chats.startedAt)).all().map(toSummary)
}

export function getChat(id: string): ChatDTO | undefined {
  const r = db
    .select({ ...summaryCols, messages: chats.messages, meta: chats.meta })
    .from(chats)
    .leftJoin(entries, eq(entries.id, chats.entryId))
    .where(eq(chats.id, id))
    .get()
  if (!r) return undefined
  const { messages, meta, ...rest } = r
  return { ...toSummary(rest), messages, meta }
}
