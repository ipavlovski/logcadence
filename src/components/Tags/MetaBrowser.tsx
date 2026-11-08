import { useMemo, type MouseEvent } from 'react'
import { ENTRY_TYPES, SUBTYPE_LABEL, TYPE_LABEL, typeRef } from '../../../shared/entryTypes.ts'
import type { Query } from '../../../shared/query.ts'
import { ancestors, buildTagTree, type TagTreeNode } from '../../../shared/tags.ts'
import type { MetaDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { pluginIcon } from '../../canvas/icons.tsx'
import { typeViewOf } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { openQuery, openTag } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { useAllTags } from '../../state/tags.ts'
import { prefsStore, setPref } from '../../state/ui.ts'
import { mark } from '../Markdown/Markdown.tsx'
import { startTagOp } from './tagOps.ts'
import styles from './Tags.module.css'

/** The tags pane's preview with no query: every type, category and tag, with how many entries each has. */
export function MetaBrowser({ find }: { find: string }) {
  return (
    <div className={styles.view}>
      <TypesAndCategories />
      <TagTree find={find} />
    </div>
  )
}

const open = (q: Query) => (e: MouseEvent) => openQuery(q, { newTab: e.ctrlKey || e.metaKey })

function TypesAndCategories() {
  const rev = useRevision()
  const showArchived = useStore(prefsStore, (s) => s.showArchived)
  const { data } = useFetch<MetaDTO>(`meta|${rev}`, (signal) => unwrap(api.meta.$get({}, { init: { signal } })))
  if (!data) return null
  const n = (c: { active: number; archived: number }) => c.active + (showArchived ? c.archived : 0)
  const types = ENTRY_TYPES.map((type) => {
    const rows = data.types.filter((t) => t.type === type)
    return { type, count: rows.reduce((a, r) => a + n(r), 0), subtypes: rows.filter((r) => r.subtype) }
  }).filter((t) => t.count > 0)
  return (
    <>
      <header className={styles.viewHeader}>
        <h2 className={styles.viewTitle}>Types</h2>
      </header>
      <ul className={styles.metaList}>
        {types.map((t) => {
          const view = typeViewOf(t.type)
          return (
            <li key={t.type}>
              <button className={styles.metaItem} onClick={open({ types: [t.type] })} title={`Every ${TYPE_LABEL[t.type].toLowerCase()} entry (ctrl+click: a tab of its own)`}>
                {view && <span className={styles.metaIcon}>{pluginIcon(view.icon)}</span>}
                {TYPE_LABEL[t.type]}
                <span className={styles.count}>{t.count}</span>
              </button>
              {t.subtypes.length > 1 &&
                t.subtypes.map((st) => (
                  <button key={st.subtype} className={styles.metaSub} onClick={open({ types: [typeRef(t.type, st.subtype)] })}>
                    {SUBTYPE_LABEL[typeRef(t.type, st.subtype)] ?? st.subtype}
                    <span className={styles.count}>{n(st)}</span>
                  </button>
                ))}
            </li>
          )
        })}
      </ul>
      <header className={styles.viewHeader}>
        <h2 className={styles.viewTitle}>Categories</h2>
      </header>
      <ul className={styles.metaList}>
        {data.categories.map((c) => (
          <li key={c.name}>
            <button className={styles.metaItem} onClick={open({ category: c.name })} title={`Everything filed under ${c.name}`}>
              {c.name}
              <span className={styles.count}>{n(c)}</span>
            </button>
          </li>
        ))}
        {n(data.uncategorized) > 0 && (
          <li>
            <button className={`${styles.metaItem} ${styles.dim}`} onClick={open({ uncategorized: true })} title="Entries without a category">
              uncategorized
              <span className={styles.count}>{n(data.uncategorized)}</span>
            </button>
          </li>
        )}
      </ul>
    </>
  )
}

/** Every tag in its hierarchy. */
function TagTree({ find }: { find: string }) {
  const all = useAllTags()
  const showArchived = useStore(prefsStore, (s) => s.showArchived)
  const expandedList = useStore(prefsStore, (s) => s.expanded)
  const expanded = useMemo(() => new Set(expandedList), [expandedList])
  const tree = useMemo(() => buildTagTree(all), [all])
  const q = find.trim().toLowerCase()

  // With a filter: matching tags plus their ancestors, fully expanded.
  const shown = useMemo(() => {
    if (!q) return null
    const set = new Set<string>()
    for (const t of all) if (t.path.includes(q)) for (const p of [...ancestors(t.path), t.path]) set.add(p)
    return set
  }, [all, q])

  const toggle = (path: string) => setPref('expanded', expanded.has(path) ? expandedList.filter((p) => p !== path) : [...expandedList, path])
  const allPaths = (nodes: TagTreeNode[]): string[] => nodes.flatMap((n) => (n.children.length ? [n.path, ...allPaths(n.children)] : []))

  const renderNodes = (nodes: TagTreeNode[], depth: number) =>
    nodes
      .filter((n) => (shown ? shown.has(n.path) : showArchived || n.totalActive > 0))
      .map((n) => {
        const open = shown ? true : expanded.has(n.path)
        return (
          <li key={n.path}>
            <div className={`${styles.treeRow} ${!n.totalActive ? styles.dim : ''}`} style={{ paddingLeft: depth * 16 + 4 }}>
              <button
                className={styles.caret}
                data-open={open || undefined}
                onClick={() => toggle(n.path)}
                disabled={!n.children.length}
                aria-label={open ? 'Collapse' : 'Expand'}
              />
              <button className={styles.treeName} title={n.path} onClick={(e) => openTag(n.path, { newTab: e.ctrlKey || e.metaKey })}>
                {mark(n.name, q)}
              </button>
              <span className={styles.count} title={`${n.totalActive} entries${n.totalArchived ? `, ${n.totalArchived} archived` : ''}`}>
                {n.totalActive}
                {showArchived && n.totalArchived > 0 && <span className={styles.archivedCount}>+{n.totalArchived}</span>}
              </span>
              <span className={styles.treeActions}>
                <button title="Rename" onClick={() => startTagOp({ op: 'rename', tag: n.path })}>
                  ✎
                </button>
                <button title="Merge into…" onClick={() => startTagOp({ op: 'merge', tag: n.path })}>
                  ⇥
                </button>
                <button title="Delete" onClick={() => startTagOp({ op: 'delete', tag: n.path })}>
                  ×
                </button>
              </span>
            </div>
            {open && n.children.length > 0 && <ul className={styles.tree}>{renderNodes(n.children, depth + 1)}</ul>}
          </li>
        )
      })

  return (
    <>
      <header className={styles.viewHeader}>
        <h2 className={styles.viewTitle}>Tags</h2>
        <span className={styles.muted}>{all.length} tags</span>
        <div className={styles.toolbar}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setPref('showArchived', e.target.checked)} /> archived
          </label>
          <button onClick={() => setPref('expanded', allPaths(tree))}>expand</button>
          <button onClick={() => setPref('expanded', [])}>collapse</button>
        </div>
      </header>
      {!all.length && <p className={styles.muted}>No tags yet. Add tags to entries and they show up here.</p>}
      <ul className={`${styles.tree} ${styles.treeRoot}`}>{renderNodes(tree, 0)}</ul>
    </>
  )
}
