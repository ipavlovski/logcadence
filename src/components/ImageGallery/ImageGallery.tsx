import { useEffect, useState } from 'react'
import type { ImageDTO } from '../../../shared/types.ts'
import styles from './ImageGallery.module.css'

interface Props {
  images: ImageDTO[]
  activeId: string | null
  onActivate?: (id: string) => void
  onDelete?: (id: string) => void
  compact?: boolean
}

/** Large preview of the active image, plus a strip of all images (the first one is the thumbnail). */
export function ImageGallery({ images, activeId, onActivate, onDelete, compact }: Props) {
  const [zoom, setZoom] = useState(false)
  const active = images.find((i) => i.id === activeId) ?? images[0]

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (!active) return null
  return (
    <div className={`${styles.gallery} ${compact ? styles.compact : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className={styles.largeWrap}>
        <img className={styles.large} src={active.url} alt="" loading="lazy" onClick={() => setZoom(true)} />
        {onDelete && (
          <button className={styles.delete} title="Remove image" onClick={() => onDelete(active.id)}>
            ×
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className={styles.strip}>
          {images.map((img, i) => (
            <button
              key={img.id}
              className={`${styles.thumb} ${img.id === active.id ? styles.active : ''}`}
              title={i === 0 ? 'Thumbnail image' : undefined}
              onClick={() => onActivate?.(img.id)}
            >
              <img src={img.url} alt="" loading="lazy" />
              {i === 0 && <span className={styles.badge}>thumb</span>}
            </button>
          ))}
        </div>
      )}
      {zoom && (
        <div className={styles.lightbox} onClick={() => setZoom(false)}>
          <img src={active.url} alt="" />
        </div>
      )}
    </div>
  )
}
