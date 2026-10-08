import { api, unwrap } from '../api.ts'
import { createStore } from './store.ts'

// Checklists: a version bumped whenever checklists are created, edited or removed (the dashboard refetches), and
// mark writes, one at a time per item and day so a quick run of +/− clicks lands in order.

export const checklistsVersion = createStore(0)
export const bumpChecklists = () => checklistsVersion.set((v) => v + 1)

const writes = new Map<string, Promise<unknown>>()

export function writeMark(itemId: string, date: string, count: number): Promise<unknown> {
  const key = `${itemId}|${date}`
  const next = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => unwrap(api.checklists.marks.$put({ json: { itemId, date, count } })))
  writes.set(key, next)
  void next.finally(() => writes.get(key) === next && writes.delete(key)).catch(() => {})
  return next
}
