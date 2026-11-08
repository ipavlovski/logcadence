import { useEffect } from 'react'
import type { CategoryInfo } from '../../shared/types.ts'
import { api, unwrap } from '../api.ts'
import { useRevision } from './bus.ts'
import { createStore, useStore } from './store.ts'

// One shared copy of the categories (in display order, with counts), refetched once per content revision.

const categoriesStore = createStore<CategoryInfo[]>([])
let loadedRev = -1

export function useCategories(): CategoryInfo[] {
  const rev = useRevision()
  useEffect(() => {
    if (loadedRev === rev) return
    loadedRev = rev
    unwrap(api.categories.$get()).then(
      (d) => categoriesStore.set(() => d.categories),
      () => {
        loadedRev = -1
      },
    )
  }, [rev])
  return useStore(categoriesStore, (s) => s)
}

/** Display order of a category (uncategorized last). */
export function categoryOrder(list: CategoryInfo[]): (name: string | null) => number {
  const order = new Map(list.map((c, i) => [c.name, i]))
  return (name) => (name === null ? list.length + 1 : (order.get(name) ?? list.length))
}
