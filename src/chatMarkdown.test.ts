import { describe, expect, it } from 'vitest'
import { parseChatMarkdown } from './chatMarkdown.ts'

describe('chat markdown blocks', () => {
  it('parses headings, lists, tables, quotes, rules and code', () => {
    const src = [
      '## Plan',
      'Two steps:',
      '- first',
      '  continued',
      '  - nested',
      '1. one',
      '',
      '| a | b |',
      '|---|:-:|',
      '| 1 | 2 |',
      '> quoted',
      '---',
      '```ts',
      '- not a list',
      '```',
    ].join('\n')
    expect(parseChatMarkdown(src)).toEqual([
      { t: 'heading', level: 2, text: 'Plan' },
      { t: 'para', lines: ['Two steps:'] },
      {
        t: 'list',
        ordered: false,
        items: [
          { text: 'first\ncontinued', depth: 0 },
          { text: 'nested', depth: 1 },
          { text: 'one', depth: 0 },
        ],
      },
      { t: 'table', head: ['a', 'b'], rows: [['1', '2']] },
      { t: 'quote', lines: ['quoted'] },
      { t: 'rule' },
      { t: 'code', lang: 'ts', code: '- not a list' },
    ])
  })

  it('leaves a lone pipe line as text', () => {
    expect(parseChatMarkdown('| not a table')).toEqual([{ t: 'para', lines: ['| not a table'] }])
  })
})
