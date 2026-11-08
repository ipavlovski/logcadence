import { Suspense, useEffect, useRef } from 'react'
import { CHAT_SUBTYPE, parseTypeRef, type EntryType } from '../../../shared/entryTypes.ts'
import type { Query } from '../../../shared/query.ts'
import { CHAT_SOURCES, type ChatSource, type HandlerId } from '../../../shared/types.ts'
import { typeViewOf } from '../../canvas/plugins.ts'
import { aiStore, setChatSource } from '../../state/ai.ts'
import { bookmarksNav, withFilter as withCaptureFilter, withHandler, type CaptureFilter } from '../../state/captures.ts'
import { setTabQuery } from '../../state/panes.ts'
import type { Store } from '../../state/store.ts'
import { withFilter as withYtFilter, youtubeStore, type YtFilter } from '../../state/youtube.ts'
import styles from './Tags.module.css'

// A type's own view in a tags pane tab. The view keeps its filter in a store of its own (a channel, a site, a
// source…); the tab's query is the source of truth: opening the tab sets the view's filter from it, and a filter
// chosen in the view becomes the tab's query.

interface Sync<S> {
  store: Store<S>
  /** The view's filter, as comparable state. */
  read(s: S): unknown
  /** The query's filter for the view. */
  fromQuery(q: Query): unknown
  /** Sets the view's filter (without leaving an open item). */
  apply(f: unknown): void
  /** The query with the view's filter. */
  toQuery(q: Query, f: unknown): Query
}

const sub = (q: Query) => parseTypeRef(q.types?.[0] ?? '')?.subtype ?? null

const ytSync: Sync<ReturnType<typeof youtubeStore.get>> = {
  store: youtubeStore,
  read: (s) => s.filter,
  fromQuery: (q): YtFilter => (q.channel ? { kind: 'channel', name: q.channel } : q.tags?.[0] ? { kind: 'tag', path: q.tags[0] } : q.untagged ? { kind: 'untagged' } : null),
  apply: (f) => youtubeStore.set((s) => withYtFilter(s, f as YtFilter)),
  toQuery: (q, f) => {
    const filter = f as YtFilter
    return { types: q.types, ...(filter?.kind === 'channel' && { channel: filter.name }), ...(filter?.kind === 'tag' && { tags: [filter.path] }), ...(filter?.kind === 'untagged' && { untagged: true }) }
  },
}

const bookmarkSync: Sync<ReturnType<typeof bookmarksNav.store.get>> = {
  store: bookmarksNav.store,
  read: (s) => ({ filter: s.filter, handler: s.handler }),
  fromQuery: (q) => ({
    filter: (q.site ? { kind: 'site', site: q.site } : q.tags?.[0] ? { kind: 'tag', path: q.tags[0] } : q.untagged ? { kind: 'untagged' } : null) as CaptureFilter,
    handler: sub(q) as HandlerId | null,
  }),
  apply: (f) => {
    const { filter, handler } = f as { filter: CaptureFilter; handler: HandlerId | null }
    bookmarksNav.store.set((s) => withHandler(withCaptureFilter(s, filter), handler))
  },
  toQuery: (_, f) => {
    const { filter, handler } = f as { filter: CaptureFilter; handler: HandlerId | null }
    return {
      types: [handler ? `bookmark/${handler}` : 'bookmark'],
      ...(filter?.kind === 'site' && { site: filter.site }),
      ...(filter?.kind === 'tag' && { tags: [filter.path] }),
      ...(filter?.kind === 'untagged' && { untagged: true }),
    }
  },
}

const SOURCE_OF = Object.fromEntries(CHAT_SOURCES.map((s) => [CHAT_SUBTYPE[s], s])) as Record<string, ChatSource>

const aiSync: Sync<ReturnType<typeof aiStore.get>> = {
  store: aiStore,
  read: (s) => s.source,
  fromQuery: (q) => SOURCE_OF[sub(q) ?? ''] ?? null,
  apply: (f) => setChatSource(f as ChatSource | null),
  toQuery: (_, f) => ({ types: [f ? `ai/${CHAT_SUBTYPE[f as ChatSource]}` : 'ai'] }),
}

const SYNCS: Partial<Record<EntryType, Sync<never>>> = { video: ytSync as Sync<never>, bookmark: bookmarkSync as Sync<never>, ai: aiSync as Sync<never> }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function useQuerySync(type: EntryType, tabKey: string, query: Query) {
  const sync = SYNCS[type] as Sync<unknown> | undefined
  const queryRef = useRef(query)
  queryRef.current = query
  const queryId = JSON.stringify(query)
  // The tab's query → the view.
  useEffect(() => {
    if (!sync) return
    const want = sync.fromQuery(queryRef.current)
    if (!same(sync.read(sync.store.get()), want)) sync.apply(want)
  }, [sync, queryId])
  // The view's filter → the tab's query.
  useEffect(() => {
    if (!sync) return
    let last = sync.read(sync.store.get())
    return sync.store.subscribe(() => {
      const f = sync.read(sync.store.get())
      if (same(f, last)) return
      last = f
      if (!same(f, sync.fromQuery(queryRef.current))) setTabQuery(tabKey, sync.toQuery(queryRef.current, f))
    })
  }, [sync, tabKey])
}

export function TypeView({ type, tabKey, query }: { type: EntryType; tabKey: string; query: Query }) {
  useQuerySync(type, tabKey, query)
  const view = typeViewOf(type)
  if (!view) return null
  return (
    <Suspense fallback={<div className={styles.view} />}>
      <view.Component tabKey={tabKey} />
    </Suspense>
  )
}
