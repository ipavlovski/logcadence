// Block structure of AI replies: headings, lists, tables, quotes and rules on top of the node
// markdown subset (markdown.ts), whose inline rules render each line.

export type ChatBlock =
  | { t: 'code'; lang: string; code: string }
  | { t: 'heading'; level: number; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { t: 'quote'; lines: string[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'rule' }
  | { t: 'para'; lines: string[] }

const FENCE = /^\s*```(\S*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function parseChatMarkdown(src: string): ChatBlock[] {
  const lines = src.split('\n')
  const out: ChatBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ t: 'para', lines: para })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]!); i++) code.push(lines[i]!)
      out.push({ t: 'code', lang: fence[1] ?? '', code: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      out.push({ t: 'heading', level: heading[1]!.length, text: heading[2]! })
      continue
    }
    if (RULE.test(line)) {
      flush()
      out.push({ t: 'rule' })
      continue
    }
    if (line.trimStart().startsWith('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length && lines[i]!.trimStart().startsWith('|'); i++) rows.push(cells(lines[i]!))
      i--
      out.push({ t: 'table', head, rows })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quote: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]!); i++) quote.push(lines[i]!.replace(/^\s*>\s?/, ''))
      i--
      out.push({ t: 'quote', lines: quote })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      flush()
      const ordered = /\d/.test(item[2]!)
      const items: { text: string; depth: number }[] = []
      const base = item[1]!.length
      for (; i < lines.length; i++) {
        const m = ITEM.exec(lines[i]!)
        if (m) items.push({ text: m[3]!, depth: Math.min(3, Math.floor(Math.max(0, m[1]!.length - base) / 2)) })
        else if (/^\s{2,}\S/.test(lines[i]!) && items.length) items.at(-1)!.text += '\n' + lines[i]!.trim()
        else break
      }
      i--
      out.push({ t: 'list', ordered, items })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}
