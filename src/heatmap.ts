import { shiftDate } from '../shared/dates.ts'

// GitHub-style calendar heatmap: one column per week (Sunday on top), ending with the week of `end`.

/** Columns of 7 dates, oldest week first. The last column stops at `end`. */
export function heatmapWeeks(end: string, weeks: number): string[][] {
  const endDow = new Date(end + 'T12:00:00').getDay()
  const start = shiftDate(end, -endDow - 7 * (weeks - 1))
  const cols: string[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: string[] = []
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(start, w * 7 + d)
      if (date > end) break
      col.push(date)
    }
    cols.push(col)
  }
  return cols
}

/** 0 for nothing, else 1-4 in quarters of the busiest day. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
}
