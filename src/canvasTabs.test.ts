import { beforeEach, describe, expect, it } from 'vitest'
import { canvasTabsStore, moveCanvasTab, resetCanvasTabs, setCanvasTabShown, syncCanvasPlugins, visibleCanvasTabs } from './state/canvasTabs.ts'
import { today } from '../shared/dates.ts'
import { activeJournalDate, closeTab, cycleTab, goDayHistory, openDate, openLoc, paneTabs, panesStore, revivePanes } from './state/panes.ts'

const canvas = () => paneTabs('canvas', panesStore.get().panes.canvas)
const active = () => panesStore.get().panes.canvas.active

beforeEach(() => {
  resetCanvasTabs(['map', 'youtube', 'ai'])
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

describe('journal tab', () => {
  it('opens a day in the journal tab and steps back and forward through the days shown', () => {
    openLoc('canvas', 'plugin:youtube')
    openDate('2026-09-20')
    expect(active()).toBe('journal')
    expect(activeJournalDate()).toBe('2026-09-20')
    openDate('2026-09-21')
    openDate(today())
    expect(panesStore.get().day).toBeNull()
    goDayHistory(-1)
    expect(activeJournalDate()).toBe('2026-09-21')
    goDayHistory(-1)
    expect(activeJournalDate()).toBe('2026-09-20')
    // A new day drops the forward history.
    openDate('2026-09-25')
    goDayHistory(1)
    expect(activeJournalDate()).toBe('2026-09-25')
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
    expect(s.day).toBe('2026-09-20')
    expect(s.dayHistory).toEqual(['2026-09-20'])
    expect(s.panes.canvas.active).toBe('journal')
    expect(s.panes.tags.active).toBe('tag:dev')
    expect(s.focus).toBe('canvas')
    expect(s.open).toEqual({ canvas: true, tags: true })
    expect(Object.keys(s.weights).sort()).toEqual(['canvas', 'tags'])
  })
})
