import type { ChatAttachment } from '../../../shared/types.ts'
import { ms, toolCall, Transcript, type ParsedChat } from './chat.ts'

// A claude.ai conversation as a transcript. Two places hand out the same shape: the data export
// (Settings → Privacy → Export data: a zip holding conversations.json, an array of them) and claude.ai's
// internal API, which live sync reads (claudeWeb.ts): GET /api/organizations/{org}/chat_conversations/{id}
// ?tree=true&rendering_mode=messages&render_all_tools=true. The API adds `current_leaf_message_uuid` and
// `model`; the export has neither.
//
// The rendering follows github.com/agarwalvishal/claude-chat-exporter (MIT), which documents the API's fields:
// artifacts are folded to their final version and shown once, widgets as fenced code, `thinking` and
// `tool_result` are skipped. Beyond it: files Claude writes (create_file, Write) are folded with their edits
// (str_replace, Edit) the same way, and a published artifact (Artifact) is a link. Other tools stay as tool calls.

type Block = { type: string; text?: string; name?: string; input?: unknown }
type File = { file_kind?: string; file_name?: string; size_bytes?: number; document_asset?: { page_count?: number } }
type Attachment = { file_name?: string; name?: string; file_type?: string; file_size?: number; extracted_content?: string }
type Message = {
  uuid: string
  parent_message_uuid?: string
  index?: number
  sender: string
  /** Empty in the API's messages rendering; the export fills it too. */
  text?: string
  content?: Block[]
  created_at?: string
  /** Seen only as false; meaning unknown, so it is flagged rather than explained. */
  truncated?: boolean
  /** 'user_canceled' when the user stopped the reply (seen); other values are not annotated. */
  stop_reason?: string
  attachments?: Attachment[]
  files?: File[]
}
export type ClaudeConversation = {
  uuid: string
  name?: string
  model?: string
  created_at?: string
  updated_at?: string
  current_leaf_message_uuid?: string
  chat_messages?: Message[]
}

/** Bumped when the rendering changes: live sync then fetches every conversation again, once. */
export const CLAUDE_RENDER_VERSION = 3

export const isClaudeExport = (data: unknown): data is ClaudeConversation[] =>
  Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && 'chat_messages' in data[0] && 'uuid' in data[0]

export const isClaudeConversation = (data: unknown): data is ClaudeConversation =>
  !!data && typeof data === 'object' && typeof (data as ClaudeConversation).uuid === 'string' && Array.isArray((data as ClaudeConversation).chat_messages)

/**
 * The branch the user is on. Messages form a tree (a regenerated reply is a sibling): walk parents back from the
 * current leaf, or, in the export, which doesn't name it, from the newest message.
 */
