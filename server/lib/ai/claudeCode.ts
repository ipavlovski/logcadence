import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { ms, toolCall, Transcript, type ParsedChat } from './chat.ts'

// Claude Code keeps one JSONL transcript per session under ~/.claude/projects/<cwd-slug>/.
// The desktop app's Code tab writes the same files (under the Windows home) plus a metadata
// file per session holding the title shown in the app.

type Block = { type: string; text?: string; name?: string; input?: unknown }
type Rec = {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  origin?: { kind?: string }
  timestamp?: string
  cwd?: string
  gitBranch?: string
  message?: { content?: string | Block[]; model?: string }
  aiTitle?: string
  customTitle?: string
  summary?: string
}

// Context the IDE or harness adds to a prompt; not what the user typed.
const INJECTED = /<(ide_opened_file|ide_selection|system-reminder|ide_diagnostics)>[\s\S]*?<\/\1>/g
// Pasted text is wrapped in a tag; keep what was pasted.
const PASTED = /<\/?pasted_content\b[^>]*>/g
const clean = (s: string) => s.replace(INJECTED, '').replace(PASTED, '')
// Whole records that are harness chatter rather than prompts.
const NOISE = /^\s*(<task-notification>|<local-command-|<command-name>|<command-message>|<bash-(input|stdout|stderr)>|\[Request interrupted)/

function promptText(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return NOISE.test(content) ? '' : clean(content)
  if (!Array.isArray(content) || content.some((b) => b.type === 'tool_result')) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b.type === 'text' && b.text && !NOISE.test(b.text)) parts.push(clean(b.text))
    else if (b.type === 'image') parts.push('[image]')
  }
  return parts.join('\n\n')
}

/** Titles from the desktop app's session metadata files, keyed by CLI session id. */
export function desktopTitles(files: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of files) {
    try {
      const o = JSON.parse(readFileSync(f, 'utf8')) as { cliSessionId?: string; title?: string }
      if (o.cliSessionId && o.title) map.set(o.cliSessionId, o.title)
    } catch {
      // partially written or foreign file
    }
  }
  return map
}

export async function parseClaudeCode(file: string, titles: Map<string, string> = new Map(), origin = ''): Promise<ParsedChat | null> {
  const sessionId = path.basename(file, '.jsonl')
  const tr = new Transcript()
  let aiTitle = ''
  let customTitle = ''
  let summary = ''
  let cwd = ''
  let model = ''
  let branch = ''
  let lastTs: number | null = null

  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line) continue
    let r: Rec
    try {
      r = JSON.parse(line) as Rec
    } catch {
      continue // a line still being written
    }
    const ts = ms(r.timestamp)
    if (ts != null) lastTs = ts
    if (r.type === 'ai-title' && r.aiTitle) aiTitle = r.aiTitle
    else if (r.type === 'custom-title' && r.customTitle) customTitle = r.customTitle
    else if (r.type === 'summary' && r.summary) summary ||= r.summary
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isSidechain || !r.message) continue
    cwd ||= r.cwd ?? ''
    branch ||= r.gitBranch ?? ''

    if (r.type === 'user') {
      if (r.isMeta || r.isCompactSummary || r.origin?.kind === 'system') continue
      tr.user(promptText(r.message.content), ts)
      continue
    }
    // Harness-made replies (API errors, usage limits, "No response requested.").
    if (r.message.model === '<synthetic>') continue
    model = r.message.model ?? model
    const content = r.message.content
    if (typeof content === 'string') tr.text(content, ts)
    else
      for (const b of content ?? []) {
        if (b.type === 'text' && b.text) tr.text(b.text, ts)
        else if (b.type === 'tool_use' && b.name) tr.tool(toolCall(b.name, b.input), ts)
      }
  }

  if (!tr.messages.some((m) => m.role === 'user')) return null
  const startedAt = tr.messages.find((m) => m.role === 'user')?.ts ?? tr.firstTs ?? lastTs ?? 0
  const meta: Record<string, string> = { sessionId }
  if (cwd) meta.cwd = cwd
  if (branch && branch !== 'HEAD') meta.branch = branch
  if (model) meta.model = model
  if (origin) meta.origin = origin
  return {
    source: 'claude-code',
    externalId: sessionId,
    title: titles.get(sessionId) || customTitle || aiTitle || summary,
    startedAt,
    updatedAt: lastTs ?? startedAt,
    messages: tr.messages,
    meta,
  }
}
