import { describe, expect, it } from 'vitest'
import type { EntryDTO } from '../shared/types.ts'
import { UNTAGGED, groupProgress, progressLabels, progressRows, sortProjects } from './progress.ts'

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

describe('progress', () => {
  it('groups tasks:progress entries by their full primary tag, then by day', () => {
    const map = groupProgress([
      entry('a', '2026-09-06', ['hp-d1', 'tasks:progress']),
      entry('b', '2026-09-06', ['tasks:progress', 'dev']),
      entry('c', '2026-09-04', ['project:coop', 'misc', 'tasks:progress']),
      entry('d', '2026-09-06', ['hp-d1', 'tasks:progress']),
      entry('e', '2026-09-05', ['hp-d1', 'tasks', 'tasks:progress:x']),
      entry('f', '2026-09-05', ['home:coop', 'tasks:progress']),
    ])
    expect([...map.keys()].sort()).toEqual([UNTAGGED, 'home:coop', 'hp-d1', 'project:coop'])
    expect(map.get('hp-d1')!.get('2026-09-06')!.map((e) => e.id)).toEqual(['a', 'd'])
    expect(map.get(UNTAGGED)!.get('2026-09-06')!.map((e) => e.id)).toEqual(['b'])
    expect([...map.get('project:coop')!.keys()]).toEqual(['2026-09-04'])
    expect([...map.get('home:coop')!.keys()]).toEqual(['2026-09-05'])
  })

  it('labels projects by their last segment, prepending parents only to break ties', () => {
    const projects = sortProjects(['project:coop', 'hp-d1', 'home:coop', UNTAGGED, 'a:x:y', 'b:x:y', 'garden:shed'])
    expect(projects).toEqual(['home:coop', 'project:coop', 'hp-d1', 'garden:shed', UNTAGGED, 'a:x:y', 'b:x:y'])
    expect(Object.fromEntries(progressLabels(projects))).toEqual({
      'home:coop': 'home:coop',
      'project:coop': 'project:coop',
      'hp-d1': 'hp-d1',
      'garden:shed': 'shed',
      [UNTAGGED]: 'untagged',
      'a:x:y': 'a:x:y',
      'b:x:y': 'b:x:y',
    })
  })

  it('lays out true scale with gaps and compact without, ending today', () => {
    const active = ['2026-09-06', '2026-09-04', '2026-09-06']
    expect(progressRows(active, '2026-09-09', 'true')).toEqual([
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ])
    expect(progressRows(active, '2026-09-09', 'compact')).toEqual(['2026-09-04', '2026-09-06', '2026-09-09'])
    expect(progressRows(['2026-09-09'], '2026-09-09', 'compact')).toEqual(['2026-09-09'])
    expect(progressRows([], '2026-09-09', 'true')).toEqual([])
  })
})
