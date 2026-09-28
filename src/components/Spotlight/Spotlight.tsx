import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { allTagPaths } from '../../../shared/tags.ts'
import type { SearchHit } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useDebounced, useFetch } from '../../hooks/useFetch.ts'
import { requestReveal } from '../../state/journal.ts'
import { openDate, openTag } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { useAllTags } from '../../state/tags.ts'
import { openSpotlight, uiStore, type SpotlightMode } from '../../state/ui.ts'
import { rankTags } from '../../tagSearch.ts'
import { mark } from '../Markdown/Markdown.tsx'
import { Modal } from '../Modal/Modal.tsx'
import styles from './Spotlight.module.css'

export function Spotlight() {
  const mode = useStore(uiStore, (s) => s.spotlight)
  if (!mode) return null
  return <SpotlightDialog key={mode} mode={mode} />
}

type Item = { kind: 'tag'; path: string; count: number } | { kind: 'hit'; hit: SearchHit }

function SpotlightDialog({ mode }: { mode: SpotlightMode }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const close = () => openSpotlight(null)

  const tags = useAllTags()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tags) for (const p of allTagPaths([t])) m.set(p, (m.get(p) ?? 0) + t.active)
    return m
  }, [tags])
  const paths = useMemo(() => allTagPaths(tags), [tags])

  const q = useDebounced(query.trim(), 150)
  const search = useFetch(mode === 'search' && q ? `search:${q}` : null, (signal) => unwrap(api.search.$get({ query: { q } }, { init: { signal } })))

  const items: Item[] = useMemo(
    () =>
      mode === 'tags'
        ? rankTags(paths, query, 60).map((path) => ({ kind: 'tag', path, count: counts.get(path) ?? 0 }))
        : q
          ? (search.data?.hits ?? []).map((hit) => ({ kind: 'hit', hit }))
          : [],
    [mode, paths, query, counts, q, search.data],
  )

  useEffect(() => setSel(0), [items])
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (item: Item | undefined, newTab: boolean) => {
    if (!item) return
    close()
    if (item.kind === 'tag') openTag(item.path, { newTab, focus: true })
    else {
      const { hit } = item
      openDate(hit.date, { newTab, focus: true })
      requestReveal({ date: hit.date, entryId: hit.entryId, nodeId: hit.nodeId ?? undefined, mode: 'flash' })
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(items[sel], e.ctrlKey || e.metaKey)
    }
  }

  return (
    <Modal onClose={close} spotlight>
      <input
        className={styles.input}
        autoFocus
        value={query}
        spellCheck={false}
        placeholder={mode === 'tags' ? 'Jump to tag…' : 'Search all entries and notes…'}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul className={styles.list} ref={listRef}>
        {items.map((item, i) => (
          <li
            key={item.kind === 'tag' ? item.path : `${item.hit.entryId}:${item.hit.nodeId}`}
            className={`${styles.item} ${i === sel ? styles.selected : ''}`}
            onMouseEnter={() => setSel(i)}
            onClick={(e) => choose(item, e.ctrlKey || e.metaKey)}
          >
            {item.kind === 'tag' ? (
              <>
                <span className={styles.tag}>#{mark(item.path, query.replace(/^#/, ''))}</span>
                <span className={styles.meta}>{item.count}</span>
              </>
            ) : (
              <div className={`${styles.hit} ${item.hit.archived ? styles.archived : ''}`}>
                <div className={styles.hitHead}>
                  <span className={styles.date}>{formatJournalDate(item.hit.date)}</span>
                  <span className={styles.hitTitle}>{mark(item.hit.title || 'untitled', q)}</span>
                  {item.hit.tags[0] && <span className={styles.tag}>#{item.hit.tags[0]}</span>}
                </div>
                {item.hit.snippet && <div className={styles.snippet}>{mark(item.hit.snippet, q.split(/\s+/)[0] ?? '')}</div>}
              </div>
            )}
          </li>
        ))}
        {mode === 'search' && q && search.data && !items.length && <li className={styles.empty}>No matches.</li>}
        {mode === 'tags' && !items.length && <li className={styles.empty}>No tags match.</li>}
      </ul>
      <div className={styles.footer}>
        <span>↑↓ select</span>
        <span>Enter open</span>
        <span>Ctrl+Enter new tab</span>
        <span>Esc close</span>
      </div>
    </Modal>
  )
}
