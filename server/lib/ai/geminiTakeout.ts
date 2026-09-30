import { htmlToText, ms, oneLine, Transcript, type ParsedChat } from './chat.ts'

// Gemini web chats only leave Google through Takeout ("My Activity" → Gemini Apps, JSON format).
// The activity log is a flat list of prompts with their replies: it has neither conversation ids
// nor the titles shown in the Gemini sidebar. Prompts are grouped into chats by time gaps and
// titled after the first prompt.

type Activity = {
  header?: string
  title?: string
  time?: string
  products?: string[]
  safeHtmlItem?: { html?: string }[]
  attachedFiles?: string[]
}

const GAP = 30 * 60 * 1000
const PROMPTED = /^Prompted\s+/

export const isGeminiActivity = (data: unknown): data is Activity[] =>
  Array.isArray(data) &&
  data.some((a: Activity) => typeof a === 'object' && (a.header?.includes('Gemini') || a.products?.some((p) => p.includes('Gemini'))))

export function parseGeminiActivity(data: Activity[]): ParsedChat[] {
  const prompts = data
    .filter((a) => PROMPTED.test(a.title ?? '') && ms(a.time) != null)
    .map((a) => ({ a, ts: ms(a.time)! }))
    .sort((x, y) => x.ts - y.ts)

  const groups: (typeof prompts)[] = []
  for (const p of prompts) {
    const cur = groups.at(-1)
    if (cur && p.ts - cur.at(-1)!.ts <= GAP) cur.push(p)
    else groups.push([p])
  }

  return groups.map((g) => {
    const tr = new Transcript()
    for (const { a, ts } of g) {
      const files = (a.attachedFiles ?? []).map((f) => `📎 ${f}`).join('\n')
      tr.user([a.title!.replace(PROMPTED, ''), files].filter(Boolean).join('\n\n'), ts)
      const html = a.safeHtmlItem?.map((h) => h.html ?? '').join('\n') ?? ''
      tr.text(htmlToText(html), ts)
    }
    return {
      source: 'gemini' as const,
      externalId: String(g[0]!.ts),
      title: oneLine(tr.messages[0]!.text, 70),
      startedAt: g[0]!.ts,
      updatedAt: g.at(-1)!.ts,
      messages: tr.messages,
      meta: {},
    }
  })
}