function currentBranch(c: ClaudeConversation): Message[] {
  const list = [...(c.chat_messages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (list.length < 2) return list
  const byId = new Map(list.map((m) => [m.uuid, m]))
  const leaf = byId.get(c.current_leaf_message_uuid ?? '')
  if (!leaf && !list.some((m) => m.parent_message_uuid && byId.has(m.parent_message_uuid))) return list
  const chain: Message[] = []
  const seen = new Set<string>()
  for (let m: Message | undefined = leaf ?? list.at(-1); m && !seen.has(m.uuid); m = byId.get(m.parent_message_uuid ?? '')) {
    seen.add(m.uuid)
    chain.push(m)
  }
  return chain.reverse()
}

// ── artifacts, created files, widgets ──────────────────────────────────────

interface Artifact {
  content: string
  title?: string
  type?: string
  language?: string
  lastVersion?: unknown
}

/** A file Claude wrote, and the block that last wrote or edited it (where it is shown). */
interface WrittenFile {
  content: string
  last: Block
}

interface Folded {
  artifacts: Map<string, Artifact>
  files: Map<string, WrittenFile>
  /** The file each write or edit block went to. */
  fileOf: Map<Block, string>
}

const inputOf = (b: Block) => (b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

const WRITE_TOOLS = new Set(['create_file', 'Write'])
const EDIT_TOOLS = new Set(['str_replace', 'Edit'])
const filePath = (input: Record<string, unknown>) => str(input.file_path) ?? str(input.path) ?? ''
const baseName = (p: string) => p.split('/').at(-1)!

/** The written file a path names: itself, or, when one side is a bare name (relative to the cwd), the one file with that name. */
function resolveFile(files: Map<string, WrittenFile>, path: string): string {
  if (files.has(path)) return path
  const same = [...files.keys()].filter((k) => baseName(k) === baseName(path) && (!k.includes('/') || !path.includes('/')))
  return same.length === 1 ? same[0]! : path
}

/** Replaces old with new (every occurrence when `all`); null when old is not there. */
function applyEdit(content: string, oldStr: string, newStr: string, all = false): string | null {
  if (!oldStr || !content.includes(oldStr)) return null
  // A function, not a string: `$&`, `$'`, `` $` `` and `$$` in new_str would be read as replacement patterns.
  return all ? content.replaceAll(oldStr, () => newStr) : content.replace(oldStr, () => newStr)
}

/**
 * Every artifact (by id) and written file (by path) folded to its final content: create / rewrite / Write carry
 * the whole text, update / str_replace / Edit an old → new edit. Each is shown once, at its last block.
 */
function collect(messages: Message[], warn: (msg: string) => void): Folded {
  const artifacts = new Map<string, Artifact>()
  const files = new Map<string, WrittenFile>()
  const fileOf = new Map<Block, string>()
  for (const m of messages)
    for (const b of m.content ?? []) {
      if (b.type !== 'tool_use') continue
      const input = inputOf(b)
      if (b.name && WRITE_TOOLS.has(b.name)) {
        const text = str(input.file_text) ?? str(input.content)
        if (text === undefined || !filePath(input)) continue
        const path = resolveFile(files, filePath(input))
        files.set(path, { content: text, last: b })
        fileOf.set(b, path)
        continue
      }
      if (b.name && EDIT_TOOLS.has(b.name)) {
        // Only files written in the chat; an edit to any other file stays a tool call.
        const path = resolveFile(files, filePath(input))
        const f = files.get(path)
        if (!f) continue
        fileOf.set(b, path)
        const next = applyEdit(f.content, str(input.old_string) ?? str(input.old_str) ?? '', str(input.new_string) ?? str(input.new_str) ?? '', input.replace_all === true)
        if (next === null) warn(`file “${baseName(path)}”: an edit could not be applied, so it may be incomplete`)
        else f.content = next
        f.last = b
        continue
      }
      if (b.name !== 'artifacts') continue
      const id = str(input.id) ?? ''
      let a = artifacts.get(id)
      if (!a) artifacts.set(id, (a = { content: '' }))
      const oldStr = str(input.old_str)
      const newStr = str(input.new_str)
      if (input.command === 'update') {
        if (oldStr !== undefined && newStr !== undefined) {
          const next = applyEdit(a.content, oldStr, newStr)
          if (next === null) warn(`artifact “${a.title || id}”: an edit could not be applied, so it may be incomplete`)
          else a.content = next
        }
      } else if (str(input.content) !== undefined) a.content = str(input.content)!
      a.title = str(input.title) || a.title
      a.type = str(input.type) || a.type
      a.language = str(input.language) || a.language
      a.lastVersion = input.version_uuid
    }
  return { artifacts, files, fileOf }
}

const ARTIFACT_TYPES: Record<string, { lang: string; label: string }> = {
  'application/vnd.ant.react': { lang: 'jsx', label: 'React' },
  'text/html': { lang: 'html', label: 'HTML' },
  'image/svg+xml': { lang: 'svg', label: 'SVG' },
  'application/vnd.ant.mermaid': { lang: 'mermaid', label: 'Mermaid' },
  'text/markdown': { lang: 'markdown', label: 'Markdown' },
}

const EXT_LANG: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  md: 'markdown',
  html: 'html',
  css: 'css',
  json: 'json',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  java: 'java',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
}

/** A labelled fenced block; the fence is longer than any backtick run in the code. */
export function codeBlock(label: string, code: string, lang = ''): string {
  const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((s) => s.length + 1)))
  return `**${label}**\n\n${fence}${lang}\n${code}\n${fence}`
}

