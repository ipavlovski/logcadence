import { describe, expect, it } from 'vitest'
import { parseNotes } from './components/Updates/ReleaseNotes.tsx'

describe('release notes parser', () => {
  it('reads headings, nested bullets and paragraphs', () => {
    const md = 'Intro line\nwraps.\n\n## Changes since 0.2.0.1\r\n\n- Add X (abc)\n  - detail one\n  - detail two\n- Fix Y (def)\n\nOutro.'
    expect(parseNotes(md)).toEqual([
      { t: 'p', text: 'Intro line wraps.' },
      { t: 'h', text: 'Changes since 0.2.0.1' },
      {
        t: 'ul',
        items: [
          { text: 'Add X (abc)', children: [{ text: 'detail one', children: [] }, { text: 'detail two', children: [] }] },
          { text: 'Fix Y (def)', children: [] },
        ],
      },
      { t: 'p', text: 'Outro.' },
    ])
  })
})
