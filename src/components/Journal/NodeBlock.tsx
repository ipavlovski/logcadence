import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import type { EntryDTO, NodeDTO } from '../../../shared/types.ts'
import { AutoTextarea } from '../AutoTextarea/AutoTextarea.tsx'
import { ImageGallery } from '../ImageGallery/ImageGallery.tsx'
import { Markdown } from '../Markdown/Markdown.tsx'
import { openChat, SOURCE_LABEL } from '../../state/ai.ts'
import { useDayApi, type FocusTarget } from './dayContext.ts'
import styles from './Journal.module.css'

interface Props {
  node: NodeDTO
  /** Set while this node is being edited. */
  editing: Extract<FocusTarget, { kind: 'node' }> | null
  find: string
  flash: boolean
}

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'))

export const NodeBlock = memo(function NodeBlock({ node, editing, find, flash }: Props) {
  const day = useDayApi()
  const [dragOver, setDragOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    const files = imageFiles(e.dataTransfer.files)
    setDragOver(false)
    if (!files.length) return
    e.preventDefault()
    day.uploadImages(node.id, files)
  }

  return (
    <div
      className={`${styles.node} ${node.archived ? styles.archived : ''} ${flash ? styles.flash : ''} ${dragOver ? styles.dragOver : ''}`}
      data-reveal={node.id}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <span className={styles.bullet} />
      <div className={styles.nodeBody}>
        {editing ? (
          <NodeEditor node={node} target={editing} />
        ) : (
          <div
            className={styles.nodeView}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) return
              if (window.getSelection()?.toString()) return // let the user select text
              day.focusTo({ kind: 'node', nodeId: node.id, caret: 'end' })
            }}
          >
            {node.content ? <Markdown source={node.content} highlight={find} /> : !node.images.length && <span className={styles.placeholder}>…</span>}
          </div>
        )}
        {node.images.length > 0 && (
          <ImageGallery
            images={node.images}
            activeId={node.activeImageId}
            onActivate={(id) => day.updateNode(node.id, { activeImageId: id })}
            onDelete={(id) => day.deleteImage(node.id, id)}
          />
        )}
      </div>
      <div className={styles.rowActions}>
        <button title={node.archived ? 'Unarchive' : 'Archive'} onClick={() => day.updateNode(node.id, { archived: !node.archived })}>
          {node.archived ? '↺' : '▣'}
        </button>
        <button title="Delete node" onClick={() => day.deleteNode(node.id)}>
          ×
        </button>
      </div>
    </div>
  )
})

/** A read-only prompt of an imported AI chat; clicking it shows the prompt and its reply in the canvas AI tab. */
export const PromptNode = memo(function PromptNode({
  node,
  chat,
  find,
  flash,
}: {
  node: NodeDTO
  chat: NonNullable<EntryDTO['chat']>
  find: string
  flash: boolean
}) {
  const turn = chat.nodeIds.indexOf(node.id)
  const open = (e: MouseEvent) => {
    if (turn < 0 || (e.target as HTMLElement).closest('a')) return
    if (window.getSelection()?.toString()) return // let the user select text
    openChat(chat.id, { turn, newTab: e.ctrlKey || e.metaKey })
  }
  return (
    <div className={`${styles.node} ${node.archived ? styles.archived : ''} ${flash ? styles.flash : ''}`} data-reveal={node.id}>
      <span className={styles.bullet} />
      <div className={styles.nodeBody}>
        <div
          className={`${styles.nodeView} ${styles.readOnly} ${turn >= 0 ? styles.prompt : ''}`}
          title={turn >= 0 ? `Show this prompt and the reply in the ${SOURCE_LABEL[chat.source]} transcript (Ctrl+click: new tab)` : undefined}
          onClick={open}
        >
          {node.content ? <Markdown source={node.content} highlight={find} /> : <span className={styles.placeholder}>…</span>}
        </div>
        {node.images.length > 0 && <ImageGallery images={node.images} activeId={node.activeImageId} />}
      </div>
    </div>
  )
})

/** Lines starting with ``` before the caret: an odd count means the caret is inside a code block. */
const insideFence = (text: string) => text.split('\n').filter((l) => l.startsWith('```')).length % 2 === 1

function NodeEditor({ node, target }: { node: NodeDTO; target: Extract<FocusTarget, { kind: 'node' }> }) {
  const day = useDayApi()
  const [draft, setDraft] = useState(node.content)
  const ref = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  // Set once the node was merged/split away, so the unmount commit does not resurrect it.
  const consumed = useRef(false)
  const dayRef = useRef(day)
  dayRef.current = day

  const commit = () => {
    if (!consumed.current) dayRef.current.updateNode(node.id, { content: draftRef.current })
  }

  // Edits live in memory while typing and are pushed when editing ends.
  useEffect(() => commit, []) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: false })
    const pos = target.caret === 'start' ? 0 : target.caret === 'end' ? el.value.length : target.caret
    el.setSelectionRange(pos, pos)
  }, [target.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const { selectionStart: s, selectionEnd: t, value } = el
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey
    if (e.key === 'Enter' && plain && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (insideFence(value.slice(0, s))) return
      e.preventDefault()
      consumed.current = true
      day.split(node, value.slice(0, s), value.slice(t))
    } else if (e.key === 'Backspace' && plain && s === 0 && t === 0) {
      if (day.backspaceAtStart(node, value)) {
        e.preventDefault()
        consumed.current = true
      }
    } else if (e.key === 'ArrowUp' && plain && !e.shiftKey && s === t && !value.slice(0, s).includes('\n')) {
      e.preventDefault()
      day.navigate({ entryId: node.entryId, nodeId: node.id }, -1)
    } else if (e.key === 'ArrowDown' && plain && !e.shiftKey && s === t && !value.slice(t).includes('\n')) {
      e.preventDefault()
      day.navigate({ entryId: node.entryId, nodeId: node.id }, 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      el.blur()
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    const files = imageFiles(e.clipboardData.files)
    if (!files.length) return
    e.preventDefault()
    day.uploadImages(node.id, files)
  }

  return (
    <AutoTextarea
      ref={ref}
      className={styles.editor}
      value={draft}
      spellCheck={false}
      placeholder="Write… (Enter: new node, Shift+Enter: line break, paste images)"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={() => day.touch(node.entryId)}
      onBlur={() => {
        commit()
        // Switching windows keeps the editor open; clicking elsewhere in the app closes it.
        if (document.hasFocus()) day.blurNode(node.id)
      }}
    />
  )
}
