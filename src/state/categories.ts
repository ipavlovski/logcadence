import { useEffect, type CSSProperties } from 'react'
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

/** Display order of a category: uncategorized first (bookmarks and the like), then the categories' order. */
export function categoryOrder(list: CategoryInfo[]): (name: string | null) => number {
  const order = new Map(list.map((c, i) => [c.name, i]))
  return (name) => (name === null ? -1 : (order.get(name) ?? list.length))
}

/** The default categories, each with a color of its own (--cat-<name> in global.css). */
const COLORED = new Set(['design', 'build', 'fab', 'dev', 'notes'])

/** Sets --cat to the category's color, for CSS that reads `var(--cat, var(--date))`; others keep the default. */
export function categoryStyle(name: string | null | undefined): CSSProperties | undefined {
  return name && COLORED.has(name) ? ({ '--cat': `var(--cat-${name})` } as CSSProperties) : undefined
}

/** How a category reads: capitalized ("Design", "Fab"). */
export const categoryLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
