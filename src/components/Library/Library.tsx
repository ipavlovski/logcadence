import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type MouseEvent } from 'react'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import type { ImageDTO } from '../../../shared/types.ts'
import { mediaFiles, pasteMedia } from '../../media.ts'
import { notify } from '../../state/ui.ts'
import { AutoTextarea } from '../AutoTextarea/AutoTextarea.tsx'
import { ImageGallery } from '../ImageGallery/ImageGallery.tsx'
import { Markdown } from '../Markdown/Markdown.tsx'
import styles from './Library.module.css'

// The look and the pieces the catalog views share (Bookmarks; the image board's day labels): a grid of cards by
// day, an item page with notes and comments that take pasted media. Library.module.css is their stylesheet.

const fail = (err: Error) => notify(err.message)

export function dayLabel(date: string): string {
  const t = today()
  if (date === t) return 'Today'
  if (date === shiftDate(t, -1)) return 'Yesterday'
  return `${weekday(date)}, ${formatJournalDate(date)}`
}

export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

interface TextSectionProps {
  title: string
  text: string
  images: ImageDTO[]
  activeId: string | null
  empty: string
  onSave: (text: string) => void
  onActivate: (imageId: string) => void
  upload: (file: File) => Promise<unknown>
  deleteImage: (imageId: string) => Promise<unknown>
  reorder: (ids: string[]) => Promise<unknown>
  /** After images were added, removed or reordered. */
  onImages: () => void
}

/** Markdown text (click to edit, saved when editing ends) and its gallery: pasted or dropped images, gifs and videos join it. */
export function TextSection({ title, text, images, activeId, empty, onSave, onActivate, upload: uploadOne, deleteImage, reorder, onImages }: TextSectionProps) {
  const [editing, setEditing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const imageOp = (p: Promise<unknown>) => p.catch(fail).finally(onImages)
  const upload = async (files: File[]) => {
    for (const file of files) await uploadOne(file).catch(fail)
    onImages()
  }
  const onDrop = (e: DragEvent) => {
    const files = mediaFiles(e.dataTransfer.files)
    setDragOver(false)
    if (!files.length) return
    e.preventDefault()
    void upload(files)
  }
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button') || window.getSelection()?.toString()) return
    setEditing(true)
  }
  return (
    <section
      className={`${styles.notes} ${dragOver ? styles.dragOver : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <h3>{title}</h3>
      {editing ? (
        <NotesEditor
          initial={text}
          onDone={(next) => {
            setEditing(false)
            if (next !== text) onSave(next)
          }}
          onUpload={(files) => void upload(files)}
        />
      ) : (
        <div className={styles.notesView} onClick={open}>
          {text.trim() ? <Markdown source={text} /> : !images.length && <span className={styles.placeholder}>{empty}</span>}
        </div>
      )}
      {images.length > 0 && (
        <div className={styles.gallery}>
          <ImageGallery
            images={images}
            activeId={activeId}
            onActivate={onActivate}
            onDelete={(imageId) => imageOp(deleteImage(imageId))}
            onReorder={(ids) => imageOp(reorder(ids))}
          />
        </div>
      )}
    </section>
  )
}

function NotesEditor({ initial, onDone, onUpload }: { initial: string; onDone: (notes: string) => void; onUpload: (files: File[]) => void }) {
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const finished = useRef(false)
  const finish = () => {
    if (finished.current) return
    finished.current = true
    doneRef.current(draftRef.current)
  }
  // Leaving the page (another video, the listing) while typing still saves.
  useEffect(() => finish, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onPaste = (e: ClipboardEvent) => pasteMedia(e, onUpload)
  return (
    <AutoTextarea
      className={styles.editor}
      value={draft}
      autoFocus
      spellCheck={false}
      placeholder="Write… (markdown; paste or drop images, gifs and videos; Esc to finish)"
      onChange={(e) => setDraft(e.target.value)}
      onPaste={onPaste}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        // Switching windows keeps the editor open; clicking elsewhere in the app closes it.
        if (document.hasFocus()) finish()
      }}
    />
  )
}

// ── icons ──────────────────────────────────────────────────────────────────

export function ArrowIcon({ dir }: { dir: -1 | 1 }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir < 0 ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
    </svg>
  )
}
