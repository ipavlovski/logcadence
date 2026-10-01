import { describe, expect, it } from 'vitest'
import type { EntryDTO } from '../shared/types.ts'
import { groupThreads, threadRows } from './threads.ts'

const entry = (id: string, date: string, tags: string[]): EntryDTO => ({
  id,
  date,
  title: id,
  position: 1,
  archived: false,
  tags,
  nodes: [],
  chat: null,
  createdAt: 0,
  updatedAt: 0,
})

describe('threads', () => {
  it('groups done:<project> entries by project and day', () => {
    const map = groupThreads([
      entry('a', '2026-09-06', ['done:project-a', 'done:project-b']),
      entry('b', '2026-09-06', ['dev', 'done:project-a']),
      entry('c', '2026-09-04', ['done:home:coop']),
      entry('d', '2026-09-05', ['done', 'undone:x']),
    ])
    expect([...map.keys()].sort()).toEqual(['home:coop', 'project-a', 'project-b'])
    expect(map.get('project-a')!.get('2026-09-06')!.map((e) => e.id)).toEqual(['a', 'b'])
    expect(map.get('project-b')!.get('2026-09-06')!.map((e) => e.id)).toEqual(['a'])
    expect([...map.get('home:coop')!.keys()]).toEqual(['2026-09-04'])
  })

  it('lays out true scale with gaps and compact without, ending today', () => {
    const active = ['2026-09-06', '2026-09-04', '2026-09-06']
    expect(threadRows(active, '2026-09-09', 'true')).toEqual([
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ])
    expect(threadRows(active, '2026-09-09', 'compact')).toEqual(['2026-09-04', '2026-09-06', '2026-09-09'])
    expect(threadRows(['2026-09-09'], '2026-09-09', 'compact')).toEqual(['2026-09-09'])
    expect(threadRows([], '2026-09-09', 'true')).toEqual([])
  })
})
