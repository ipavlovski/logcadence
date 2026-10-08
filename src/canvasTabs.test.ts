import { beforeEach, describe, expect, it } from 'vitest'
import { canvasTabsStore, moveCanvasTab, resetCanvasTabs, setCanvasTabShown, syncCanvasPlugins, visibleCanvasTabs } from './state/canvasTabs.ts'
import { closeTab, cycleTab, openLoc, paneTabs, panesStore } from './state/panes.ts'

const canvas = () => paneTabs('canvas', panesStore.get().panes.canvas)
const active = () => panesStore.get().panes.canvas.active

beforeEach(() => {
  resetCanvasTabs(['map', 'youtube', 'ai'])
  openLoc('canvas', 'dashboard')
})

describe('canvas tabs', () => {
  it('keeps saved order and hidden tabs across plugin changes, adding new plugins at the end', () => {
    moveCanvasTab('ai', -2)
    setCanvasTabShown('map', false)
    syncCanvasPlugins(['map', 'ai', 'spotify'])
    expect(canvasTabsStore.get()).toEqual({ order: ['ai', 'map', 'spotify'], hidden: ['map'] })
    expect(visibleCanvasTabs()).toEqual(['ai', 'spotify'])
  })

  it('shows the dashboard and every plugin shown, plus a hidden one while it is open', () => {
    setCanvasTabShown('youtube', false)
    expect(canvas()).toEqual(['dashboard', 'plugin:map', 'plugin:ai'])
    openLoc('canvas', 'plugin:youtube')
    expect(canvas()).toEqual(['dashboard', 'plugin:map', 'plugin:ai', 'plugin:youtube'])
    // Fixed tabs don't close; the hidden one does, back to the dashboard.
    closeTab('canvas', 'plugin:map')
    expect(active()).toBe('plugin:youtube')
    closeTab('canvas')
    expect(active()).toBe('dashboard')
    expect(canvas()).toEqual(['dashboard', 'plugin:map', 'plugin:ai'])
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
