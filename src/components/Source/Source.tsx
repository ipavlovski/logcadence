import type { ReactNode } from 'react'
import { handlerById } from '../../../shared/handlers.ts'
import type { EntrySource } from '../../../shared/types.ts'
import styles from './Source.module.css'

// A captured entry's page (shared/handlers.ts): its title, as a link to the page, and a line of where it's from.

/** The title of a captured entry, linking to its page (in the browser). */
export function SourceTitle({ source, children, className }: { source: EntrySource; children: ReactNode; className?: string }) {
  return (
    <a className={`${styles.title} ${className ?? ''}`} href={source.url} target="_blank" rel="noreferrer" title={source.url} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  )
}

/** Favicon and host, then what the handler read from the page: "u/alice • 412 points • 3 days ago", a listing's price. */
export function SourceLine({ source, createdAt }: { source: EntrySource; createdAt: number }) {
  const handler = handlerById(source.handler)
  const shown = { fields: source.fields, publishedAt: source.publishedAt, createdAt }
  const byline = handler.byline(shown)
  const meta = handler.meta(shown)
  return (
    <div className={styles.line}>
      {source.iconUrl && <img className={styles.icon} src={source.iconUrl} alt="" />}
      <span className={styles.host}>{source.host}</span>
      {byline && <span>{byline}</span>}
      {meta && <span className={styles.meta}>{meta}</span>}
    </div>
  )
}
