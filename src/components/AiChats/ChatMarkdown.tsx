import { Fragment, memo } from 'react'
import { parseChatMarkdown } from '../../chatMarkdown.ts'
import { CodeBlock, InlineText } from '../Markdown/Markdown.tsx'
import mdStyles from '../Markdown/Markdown.module.css'
import styles from './AiChats.module.css'

const Lines = ({ lines }: { lines: string[] }) => (
  <>
    {lines.map((l, i) => (
      <Fragment key={i}>
        {i > 0 && <br />}
        <InlineText text={l} />
      </Fragment>
    ))}
  </>
)

/** An AI message: node markdown plus headings, lists, tables and quotes. */
export const ChatMarkdown = memo(function ChatMarkdown({ source }: { source: string }) {
  return (
    <div className={`${mdStyles.md} ${styles.chatMd}`}>
      {parseChatMarkdown(source).map((b, i) => {
        switch (b.t) {
          case 'code':
            return <CodeBlock key={i} code={b.code} lang={b.lang} highlight="" />
          case 'heading':
            return (
              <p key={i} className={styles.heading} data-level={b.level}>
                <InlineText text={b.text} />
              </p>
            )
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul'
            return (
              <List key={i}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ marginLeft: `${it.depth * 1.4}em` }}>
                    <Lines lines={it.text.split('\n')} />
                  </li>
                ))}
              </List>
            )
          }
          case 'quote':
            return (
              <blockquote key={i}>
                <Lines lines={b.lines} />
              </blockquote>
            )
          case 'table':
            return (
              <div key={i} className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>
                          <InlineText text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>
                            <InlineText text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'rule':
            return <hr key={i} />
          case 'para':
            return (
              <p key={i}>
                <Lines lines={b.lines} />
              </p>
            )
        }
      })}
    </div>
  )
})
