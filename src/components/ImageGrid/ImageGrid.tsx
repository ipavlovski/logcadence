import { memo, useRef, useState, type MouseEvent } from 'react'
import { isVideo, type EntryDTO, type ImageDTO } from '../../../shared/types.ts'
import { requestReveal } from '../../state/journal.ts'
import { openDate } from '../../state/panes.ts'
import { toggleImageMode } from '../../state/ui.ts'
import { Lightbox, usePlayInView } from '../ImageGallery/ImageGallery.tsx'
import styles from './ImageGrid.module.css'

// Image mode's grid: the images of a section's entries (a category of a day, a day of a query) in justified rows,
// each tile as wide as its image is for the row's height. A click shows it large; ctrl+click (or "Show in journal"
// there) leaves image mode for its node.

export interface GridItem {
  image: ImageDTO
  entry: EntryDTO
  nodeId: string
  archived: boolean
}

/** Every image of the entries' nodes, in order. */
export const gridItems = (entries: EntryDTO[]): GridItem[] =>
  entries.flatMap((entry) => entry.nodes.flatMap((n) => n.images.map((image) => ({ image, entry, nodeId: n.id, archived: entry.archived || n.archived }))))

const ROW_H = 180
// Very tall screenshots (a whole Reddit post) and panoramas show their top or middle, cropped.
const MIN_RATIO = 0.5
const MAX_RATIO = 3

/** Leaves image mode for the image's node, in its day. */
export function revealImage(item: GridItem) {
  toggleImageMode(false)
  openDate(item.entry.date, { focus: true })
  requestReveal({ date: item.entry.date, entryId: item.entry.id, nodeId: item.nodeId, mode: 'flash' })
}

export function ImageGrid({ items }: { items: GridItem[] }) {
  const [open, setOpen] = useState<number | null>(null)
  // The sizes of images stored without one, as they load.
  const [measured, setMeasured] = useState<Record<string, number>>({})
  const shown = open !== null ? items[open] : undefined
  return (
    <>
      <div className={styles.grid}>
        {items.map((item, i) => {
          const { image } = item
          const known = image.width && image.height ? image.width / image.height : measured[image.id]
          const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, known ?? 4 / 3))
          return (
            <Tile
              key={`${item.nodeId}:${image.id}`}
              item={item}
              ratio={ratio}
              onMeasure={known ? undefined : (r) => setMeasured((m) => ({ ...m, [image.id]: r }))}
              onClick={(e) => (e.ctrlKey || e.metaKey ? revealImage(item) : setOpen(i))}
            />
          )
        })}
      </div>
      {shown && (
        <Lightbox
          items={items.map((x) => x.image)}
          index={open!}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          actions={
            <>
              {shown.entry.title && <span className={styles.caption}>{shown.entry.title}</span>}
              <button onClick={() => revealImage(shown)}>Show in journal</button>
            </>
          }
        />
      )}
    </>
  )
}

interface TileProps {
  item: GridItem
  ratio: number
  onMeasure?: (ratio: number) => void
  onClick: (e: MouseEvent) => void
}

const Tile = memo(function Tile({ item, ratio, onMeasure, onClick }: TileProps) {
  const { image, entry } = item
  return (
    <button
      className={`${styles.tile} ${item.archived ? styles.archived : ''}`}
      style={{ flexGrow: ratio, flexBasis: ratio * ROW_H, height: ROW_H }}
      title={[entry.title, 'click: larger · ctrl+click: show in journal'].filter(Boolean).join(' · ')}
      onClick={onClick}
    >
      {isVideo(image) ? (
        <GridVideo image={image} onMeasure={onMeasure} />
      ) : (
        <img
          src={image.thumbUrl ?? image.url}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={onMeasure && ((e) => e.currentTarget.naturalHeight && onMeasure(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight))}
        />
      )}
    </button>
  )
})

/** Plays muted and looping like a gif while on screen. */
function GridVideo({ image, onMeasure }: { image: ImageDTO; onMeasure?: (ratio: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  usePlayInView(ref)
  return (
    <video
      ref={ref}
      src={image.url}
      poster={image.thumbUrl ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      draggable={false}
      onLoadedMetadata={onMeasure && ((e) => e.currentTarget.videoHeight && onMeasure(e.currentTarget.videoWidth / e.currentTarget.videoHeight))}
    />
  )
}
