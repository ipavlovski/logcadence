import { Fragment, memo, type ReactNode } from 'react'
import { isIsoDate } from '../../../shared/dates.ts'
import { parseBlocks, type Inline } from '../../markdown.ts'
import { openDate, openTag } from '../../state/panes.ts'
import { TagChip } from '../TagChip/TagChip.tsx'
import styles from './Markdown.module.css'

interface Props {
  source: string
  /** Find-in-pane query to highlight. */
  highlight?: string
}

export const Markdown = memo(function Markdown({ source, highlight = '' }: Props) {
  return (
    <div className={styles.md}>
      {parseBlocks(source).map((b, i) =>
        b.t === 'code' ? (
          <CodeBlock key={i} code={b.code} lang={b.lang} highlight={highlight} />
        ) : (
          <p key={i} className={styles.para}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {line.map((part, k) => (
                  <InlinePart key={k} part={part} highlight={highlight} />
                ))}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  )
})

function CodeBlock({ code, lang, highlight }: { code: string; lang: string; highlight: string }) {
  const lines = code.split('\n')
  return (
    <div className={styles.code} data-lang={lang || undefined}>
      <pre>
        {lines.map((l, i) => (
          <div key={i} className={styles.codeLine}>
            <span className={styles.lineNo}>{i + 1}</span>
            <span>{mark(l, highlight) || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

function InlinePart({ part, highlight }: { part: Inline; highlight: string }) {
  switch (part.t) {
    case 'text':
      return <>{mark(part.v, highlight)}</>
    case 'code':
      return <code className={styles.inlineCode}>{mark(part.v, highlight)}</code>
    case 'bold':
      return <strong>{mark(part.v, highlight)}</strong>
    case 'italic':
      return <em>{mark(part.v, highlight)}</em>
    case 'link':
      return (
        <a href={part.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {mark(part.v, highlight)}
        </a>
      )
    case 'tag':
      return <TagChip tag={part.v} inline />
    case 'ref':
      return (
        <button
          className={styles.ref}
          onClick={(e) => {
            e.stopPropagation()
            const open = isIsoDate(part.v) ? openDate : openTag
            open(part.v, { newTab: e.ctrlKey || e.metaKey })
          }}
        >
          <span className={styles.bracket}>[[</span>
          {part.v}
          <span className={styles.bracket}>]]</span>
        </button>
      )
  }
}

/** Wraps case-insensitive occurrences of `q` in <mark>. */
export function mark(text: string, q: string): ReactNode {
  if (!q) return text
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const out: ReactNode[] = []
  let from = 0
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, from)) {
    if (i > from) out.push(text.slice(from, i))
    out.push(<mark key={i}>{text.slice(i, i + q.length)}</mark>)
    from = i + q.length
  }
  if (!out.length) return text
  out.push(text.slice(from))
  return out
}
