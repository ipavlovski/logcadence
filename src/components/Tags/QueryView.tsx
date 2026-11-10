import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { ancestors, tagName } from '../../../shared/tags.ts'
import type { EntryDTO } from '../../../shared/types.ts'
import { thumbOf } from '../../entryView.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { matches } from '../../markdown.ts'
import { categoryLabel, categoryOrder, categoryStyle, useCategories } from '../../state/categories.ts'
import { emitChange, useRevision } from '../../state/bus.ts'
import { useCommand } from '../../state/commands.ts'
import { requestReveal } from '../../state/journal.ts'
import { queryToString, type Query } from '../../../shared/query.ts'
import { openDate, openQuery, openTag, setTabQuery } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify, prefsStore, setPref } from '../../state/ui.ts'
import { ImageGallery, MediaThumb } from '../ImageGallery/ImageGallery.tsx'
import { gridItems, ImageGrid } from '../ImageGrid/ImageGrid.tsx'
import { Markdown, mark } from '../Markdown/Markdown.tsx'
import { SourceLine, SourceTitle } from '../Source/Source.tsx'
import { TagChip } from '../TagChip/TagChip.tsx'
import { startTagOp } from './tagOps.ts'
import styles from './Tags.module.css'

/** URL parameters as an object, `type` and `tag` (which repeat) as arrays: as the API client sends them. */
function paramsOf(query: string): Record<string, string | string[]> {
  const p = new URLSearchParams(query)
  return Object.fromEntries([...new Set(p.keys())].map((k) => [k, k === 'type' || k === 'tag' ? p.getAll(k) : p.get(k)!]))
}

/** Selection keys: `e:<entryId>` or `n:<nodeId>`. */
type Sel = Set<string>

