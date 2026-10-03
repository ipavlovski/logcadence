import type { AppInfo, UpdateStatus } from '../../shared/desktop.ts'
import { createStore } from './store.ts'

// Desktop app updates: the updater's status (electron/updater.ts) and whether the Updates window is open.

interface UpdatesState {
  open: boolean
  status: UpdateStatus | null
  app: AppInfo | null
}

export const updatesStore = createStore<UpdatesState>({ open: false, status: null, app: null })

window.desktop?.onUpdate((status) => updatesStore.set((s) => ({ ...s, status })))
window.desktop?.appInfo().then((app) => updatesStore.set((s) => ({ ...s, app })))

export function openUpdates(open: boolean) {
  updatesStore.set((s) => ({ ...s, open }))
}
