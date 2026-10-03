import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { chatTag } from '../../../shared/tags.ts'
import type { EntryDTO } from '../../../shared/types.ts'
import { AutoTextarea } from '../AutoTextarea/AutoTextarea.tsx'
import { mark } from '../Markdown/Markdown.tsx'
import { openChat, SOURCE_LABEL } from '../../state/ai.ts'
import { TagInput } from '../TagInput/TagInput.tsx'
import { useDayApi, type FocusTarget } from './dayContext.ts'
import { NodeBlock, PromptNode } from './NodeBlock.tsx'
import styles from './Journal.module.css'

interface Props {
  entry: EntryDTO
  focus: FocusTarget | null
  find: string
  flashId: string | null
  /** Only the title and tags show. */
  folded: boolean
}

/** Shift+click on a title folds or unfolds its entry. On mousedown, so the title doesn't start editing first. */
function foldOnShiftClick(e: MouseEvent, toggle: () => void) {
  if (!e.shiftKey) return
  e.preventDefault()
  toggle()
}

export const EntryCard = memo(function EntryCard({ entry, focus, find, flashId, folded }: Props) {
  const day = useDayApi()
  const titleFocus = focus?.kind === 'title' && focus.entryId === entry.id ? focus : null
  const isEmpty = !entry.title && !entry.tags.length && entry.nodes.every((n) => !n.content && !n.images.length)
  // Imported AI chats are read-only apart from tags (their source tag is locked); each prompt links to the transcript.
  const chat = entry.chat
  const toggleFold = () => day.toggleFold(entry.id)

  return (
    <article className={`${styles.entry} ${entry.archived ? styles.archived : ''} ${flashId === entry.id ? styles.flash : ''}`} data-reveal={entry.id}>
      <header className={styles.entryHead}>
        <div className={styles.entryHeadMain}>
          {chat ? (
            <div className={`${styles.title} ${styles.readOnly}`} onMouseDown={(e) => foldOnShiftClick(e, toggleFold)}>
              {mark(entry.title, find)}
            </div>
          ) : (
            <EntryTitle entry={entry} focus={titleFocus} find={find} isEmpty={isEmpty} toggleFold={toggleFold} />
          )}
          <TagInput
            className={styles.entryTags}
            value={entry.tags}
            locked={chat ? chatTag(chat.source) : undefined}
            onChange={(tags) => day.updateEntry(entry.id, { tags })}
            onFocus={() => day.touch(entry.id)}
          />
        </div>
        {chat && (
          <button
            className={styles.chatLink}
            title={`Open the ${SOURCE_LABEL[chat.source]} transcript in the canvas AI tab (Ctrl+click: new tab)`}
            onClick={(e) => openChat(chat.id, { newTab: e.ctrlKey || e.metaKey })}
          >
            transcript ↗
          </button>
        )}
        <div className={styles.rowActions}>
          <button title={entry.archived ? 'Unarchive entry' : 'Archive entry'} onClick={() => day.updateEntry(entry.id, { archived: !entry.archived })}>
            {entry.archived ? '↺' : '▣'}
          </button>
          <button
            title="Delete entry"
            onClick={() =>
              (isEmpty || confirm(`Delete "${entry.title || 'untitled entry'}" and its ${entry.nodes.length} node(s)?`)) && day.deleteEntry(entry.id)
            }
          >
            ×
          </button>
        </div>
      </header>
      {folded ? (
        <button className={styles.foldedHint} onClick={toggleFold} title="Unfold (or Shift+click the title)">
          <i className={styles.chevron} />
          {entry.nodes.length} {entry.nodes.length === 1 ? 'node' : 'nodes'}
        </button>
      ) : (
        <div className={styles.nodes}>
          {entry.nodes.map((n) =>
            chat ? (
              <PromptNode key={n.id} node={n} chat={chat} find={find} flash={flashId === n.id} />
            ) : (
              <NodeBlock key={n.id} node={n} editing={focus?.kind === 'node' && focus.nodeId === n.id ? focus : null} find={find} flash={flashId === n.id} />
            ),
          )}
          {!chat && (
            <button
              className={styles.addNode}
              title="Add a node"
              onClick={() => day.focusTo({ kind: 'node', nodeId: day.insertNode(entry.id, entry.nodes.at(-1)?.id ?? null, ''), caret: 'start' })}
            >
              +
            </button>
          )}
        </div>
      )}
    </article>
  )
})

function EntryTitle({
  entry,
  focus,
  find,
  isEmpty,
  toggleFold,
}: {
  entry: EntryDTO
  focus: Extract<FocusTarget, { kind: 'title' }> | null
  find: string
  isEmpty: boolean
  toggleFold: () => void
}) {
  const day = useDayApi()
  const [draft, setDraft] = useState(entry.title)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) setDraft(entry.title)
  }, [entry.title, editing])

  useLayoutEffect(() => {
    if (!focus) return
    setEditing(true)
  }, [focus])

  useLayoutEffect(() => {
    const el = ref.current
    if (!editing || !el || !focus) return
    el.focus()
    const pos = focus.caret === 'start' ? 0 : el.value.length
    el.setSelectionRange(pos, pos)
  }, [editing, focus])

  const commit = () => {
    const title = draft.replace(/\s*\n\s*/g, ' ').trim()
    if (title !== entry.title) day.updateEntry(entry.id, { title })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      commit()
      const first = entry.nodes[0]
      day.focusTo({ kind: 'node', nodeId: first ? first.id : day.insertNode(entry.id, null, ''), caret: 'start' })
    } else if (e.key === 'ArrowDown' && el.selectionStart === el.value.length) {
      e.preventDefault()
      day.navigate({ entryId: entry.id }, 1)
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0) {
      e.preventDefault()
      day.navigate({ entryId: entry.id }, -1)
    } else if (e.key === 'Backspace' && !draft && isEmpty) {
      // Backspace in an empty, untagged entry removes it.
      e.preventDefault()
      day.navigate({ entryId: entry.id }, -1)
      day.deleteEntry(entry.id)
    } else if (e.key === 'Escape') {
      el.blur()
    }
  }

  if (!editing)
    return (
      <div
        className={`${styles.title} ${entry.title ? '' : styles.placeholder}`}
        tabIndex={0}
        onMouseDown={(e) => foldOnShiftClick(e, toggleFold)}
        onClick={(e) => !e.shiftKey && day.focusTo({ kind: 'title', entryId: entry.id, caret: 'end' })}
        onFocus={() => setEditing(true)}
      >
        {entry.title ? mark(entry.title, find) : 'Untitled entry'}
      </div>
    )

  return (
    <AutoTextarea
      ref={ref}
      className={`${styles.title} ${styles.titleInput}`}
      value={draft}
      placeholder="Untitled entry"
      spellCheck={false}
      autoFocus={!focus}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => day.touch(entry.id)}
      onBlur={() => {
        commit()
        setEditing(false)
      }}
    />
  )
}