/** Read-only listing of the entries a query matches (of every type), newest first; archive to keep it fresh. */
export function QueryView({ tabKey, query, find }: { tabKey: string; query: Query; find: string }) {
  const rev = useRevision()
  const showArchived = useStore(prefsStore, (s) => s.showArchived)
  const imageMode = useStore(prefsStore, (s) => s.imageMode)
  const includeSub = useStore(prefsStore, (s) => s.includeSubtags)
  const [sel, setSel] = useState<Sel>(new Set())
  const q = find.trim()
  const queryId = queryToString(query)
  // A query of tags is fetched without its category, which filters here: the category bar counts every category's.
  const byCategory = !!query.tags?.length
  const base: Query = byCategory ? { ...query, category: undefined, uncategorized: undefined } : query
  const baseId = queryToString(base)
  // A view of one tag (in any category): its crumbs and the tag's operations.
  const tag = base.tags?.length === 1 && queryToString({ tags: base.tags }) === baseId ? base.tags[0]! : null
  useEffect(() => setSel(new Set()), [queryId])

  const { data, error } = useFetch(`${baseId}|${showArchived}|${includeSub}|${rev}`, (signal) =>
    unwrap(
      api.entries.$get(
        // The query string as GET /entries reads it (repeated type and tag); its client types are the parsed query's.
        { query: { ...paramsOf(baseId), archived: showArchived ? '1' : '0', exact: includeSub ? '0' : '1' } as never },
        { init: { signal } },
      ),
    ).then((d) => ({ baseId, entries: d.entries })),
  )
  const fetched = data?.baseId === baseId ? data.entries : undefined
  const all = useMemo(() => {
    if (!fetched || !byCategory) return fetched
    if (query.category) return fetched.filter((e) => e.category === query.category)
    if (query.uncategorized) return fetched.filter((e) => !e.category)
    return fetched
  }, [fetched, byCategory, query.category, query.uncategorized])

  const visible = useMemo(() => {
    if (!all || !q) return all ?? []
    return all.flatMap((e) => {
      const head = matches(e.title, q) || e.tags.some((t) => matches(t, q))
      const nodes = head ? e.nodes : e.nodes.filter((n) => matches(n.content, q))
      return head || nodes.length ? [{ ...e, nodes }] : []
    })
  }, [all, q])

  const byDate = useMemo(() => {
    const m = new Map<string, EntryDTO[]>()
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return [...m]
  }, [visible])

  const selection = () => {
    const entryIds: string[] = []
    const nodeIds: string[] = []
    for (const k of sel) (k.startsWith('e:') ? entryIds : nodeIds).push(k.slice(2))
    return { entryIds, nodeIds }
  }

  const isArchived = (key: string) => {
    const id = key.slice(2)
    for (const e of all ?? []) {
      if (key.startsWith('e:') && e.id === id) return e.archived
      const n = e.nodes.find((x) => x.id === id)
      if (n) return n.archived
    }
    return false
  }

  // Delete toggles archive (all archived → unarchive, else archive); shift+delete deletes.
  const archiveSelection = () => {
    if (!sel.size) return
    const archived = ![...sel].every(isArchived)
    unwrap(api.archive.$post({ json: { ...selection(), archived } })).then(
      () => {
        emitChange()
        if (archived && !showArchived) setSel(new Set())
      },
      (err: Error) => notify(err.message),
    )
  }
  const deleteSelection = () => {
    if (!sel.size || !confirm(`Permanently delete ${sel.size} selected item(s)?`)) return
    unwrap(api['bulk-delete'].$post({ json: selection() })).then(
      () => {
        setSel(new Set())
        emitChange()
      },
      (err: Error) => notify(err.message),
    )
  }
  useCommand('tags.archive', archiveSelection)
  useCommand('tags.delete', deleteSelection)

  const click = (e: MouseEvent, key: string, reveal: () => void) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) return reveal()
    if (window.getSelection()?.toString()) return
    setSel((s) => {
      if (e.shiftKey) {
        const next = new Set(s)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }
      return s.size === 1 && s.has(key) ? new Set() : new Set([key])
    })
  }

  const revealIn = (entry: EntryDTO, nodeId?: string) => {
    openDate(entry.date, { focus: true })
    requestReveal({ date: entry.date, entryId: entry.id, nodeId, mode: 'flash' })
  }

  const entryIdsSelected = selection().entryIds

  return (
    <div className={styles.view} onClick={(e) => e.target === e.currentTarget && setSel(new Set())}>
      <header className={styles.viewHeader}>
        {tag ? (
          <h2 className={styles.viewTitle}>
            {ancestors(tag).map((a) => (
              <span key={a}>
                <button className={styles.crumb} onClick={(e) => openTag(a, { newTab: e.ctrlKey || e.metaKey })}>
                  {tagName(a)}
                </button>
                <span className={styles.sep}>/</span>
              </span>
            ))}
            <span>{tagName(tag)}</span>
          </h2>
        ) : (
          <Facets tabKey={tabKey} query={query} withoutCategory={byCategory} />
        )}
        <span className={styles.muted}>{all ? `${all.length} ${all.length === 1 ? 'entry' : 'entries'}` : ''}</span>
        <div className={styles.toolbar}>
          <label className={styles.toggle} title="Show archived entries and nodes (greyed out)">
            <input type="checkbox" checked={showArchived} onChange={(e) => setPref('showArchived', e.target.checked)} /> archived
          </label>
          {!!query.tags?.length && (
            <label className={styles.toggle} title="Include entries of sub-tags">
              <input type="checkbox" checked={includeSub} onChange={(e) => setPref('includeSubtags', e.target.checked)} /> sub-tags
            </label>
          )}
          {tag && (
            <>
              <button onClick={() => startTagOp({ op: 'rename', tag })}>rename</button>
              <button onClick={() => startTagOp({ op: 'merge', tag })}>merge</button>
              <button
                disabled={!entryIdsSelected.length}
                title={entryIdsSelected.length ? 'Move selected entries into a sub-tag' : 'Select entries first (click / shift+click)'}
                onClick={() => startTagOp({ op: 'branch', tag, entryIds: entryIdsSelected })}
              >
                branch
              </button>
              <button className={styles.danger} onClick={() => startTagOp({ op: 'delete', tag })}>
                delete
              </button>
            </>
          )}
        </div>
      </header>

      {byCategory && fetched && <CategoryBar tabKey={tabKey} query={query} entries={fetched} />}

      {sel.size > 0 && (
        <div className={styles.selectionBar}>
          <span>{sel.size} selected</span>
          <button onClick={archiveSelection}>
            archive / unarchive <kbd>Del</kbd>
          </button>
          <button className={styles.danger} onClick={deleteSelection}>
            delete <kbd>Shift+Del</kbd>
          </button>
          <button onClick={() => setSel(new Set())}>clear</button>
        </div>
      )}

      {error && <p className={styles.error}>{error.message}</p>}
      {all && !visible.length && <p className={styles.muted}>{q ? `Nothing matches “${q}”.` : 'No entries match.'}</p>}

      {imageMode && visible.length > 0 && <ImageDays byDate={byDate} />}
      {!imageMode &&
        byDate.map(([date, list]) => (
          <section key={date} className={styles.card}>
            <button
              className={styles.stamp}
              title="Open in journal (ctrl+click: new tab)"
              onClick={(e) => openDate(date, { newTab: e.ctrlKey || e.metaKey, focus: true })}
            >
              {formatJournalDate(date)}
            </button>
            {list.map((entry) => {
              const thumb = thumbOf(entry)
              return (
                <article
                  key={entry.id}
                  className={`${styles.entry} ${sel.has(`e:${entry.id}`) ? styles.selected : ''} ${entry.archived ? styles.archived : ''}`}
                  onClick={(e) => click(e, `e:${entry.id}`, () => revealIn(entry))}
                  onDoubleClick={() => revealIn(entry)}
                >
                  <div className={styles.entryHead}>
                    <div className={styles.entryMain}>
                      <div className={styles.entryTitle} title={entry.title || undefined}>
                        {entry.category && (
                          <button className={styles.entryCategory} style={categoryStyle(entry.category)} title={byCategory ? `Only the ones filed under ${categoryLabel(entry.category)} (Ctrl+click: everything filed under it)` : `Everything filed under ${categoryLabel(entry.category)}`} onClick={(e) => (byCategory && !(e.ctrlKey || e.metaKey) ? setTabQuery(tabKey, { ...base, category: entry.category! }) : openQuery({ category: entry.category! }, { newTab: e.ctrlKey || e.metaKey }))}>
                            {categoryLabel(entry.category)}
                          </button>
                        )}
                        {entry.source ? (
                          <SourceTitle source={entry.source}>{entry.title ? mark(entry.title, q) : entry.source.url}</SourceTitle>
                        ) : entry.title ? (
                          mark(entry.title, q)
                        ) : (
                          <span className={styles.muted}>untitled</span>
                        )}
                      </div>
                      {entry.source && <SourceLine source={entry.source} createdAt={entry.createdAt} />}
                      <div className={styles.entryTags}>
                        {entry.tags.map((t) => (
                          <TagChip key={t} tag={t} />
                        ))}
                      </div>
                    </div>
                    {thumb && <MediaThumb item={thumb} className={styles.thumb} />}
                  </div>
                  <ul className={styles.nodeList}>
                    {entry.nodes.map((n) => (
                      <li
                        key={n.id}
                        className={`${styles.node} ${sel.has(`n:${n.id}`) ? styles.selected : ''} ${n.archived ? styles.archived : ''}`}
                        onClick={(e) => click(e, `n:${n.id}`, () => revealIn(entry, n.id))}
                        onDoubleClick={(e) => (e.stopPropagation(), revealIn(entry, n.id))}
                      >
                        {n.content && <Markdown source={n.content} highlight={q} />}
                        {n.images.length > 0 && <ImageGallery images={n.images} activeId={n.activeImageId} compact />}
                      </li>
                    ))}
                  </ul>
                </article>
              )
            })}
          </section>
        ))}
    </div>
  )
}

