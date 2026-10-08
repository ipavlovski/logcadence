import { persistedStore } from './store.ts'

// Which canvas plugins have a tab in the canvas tab bar, and in what order (Settings → Canvas). Every plugin has
// one unless hidden, so a newly added plugin shows up on its own. Plugin types only: this module stays free of
// the plugin registry (src/canvas/plugins.ts), which reports the known types through syncCanvasPlugins.

interface CanvasTabsState {
  /** Every known plugin type, in tab-bar order. */
  order: string[]
  hidden: string[]
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export const canvasTabsStore = persistedStore<CanvasTabsState>('canvasTabs.v1', { order: [], hidden: [] }, (s) => {
  const o = s as Partial<CanvasTabsState> | null
  return { order: strings(o?.order), hidden: strings(o?.hidden) }
})

/** Called once by the plugin registry: drops plugins that are gone and appends new ones. */
export function syncCanvasPlugins(types: string[]) {
  canvasTabsStore.set((s) => {
    const order = [...s.order.filter((t) => types.includes(t)), ...types.filter((t) => !s.order.includes(t))]
    const hidden = s.hidden.filter((t) => types.includes(t))
    return order.join() === s.order.join() && hidden.length === s.hidden.length ? s : { order, hidden }
  })
}

/** Plugin types with a tab, in order. */
export const visibleCanvasTabs = (s = canvasTabsStore.get()): string[] => s.order.filter((t) => !s.hidden.includes(t))

export function setCanvasTabShown(type: string, shown: boolean) {
  canvasTabsStore.set((s) => ({ ...s, hidden: shown ? s.hidden.filter((t) => t !== type) : [...new Set([...s.hidden, type])] }))
}

/** Moves a plugin's tab `by` places (-1 = left), staying within the list. */
export function moveCanvasTab(type: string, by: number) {
  canvasTabsStore.set((s) => {
    const i = s.order.indexOf(type)
    const j = Math.max(0, Math.min(s.order.length - 1, i + by))
    if (i < 0 || i === j) return s
    const order = [...s.order]
    order.splice(j, 0, ...order.splice(i, 1))
    return { ...s, order }
  })
}

/** Every plugin shown, in the registry's order. */
export function resetCanvasTabs(types: string[]) {
  canvasTabsStore.set(() => ({ order: [...types], hidden: [] }))
}
