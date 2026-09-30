import type { ChatMessage, ChatSource, ChatTool } from '../../../shared/types.ts'

// What every source parser produces; importer.ts turns it into a journal entry.

export interface ParsedChat {
  source: ChatSource
  /** Stable id within the source (session / conversation id). */
  externalId: string
  /** Name the AI app gave the chat; empty to fall back to the first prompt. */
  title: string
  startedAt: number
  updatedAt: number
  messages: ChatMessage[]
  meta: Record<string, string>
}

/**
 * Builds a message list from a stream of prompts, reply text and tool calls. Reply text after
 * tool calls starts a new assistant message, so the transcript keeps the order text → tools → text.
 */
export class Transcript {
  readonly messages: ChatMessage[] = []

  user(text: string, ts: number | null) {
    const t = text.trim()
    if (t) this.messages.push({ role: 'user', text: t, ts })
  }

  text(text: string, ts: number | null) {
    const t = text.trim()
    if (!t) return
    const last = this.messages.at(-1)
    if (last?.role === 'assistant' && !last.tools?.length) last.text = last.text ? `${last.text}\n\n${t}` : t
    else this.messages.push({ role: 'assistant', text: t, ts })
  }

  tool(tool: ChatTool, ts: number | null) {
    let last = this.messages.at(-1)
    if (last?.role !== 'assistant') this.messages.push((last = { role: 'assistant', text: '', ts }))
    ;(last.tools ??= []).push(tool)
  }

  get firstTs(): number | null {
    return this.messages.find((m) => m.ts != null)?.ts ?? null
  }

  get lastTs(): number | null {
    return this.messages.findLast((m) => m.ts != null)?.ts ?? null
  }
}

export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…'
}

const TOOL_KEYS = ['description', 'toolSummary', 'command', 'CommandLine', 'file_path', 'AbsolutePath', 'path', 'pattern', 'query', 'url', 'prompt', 'title']

/** A tool call as one line: its most telling argument. */
export function toolCall(name: string, input: unknown): ChatTool {
  let args = input
  if (typeof args === 'string')
    try {
      args = JSON.parse(args)
    } catch {
      return { name, summary: oneLine(args as string, 140) }
    }
  const o = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const key = TOOL_KEYS.find((k) => typeof o[k] === 'string' && o[k])
  return { name, summary: key ? oneLine(o[key] as string, 140) : '' }
}

export const ms = (iso: unknown): number | null => {
  if (typeof iso !== 'string' && typeof iso !== 'number') return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Rough HTML → markdown-ish text (Takeout stores Gemini replies as HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => '\n```\n' + code.replace(/<[^>]+>/g, '') + '\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<h[1-6][^>]*>/gi, '\n\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
