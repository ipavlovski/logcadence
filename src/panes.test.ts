import { beforeEach, describe, expect, it } from 'vitest'
import { today } from '../shared/dates.ts'
import {
  activateTab,
  activeJournalDate,
  activeTypeView,
  closeAllTabs,
  closeTab,
  closeTagTabs,
  goDayHistory,
  goHistory,
  openDate,
  openLoc,
  openQuery,
  openTag,
  paneTabs,
  panesStore,
  pinPreviewDay,
  pinPreviewQuery,
  renameTagTabs,
  revivePanes,
  setTabQuery,
  stepDay,
} from './state/panes.ts'

const canvas = () => paneTabs('canvas')
const active = () => panesStore.get().panes.canvas.active

const tags = () => paneTabs('tags')
const tagsActive = () => panesStore.get().panes.tags.active
const preview = () => panesStore.get().previewQuery

beforeEach(() => {
  closeAllTabs('canvas')
  closeAllTabs('tags')
  openLoc('canvas', 'journal')
  openQuery('')
})

describe('day tabs', () => {
  it('opens a day in the preview tab, which the next day opened replaces; today opens in Today', () => {
    openDate('2026-09-20')
    expect(active()).toBe('preview-day')
    expect(activeJournalDate()).toBe('2026-09-20')
    expect(canvas()).toEqual(['journal', 'preview-day'])
    openDate('2026-09-21')
    expect(canvas()).toEqual(['journal', 'preview-day'])
    expect(activeJournalDate()).toBe('2026-09-21')
    openDate(today())
    expect(active()).toBe('journal')
    expect(activeJournalDate()).toBe(today())
    activateTab('canvas', 'preview-day')
    expect(activeJournalDate()).toBe('2026-09-21')
  })

  it('steps back and forward through the days opened', () => {
    openDate('2026-09-20')
    openDate('2026-09-21')
    openDate(today())
    goDayHistory(-1)
    expect([active(), activeJournalDate()]).toEqual(['preview-day', '2026-09-21'])
    goDayHistory(-1)
    expect(activeJournalDate()).toBe('2026-09-20')
    // A new day drops the forward history.
    openDate('2026-09-25')
    goDayHistory(1)
    expect(activeJournalDate()).toBe('2026-09-25')
  })

  it('pins the preview (double-click) or a day opened with ctrl+click; stepping from a pinned day goes to the preview', () => {
    openDate('2026-09-20')
    pinPreviewDay()
    expect(active()).toBe('day:2026-09-20')
    expect(canvas().slice(0, 2)).toEqual(['journal', 'day:2026-09-20'])
    stepDay(1)
    expect([active(), activeJournalDate()]).toEqual(['preview-day', '2026-09-21'])
    expect(canvas().slice(0, 3)).toEqual(['journal', 'day:2026-09-20', 'preview-day'])
    openDate('2026-09-20')
    expect(active()).toBe('day:2026-09-20')
    openDate('2026-09-10', { newTab: true })
    expect(canvas().slice(0, 4)).toEqual(['journal', 'day:2026-09-20', 'day:2026-09-10', 'preview-day'])
    // Closing a day tab goes to the tab before it; Today doesn't close.
    closeTab('canvas', 'day:2026-09-10')
    expect(active()).toBe('day:2026-09-20')
    closeTab('canvas', 'journal')
    closeTab('canvas', 'preview-day')
    expect(canvas()).toEqual(['journal', 'day:2026-09-20'])
  })

  it('migrates the single journal tab: its day becomes the preview', () => {
    const s = revivePanes({ panes: { canvas: { tabs: ['journal'], active: 'journal', history: ['journal'], hIndex: 0 } }, day: '2026-09-20', dayHistory: [null, '2026-09-20'], dayIndex: 1 })
    expect([s.previewDay, s.panes.canvas.active, s.dayTab, s.pinnedDays]).toEqual(['2026-09-20', 'preview-day', 'preview-day', []])
    expect(s.dayHistory).toEqual([today(), '2026-09-20'])
    // A day tab that's gone gives way to Today.
    expect(revivePanes({ panes: { canvas: { tabs: [], active: 'day:2026-09-01', history: [], hIndex: 0 } }, pinnedDays: [] }).panes.canvas.active).toBe('journal')
  })

  it('migrates the three-pane layout: the journal pane’s day, and tabs that moved away', () => {
    const s = revivePanes({
      panes: {
        canvas: { tabs: ['dashboard'], active: 'plugin:map', history: ['dashboard', 'plugin:map'], hIndex: 1 },
        journal: { tabs: ['today', 'date:2026-09-20'], active: 'date:2026-09-20', history: ['today'], hIndex: 0 },
        tags: { tabs: ['tree', 'tag:dev'], active: 'tag:dev', history: ['tree', 'tag:dev'], hIndex: 1 },
      },
      focus: 'journal',
      open: { canvas: false, journal: true, tags: true },
      weights: { canvas: 0.75, journal: 1.35, tags: 1 },
    })
    expect(s.previewDay).toBe('2026-09-20')
    expect(s.dayHistory).toEqual(['2026-09-20'])
    expect(s.panes.canvas.active).toBe('preview-day')
    expect(s.panes.tags.active).toBe('q:tag=dev')
    expect(s.focus).toBe('canvas')
    expect(s.open).toEqual({ canvas: true, tags: true })
    expect(Object.keys(s.weights).sort()).toEqual(['canvas', 'tags'])
  })
})

