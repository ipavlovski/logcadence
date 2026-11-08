import { describe, expect, it } from 'vitest'
import { normalizeQuery, parseQuery, queryLabel, queryToString, typeView } from './query.ts'

describe('queries', () => {
  it('round-trips in one fixed order, dropping what is not valid', () => {
    expect(queryToString({ tags: ['dev/react'], types: ['video'], channel: 'WOT' })).toBe('type=video&tag=dev%2Freact&channel=WOT')
    expect(parseQuery('tag=Dev:React&type=video/youtube&type=nope&category=build&untagged=1')).toEqual({ types: ['video/youtube'], category: 'build', tags: ['dev/react'] })
    expect(normalizeQuery('channel=WOT&type=video')).toBe('type=video&channel=WOT')
    expect(parseQuery('junk')).toEqual({})
  })

  it('names a tab by its facets', () => {
    expect(queryLabel({ tags: ['dev/react'] })).toBe('#dev/react')
    expect(queryLabel({ types: ['video'], channel: 'WOT' })).toBe('Videos · WOT')
    expect(queryLabel({ types: ['bookmark/reddit'], category: 'build' })).toBe('Reddit · build')
    expect(queryLabel({})).toBe('Browse')
  })

  it('shows a type in its own view while the view can filter by the rest', () => {
    expect(typeView({ types: ['video'], channel: 'WOT' })).toBe('video')
    expect(typeView({ types: ['video'], tags: ['build'] })).toBe('video')
    expect(typeView({ types: ['video'], tags: ['build'], channel: 'WOT' })).toBeNull()
    expect(typeView({ types: ['video'], category: 'build' })).toBeNull()
    expect(typeView({ types: ['bookmark/reddit'], site: 'r/selfhosted' })).toBe('bookmark')
    expect(typeView({ types: ['ai/claude-code'] })).toBe('ai')
    expect(typeView({ types: ['media'] })).toBe('media')
    expect(typeView({ types: ['video', 'ai'] })).toBeNull()
    expect(typeView({ tags: ['dev'] })).toBeNull()
  })
})
