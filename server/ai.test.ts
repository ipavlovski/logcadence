import Database from 'better-sqlite3'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatDTO, ChatSummary, EntryDTO, ImportReport, NodeDTO } from '../shared/types.ts'

// A fake machine: one home with Claude Code, Antigravity and a Claude export in Downloads.
const root = mkdtempSync(path.join(os.tmpdir(), 'logcadence-ai-'))
const home = path.join(root, 'home')
process.env.LOGCADENCE_DATA_DIR = path.join(root, 'data')
process.env.LOGCADENCE_AI_HOMES = home
let app: typeof import('./app.ts').app

const T0 = Date.parse('2026-09-20T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()

// ── fixtures ──────────────────────────────────────────────────────────────

const ccFile = path.join(home, '.claude', 'projects', '-home-me-proj', 'sess-1.jsonl')
const jsonl = (...recs: object[]) => recs.map((r) => JSON.stringify(r) + '\n').join('')
const ccUser = (text: string, min: number, extra: object = {}) => ({
  type: 'user',
  timestamp: iso(min),
  cwd: '/home/me/proj',
  message: { role: 'user', content: text },
  ...extra,
})
const ccAssistant = (content: object[], min: number, model = 'claude-opus-5-5') => ({ type: 'assistant', timestamp: iso(min), message: { model, content } })

function writeClaudeCode() {
  mkdirSync(path.dirname(ccFile), { recursive: true })
  writeFileSync(
    ccFile,
    jsonl(
      ccUser('<ide_opened_file>The user opened x.ts</ide_opened_file>Fix the <pasted_content id="1">flaky</pasted_content> test', 0),
      ccAssistant([{ type: 'text', text: 'Looking at the test.' }], 1),
      ccAssistant([{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test', description: 'Run tests' } }], 1),
      { type: 'user', timestamp: iso(2), message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      ccAssistant([{ type: 'text', text: '## Done\n\nThe **race** is fixed.' }], 3),
      ccUser('[Request interrupted by user]', 4),
      ccUser('<task-notification>bg done</task-notification>', 4, { origin: { kind: 'system' } }),
      ccAssistant([{ type: 'text', text: 'No response requested.' }], 4, '<synthetic>'),
      { type: 'ai-title', aiTitle: 'Flaky test', sessionId: 'sess-1' },
      { type: 'ai-title', aiTitle: 'Fix flaky test', sessionId: 'sess-1' },
    ),
  )
}

// Protobuf encoding, just enough for Antigravity steps.
const varint = (n: number) => {
  const b: number[] = []
  for (; n > 127; n = Math.floor(n / 128)) b.push((n & 127) | 128)
  b.push(n)
  return Buffer.from(b)
}
const pb = (n: number, v: number | string | Buffer) => {
  if (typeof v === 'number') return Buffer.concat([varint(n << 3), varint(v)])
  const b = Buffer.from(v)
  return Buffer.concat([varint((n << 3) | 2), varint(b.length), b])
}
const at = (min: number) => pb(5, pb(1, Buffer.concat([pb(1, Math.floor((T0 + min * 60_000) / 1000)), pb(2, 0)])))

function writeAntigravity() {
  const ag = path.join(home, '.gemini', 'antigravity')
  mkdirSync(path.join(ag, 'conversations'), { recursive: true })
  const index = new Database(path.join(ag, 'conversation_summaries.db'))
  index.exec(`create table conversation_summaries (conversation_id text primary key, title text, last_modified_time text,
    workspace_uris text, parent_conversation_id text not null default '', nesting_depth integer not null default 0)`)
  const add = index.prepare('insert into conversation_summaries values (?, ?, ?, ?, ?, ?)')
  add.run('ag-1', 'Build Revit House', '2026-09-21 09:30:00.1234567+00:00', 'file:///C:/work', '', 0)
  add.run('ag-sub', 'Subagent run', '2026-09-21 09:30:00+00:00', '', 'ag-1', 1)
  index.close()
  for (const id of ['ag-1', 'ag-sub']) {
    const conv = new Database(path.join(ag, 'conversations', `${id}.db`))
    conv.exec('create table steps (idx integer primary key, step_type integer, step_payload blob)')
    const step = conv.prepare('insert into steps values (?, ?, ?)')
    step.run(0, 14, Buffer.concat([at(24 * 60), pb(19, pb(2, 'Build a small house'))]))
    step.run(1, 15, Buffer.concat([at(24 * 60 + 1), pb(20, Buffer.concat([pb(3, 'thinking…'), pb(7, Buffer.concat([pb(2, 'run_command'), pb(3, '{"toolSummary":"Create walls"}')]))]))]))
    step.run(2, 132, Buffer.from('tool output'))
    step.run(3, 15, Buffer.concat([at(24 * 60 + 2), pb(20, pb(1, 'Built the house with **4 walls**.'))]))
    conv.close()
  }
}

/** Zip with deflated members. The reader skips CRCs, so they are left zero. */
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text))
    const n = Buffer.from(name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(data.length, 18)
    lh.writeUInt32LE(Buffer.byteLength(text), 22)
    lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(data.length, 20)
    ch.writeUInt32LE(Buffer.byteLength(text), 24)
    ch.writeUInt16LE(n.length, 28)
    ch.writeUInt32LE(offset, 42)
    local.push(lh, n, data)
    central.push(ch, n)
    offset += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cd, end])
}

function writeClaudeExport() {
  const msg = (uuid: string, parent: string, sender: string, text: string, min: number) => ({
    uuid,
    parent_message_uuid: parent,
    sender,
    text,
    content: [{ type: 'text', text }],
    created_at: iso(min),
    attachments: [],
    files: [],
  })
  const conversations = [
    {
      uuid: 'conv-1',
      name: 'Battery pack layout',
      created_at: iso(2 * 24 * 60),
      updated_at: iso(2 * 24 * 60 + 5),
      chat_messages: [
        msg('m1', '00000000-0000-4000-8000-000000000000', 'human', 'Design a 20s6p pack', 2 * 24 * 60),
        msg('m2', 'm1', 'assistant', 'An abandoned answer', 2 * 24 * 60 + 1),
        msg('m3', 'm1', 'assistant', 'Here is a **layout**:\n\n| a | b |\n|---|---|\n| 1 | 2 |', 2 * 24 * 60 + 2),
      ],
    },
  ]
  mkdirSync(path.join(home, 'Downloads'), { recursive: true })
  writeFileSync(path.join(home, 'Downloads', 'conversations-000.zip'), zip({ 'conversations.json': JSON.stringify(conversations) }))
  writeFileSync(path.join(home, 'Downloads', 'unrelated.zip'), zip({ 'a.txt': 'x' }))
}

// ── helpers ───────────────────────────────────────────────────────────────

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

const scan = () => req<{ report: ImportReport }>('POST', '/api/ai/scan').then((r) => r.report)
const chatList = () => req<{ chats: ChatSummary[] }>('GET', '/api/ai/chats').then((r) => r.chats)
const entryOf = async (c: ChatSummary) => (await req<{ entries: EntryDTO[] }>('GET', `/api/journal/${c.date}`)).entries.find((e) => e.id === c.entryId)!

beforeAll(async () => {
  writeClaudeCode()
  writeAntigravity()
  writeClaudeExport()
  app = (await import('./app.ts')).app
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

// ── tests ─────────────────────────────────────────────────────────────────

describe('AI chat import', () => {
  it('imports every local source as titled, tagged entries', async () => {
    const report = await scan()
    expect(report['claude-code']).toMatchObject({ found: 1, created: 1, errors: [] })
    expect(report.antigravity).toMatchObject({ found: 1, created: 1, errors: [] }) // the subagent run is left out
    expect(report.claude).toMatchObject({ found: 1, created: 1, errors: [] })

    const chats = await chatList()
    expect(chats.map((c) => [c.source, c.title, c.date, c.turns])).toEqual([
      ['claude', 'Battery pack layout', '2026-09-22', 1],
      ['antigravity', 'Build Revit House', '2026-09-21', 1],
      ['claude-code', 'Fix flaky test', '2026-09-20', 1],
    ])
  })

  it('makes one node per prompt, leaving the replies to the transcript', async () => {
    const [claude, ag, cc] = await chatList()
    const ccEntry = await entryOf(cc!)
    expect(ccEntry.title).toBe('Fix flaky test')
    expect(ccEntry.tags).toEqual(['ai:claude-code'])
    expect(ccEntry.chat).toEqual({ id: cc!.id, source: 'claude-code', nodeIds: ccEntry.nodes.map((n) => n.id) })
    // IDE context and paste wrappers stripped; interrupts, notifications and synthetic replies skipped.
    expect(ccEntry.nodes.map((n) => n.content)).toEqual(['Fix the flaky test'])

    expect((await entryOf(ag!)).nodes.map((n) => n.content)).toEqual(['Build a small house'])
    // The branch the user ended on, not the abandoned reply.
    expect((await entryOf(claude!)).nodes[0]!.content).toBe('Design a 20s6p pack')
  })

  it('keeps the full transcript with tool calls', async () => {
    const cc = (await chatList()).find((c) => c.source === 'claude-code')!
    const chat = await req<ChatDTO>('GET', `/api/ai/chats/${cc.id}`)
    expect(chat.meta).toMatchObject({ cwd: '/home/me/proj', model: 'claude-opus-5-5' })
    expect(chat.messages.map((m) => [m.role, m.text, m.tools?.map((t) => t.summary)])).toEqual([
      ['user', 'Fix the flaky test', undefined],
      ['assistant', 'Looking at the test.', ['Run tests']],
      ['assistant', '## Done\n\nThe **race** is fixed.', undefined],
    ])
    const ag = await req<ChatDTO>('GET', `/api/ai/chats/${(await chatList()).find((c) => c.source === 'antigravity')!.id}`)
    expect(ag.messages[1]!.tools).toEqual([{ name: 'run_command', summary: 'Create walls' }])
  })

  it('skips unchanged sources on rescan', async () => {
    const report = await scan()
    expect(report['claude-code']).toMatchObject({ found: 1, unchanged: 1 })
    expect(report.antigravity).toMatchObject({ found: 1, unchanged: 1 })
    expect(report.claude).toMatchObject({ found: 1, unchanged: 1 })
  })

  it('appends new turns without overwriting earlier edits', async () => {
    const cc = (await chatList()).find((c) => c.source === 'claude-code')!
    const entry = await entryOf(cc)
    await req('PATCH', `/api/entries/${entry.id}`, { title: 'My own title' })
    await req<NodeDTO>('PATCH', `/api/nodes/${entry.nodes[0]!.id}`, { content: 'edited by me' })

    appendFileSync(
      ccFile,
      jsonl(ccUser('Now add a regression test', 10), ccAssistant([{ type: 'text', text: 'Added `race.test.ts`.' }], 11), {
        type: 'ai-title',
        aiTitle: 'Fix flaky test and add regression',
      }),
    )
    expect((await scan())['claude-code']).toMatchObject({ updated: 1 })

    const after = await entryOf(cc)
    expect(after.title).toBe('My own title')
    expect(after.nodes.map((n) => n.content)).toEqual(['edited by me', 'Now add a regression test'])
    expect((await chatList()).find((c) => c.id === cc.id)).toMatchObject({ turns: 2, title: 'Fix flaky test and add regression' })
  })

  it('strips reply previews left by earlier imports', async () => {
    const cc = (await chatList()).find((c) => c.source === 'claude-code')!
    const node = (await entryOf(cc)).nodes[1]!
    await req('PATCH', `/api/nodes/${node.id}`, { content: 'Now add a regression test\n\n→ Added `race.test.ts`.' })
    const { stripReplyPreviews } = await import('./lib/ai/importer.ts')
    stripReplyPreviews()
    expect((await entryOf(cc)).nodes[1]!.content).toBe('Now add a regression test')
  })

  it('takes extra tags but keeps the chat source tag as the locked primary', async () => {
    const cc = (await chatList()).find((c) => c.source === 'claude-code')!
    const entry = await entryOf(cc)
    const patch = (tags: string[]) => req<EntryDTO>('PATCH', `/api/entries/${entry.id}`, { tags })
    expect((await patch(['ai:claude-code', 'project:x'])).tags).toEqual(['ai:claude-code', 'project:x'])
    expect((await patch(['project:x', 'ai:claude-code'])).tags).toEqual(['ai:claude-code', 'project:x'])
    expect((await patch(['project:y'])).tags).toEqual(['ai:claude-code', 'project:y'])

    const post = (url: string, body: object) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post('/api/tags/rename', { from: 'ai:claude-code', to: 'ai:cc' })).status).toBe(400)
    expect((await post('/api/tags/rename', { from: 'ai', to: 'assistants' })).status).toBe(400)
    expect((await post('/api/tags/delete', { tag: 'ai:claude-code' })).status).toBe(400)
    expect((await post('/api/tags/branch', { from: 'ai:claude-code', to: 'ai:claude-code:x', entryIds: [entry.id] })).status).toBe(400)
    expect((await entryOf(cc)).tags).toEqual(['ai:claude-code', 'project:y'])
  })

  it('does not bring back an entry the user deleted', async () => {
    const ag = (await chatList()).find((c) => c.source === 'antigravity')!
    await req('DELETE', `/api/entries/${ag.entryId}`)
    expect((await chatList()).find((c) => c.id === ag.id)!.entryId).toBeNull()
    await scan()
    expect((await chatList()).find((c) => c.id === ag.id)!.entryId).toBeNull()
  })

  it('imports an uploaded Gemini Takeout, grouping prompts into chats by time', async () => {
    const act = (prompt: string, min: number, html: string) => ({
      header: 'Gemini Apps',
      title: `Prompted ${prompt}`,
      time: iso(3 * 24 * 60 + min),
      products: ['Gemini Apps'],
      safeHtmlItem: [{ html }],
    })
    const takeout = [
      act('Follow-up on hinges', 10, '<p>Use &quot;piano&quot; hinges.</p>'),
      act('Best hinge for a chicken coop door?', 0, '<p>A <b>strap hinge</b>.</p><ul><li>galvanized</li></ul>'),
      act('Unrelated later question', 180, '<p>Answer.</p>'),
      { header: 'Gemini Apps', title: 'Used Gemini Apps', time: iso(3 * 24 * 60 + 5), products: ['Gemini Apps'] },
    ]
    const form = new FormData()
    form.append('file', new File([new Uint8Array(zip({ 'Takeout/My Activity/Gemini Apps/MyActivity.json': JSON.stringify(takeout) }))], 'takeout-2026.zip'))
    const res = await app.request('/api/ai/import', { method: 'POST', body: form })
    expect(((await res.json()) as { report: ImportReport }).report.gemini).toMatchObject({ found: 2, created: 2 })

    const gemini = (await chatList()).filter((c) => c.source === 'gemini')
    expect(gemini.map((c) => [c.title, c.turns])).toEqual([
      ['Unrelated later question', 1],
      ['Best hinge for a chicken coop door?', 2],
    ])
    const chat = await req<ChatDTO>('GET', `/api/ai/chats/${gemini[1]!.id}`)
    expect(chat.messages.map((m) => m.text)).toEqual(['Best hinge for a chicken coop door?', 'A **strap hinge**.\n\n- galvanized', 'Follow-up on hinges', 'Use "piano" hinges.'])
  })

  it('rejects files that are not chat exports', async () => {
    const form = new FormData()
    form.append('file', new File(['{"hello": 1}'], 'notes.json'))
    const res = await app.request('/api/ai/import', { method: 'POST', body: form })
    expect(res.status).toBe(400)
  })
})