describe('tags pane', () => {
  it('shows what was clicked in the preview, and a query of its own in a tab (ctrl+click or double-click)', () => {
    openTag('dev/react')
    expect([tags(), tagsActive(), preview()]).toEqual([['preview'], 'preview', 'tag=dev%2Freact'])
    openQuery({ types: ['video'], channel: 'WOT' })
    expect(preview()).toBe('type=video&channel=WOT')
    expect(activeTypeView()).toBe('video')
    openQuery({ category: 'build' }, { newTab: true })
    expect([tags(), tagsActive()]).toEqual([['preview', 'q:category=build'], 'q:category=build'])
    // The same query again goes to its tab.
    openQuery({ category: 'build' })
    expect(preview()).toBe('type=video&channel=WOT')
    activateTab('tags', 'preview')
    pinPreviewQuery()
    expect([tags(), tagsActive(), preview()]).toEqual([['preview', 'q:type=video&channel=WOT', 'q:category=build'], 'q:type=video&channel=WOT', ''])
    // A view's own filter (or a removed facet) retargets the tab it shows in.
    setTabQuery('q:type=video&channel=WOT', { types: ['video'] })
    expect(tags()).toEqual(['preview', 'q:type=video', 'q:category=build'])
    closeTab('tags', 'q:type=video')
    expect(tags()).toEqual(['preview', 'q:category=build'])
  })

  it('steps back through the queries shown, the preview included', () => {
    openTag('a')
    openTag('b')
    goHistory('tags', -1)
    expect([tagsActive(), preview()]).toEqual(['preview', 'tag=a'])
    goHistory('tags', 1)
    expect(preview()).toBe('tag=b')
  })

  it('follows tag renames and deletes in every query', () => {
    openQuery({ tags: ['dev/react'], category: 'dev' }, { newTab: true })
    openTag('dev/react/hooks')
    renameTagTabs('dev', 'code')
    expect(tags()).toEqual(['preview', 'q:category=dev&tag=code%2Freact'])
    expect(preview()).toBe('tag=code%2Freact%2Fhooks')
    closeTagTabs('code/react')
    expect(tags()).toEqual(['preview', 'q:category=dev'])
    expect(preview()).toBe('')
  })

  it('migrates the tag tree and tag tabs, and the canvas plugin tabs', () => {
    const s = revivePanes({
      panes: {
        canvas: { tabs: ['journal'], active: 'plugin:youtube', history: ['plugin:youtube'], hIndex: 0 },
        tags: { tabs: ['tree', 'tag:dev:react'], active: 'tree', history: ['tree', 'tag:dev:react'], hIndex: 1 },
      },
    })
    expect(s.panes.canvas.active).toBe('journal')
    expect(s.panes.tags).toEqual({ tabs: ['preview', 'q:tag=dev%2Freact'], active: 'preview', history: ['preview', 'q:tag=dev%2Freact'], hIndex: 1 })
  })
})
