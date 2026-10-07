import { describe, expect, it } from 'vitest'
import { pushStep, reviveYt, stepHistory, toListing, withAnchor, withFilter, type YtState } from './state/youtube.ts'

const start = (): YtState => reviveYt(null)

describe('YouTube tab history', () => {
  it('a video click keeps the listing position for back, and forward returns to the video', () => {
    let s = withAnchor(start(), { date: '2026-03-02', offset: 120 })
    s = pushStep(s, { videoId: 'a' })
    expect(s.videoId).toBe('a')
    s = stepHistory(s, -1)!
    expect(s.videoId).toBeNull()
    expect(s.history[s.hIndex]!.anchor).toEqual({ date: '2026-03-02', offset: 120 })
    s = stepHistory(s, 1)!
    expect(s.videoId).toBe('a')
    expect(stepHistory(s, 1)).toBeNull()
  })

  it('a new step drops the forward ones', () => {
    let s = pushStep(pushStep(start(), { videoId: 'a' }), { videoId: 'b' })
    s = pushStep(stepHistory(s, -1)!, { videoId: null, anchor: null })
    expect(s.history.map((e) => e.videoId)).toEqual([null, 'a', null])
  })

  it('anchors are saved into listing steps only', () => {
    const s = pushStep(start(), { videoId: 'a' })
    expect(withAnchor(s, { date: '2026-01-01', offset: 0 })).toBe(s)
  })

  it('"← Videos" goes back to the listing step before, else opens the listing at the video', () => {
    let s = pushStep(start(), { videoId: 'a' })
    expect(toListing(s).hIndex).toBe(0)
    s = pushStep(s, { videoId: 'b' })
    const t = toListing(s)
    expect(t.history.at(-1)).toEqual({ videoId: null, anchor: { video: 'b' }, filter: null })
    expect(t.seq).toBe(s.seq + 1)
  })

  it('the logo clears the filter, and back brings the filter and position back', () => {
    let s = withFilter(start(), { kind: 'tag', path: 'build' })
    s = withAnchor(s, { date: '2026-03-02', offset: 40 })
    s = pushStep(s, { videoId: null, anchor: null, filter: null })
    expect(s.filter).toBeNull()
    s = stepHistory(s, -1)!
    expect(s.filter).toEqual({ kind: 'tag', path: 'build' })
    expect(s.history[s.hIndex]!.anchor).toEqual({ date: '2026-03-02', offset: 40 })
  })

  it('a video step keeps the filter; a listing step without one records it', () => {
    let s = withFilter(start(), { kind: 'untagged' })
    s = pushStep(s, { videoId: 'a' })
    expect(s.filter).toEqual({ kind: 'untagged' })
    s = pushStep(s, { videoId: null, anchor: { video: 'a' } })
    expect(s.history.at(-1)!.filter).toEqual({ kind: 'untagged' })
  })

  it('revives a stored history, or starts over when it does not match the open video', () => {
    const s = pushStep(withAnchor(start(), { date: '2026-03-02', offset: 5 }), { videoId: 'a' })
    expect(reviveYt(JSON.parse(JSON.stringify(s))).history).toEqual(s.history)
    expect(reviveYt({ ...s, videoId: 'zzz' }).history).toEqual([{ videoId: 'zzz' }])
  })
})
