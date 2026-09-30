import { ms, toolCall, Transcript, type ParsedChat } from './chat.ts'

// claude.ai chats are stored server-side; the way out is Settings → Privacy → Export data,
// which mails a zip holding conversations.json (an array of conversations).

type Block = { type: string; text?: string; name?: string; input?: unknown }
type Message = {
  uuid: string
  parent_message_uuid?: string
  sender: 'human' | 'assistant'
  text?: string
  content?: Block[]
  created_at?: string
  attachments?: { file_name?: string }[]
  files?: { file_name?: string }[]
}
type Conversation = { uuid: string; name?: string; created_at?: string; updated_at?: string; chat_messages?: Message[] }

export const isClaudeExport = (data: unknown): data is Conversation[] =>
  Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && 'chat_messages' in data[0] && 'uuid' in data[0]

/** The branch the user ended on: walk parents back from the newest message. */
function currentBranch(list: Message[]): Message[] {
  if (list.length < 2) return list
  const byId = new Map(list.map((m) => [m.uuid, m]))
  if (!list.some((m) => m.parent_message_uuid && byId.has(m.parent_message_uuid))) return list
  const chain: Message[] = []
  const seen = new Set<string>()
  for (let m: Message | undefined = list.at(-1); m && !seen.has(m.uuid); m = byId.get(m.parent_message_uuid ?? '')) {
    seen.add(m.uuid)
    chain.push(m)
  }
  return chain.reverse()
}

export function parseClaudeExport(data: Conversation[]): ParsedChat[] {
  const out: ParsedChat[] = []
  for (const c of data) {
    const tr = new Transcript()
    for (const m of currentBranch(c.chat_messages ?? [])) {
      const ts = ms(m.created_at)
      const blocks = m.content ?? []
      if (m.sender === 'human') {
        const text = blocks.some((b) => b.type === 'text')
          ? blocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('\n\n')
          : (m.text ?? '')
        const files = [...(m.attachments ?? []), ...(m.files ?? [])].map((f) => f.file_name).filter(Boolean)
        tr.user(files.length ? `${text}\n\n${files.map((f) => `📎 ${f}`).join('\n')}` : text, ts)
      } else if (blocks.length) {
        for (const b of blocks) {
          if (b.type === 'text' && b.text) tr.text(b.text, ts)
          else if (b.type === 'tool_use' && b.name) tr.tool(toolCall(b.name, b.input), ts)
        }
      } else tr.text(m.text ?? '', ts)
    }
    if (!tr.messages.some((m) => m.role === 'user')) continue
    const startedAt = ms(c.created_at) ?? tr.firstTs ?? 0
    out.push({
      source: 'claude',
      externalId: c.uuid,
      title: c.name ?? '',
      startedAt,
      updatedAt: Math.max(ms(c.updated_at) ?? 0, tr.lastTs ?? 0, startedAt),
      messages: tr.messages,
      meta: {},
    })
  }
  return out
}
