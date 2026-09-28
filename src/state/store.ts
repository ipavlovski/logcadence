import { useSyncExternalStore } from 'react'

export interface Store<S> {
  get(): S
  set(fn: (s: S) => S): void
  subscribe(listener: () => void): () => void
}

export function createStore<S>(initial: S, onChange?: (s: S) => void): Store<S> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(fn) {
      const next = fn(state)
      if (next === state) return
      state = next
      onChange?.(state)
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** A store saved to localStorage; `revive` repairs whatever was stored (older shapes, junk). */
export function persistedStore<S>(key: string, initial: S, revive: (stored: unknown) => S = (s) => s as S): Store<S> {
  let loaded = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw) loaded = revive(JSON.parse(raw))
  } catch {
    // storage blocked or corrupt: start fresh
  }
  return createStore(loaded, (s) => {
    try {
      localStorage.setItem(key, JSON.stringify(s))
    } catch {
      // ignore quota / privacy mode
    }
  })
}

/** Subscribes to a slice; `select` must return a stable value (primitive or a reference held in the state). */
export function useStore<S, T>(store: Store<S>, select: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}
