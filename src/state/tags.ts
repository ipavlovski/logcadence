import { useEffect } from 'react'
import type { TagInfo } from '../../shared/types.ts'
import { api, unwrap } from '../api.ts'
import { useRevision } from './bus.ts'
import { createStore, useStore } from './store.ts'

// One shared copy of the tag list (for autocomplete, the tree and the spotlight),
// refetched once per content revision no matter how many components use it.

const tagsStore = createStore<TagInfo[]>([])
let loadedRev = -1

export function useAllTags(): TagInfo[] {
  const rev = useRevision()
  useEffect(() => {
    if (loadedRev === rev) return
    loadedRev = rev
    unwrap(api.tags.$get()).then(
      (d) => tagsStore.set(() => d.tags),
      () => {
        loadedRev = -1
      },
    )
  }, [rev])
  return useStore(tagsStore, (s) => s)
}
