import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { listProgress, WEEKDAYS_ONLY, type ChecklistDayDTO, type ChecklistDTO } from '../shared/checklists.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-checklists-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app

beforeAll(async () => {
  // "Today" is Thursday, Oct 8th, 2026: removals and later additions are dated from it.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00'))
  app = (await import('./app.ts')).app
})
afterAll(async () => {
  vi.useRealTimers()
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

const days = (from: string, to: string) => req<{ days: ChecklistDayDTO[] }>('GET', `/api/checklists/days?from=${from}&to=${to}`).then((r) => r.days)
const day = (date: string) => days(date, date).then((d) => d[0]!)
const mark = (itemId: string, date: string, count: number) => req('PUT', '/api/checklists/marks', { itemId, date, count })

let reddit: ChecklistDTO
let work: ChecklistDTO

describe('checklists', () => {
  it('creates checklists, due on their days', async () => {
    reddit = await req<ChecklistDTO>('POST', '/api/checklists', {
      title: 'Reddit',
      startDate: '2026-10-01',
      endDate: null,
      weekdays: 127,
      items: [
        { label: 'Review subreddits', target: 25, source: null },
        { label: 'Save posts', target: 50, source: 'reddit-posts' },
      ],
    })
    work = await req<ChecklistDTO>('POST', '/api/checklists', {
      title: 'Work',
      startDate: '2026-10-05',
      endDate: '2026-10-09',
      weekdays: WEEKDAYS_ONLY,
      items: [{ label: 'SEO dashboard', target: 1, source: null }],
    })
    expect(reddit.items.map((i) => i.target)).toEqual([25, 50])

    const week = await days('2026-10-03', '2026-10-11')
    const titles = Object.fromEntries(week.map((d) => [d.date, d.lists.map((l) => l.title).join(',')]))
    expect(titles).toEqual({
      '2026-10-03': 'Reddit', // Saturday
      '2026-10-04': 'Reddit',
      '2026-10-05': 'Reddit,Work',
      '2026-10-06': 'Reddit,Work',
      '2026-10-07': 'Reddit,Work',
      '2026-10-08': 'Reddit,Work',
      '2026-10-09': 'Reddit,Work',
      '2026-10-10': 'Reddit', // Work ended
      '2026-10-11': 'Reddit',
    })
  })

  it('records marks and adds sourced counts from the app data', async () => {
    const [review, save] = reddit.items
    await mark(review!.id, '2026-10-08', 25)
    await mark(save!.id, '2026-10-08', 2)
    const { db } = await import('./db/client.ts')
    const { captures } = await import('./db/content-schema.ts')
    for (const [i, site] of ['r/a', 'r/a', 'r/b'].entries())
      db.insert(captures)
        .values({ id: `c${i}`, kind: 'reddit', key: `k${i}`, url: 'u', title: 't', site, screenshot: 's', capturedAt: 0, capturedDate: '2026-10-08', updatedAt: 0 })
        .run()

    const list = (await day('2026-10-08')).lists.find((l) => l.id === reddit.id)!
    expect(list.items.map((i) => [i.count, i.auto])).toEqual([
      [25, null],
      [2, 3],
    ])
    expect(listProgress(list.items)).toBeCloseTo((1 + 5 / 50) / 2)

    // YouTube: videos edited or given an image that day, each once; an import (create) doesn't count.
    const { eventsDb } = await import('./db/client.ts')
    const { events } = await import('./db/events-schema.ts')
    const at = (h: number) => new Date(`2026-10-08T${String(h).padStart(2, '0')}:00:00`).getTime()
    eventsDb
      .insert(events)
      .values([
        { ts: at(9), entity: 'yt-video', nodeId: 'v1', op: 'edit', payload: {} },
        { ts: at(10), entity: 'yt-image', nodeId: 'img', op: 'create', payload: { videoId: 'v1' } },
        { ts: at(11), entity: 'yt-image', nodeId: 'img2', op: 'create', payload: { videoId: 'v2' } },
        { ts: at(12), entity: 'yt-video', nodeId: 'v3', op: 'create', payload: {} },
        { ts: at(9) - 86_400_000, entity: 'yt-video', nodeId: 'v4', op: 'edit', payload: {} },
      ])
      .run()
    const yt = await req<ChecklistDTO>('POST', '/api/checklists', { title: 'YouTube', startDate: '2026-10-08', endDate: '2026-10-08', weekdays: 127, items: [{ label: 'Videos', target: 30, source: 'youtube-videos' }] })
    expect((await day('2026-10-08')).lists.find((l) => l.id === yt.id)!.items[0]!.auto).toBe(2)
    await req('DELETE', `/api/checklists/${yt.id}`)

    await mark(review!.id, '2026-10-08', 0)
    expect((await day('2026-10-08')).lists[0]!.items[0]!.count).toBe(0)
  })

  it('keeps a removed item on the days it was ticked, and counts added ones from today', async () => {
    const [review, save] = reddit.items
    await mark(review!.id, '2026-10-06', 10)
    const edited = await req<ChecklistDTO>('PATCH', `/api/checklists/${reddit.id}`, {
      items: [{ id: save!.id, label: 'Save posts', target: 40, source: 'reddit-posts' }, { label: 'Write comments', target: 20, source: null }],
    })
    expect(edited.items.map((i) => i.label)).toEqual(['Save posts', 'Write comments'])
    expect(edited.items[0]!.id).toBe(save!.id)

    const labels = async (date: string) => (await day(date)).lists.find((l) => l.id === reddit.id)!.items.map((i) => i.label)
    // Before today the list had its old items, ticked or not; comments came later.
    expect(await labels('2026-10-07')).toEqual(['Review subreddits', 'Save posts'])
    expect(await labels('2026-10-08')).toEqual(['Save posts', 'Write comments'])
    const { db } = await import('./db/client.ts')
    const { checklistItems } = await import('./db/content-schema.ts')
    // Kept for its ticks (Oct 6th), out of the list from today.
    expect(db.select().from(checklistItems).all().find((i) => i.id === review!.id)?.removedDate).toBe('2026-10-08')
  })

  it('validates, archives, reorders and deletes', async () => {
    await expect(req('POST', '/api/checklists', { title: 'x', startDate: '2026-10-08', endDate: '2026-10-01', weekdays: 127, items: [{ label: 'a', target: 1 }] })).rejects.toThrow(/before the start/)
    await expect(req('PATCH', `/api/checklists/${work.id}`, { weekdays: 0 })).rejects.toThrow(/at least one day/)
    await expect(req('PATCH', `/api/checklists/${work.id}`, { items: [] })).rejects.toThrow(/at least one item/)

    await req('PATCH', `/api/checklists/${work.id}`, { archived: true })
    expect((await day('2026-10-08')).lists.map((l) => l.title)).toEqual(['Reddit'])

    const { checklists } = await req<{ checklists: ChecklistDTO[] }>('PUT', '/api/checklists/order', { ids: [work.id, reddit.id] })
    expect(checklists.map((c) => [c.title, c.archived])).toEqual([
      ['Work', true],
      ['Reddit', false],
    ])

    await req('DELETE', `/api/checklists/${reddit.id}`)
    expect((await req<{ checklists: ChecklistDTO[] }>('GET', '/api/checklists')).checklists.map((c) => c.title)).toEqual(['Work'])
    expect((await day('2026-10-08')).lists).toEqual([])
  })
})