/** The tools whose input is content: markdown for them, '' for earlier versions; null for other tools. */
function renderTool(b: Block, { artifacts, files, fileOf }: Folded): string | null {
  const input = inputOf(b)
  if (b.name === 'artifacts') {
    const a = artifacts.get(str(input.id) ?? '')
    if (!a || input.version_uuid !== a.lastVersion || !a.content) return ''
    const t = ARTIFACT_TYPES[a.type ?? ''] ?? { lang: a.language ?? '', label: a.language || (a.type === 'application/vnd.ant.code' ? 'Code' : '') }
    return codeBlock(`Artifact: ${a.title || 'untitled'}${t.label ? ` · ${t.label}` : ''}`, a.content, t.lang)
  }
  if (b.name && (WRITE_TOOLS.has(b.name) || EDIT_TOOLS.has(b.name))) {
    const path = fileOf.get(b)
    const f = path === undefined ? undefined : files.get(path)
    if (!f) return null
    if (f.last !== b || !f.content) return ''
    const file = baseName(path!)
    const ext = file.includes('.') ? file.split('.').at(-1)!.toLowerCase() : ''
    return codeBlock(`File: ${file}`, f.content, EXT_LANG[ext] ?? '')
  }
  // A page published to claude.ai (open to whoever it is shared with).
  const url = str(input.url)
  if (b.name === 'Artifact' && url?.startsWith('https://claude.ai/')) return `**Artifact:** [${str(input.title) || url}](${url})`
  const widget = str(input.widget_code)
  if (b.name === 'visualize:show_widget' && widget) return codeBlock(`Widget: ${str(input.title) || 'untitled'}`, widget, 'jsx')
  return null
}

// ── attachments ────────────────────────────────────────────────────────────

function size(n: unknown): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const joinMeta = (...bits: (string | undefined)[]) => bits.filter(Boolean).join(' · ') || undefined

/**
 * Uploaded files (images, PDFs, other blobs) by name; their urls need the claude.ai session, so they are not kept.
 * Text extractions (.md, .docx, .txt…) keep the extracted text.
 */
function attachmentsOf(m: Message): ChatAttachment[] {
  const out: ChatAttachment[] = []
  for (const f of m.files ?? []) {
    const pages = f.document_asset?.page_count
    const meta =
      f.file_kind === 'image' ? 'image' : f.file_kind === 'document' ? joinMeta('document', pages ? `${pages} page${pages === 1 ? '' : 's'}` : undefined) : joinMeta(f.file_kind, size(f.size_bytes))
    out.push({ name: f.file_name || 'file', ...(meta && { meta }) })
  }
  for (const a of m.attachments ?? []) {
    const meta = joinMeta(a.file_type, size(a.file_size))
    const text = a.extracted_content?.trim()
    out.push({ name: a.file_name || a.name || 'attachment', ...(meta && { meta }), ...(text && { text }) })
  }
  return out
}

function incompleteNote(m: Message): string {
  if (m.truncated) return '> **Truncated:** claude.ai flagged this message as truncated; it may be incomplete.'
  if (m.stop_reason === 'user_canceled') return '> **Interrupted:** this reply was stopped before Claude finished.'
  return ''
}

// ── conversation → chat ────────────────────────────────────────────────────

/** Null for a conversation without prompts. Problems rebuilding it go to meta.warnings (one per line). */
export function parseClaudeConversation(c: ClaudeConversation): ParsedChat | null {
  const warnings: string[] = []
  const branch = currentBranch(c)
  const folded = collect(branch, (w) => warnings.push(w))
  const tr = new Transcript()

  for (const m of branch) {
    const ts = ms(m.created_at)
    const blocks = m.content ?? []
    if (m.sender === 'human') {
      const text = blocks.some((b) => b.type === 'text')
        ? blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('\n\n')
        : (m.text ?? '')
      tr.user(text, ts, attachmentsOf(m))
      continue
    }
    if (m.sender !== 'assistant') warnings.push(`unexpected sender “${m.sender}”, shown as Claude`)
    let said = false
    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) {
        tr.text(b.text, ts)
        said = true
      } else if (b.type === 'tool_use' && b.name) {
        const md = renderTool(b, folded)
        if (md) tr.text(md, ts)
        else if (md === null) tr.tool(toolCall(b.name, b.input), ts)
        said ||= md !== ''
      }
    }
    if (!blocks.length && m.text?.trim()) {
      tr.text(m.text, ts)
      said = true
    }
    const note = incompleteNote(m)
    if (said && note) tr.text(note, ts)
  }

  if (!tr.messages.some((m) => m.role === 'user')) return null
  const startedAt = ms(c.created_at) ?? tr.firstTs ?? 0
  const meta: Record<string, string> = {}
  if (c.model) meta.model = c.model
  if (warnings.length) meta.warnings = warnings.join('\n')
  return {
    source: 'claude',
    externalId: c.uuid,
    title: c.name ?? '',
    startedAt,
    updatedAt: Math.max(ms(c.updated_at) ?? 0, tr.lastTs ?? 0, startedAt),
    messages: tr.messages,
    meta,
  }
}

export const parseClaudeExport = (data: ClaudeConversation[]): ParsedChat[] =>
  data.map(parseClaudeConversation).filter((p): p is ParsedChat => p !== null)
