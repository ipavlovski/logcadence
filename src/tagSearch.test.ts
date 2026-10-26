import { describe, expect, it } from 'vitest'
import { suggestTags } from './tagSearch.ts'

const PATHS = ['dev', 'dev/frontend', 'dev/frontend/other-frameworks', 'dev/frontend/react', 'dev/fundamentals', 'design', 'fab', 'fab/devices']
const paths = (text: string, taken?: string[]) => suggestTags(PATHS, text, taken).map((s) => s.path + (s.branch ? '/' : ''))

describe('tag suggestions', () => {
  it('suggest a level at a time', () => {
    expect(paths('de')).toEqual(['design', 'dev/', 'fab/devices'])
    expect(paths('dev/')).toEqual(['dev/frontend/', 'dev/fundamentals'])
    expect(paths('dev/f')).toEqual(['dev/frontend/', 'dev/fundamentals'])
    // Names starting with what's typed, then those containing it.
    expect(paths('dev/frontend/r')).toEqual(['dev/frontend/react', 'dev/frontend/other-frameworks'])
  })

  it('read #, capitals, spaces and the old ":" separator', () => {
    expect(paths('#Dev:Frontend/other f')).toEqual(['dev/frontend/other-frameworks'])
  })

  it('leave out tags already added, unless there is a level below them', () => {
    expect(paths('dev/fun', ['dev/fundamentals'])).toEqual([])
    expect(paths('dev', ['dev'])).toEqual(['dev/', 'fab/devices'])
  })
})
