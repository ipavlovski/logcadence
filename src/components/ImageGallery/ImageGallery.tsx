import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isVideo, type ImageDTO } from '../../../shared/types.ts'
import styles from './ImageGallery.module.css'

/** A small still of a gallery item: the image, or a video's first frame. */
export function MediaThumb({ item, className }: { item: ImageDTO; className?: string }) {
  return isVideo(item) ? (
    <video className={className} src={item.url} preload="metadata" muted playsInline draggable={false} />
  ) : (
    <img className={className} src={item.url} alt="" loading="lazy" draggable={false} />
  )
}

interface Props {
  images: ImageDTO[]
  activeId: string | null
  onActivate?: (id: string) => void
  onDelete?: (id: string) => void
  /** Called with the new order after a thumbnail is dragged onto another (they swap places). */
  onReorder?: (ids: string[]) => void
  compact?: boolean
}

/**
 * Plays muted and looping like a gif while on screen (paused off it); the controls show on hover, to
 * unmute, seek or go fullscreen.
 */
function LargeVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) void el.play().catch(() => {})
      else el.pause()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <video
      ref={ref}
      className={styles.large}
      src={url}
      muted
      loop
      playsInline
      preload="metadata"
      controls={hover}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  )
}

/**
 * Large preview of the active (selected) image or video, plus a strip of all items; the first one is
 * the node's thumbnail. Drag a thumbnail onto another to swap them; Delete removes the selected image.
 */
export function ImageGallery({ images, activeId, onActivate, onDelete, onReorder, compact }: Props) {
  const [zoom, setZoom] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const active = images.find((i) => i.id === activeId) ?? images[0]

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setZoom(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (!active) return null

  const remove = (id: string) => {
    onDelete?.(id)
    // The focused thumbnail goes away with the image; keep focus here so Delete can go on.
    root.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const i = images.indexOf(active)
    if ((e.key === 'Delete' || e.key === 'Backspace') && onDelete) {
      e.preventDefault()
      e.stopPropagation()
      remove(active.id)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onActivate && images.length > 1) {
      e.preventDefault()
      e.stopPropagation()
      onActivate(images[(i + (e.key === 'ArrowLeft' ? -1 : 1) + images.length) % images.length]!.id)
    }
  }

  const swap = (a: string, b: string) => {
    if (a === b || !onReorder) return
    const ids = images.map((img) => img.id)
    const ia = ids.indexOf(a)
    const ib = ids.indexOf(b)
    if (ia < 0 || ib < 0) return
    ;[ids[ia], ids[ib]] = [ids[ib]!, ids[ia]!]
    onReorder(ids)
  }

  return (
    <div
      ref={root}
      className={`${styles.gallery} ${compact ? styles.compact : ''}`}
      tabIndex={onDelete ? -1 : undefined}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.largeWrap}>
        {isVideo(active) ? (
          <LargeVideo key={active.id} url={active.url} />
        ) : (
          <img className={styles.large} src={active.url} alt="" loading="lazy" onClick={() => setZoom(true)} />
        )}
        {onDelete && (
          <button className={styles.delete} title={isVideo(active) ? 'Remove video (Delete)' : 'Remove image (Delete)'} onClick={() => remove(active.id)}>
            ×
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className={styles.strip}>
          {images.map((img, i) => (
            <button
              key={img.id}
              className={[styles.thumb, img.id === active.id && styles.active, img.id === dragId && styles.dragging, img.id === overId && img.id !== dragId && styles.dropTarget]
                .filter(Boolean)
                .join(' ')}
              title={[i === 0 ? 'Thumbnail image' : 'Click to preview', onReorder && 'drag onto another to swap', onDelete && 'Delete removes it'].filter(Boolean).join(' · ')}
              onClick={() => onActivate?.(img.id)}
              draggable={!!onReorder}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-image-id', img.id)
                setDragId(img.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              onDragOver={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.stopPropagation()
                setOverId(img.id)
              }}
              onDragLeave={() => setOverId((o) => (o === img.id ? null : o))}
              onDrop={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.stopPropagation()
                swap(dragId, img.id)
                setDragId(null)
                setOverId(null)
              }}
            >
              <MediaThumb item={img} />
              {isVideo(img) && <span className={styles.play}>▶</span>}
              {i === 0 && <span className={styles.badge}>thumb</span>}
            </button>
          ))}
        </div>
      )}
      {zoom && !isVideo(active) && (
        <div className={styles.lightbox} onClick={() => setZoom(false)}>
          <img src={active.url} alt="" />
        </div>
      )}
    </div>
  )
}
