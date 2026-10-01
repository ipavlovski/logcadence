import type { ThreadScale } from '../threads.ts'
import { persistedStore } from './store.ts'

// Threads canvas tab: timeline scale and the projects hidden from it.

interface ThreadsState {
  scale: ThreadScale
  hidden: string[]
}

export const threadsStore = persistedStore<ThreadsState>('threads.v1', { scale: 'true', hidden: [] }, (s) => {
  const o = (s ?? {}) as Partial<ThreadsState>
  return {
    scale: o.scale === 'compact' ? 'compact' : 'true',
    hidden: Array.isArray(o.hidden) ? o.hidden.filter((h) => typeof h === 'string') : [],
  }
})

export function setThreadScale(scale: ThreadScale) {
  threadsStore.set((s) => ({ ...s, scale }))
}

export function toggleThread(project: string) {
  threadsStore.set((s) => ({ ...s, hidden: s.hidden.includes(project) ? s.hidden.filter((h) => h !== project) : [...s.hidden, project] }))
}
