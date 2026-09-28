import { describe, expect, it } from 'vitest'
import { parseBlocks, parseInline } from './markdown.ts'

describe('markdown', () => {
  it('splits fenced code from paragraphs', () => {
    const blocks = parseBlocks('intro\n```powershell\nGet-PhysicalDisk | Format-Table\n```\noutro')
    expect(blocks.map((b) => b.t)).toEqual(['para', 'code', 'para'])
    expect(blocks[1]).toEqual({ t: 'code', lang: 'powershell', code: 'Get-PhysicalDisk | Format-Table' })
  })

  it('parses tags, refs, links and emphasis', () => {
    expect(parseInline('see #system:windows and [[2026-09-20]], **bold** `x` https://a.io/b.')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'tag', v: 'system:windows' },
      { t: 'text', v: ' and ' },
      { t: 'ref', v: '2026-09-20' },
      { t: 'text', v: ', ' },
      { t: 'bold', v: 'bold' },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'x' },
      { t: 'text', v: ' ' },
      { t: 'link', v: 'https://a.io/b', href: 'https://a.io/b' },
      { t: 'text', v: '.' },
    ])
  })

  it('does not treat url fragments or C# as tags', () => {
    expect(parseInline('C# and a#b').every((p) => p.t === 'text')).toBe(true)
  })
})
