import type { ProgressScale } from '../progress.ts'
import { persistedStore } from './store.ts'

// Progress canvas tab: timeline scale and the projects hidden from it.

interface ProgressState {
  scale: ProgressScale
  hidden: string[]
}

export const progressStore = persistedStore<ProgressState>('progress.v1', { scale: 'true', hidden: [] }, (s) => {
  const o = (s ?? {}) as Partial<ProgressState>
  return {
    scale: o.scale === 'compact' ? 'compact' : 'true',
    hidden: Array.isArray(o.hidden) ? o.hidden.filter((h) => typeof h === 'string') : [],
  }
})

export function setProgressScale(scale: ProgressScale) {
  progressStore.set((s) => ({ ...s, scale }))
}

export function toggleProject(project: string) {
  progressStore.set((s) => ({ ...s, hidden: s.hidden.includes(project) ? s.hidden.filter((h) => h !== project) : [...s.hidden, project] }))
}
