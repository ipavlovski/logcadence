import { MODS, type Mod } from '../shortcutKeys.ts'
import { persistedStore } from './store.ts'

// Shortcuts canvas tab: the app shown and the modifier layer toggled on (held keys override it).

interface ShortcutsState {
  app: string | null
  mods: Mod[]
}

export const shortcutsStore = persistedStore<ShortcutsState>('shortcuts.v1', { app: null, mods: [] }, (s) => {
  const o = (s ?? {}) as Partial<ShortcutsState>
  return {
    app: typeof o.app === 'string' ? o.app : null,
    mods: Array.isArray(o.mods) ? MODS.filter((m) => o.mods!.includes(m)) : [],
  }
})

export function setShortcutApp(app: string) {
  shortcutsStore.set((s) => ({ ...s, app }))
}

export function setShortcutMods(mods: Mod[]) {
  shortcutsStore.set((s) => ({ ...s, mods: MODS.filter((m) => mods.includes(m)) }))
}

export function toggleShortcutMod(mod: Mod) {
  shortcutsStore.set((s) => ({ ...s, mods: s.mods.includes(mod) ? s.mods.filter((m) => m !== mod) : MODS.filter((m) => m === mod || s.mods.includes(m)) }))
}
