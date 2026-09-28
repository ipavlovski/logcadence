// Small markdown subset for node content: fenced code blocks, inline code, bold, italic,
// links, bare URLs, #tags and [[refs]] (a YYYY-MM-DD ref links to that journal day,
// anything else to a tag). Hand-rolled so every platform renders notes identically.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'tag'; v: string }
  | { t: 'ref'; v: string }

export type Block = { t: 'code'; lang: string; code: string } | { t: 'para'; lines: Inline[][] }

const FENCE = /^```(\S*)\s*$/

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ t: 'para', lines: para.map(parseInline) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]!)
    if (!m) {
      para.push(lines[i]!)
      continue
    }
    flush()
    const code: string[] = []
    for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) code.push(lines[i]!)
    blocks.push({ t: 'code', lang: m[1] ?? '', code: code.join('\n') })
  }
  flush()
  return blocks
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[\[[^\]\n]+\]\])|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|((?<![\w#])#[\p{L}\p{N}_\-:./]*[\p{L}\p{N}_\-])|((?<![\w*])\*[^*\s][^*\n]*\*(?!\*))/gu

export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: 'text', v: line.slice(last, m.index) })
    const s = m[0]
    if (m[1]) out.push({ t: 'code', v: s.slice(1, -1) })
    else if (m[2]) out.push({ t: 'bold', v: s.slice(2, -2) })
    else if (m[3]) out.push({ t: 'ref', v: s.slice(2, -2).trim() })
    else if (m[4]) {
      const mid = s.indexOf('](')
      out.push({ t: 'link', v: s.slice(1, mid), href: s.slice(mid + 2, -1) })
    } else if (m[5]) out.push({ t: 'link', v: s, href: s })
    else if (m[6]) out.push({ t: 'tag', v: s.slice(1) })
    else out.push({ t: 'italic', v: s.slice(1, -1) })
    last = m.index + s.length
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) })
  return out
}

/** Plain text of content, for find/filter matching. */
export const matches = (text: string, query: string) => !query || text.toLowerCase().includes(query.toLowerCase())
