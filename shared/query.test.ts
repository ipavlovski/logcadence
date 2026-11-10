import { describe, expect, it } from 'vitest'
import { normalizeQuery, parseQuery, queryLabel, queryToString, typeView } from './query.ts'

describe('queries', () => {
  it('round-trips in one fixed order, dropping what is not valid', () => {
    expect(queryToString({ tags: ['dev/react'], types: ['bookmark'], site: 'reddit.com' })).toBe('type=bookmark&tag=dev%2Freact&site=reddit.com')
    expect(parseQuery('tag=Dev:React&type=bookmark/reddit&type=nope&category=build&untagged=1')).toEqual({ types: ['bookmark/reddit'], category: 'build', tags: ['dev/react'] })
    expect(normalizeQuery('site=reddit.com&type=bookmark')).toBe('type=bookmark&site=reddit.com')
    expect(parseQuery('junk')).toEqual({})
    // Videos and AI chats moved out (youtube-lib, ai-lib): their types and the channel facet read as nothing.
    expect(normalizeQuery('type=video&channel=WOT')).toBe('')
    expect(normalizeQuery('type=ai/claude-code&tag=dev')).toBe('tag=dev')
  })

  it('names a tab by its facets', () => {
    expect(queryLabel({ tags: ['dev/react'] })).toBe('#dev/react')
    expect(queryLabel({ types: ['bookmark'], site: 'reddit.com' })).toBe('Bookmarks · reddit.com')
    expect(queryLabel({ types: ['bookmark/reddit'], category: 'build' })).toBe('Reddit · build')
    expect(queryLabel({})).toBe('Browse')
  })

  it('shows a type in its own view while the view can filter by the rest', () => {
    expect(typeView({ types: ['bookmark'], site: 'reddit.com' })).toBe('bookmark')
    expect(typeView({ types: ['bookmark'], tags: ['build'] })).toBe('bookmark')
    expect(typeView({ types: ['bookmark'], tags: ['build'], site: 'reddit.com' })).toBeNull()
    expect(typeView({ types: ['bookmark'], category: 'build' })).toBeNull()
    expect(typeView({ types: ['bookmark/reddit'], site: 'r/selfhosted' })).toBe('bookmark')
    expect(typeView({ types: ['media'] })).toBe('media')
    expect(typeView({ types: ['media'], tags: ['build'] })).toBeNull()
    expect(typeView({ types: ['bookmark', 'media'] })).toBeNull()
    expect(typeView({ tags: ['dev'] })).toBeNull()
  })
})
