import { describe, expect, it } from 'vitest'
import { pushStep, reviveCaptures, stepHistory, toListing, withAnchor, withFilter, type CaptureState } from './state/captures.ts'

const start = (): CaptureState => reviveCaptures(null)

describe('Reddit and Bookmarks tab history', () => {
  it('opening a capture keeps the listing position for back, and its site filter', () => {
    let s = withFilter(start(), { kind: 'site', site: 'r/selfhosted' })
    s = withAnchor(s, { date: '2026-10-01', offset: 80 })
    s = pushStep(s, { itemId: 'a' })
    expect(s.itemId).toBe('a')
    s = stepHistory(s, -1)!
    expect(s).toMatchObject({ itemId: null, filter: { kind: 'site', site: 'r/selfhosted' } })
    expect(s.history[s.hIndex]!.anchor).toEqual({ date: '2026-10-01', offset: 80 })
  })

  it('back to the listing from a capture opened elsewhere lands on its card', () => {
    let s = pushStep(pushStep(start(), { itemId: 'a' }), { itemId: 'b' })
    s = toListing(s)
    expect(s.history.at(-1)).toEqual({ itemId: null, anchor: { item: 'b' }, filter: null })
  })

  it('revives a stored state, dropping junk', () => {
    const s = reviveCaptures({ itemId: 'b', filter: { kind: 'site', site: 7 }, history: [{ itemId: null, anchor: { date: 'nope' } }, { itemId: 'b' }, 5], hIndex: 1 })
    expect(s).toMatchObject({ itemId: 'b', filter: null, hIndex: 1, history: [{ itemId: null, anchor: null }, { itemId: 'b' }] })
    expect(reviveCaptures({ itemId: 'x', history: [{ itemId: 'y' }], hIndex: 0 }).history).toEqual([{ itemId: 'x' }])
  })
})
