import { beforeEach, describe, expect, it } from 'vitest'
import { canvasTabsStore, moveCanvasTab, resetCanvasTabs, setCanvasTabShown, syncCanvasPlugins, visibleCanvasTabs } from './state/canvasTabs.ts'
import { today } from '../shared/dates.ts'
import { activateTab, activeJournalDate, closeAllTabs, closeTab, cycleTab, goDayHistory, openDate, openLoc, paneTabs, panesStore, pinPreviewDay, revivePanes, stepDay } from './state/panes.ts'

const canvas = () => paneTabs('canvas')
const active = () => panesStore.get().panes.canvas.active

beforeEach(() => {
  resetCanvasTabs(['map', 'youtube', 'ai'])
  closeAllTabs('canvas')
  openLoc('canvas', 'journal')
})

describe('canvas tabs', () => {
  it('keeps saved order and hidden tabs across plugin changes, adding new plugins at the end', () => {
    moveCanvasTab('ai', -2)
    setCanvasTabShown('map', false)
    syncCanvasPlugins(['map', 'ai', 'youtube'])
    expect(canvasTabsStore.get()).toEqual({ order: ['ai', 'map', 'youtube'], hidden: ['map'] })
    expect(visibleCanvasTabs()).toEqual(['ai', 'youtube'])
  })

  it('shows the journal and every plugin shown, plus a hidden one while it is open', () => {
    setCanvasTabShown('youtube', false)
    expect(canvas()).toEqual(['journal', 'plugin:map', 'plugin:ai'])
    openLoc('canvas', 'plugin:youtube')
    expect(canvas()).toEqual(['journal', 'plugin:map', 'plugin:ai', 'plugin:youtube'])
    // Fixed tabs don't close; the hidden one does, back to the journal.
    closeTab('canvas', 'plugin:map')
    expect(active()).toBe('plugin:youtube')
    closeTab('canvas')
    expect(active()).toBe('journal')
    expect(canvas()).toEqual(['journal', 'plugin:map', 'plugin:ai'])
  })

  it('cycles through the tab bar order, wrapping around', () => {
    moveCanvasTab('ai', -1)
    cycleTab('canvas', 1)
    expect(active()).toBe('plugin:map')
    cycleTab('canvas', 1)
    expect(active()).toBe('plugin:ai')
    cycleTab('canvas', -1)
    cycleTab('canvas', -1)
    cycleTab('canvas', -1)
    expect(active()).toBe('plugin:youtube')
  })
})

describe('day tabs', () => {
  it('opens a day in the preview tab, which the next day opened replaces; today opens in Today', () => {
    openLoc('canvas', 'plugin:youtube')
    openDate('2026-09-20')
    expect(active()).toBe('preview-day')
    expect(activeJournalDate()).toBe('2026-09-20')
    expect(canvas()).toEqual(['journal', 'preview-day', 'plugin:map', 'plugin:youtube', 'plugin:ai'])
    openDate('2026-09-21')
    expect(canvas()).toEqual(['journal', 'preview-day', 'plugin:map', 'plugin:youtube', 'plugin:ai'])
    expect(activeJournalDate()).toBe('2026-09-21')
    openDate(today())
    expect(active()).toBe('journal')
    expect(activeJournalDate()).toBe(today())
    // A plugin tab shows the journal's day of the day tab last active.
    activateTab('canvas', 'preview-day')
    openLoc('canvas', 'plugin:ai')
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
    expect(canvas().slice(0, 3)).toEqual(['journal', 'day:2026-09-20', 'plugin:map'])
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
    expect(s.panes.tags.active).toBe('tag:dev')
    expect(s.focus).toBe('canvas')
    expect(s.open).toEqual({ canvas: true, tags: true })
    expect(Object.keys(s.weights).sort()).toEqual(['canvas', 'tags'])
  })
})