/**
 * A tag query's categories, with how many of its entries each has: picks the one shown (the tab's query gets it), a
 * second click or All shows them all again. Hidden when there's only one group to pick.
 */
function CategoryBar({ tabKey, query, entries }: { tabKey: string; query: Query; entries: EntryDTO[] }) {
  const categories = useCategories()
  const groups = useMemo(() => {
    const m = new Map<string | null, number>()
    for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + 1)
    const order = categoryOrder(categories)
    return [...m].sort(([a], [b]) => order(a) - order(b))
  }, [entries, categories])
  const filtered = !!query.category || !!query.uncategorized
  if (groups.length < 2 && !filtered) return null
  const base: Query = { ...query, category: undefined, uncategorized: undefined }
  const pick = (c: string | null) => {
    const on = c === null ? query.uncategorized : query.category === c
    setTabQuery(tabKey, on ? base : c === null ? { ...base, uncategorized: true } : { ...base, category: c })
  }
  return (
    <nav className={styles.categoryBar} aria-label="Filter by category">
      <button className={filtered ? '' : styles.categoryOn} onClick={() => setTabQuery(tabKey, base)}>
        All <span className={styles.count}>{entries.length}</span>
      </button>
      {groups.map(([c, n]) => (
        <button
          key={c ?? '_uncategorized'}
          className={(c === null ? query.uncategorized : query.category === c) ? styles.categoryOn : ''}
          style={categoryStyle(c)}
          onClick={() => pick(c)}
          title={c ? `Only the ones filed under ${categoryLabel(c)}` : 'Only the ones without a category'}
        >
          {c ? categoryLabel(c) : 'uncategorized'} <span className={styles.count}>{n}</span>
        </button>
      ))}
    </nav>
  )
}

