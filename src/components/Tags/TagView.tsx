import { useMemo, useState, type MouseEvent } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { ancestors, holdsChatTag, tagName } from '../../../shared/tags.ts'
import type { EntryDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { matches } from '../../markdown.ts'
import { emitChange, useRevision } from '../../state/bus.ts'
import { useCommand } from '../../state/commands.ts'
import { requestReveal } from '../../state/journal.ts'
import { openDate, openTag } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify, prefsStore, setPref } from '../../state/ui.ts'
import { ImageGallery, MediaThumb } from '../ImageGallery/ImageGallery.tsx'
import { Markdown, mark } from '../Markdown/Markdown.tsx'
import { TagChip } from '../TagChip/TagChip.tsx'
import { startTagOp } from './tagOps.ts'
import styles from './Tags.module.css'

/** Selection keys: `e:<entryId>` or `n:<nodeId>`. */
type Sel = Set<string>

/** Read-only listing of everything under a tag, newest first; archive to keep it fresh. */
export function TagView({ tag, find }: { tag: string; find: string }) {
  const rev = useRevision()
  const showArchived = useStore(prefsStore, (s) => s.showArchived)
  const includeSub = useStore(prefsStore, (s) => s.includeSubtags)
  const [sel, setSel] = useState<Sel>(new Set())
  const q = find.trim()

  const { data, error } = useFetch(`${tag}|${showArchived}|${includeSub}|${rev}`, (signal) =>
    unwrap(api.tags.entries.$get({ query: { tag, archived: showArchived ? '1' : '0', sub: includeSub ? '1' : '0' } }, { init: { signal } })),
  )
  const all = data?.tag === tag ? data.entries : undefined

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
        <h2 className={styles.viewTitle}>
          {ancestors(tag).map((a) => (
            <span key={a}>
              <button className={styles.crumb} onClick={(e) => openTag(a, { newTab: e.ctrlKey || e.metaKey })}>
                {tagName(a)}
              </button>
              <span className={styles.sep}>:</span>
            </span>
          ))}
          <span>{tagName(tag)}</span>
        </h2>
        <span className={styles.muted}>{all ? `${all.length} ${all.length === 1 ? 'entry' : 'entries'}` : ''}</span>
        <div className={styles.toolbar}>
          <label className={styles.toggle} title="Show archived entries and nodes (greyed out)">
            <input type="checkbox" checked={showArchived} onChange={(e) => setPref('showArchived', e.target.checked)} /> archived
          </label>
          <label className={styles.toggle} title="Include entries of sub-tags">
            <input type="checkbox" checked={includeSub} onChange={(e) => setPref('includeSubtags', e.target.checked)} /> sub-tags
          </label>
          {holdsChatTag(tag) ? (
            <span className={styles.muted} title="Source tag of imported AI chats">
              🔒︎ locked
            </span>
          ) : (
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
      {all && !visible.length && <p className={styles.muted}>{q ? `Nothing matches “${q}”.` : 'No entries under this tag.'}</p>}

      {byDate.map(([date, list]) => (
        <section key={date} className={styles.card}>
          <button
            className={styles.stamp}
            title="Open in journal (ctrl+click: new tab)"
            onClick={(e) => openDate(date, { newTab: e.ctrlKey || e.metaKey, focus: true })}
          >
            {formatJournalDate(date)}
          </button>
          {list.map((entry) => {
            const thumb = entry.nodes.find((n) => n.images.length)?.images[0]
            return (
              <article
                key={entry.id}
                className={`${styles.entry} ${sel.has(`e:${entry.id}`) ? styles.selected : ''} ${entry.archived ? styles.archived : ''}`}
                onClick={(e) => click(e, `e:${entry.id}`, () => revealIn(entry))}
                onDoubleClick={() => revealIn(entry)}
              >
                <div className={styles.entryHead}>
                  <div className={styles.entryMain}>
                    <div className={styles.entryTitle}>{entry.title ? mark(entry.title, q) : <span className={styles.muted}>untitled</span>}</div>
                    <div className={styles.entryTags}>
                      {entry.tags.map((t, i) => (
                        <TagChip key={t} tag={t} primary={i === 0} />
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
