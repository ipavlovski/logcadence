import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ms, toolCall, Transcript, type ParsedChat } from './chat.ts'
import { Msg, timestampMs } from './protobuf.ts'

// Antigravity (~/.gemini/antigravity) keeps a sqlite index of conversations with the titles
// shown in the app (conversation_summaries.db) and one sqlite file per conversation whose
// `steps` rows hold protobuf payloads. Field numbers below were read off real files:
//   step.5.1          timestamp
//   type 14 (user)    step.19.2 prompt text
//   type 15 (agent)   step.20.1 reply text, step.20.7[] tool calls {2: name, 3: JSON args}

const USER_INPUT = 14
const PLANNER_RESPONSE = 15

export interface AntigravityConversation {
  id: string
  title: string
  updatedAt: number
  workspace: string
  /** conversations/<id>.db */
  file: string
}

/** "2026-09-30 12:43:13.1734199+00:00" → epoch ms. */
function agTime(s: unknown): number | null {
  if (typeof s !== 'string') return null
  return ms(s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'))
}

/** Opens a copy: the app may hold the live file open (and on /mnt/c locking is unreliable). */
function withCopy<T>(file: string, fn: (db: Database.Database) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ag-'))
  try {
    const copy = path.join(dir, 'db.sqlite')
    copyFileSync(file, copy)
    for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) copyFileSync(file + ext, copy + ext)
    const db = new Database(copy)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Top-level conversations (subagent runs are left out: they belong to their parent). */
export function listAntigravity(root: string): AntigravityConversation[] {
  const index = path.join(root, 'conversation_summaries.db')
  if (!existsSync(index)) return []
  const rows = withCopy(
    index,
    (db) =>
      db
        .prepare(
          `select conversation_id id, title, last_modified_time modified, workspace_uris workspace
           from conversation_summaries where parent_conversation_id = '' and nesting_depth = 0`,
        )
        .all() as { id: string; title: string; modified: string; workspace: string }[],
  )
  return rows.flatMap((r) => {
    const file = path.join(root, 'conversations', `${r.id}.db`)
    return existsSync(file) ? [{ id: r.id, title: r.title, updatedAt: agTime(r.modified) ?? statSync(file).mtimeMs, workspace: r.workspace, file }] : []
  })
}

export function parseAntigravity(conv: AntigravityConversation): ParsedChat | null {
  const steps = withCopy(
    conv.file,
    (db) => db.prepare('select step_type type, step_payload payload from steps order by idx').all() as { type: number; payload: Buffer | null }[],
  )
  const tr = new Transcript()
  for (const s of steps) {
    if (s.type !== USER_INPUT && s.type !== PLANNER_RESPONSE) continue
    const step = Msg.parse(s.payload)
    if (!step) continue
    const ts = timestampMs(step.msg(5, 1))
    if (s.type === USER_INPUT) {
      tr.user(step.str(19, 2) ?? '', ts)
      continue
    }
    const reply = step.msg(20)
    if (!reply) continue
    tr.text(reply.str(1) ?? '', ts)
    for (const call of reply.msgs(7)) {
      const name = call.str(2)
      if (name) tr.tool(toolCall(name, call.str(3) ?? ''), ts)
    }
  }
  if (!tr.messages.some((m) => m.role === 'user')) return null
  const startedAt = tr.firstTs ?? conv.updatedAt
  const meta: Record<string, string> = { conversationId: conv.id }
  if (conv.workspace) meta.workspace = conv.workspace
  return {
    source: 'antigravity',
    externalId: conv.id,
    title: conv.title,
    startedAt,
    updatedAt: Math.max(conv.updatedAt, tr.lastTs ?? 0),
    messages: tr.messages,
    meta,
  }
}
