import { describe, expect, it } from 'vitest'
import { heatLevel, heatmapWeeks } from './heatmap.ts'

describe('heatmap', () => {
  it('lays out whole weeks from Sunday, ending on the given day', () => {
    // 2026-09-30 is a Wednesday.
    const cols = heatmapWeeks('2026-09-30', 3)
    expect(cols.map((c) => [c[0], c.at(-1), c.length])).toEqual([
      ['2026-09-13', '2026-09-19', 7],
      ['2026-09-20', '2026-09-26', 7],
      ['2026-09-27', '2026-09-30', 4],
    ])
  })

  it('buckets counts into four levels relative to the busiest day', () => {
    expect([0, 1, 5, 6, 10, 20].map((n) => heatLevel(n, 20))).toEqual([0, 1, 1, 2, 2, 4])
    expect(heatLevel(3, 0)).toBe(0)
  })
})
