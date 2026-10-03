import { describe, expect, it } from 'vitest'
import { bodyBullets, releaseNotes } from './lib/notes.ts'

describe('release notes', () => {
  it('takes the bullets of a commit body, joining continuation lines and dropping trailers', () => {
    const body = 'Some intro.\n\n- first point\n  continued here\n- second\n\nCo-Authored-By: Someone <x@y>'
    expect(bodyBullets(body)).toEqual(['first point continued here', 'second'])
  })

  it('writes dev build and release notes', () => {
    const commits = [
      { hash: 'abc1234', subject: 'Add the Activity tab', body: '- 5-minute bins\n- sessions' },
      { hash: 'def5678', subject: 'Fix a typo', body: '' },
    ]
    expect(releaseNotes({ tag: 'v0.2.0.2', previous: 'v0.2.0.1', commits, release: '0.1.0' })).toBe(
      "Dev build of 0.2.0 (the current release is 0.1.0). Install it from the app's Updates window.\n\n" +
        '## Changes since 0.2.0.1\n\n- Add the Activity tab (abc1234)\n  - 5-minute bins\n  - sessions\n- Fix a typo (def5678)\n',
    )
    expect(releaseNotes({ tag: 'v0.2.0', previous: 'v0.1.0', commits: [], devTags: ['v0.2.0.1', 'v0.2.0.2'], release: '0.2.0' })).toBe(
      'Rolls up the dev builds 0.2.0.1, 0.2.0.2.\n\n## Changes since 0.1.0\n\n- No changes\n',
    )
  })
})
