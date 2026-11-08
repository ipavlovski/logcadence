import { memo } from 'react'
import type { EntryDTO } from '../../../shared/types.ts'
import { openItem } from '../../actions.ts'
import { thumbOf, typeLabel } from '../../entryView.ts'
import { typeRef } from '../../../shared/entryTypes.ts'
import { openQuery } from '../../state/panes.ts'
import { CategoryPicker } from '../CategoryPicker/CategoryPicker.tsx'
import { MediaThumb } from '../ImageGallery/ImageGallery.tsx'
import { mark } from '../Markdown/Markdown.tsx'
import { TagInput } from '../TagInput/TagInput.tsx'
import { useDayApi } from './dayContext.ts'
import styles from './Journal.module.css'

/** A video, bookmark or AI chat in its day: what it is and where it's from; its category and tags edit here, the rest in its view (tags pane). */
export const ItemCard = memo(function ItemCard({ entry, find, flash }: { entry: EntryDTO; find: string; flash: boolean }) {
  const day = useDayApi()
  const d = entry.detail
  const thumb = thumbOf(entry)
  const open = () => openItem(entry)
  return (
    <article className={`${styles.item} ${entry.archived ? styles.archived : ''} ${flash ? styles.flash : ''}`} data-reveal={entry.id}>
      {thumb && (
        <button className={styles.itemThumb} onClick={open} title="Open in the tags pane" tabIndex={-1}>
          <MediaThumb item={thumb} />
        </button>
      )}
      <div className={styles.itemMain}>
        <div className={styles.itemHead}>
          <button
            className={styles.itemType}
            title={`Every ${typeLabel(entry)} entry (ctrl+click: a tab of its own)`}
            onClick={(e) => openQuery({ types: [typeRef(entry.type, entry.subtype)] }, { newTab: e.ctrlKey || e.metaKey })}
          >
            {typeLabel(entry)}
          </button>
          <button className={styles.itemTitle} onClick={open} title="Open in the tags pane">
            {entry.title ? mark(entry.title, find) : 'untitled'}
          </button>
        </div>
        <div className={styles.itemSource}>
          {d?.kind === 'video' && (
            <button
              title={`${d.channel}'s videos (ctrl+click: a tab of its own)`}
              onClick={(e) => openQuery({ types: ['video'], channel: d.channel }, { newTab: e.ctrlKey || e.metaKey })}
            >
              {d.channelAvatar && <img className={styles.avatar} src={d.channelAvatar} alt="" referrerPolicy="no-referrer" />}
              {d.channel}
            </button>
          )}
          {d?.kind === 'video' && d.duration && <span>{d.duration}</span>}
          {d?.kind === 'bookmark' && (
            <button title={`Bookmarks from ${d.site} (ctrl+click: a tab of its own)`} onClick={(e) => openQuery({ types: ['bookmark'], site: d.site }, { newTab: e.ctrlKey || e.metaKey })}>
              {d.iconUrl && <img className={styles.avatar} src={d.iconUrl} alt="" />}
              {d.site}
            </button>
          )}
          {entry.type === 'ai' && (
            <span>
              {entry.nodes.length} {entry.nodes.length === 1 ? 'prompt' : 'prompts'}
            </span>
          )}
        </div>
        <div className={styles.entryMeta}>
          <CategoryPicker value={entry.category} onChange={(category) => day.updateEntry(entry.id, { category })} />
          <TagInput className={styles.entryTags} value={entry.tags} onChange={(tags) => day.updateEntry(entry.id, { tags })} />
        </div>
      </div>
      <div className={styles.rowActions}>
        <button title={entry.archived ? 'Unarchive' : 'Archive'} onClick={() => day.updateEntry(entry.id, { archived: !entry.archived })}>
          {entry.archived ? '↺' : '▣'}
        </button>
      </div>
    </article>
  )
})

/** A day's media items (the image board's), as a strip of thumbnails. */
export function MediaStrip({ entries }: { entries: EntryDTO[] }) {
  return (
    <div className={styles.mediaStrip}>
      {entries.map((e) => {
        const thumb = thumbOf(e)
        return (
          thumb && (
            <button key={e.id} className={styles.mediaThumb} data-reveal={e.id} title={`${typeLabel(e)} · open the image board`} onClick={() => openItem(e)}>
              <MediaThumb item={thumb} />
            </button>
          )
        )
      })}
    </div>
  )
}
