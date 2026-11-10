import { describe, expect, it } from 'vitest'
import { normalizeQuery, parseQuery, queryLabel, queryToString } from './query.ts'

describe('queries', () => {
  it('round-trips in one fixed order, dropping what is not valid', () => {
    expect(queryToString({ tags: ['dev/react'], category: 'build' })).toBe('category=build&tag=dev%2Freact')
    expect(parseQuery('tag=Dev:React&category=build&untagged=1')).toEqual({ category: 'build', tags: ['dev/react'] })
    expect(normalizeQuery('tag=dev&category=build')).toBe('category=build&tag=dev')
    expect(parseQuery('junk')).toEqual({})
  })

  it('reads the types and sites of older tabs as nothing, or as the tag a type became', () => {
    expect(normalizeQuery('type=bookmark&site=reddit.com')).toBe('')
    expect(normalizeQuery('type=media')).toBe('')
    expect(normalizeQuery('type=video&channel=WOT')).toBe('')
    expect(normalizeQuery('type=ai/claude-code&tag=dev')).toBe('tag=dev')
    expect(parseQuery('type=bookmark/reddit&site=r/selfhosted')).toEqual({ tags: ['reddit'] })
    expect(parseQuery('type=bookmark/marketplace&tag=desk')).toEqual({ tags: ['desk', 'marketplace'] })
  })

  it('names a tab by its facets', () => {
    expect(queryLabel({ tags: ['dev/react'] })).toBe('#dev/react')
    expect(queryLabel({ category: 'build', tags: ['well'] })).toBe('Build · #well')
    expect(queryLabel({ uncategorized: true, untagged: true })).toBe('uncategorized · untagged')
    expect(queryLabel({})).toBe('Browse')
  })
})
