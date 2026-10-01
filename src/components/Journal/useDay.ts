import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { between, newId } from '../../../shared/id.ts'
import { cleanTags } from '../../../shared/tags.ts'
import type { EntryDTO, NodeDTO, UpdateEntryBody, UpdateNodeBody } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { emitChange, useRevision } from '../../state/bus.ts'
import { notify } from '../../state/ui.ts'

export interface DayActions {
  updateEntry(id: string, patch: UpdateEntryBody): void
  deleteEntry(id: string): void
  /** No-op when nothing changes. */
  updateNode(id: string, patch: UpdateNodeBody): void
  /** Inserts after `afterId` (null = first) and returns the new node's id. */
  insertNode(entryId: string, afterId: string | null, content: string): string
  deleteNode(id: string): void
  uploadImages(nodeId: string, files: File[]): void
  deleteImage(nodeId: string, imageId: string): void
  /** New gallery order; the first image is the thumbnail. */
  reorderImages(nodeId: string, ids: string[]): void
}

/**
 * A journal day held in memory. Node and entry edits apply locally at once and are pushed
 * to the server in the background; ids are generated client-side so optimistic inserts
 * never need reconciling. Refetches only on changes made elsewhere (other panes/tabs).
 */
export function useDay(date: string) {
  const origin = useId()
  const rev = useRevision(origin)
  const [tick, setTick] = useState(0)
  const [entries, setEntries] = useState<EntryDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Source of truth between renders, so back-to-back actions (split, then insert) see each other.
  const ref = useRef<EntryDTO[] | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    unwrap(api.journal[':date'].$get({ param: { date } }, { init: { signal: ctrl.signal } })).then(
      (d) => {
        ref.current = d.entries
        setEntries(d.entries)
        setError(null)
      },
      (err: Error) => !ctrl.signal.aborted && setError(err.message),
    )
    return () => ctrl.abort()
  }, [date, rev, tick])

  const actions = useMemo<DayActions>(() => {
    const mutate = (fn: (es: EntryDTO[]) => EntryDTO[]) => {
      if (!ref.current) return
      ref.current = fn(ref.current)
      setEntries(ref.current)
    }
    const mapNode = (id: string, fn: (n: NodeDTO) => NodeDTO) =>
      mutate((es) => es.map((e) => (e.nodes.some((n) => n.id === id) ? { ...e, nodes: e.nodes.map((n) => (n.id === id ? fn(n) : n)) } : e)))
    const findNode = (id: string) => ref.current?.flatMap((e) => e.nodes).find((n) => n.id === id)
    const send = (p: Promise<unknown>) =>
      p.then(
        () => emitChange(origin),
        (err: Error) => {
          notify(err.message)
          setTick((t) => t + 1) // resync with the server
        },
      )

    return {
      updateEntry(id, patch) {
        mutate((es) => es.map((e) => (e.id === id ? { ...e, ...patch, tags: patch.tags ? cleanTags(patch.tags) : e.tags } : e)))
        send(unwrap(api.entries[':id'].$patch({ param: { id }, json: patch })))
      },
      deleteEntry(id) {
        mutate((es) => es.filter((e) => e.id !== id))
        send(unwrap(api.entries[':id'].$delete({ param: { id } })))
      },
      updateNode(id, patch) {
        const cur = findNode(id)
        if (!cur || Object.entries(patch).every(([k, v]) => cur[k as keyof NodeDTO] === v)) return
        mapNode(id, (n) => ({ ...n, ...patch }))
        send(unwrap(api.nodes[':id'].$patch({ param: { id }, json: patch })))
      },
      insertNode(entryId, afterId, content) {
        const e = ref.current?.find((x) => x.id === entryId)
        if (!e) return ''
        const i = afterId ? e.nodes.findIndex((n) => n.id === afterId) : -1
        const now = Date.now()
        const node: NodeDTO = {
          id: newId(),
          entryId,
          content,
          position: between(e.nodes[i]?.position, e.nodes[i + 1]?.position),
          archived: false,
          activeImageId: null,
          images: [],
          createdAt: now,
          updatedAt: now,
        }
        mutate((es) => es.map((x) => (x.id === entryId ? { ...x, nodes: [...x.nodes.slice(0, i + 1), node, ...x.nodes.slice(i + 1)] } : x)))
        send(unwrap(api.nodes.$post({ json: { id: node.id, entryId, content, position: node.position } })))
        return node.id
      },
      deleteNode(id) {
        mutate((es) => es.map((e) => ({ ...e, nodes: e.nodes.filter((n) => n.id !== id) })))
        send(unwrap(api.nodes[':id'].$delete({ param: { id } })))
      },
      uploadImages(nodeId, files) {
        void (async () => {
          for (const file of files) {
            try {
              const r = await unwrap(api.nodes[':id'].images.$post({ param: { id: nodeId }, form: { file } }))
              mapNode(nodeId, (n) => ({ ...n, images: [...n.images, r.image], activeImageId: r.activeImageId }))
              emitChange(origin)
            } catch (err) {
              notify((err as Error).message)
            }
          }
        })()
      },
      deleteImage(nodeId, imageId) {
        mapNode(nodeId, (n) => {
          const images = n.images.filter((i) => i.id !== imageId)
          return { ...n, images, activeImageId: n.activeImageId === imageId ? (images[0]?.id ?? null) : n.activeImageId }
        })
        send(unwrap(api.images[':id'].$delete({ param: { id: imageId } })))
      },
      reorderImages(nodeId, ids) {
        mapNode(nodeId, (n) => ({ ...n, images: ids.map((id) => n.images.find((i) => i.id === id)!).filter(Boolean) }))
        send(unwrap(api.nodes[':id'].images.order.$post({ param: { id: nodeId }, json: { ids } })))
      },
    }
  }, [origin])

  return { entries, error, actions }
}
