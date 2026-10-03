import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bin, BIN_MS, dayBounds, partOfDay, sessions, union, type ActivitySpansDTO } from '../shared/activity.ts'
import { activitySpans } from './db/content-schema.ts'
import { openContentDb, type ContentDb } from './db/open.ts'
import { ActivityRecorder, POLL_MS, spansBetween } from './lib/activity.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'logcadence-activity-'))
process.env.LOGCADENCE_DATA_DIR = path.join(root, 'data')
let app: typeof import('./app.ts').app

const [DAY0, DAY1] = dayBounds('2026-09-17')
const at = (h: number, m = 0, s = 0) => DAY0 + ((h * 60 + m) * 60 + s) * 1000
const MIN = 60_000

describe('binning and sessions', () => {
  it('merges overlapping spans and clips them', () => {
    const spans = [
      { startAt: at(9), endAt: at(9, 10) },
      { startAt: at(9, 5), endAt: at(9, 20) },
      { startAt: at(9, 20), endAt: at(9, 30) },
      { startAt: at(23, 50), endAt: DAY1 + 30 * MIN },
    ]
    expect(union(spans, DAY0, DAY1)).toEqual([
      { startAt: at(9), endAt: at(9, 30) },
      { startAt: at(23, 50), endAt: DAY1 },
    ])
  })

  it('splits input time over 5-minute slots', () => {
    const bins = bin([{ startAt: at(9, 3), endAt: at(9, 11) }], DAY0, DAY1)
    expect(bins).toHaveLength(288)
    expect(bins.slice(108, 111)).toEqual([2 * MIN, BIN_MS, MIN])
    expect(bins.reduce((a, b) => a + b, 0)).toBe(8 * MIN)
  })

  it('groups input into sessions across short pauses and drops brief ones', () => {
    const input = [
      // morning: 8:00–11:00 with a 15-min pause
      { startAt: at(8), endAt: at(9, 30) },
      { startAt: at(9, 45), endAt: at(11) },
      // a quick check at noon
      { startAt: at(12), endAt: at(12, 3) },
      // evening: 19:00–21:00
      { startAt: at(19), endAt: at(21) },
    ]
    const s = sessions(input, DAY0, DAY1)
    expect(s.map((x) => [x.startAt, x.endAt, x.activeMs])).toEqual([
      [at(8), at(11), 165 * MIN],
      [at(19), at(21), 120 * MIN],
    ])
    expect(s.map(partOfDay)).toEqual(['Morning', 'Evening'])
  })
})

describe('recorder', () => {
  let db: ContentDb
  let t: number
  let lastInput: number
  const rec = () => new ActivityRecorder(db, () => Math.max(0, Math.floor((t - lastInput) / 1000)), 'pc', () => t)

  /** Runs ticks from t to `until`, with input at the times `inputAt` says. */
  function run(r: ActivityRecorder, until: number, inputAt: (t: number) => boolean) {
    for (; t <= until; t += POLL_MS) {
      for (let s = t - POLL_MS + 1000; s <= t; s += 1000) if (inputAt(s)) lastInput = s
      r.tick()
    }
  }
  const rows = (kind: 'input' | 'tracked') =>
    db
      .select()
      .from(activitySpans)
      .all()
      .filter((r) => r.kind === kind)
      .map((r) => [r.startAt, r.endAt])

  beforeAll(() => {
    db = openContentDb(mkdtempSync(path.join(root, 'rec-')))
  })
  afterAll(() => db.$client.close())

  it('records input spans, splitting on a pause over a minute and on sleep', () => {
    t = at(9)
    lastInput = at(8)
    const r = rec()
    // typing 9:00–9:10, a 30 s pause, 9:10:30–9:20, away 9:20–9:30, input 9:30–9:40
    run(r, at(9, 40), (s) => (s >= at(9) && s < at(9, 10)) || (s >= at(9, 10, 30) && s < at(9, 20)) || s >= at(9, 30))
    // asleep 9:40–10:00, then input 10:00–10:05
    t = at(10)
    run(r, at(10, 5), () => true)
    r.stop()

    const input = rows('input')
    expect(input).toHaveLength(3)
    // within a poll interval of the true times
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(POLL_MS)
    near(input[0]![0]!, at(9))
    near(input[0]![1]!, at(9, 20))
    near(input[1]![0]!, at(9, 30))
    near(input[1]![1]!, at(9, 40))
    near(input[2]![1]!, at(10, 5))
    expect(rows('tracked')).toEqual([
      [at(9), at(9, 40)],
      [at(10), at(10, 5)],
    ])
  })

  it('ignores input while the screen is locked', () => {
    db.delete(activitySpans).run()
    t = at(14)
    lastInput = at(13)
    const r = rec()
    run(r, at(14, 10), () => true)
    r.setLocked(true)
    run(r, at(14, 20), () => true)
    r.setLocked(false)
    run(r, at(14, 30), () => true)
    r.stop()
    const input = rows('input')
    expect(input).toHaveLength(2)
    expect(input[0]![1]).toBeLessThanOrEqual(at(14, 10))
    expect(input[1]![0]).toBeGreaterThan(at(14, 20))
  })

  it('queries spans overlapping a range, merged across devices', () => {
    db.delete(activitySpans).run()
    db.insert(activitySpans)
      .values([
        { device: 'a', kind: 'input', startAt: at(9), endAt: at(10) },
        { device: 'b', kind: 'input', startAt: at(9, 30), endAt: at(11) },
        { device: 'a', kind: 'input', startAt: DAY1 + MIN, endAt: DAY1 + 2 * MIN },
        { device: 'a', kind: 'tracked', startAt: at(8), endAt: at(12) },
      ])
      .run()
    const r = spansBetween(db, DAY0, DAY1)
    expect(r.input).toEqual([{ startAt: at(9), endAt: at(11) }])
    expect(r.tracked).toEqual([{ startAt: at(8), endAt: at(12) }])
    expect(r.recording).toBe(false)
  })
})

describe('activity route', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    app = (await import('./app.ts')).app
  })
  afterAll(async () => {
    const { closeDbs } = await import('./db/client.ts')
    closeDbs()
    rmSync(root, { recursive: true, force: true })
  })

  it('returns spans for a range and validates it', async () => {
    const ok = await app.request(`/api/activity/spans?from=${DAY0}&to=${DAY1}`)
    expect(ok.status).toBe(200)
    expect((await ok.json()) as ActivitySpansDTO).toEqual({ input: [], tracked: [], recording: false })
    expect((await app.request(`/api/activity/spans?from=${DAY1}&to=${DAY0}`)).status).toBe(400)
    expect((await app.request('/api/activity/spans')).status).toBe(400)
  })
})
