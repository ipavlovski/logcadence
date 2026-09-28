import type { PaneId } from './panes.ts'
import { createStore, persistedStore } from './store.ts'

export type SpotlightMode = 'tags' | 'search'

export interface NewEntryDefaults {
  date: string
  tags: string[]
  afterEntryId?: string
}

interface UiState {
  spotlight: SpotlightMode | null
  newEntry: NewEntryDefaults | null
  help: boolean
  /** Per-pane find (ctrl+f) query; undefined = find bar closed. */
  find: Partial<Record<PaneId, string>>
  /** Bumped to re-focus an already open find bar. */
  findFocus: number
  toast: { id: number; message: string } | null
}

export const uiStore = createStore<UiState>({ spotlight: null, newEntry: null, help: false, find: {}, findFocus: 0, toast: null })

export function openSpotlight(mode: SpotlightMode | null) {
  uiStore.set((s) => ({ ...s, spotlight: mode }))
}

export function openNewEntry(defaults: NewEntryDefaults | null) {
  uiStore.set((s) => ({ ...s, newEntry: defaults }))
}

export function toggleHelp(open?: boolean) {
  uiStore.set((s) => ({ ...s, help: open ?? !s.help }))
}

export function openFind(pane: PaneId) {
  uiStore.set((s) => ({ ...s, find: { ...s.find, [pane]: s.find[pane] ?? '' }, findFocus: s.findFocus + 1 }))
}

export function setFind(pane: PaneId, query: string | undefined) {
  uiStore.set((s) => ({ ...s, find: { ...s.find, [pane]: query } }))
}

let toastId = 0
export function notify(message: string) {
  const id = ++toastId
  uiStore.set((s) => ({ ...s, toast: { id, message } }))
  setTimeout(() => uiStore.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), 4000)
}

// Viewer preferences that survive reloads.
interface Prefs {
  theme: 'dark' | 'light'
  /** Tags pane: list archived entries/nodes (greyed out). */
  showArchived: boolean
  /** Tags pane: a tag view includes entries of its sub-tags. */
  includeSubtags: boolean
  /** Expanded paths in the tag tree. */
  expanded: string[]
}

export const prefsStore = persistedStore<Prefs>('prefs.v1', { theme: 'dark', showArchived: false, includeSubtags: true, expanded: [] }, (s) => ({
  theme: 'dark',
  showArchived: false,
  includeSubtags: true,
  expanded: [],
  ...(s as Partial<Prefs>),
}))

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefsStore.set((s) => ({ ...s, [key]: value }))
}
