import { memo } from 'react'
import type { EntryDTO } from '../../../shared/types.ts'
import { openItem } from '../../actions.ts'
import { thumbOf, typeLabel } from '../../entryView.ts'
import { bookmarksNav } from '../../state/captures.ts'
import { openLoc, pluginKey } from '../../state/panes.ts'
import { setYtFilter, YOUTUBE_PLUGIN } from '../../state/youtube.ts'
import { CategoryPicker } from '../CategoryPicker/CategoryPicker.tsx'
import { MediaThumb } from '../ImageGallery/ImageGallery.tsx'
import { mark } from '../Markdown/Markdown.tsx'
import { TagInput } from '../TagInput/TagInput.tsx'
import { useDayApi } from './dayContext.ts'
import styles from './Journal.module.css'

/** A video, bookmark or AI chat in its day: what it is and where it's from; its category and tags edit here, the rest in its tab. */
export const ItemCard = memo(function ItemCard({ entry, find, flash }: { entry: EntryDTO; find: string; flash: boolean }) {
  const day = useDayApi()
  const d = entry.detail
  const thumb = thumbOf(entry)
  const open = () => openItem(entry)
  return (
    <article className={`${styles.item} ${entry.archived ? styles.archived : ''} ${flash ? styles.flash : ''}`} data-reveal={entry.id}>
      {thumb && (
        <button className={styles.itemThumb} onClick={open} title={`Open in its tab`} tabIndex={-1}>
          <MediaThumb item={thumb} />
        </button>
      )}
      <div className={styles.itemMain}>
        <div className={styles.itemHead}>
          <span className={styles.itemType}>{typeLabel(entry)}</span>
          <button className={styles.itemTitle} onClick={open} title="Open in its tab">
            {entry.title ? mark(entry.title, find) : 'untitled'}
          </button>
        </div>
        <div className={styles.itemSource}>
          {d?.kind === 'video' && (
            <button
              title={`${d.channel}'s videos`}
              onClick={() => {
                setYtFilter({ kind: 'channel', name: d.channel })
                openLoc('canvas', pluginKey(YOUTUBE_PLUGIN))
              }}
            >
              {d.channelAvatar && <img className={styles.avatar} src={d.channelAvatar} alt="" referrerPolicy="no-referrer" />}
              {d.channel}
            </button>
          )}
          {d?.kind === 'video' && d.duration && <span>{d.duration}</span>}
          {d?.kind === 'bookmark' && (
            <button title={`Bookmarks from ${d.site}`} onClick={() => (bookmarksNav.setFilter({ kind: 'site', site: d.site }), openLoc('canvas', pluginKey(bookmarksNav.plugin)))}>
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