/** A query's facets, each removable (the tab shows the query without it); a tag query's category is in its bar. */
function Facets({ tabKey, query, withoutCategory }: { tabKey: string; query: Query; withoutCategory: boolean }) {
  const facets: { label: string; without: Query }[] = [
    ...(query.category && !withoutCategory ? [{ label: categoryLabel(query.category), without: { ...query, category: undefined } }] : []),
    ...(query.uncategorized && !withoutCategory ? [{ label: 'uncategorized', without: { ...query, uncategorized: undefined } }] : []),
    ...(query.tags ?? []).map((t) => ({ label: `#${t}`, without: { ...query, tags: query.tags!.filter((x) => x !== t) } })),
    ...(query.untagged ? [{ label: 'untagged', without: { ...query, untagged: undefined } }] : []),
  ]
  return (
    <h2 className={styles.viewTitle}>
      {facets.map((f) => (
        <span key={f.label} className={styles.facet}>
          {f.label}
          <button title={`Without ${f.label}`} aria-label={`Remove ${f.label}`} onClick={() => setTabQuery(tabKey, f.without)}>
            ×
          </button>
        </span>
      ))}
    </h2>
  )
}

/** Image mode: under each day, the images of its entries. */
function ImageDays({ byDate }: { byDate: [string, EntryDTO[]][] }) {
  const days = byDate.map(([date, list]) => [date, gridItems(list)] as const).filter(([, items]) => items.length)
  if (!days.length) return <p className={styles.muted}>No images among these entries.</p>
  return days.map(([date, items]) => (
    <section key={date} className={styles.card}>
      <button className={styles.stamp} title="Open in journal (ctrl+click: new tab)" onClick={(e) => openDate(date, { newTab: e.ctrlKey || e.metaKey, focus: true })}>
        {formatJournalDate(date)}
      </button>
      <ImageGrid items={items} />
    </section>
  ))
}
