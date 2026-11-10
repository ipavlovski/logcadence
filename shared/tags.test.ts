import { describe, expect, it } from 'vitest'
import { ancestors, buildTagTree, isUnder, normalizeTag, withoutCategory } from './tags.ts'

describe('tags', () => {
  it('normalizes', () => {
    expect(normalizeTag(' #System: Windows :PowerToys ')).toBe('system/windows/powertoys')
    expect(normalizeTag('design:davinci resolve::til')).toBe('design/davinci-resolve/til')
    expect(normalizeTag('#')).toBe('')
  })

  it('knows the hierarchy', () => {
    expect(ancestors('a/b/c')).toEqual(['a', 'a/b'])
    expect(isUnder('a/b', 'a')).toBe(true)
    expect(isUnder('ab', 'a')).toBe(false)
  })

  it('builds a tree with virtual ancestors and totals', () => {
    const [root] = buildTagTree([
      { path: 'tidewater/blog/a', active: 2, archived: 1 },
      { path: 'tidewater/blog/b', active: 1, archived: 0 },
    ])
    expect(root).toMatchObject({ path: 'tidewater', active: 0, totalActive: 3, totalArchived: 1 })
    expect(root!.children[0]!.children.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('leaves out the category: its own tag goes, a tag under it loses that part', () => {
    expect(withoutCategory(['#Dev', 'dev/react', 'react', 'devops', 'notes'], 'dev')).toEqual(['react', 'devops', 'notes'])
    expect(withoutCategory(['Dev', 'x'], null)).toEqual(['dev', 'x'])
  })
})
