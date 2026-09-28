import { openTag } from '../../state/panes.ts'
import styles from './TagChip.module.css'

interface Props {
  tag: string
  primary?: boolean
  /** Inside running text (smaller, no border emphasis). */
  inline?: boolean
}

/** Clickable tag: opens it in the tags pane (ctrl+click: new tab). */
export function TagChip({ tag, primary, inline }: Props) {
  return (
    <button
      className={`${styles.chip} ${primary ? styles.primary : ''} ${inline ? styles.inline : ''}`}
      title={primary ? `${tag} (primary tag)` : tag}
      onClick={(e) => {
        e.stopPropagation()
        openTag(tag, { newTab: e.ctrlKey || e.metaKey })
      }}
    >
      #{tag}
    </button>
  )
}
