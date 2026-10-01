import { useMemo } from 'react'
import { ancestors, buildTagTree, holdsChatTag, type TagTreeNode } from '../../../shared/tags.ts'
import { openTag } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { useAllTags } from '../../state/tags.ts'
import { prefsStore, setPref } from '../../state/ui.ts'
import { mark } from '../Markdown/Markdown.tsx'
import { startTagOp } from './tagOps.ts'
import styles from './Tags.module.css'

/** The tags pane's primary tab: every tag in its hierarchy. */
export function TagTree({ find }: { find: string }) {
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
              {/* AI chat source tags (and their parents) are locked. */}
              {!holdsChatTag(n.path) && (
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
              )}
            </div>
            {open && n.children.length > 0 && <ul className={styles.tree}>{renderNodes(n.children, depth + 1)}</ul>}
          </li>
        )
      })

  return (
    <div className={styles.view}>
      <header className={styles.viewHeader}>
        <h2 className={styles.viewTitle}>Tag tree</h2>
        <span className={styles.muted}>{all.length} tags</span>
        <div className={styles.toolbar}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setPref('showArchived', e.target.checked)} /> archived
          </label>
          <button onClick={() => setPref('expanded', allPaths(tree))}>expand</button>
          <button onClick={() => setPref('expanded', [])}>collapse</button>
        </div>
      </header>
      {!all.length && <p className={styles.muted}>No tags yet. Add tags to journal entries and they show up here.</p>}
      <ul className={`${styles.tree} ${styles.treeRoot}`}>{renderNodes(tree, 0)}</ul>
    </div>
  )
}
