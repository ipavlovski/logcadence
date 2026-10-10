import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { formatJournalDate, toIsoDate } from '../../../shared/dates.ts'
import { CHAT_SOURCES, type ChatAttachment, type ChatDTO, type ChatMessage, type ChatSource, type ChatSummary, type ImportReport } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { matches } from '../../markdown.ts'
import { aiStore, clearChatTurn, openChat, setChatSource, SOURCE_LABEL } from '../../state/ai.ts'
import { emitChange, useRevision } from '../../state/bus.ts'
import { useFollowJournal } from '../../state/canvasDay.ts'
import { useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import styles from './AiChats.module.css'

/** Canvas "AI" tab: every imported chat, and the full transcript of the open one. */
export function AiChats(_: CanvasPluginProps) {
  const chatId = useStore(aiStore, (s) => s.chatId)
  return chatId ? <ChatView key={chatId} id={chatId} /> : <ChatList />
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function SourceBadge({ source }: { source: ChatSource }) {
  return (
    <span className={styles.badge} data-source={source}>
      {SOURCE_LABEL[source]}
    </span>
  )
}

// ── import ─────────────────────────────────────────────────────────────────

const AUTO_SCAN_MS = 5 * 60 * 1000
let lastScan = 0

function describe(report: ImportReport): string {
  const parts = CHAT_SOURCES.flatMap((s) => {
    const c = report[s]
    if (!c) return []
    const changes = [c.created && `${c.created} new`, c.updated && `${c.updated} updated`].filter(Boolean).join(', ')
    return [`${SOURCE_LABEL[s]}: ${changes || 'up to date'}`]
  })
  return parts.join(' · ') || 'No chats found'
}

function useImport(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const run = (label: string, p: Promise<{ report: ImportReport }>) => {
    setBusy(label)
    p.then(
      (r) => {
        setReport(r.report)
        if (CHAT_SOURCES.some((s) => r.report[s]?.created || r.report[s]?.updated)) emitChange()
        onDone()
      },
      (err: Error) => notify(err.message),
    ).finally(() => setBusy(null))
  }

  const scan = () => {
    lastScan = Date.now()
    run('Scanning…', unwrap(api.ai.scan.$post()))
  }
  const upload = (files: File[]) => {
    for (const file of files) run(`Importing ${file.name}…`, unwrap(api.ai.import.$post({ form: { file } })))
  }
  return { busy, report, scan, upload }
}

// ── list ───────────────────────────────────────────────────────────────────

function ChatList() {
  const rev = useRevision()
  const source = useStore(aiStore, (s) => s.source)
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, report, scan, upload } = useImport(() => setTick((t) => t + 1))

  const { data, error } = useFetch(`${rev}|${tick}`, (signal) => unwrap(api.ai.chats.$get({}, { init: { signal } })))
  const { data: sources } = useFetch(`sources|${tick}`, (signal) => unwrap(api.ai.sources.$get({}, { init: { signal } })))
  // Live claude.ai sync: undefined outside the desktop app.
  const claudeLive = window.desktop ? sources?.sources.find((s) => s.source === 'claude')?.connected : undefined
  const connectClaude = async () => {
    if (await window.desktop?.connectClaude()) scan()
    else setTick((t) => t + 1)
  }
  const disconnectClaude = async () => {
    await window.desktop?.disconnectClaude()
    setTick((t) => t + 1)
  }

  // Keep the list current without a click: a rescan of unchanged sources is cheap.
  useEffect(() => {
    if (Date.now() - lastScan > AUTO_SCAN_MS) scan()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const all = data?.chats
  const counts = useMemo(() => {
    const m = new Map<ChatSource, number>()
    for (const c of all ?? []) m.set(c.source, (m.get(c.source) ?? 0) + 1)
    return m
  }, [all])

  const byDate = useMemo(() => {
    const m = new Map<string, ChatSummary[]>()
    for (const c of all ?? []) {
      if ((source && c.source !== source) || !matches(c.title, q.trim())) continue
      m.set(c.date, [...(m.get(c.date) ?? []), c])
    }
    return [...m].sort(([a], [b]) => b.localeCompare(a))
  }, [all, source, q])

  // Following the journal's day (ctrl+l): scroll to it, or to the nearest earlier day with chats.
  useFollowJournal(
    (d) => {
      const days = [...document.querySelectorAll<HTMLElement>('[data-ai-list] [data-day]')]
      ;(days.find((el) => el.dataset.day! <= d) ?? days.at(-1))?.scrollIntoView({ block: 'start' })
    },
    { ready: byDate.length > 0 },
  )

  const errors = CHAT_SOURCES.flatMap((s) => report?.[s]?.errors.map((e) => `${SOURCE_LABEL[s]}: ${e}`) ?? [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    upload([...e.dataTransfer.files])
  }

  return (
    <div
      className={`${styles.frame} ${dragOver ? styles.dragOver : ''}`}
      data-ai-list
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={onDrop}
    >
      <header className={styles.toolbar}>
        <h2>AI chats</h2>
        <div className={styles.actions}>
          {claudeLive === false && (
            <button onClick={() => void connectClaude()} disabled={!!busy} title="Sign in to claude.ai, so Scan imports your claude.ai and Claude Desktop chats">
              Connect claude.ai
            </button>
          )}
          <button onClick={scan} disabled={!!busy} title="Import chats from Claude Code, Antigravity, claude.ai and exports in Downloads">
            Scan
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} title="Claude export zip, Google Takeout zip, or a Claude Code .jsonl">
            Import file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.json,.jsonl"
            multiple
            hidden
            onChange={(e) => {
              upload([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <p className={styles.status} role="status">
        {busy ?? (report ? describe(report) : ' ')}
      </p>
      {errors.length > 0 && (
        <ul className={styles.errors}>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className={styles.filters}>
        <button className={source ? '' : styles.on} onClick={() => setChatSource(null)}>
          All <span>{all?.length ?? 0}</span>
        </button>
        {CHAT_SOURCES.map((s) => (
          <button key={s} className={source === s ? styles.on : ''} data-source={s} onClick={() => setChatSource(source === s ? null : s)}>
            {SOURCE_LABEL[s]} <span>{counts.get(s) ?? 0}</span>
          </button>
        ))}
        <input className={styles.search} value={q} placeholder="Filter titles…" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <p className={styles.error}>{error.message}</p>}
      {all && !byDate.length && <p className={styles.muted}>{all.length ? 'No chats match.' : 'No chats imported yet. Scan, or drop an export here.'}</p>}

      {byDate.map(([date, list]) => (
        <section key={date} className={styles.day} data-day={date}>
          <h3>{formatJournalDate(date)}</h3>
          {list.map((c) => (
            <div key={c.id} className={styles.row}>
              <button className={styles.rowMain} onClick={() => openChat(c.id)}>
                <SourceBadge source={c.source} />
                <span className={styles.rowTitle}>{c.title}</span>
                <span className={styles.rowMeta}>
                  {c.turns} prompt{c.turns === 1 ? '' : 's'}
                </span>
              </button>
            </div>
          ))}
        </section>
      ))}

      {sources && (
        <details className={styles.sources}>
          <summary>Where chats come from</summary>
          {sources.sources.map((s) => (
            <div key={s.source} className={styles.source}>
              <SourceBadge source={s.source} />
              <p>{s.hint}</p>
              {s.source === 'claude' && claudeLive !== undefined && (
                <p>
                  {claudeLive ? 'Connected to claude.ai. ' : 'Not connected to claude.ai. '}
                  <button className={styles.link} onClick={() => void (claudeLive ? disconnectClaude() : connectClaude())}>
                    {claudeLive ? 'Disconnect' : 'Connect'}
                  </button>
                </p>
              )}
              {s.paths.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// ── transcript ─────────────────────────────────────────────────────────────

function ChatView({ id }: { id: string }) {
  const rev = useRevision()
  const { data: chat, error } = useFetch<ChatDTO>(`${id}|${rev}`, (signal) => unwrap(api.ai.chats[':id'].$get({ param: { id } }, { init: { signal } })))
  const turn = useStore(aiStore, (s) => s.turn)
  const [flashTurn, setFlashTurn] = useState<number | null>(null)

  // A prompt opened from the journal: scroll to it and highlight it briefly.
  useEffect(() => {
    if (turn === null || !chat) return
    clearChatTurn()
    document.querySelector(`[data-turn="${turn}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setFlashTurn(turn)
  }, [turn, chat])

  useEffect(() => {
    if (flashTurn === null) return
    const t = setTimeout(() => setFlashTurn(null), 1800)
    return () => clearTimeout(t)
  }, [flashTurn])

  if (error)
    return (
      <div className={styles.frame}>
        <button className={styles.back} onClick={() => openChat(null)}>
          ← All chats
        </button>
        <p className={styles.error}>{error.message}</p>
      </div>
    )
  if (!chat) return <div className={styles.frame} />

  const meta = [chat.meta.cwd ?? chat.meta.workspace, chat.meta.branch, chat.meta.model, chat.meta.origin].filter(Boolean)
  // Prompt index of each user message, matching the journal's one node per prompt.
  let n = 0
  const turnOf = chat.messages.map((m) => (m.role === 'user' ? n++ : undefined))
  return (
    <div className={styles.frame}>
      <button className={styles.back} onClick={() => openChat(null)}>
        ← All chats
      </button>
      <header className={styles.chatHead}>
        <h2>{chat.title}</h2>
        <div className={styles.chatMeta}>
          <SourceBadge source={chat.source} />
          <span>{formatJournalDate(chat.date)}</span>
          <span>
            {time(chat.startedAt)} · {chat.turns} prompt{chat.turns === 1 ? '' : 's'}
          </span>
        </div>
        {meta.length > 0 && <div className={styles.chatMeta}>{meta.join(' · ')}</div>}
      </header>
      <div className={styles.messages}>
        {chat.messages.map((m, i) => (
          <Message key={i} m={m} date={chat.date} turn={turnOf[i]} flash={flashTurn !== null && turnOf[i] === flashTurn} />
        ))}
      </div>
    </div>
  )
}

/** When a prompt was sent: the time, with the day too once the chat has run past the day it started. */
function stamp(ts: number, chatDate: string) {
  const day = toIsoDate(new Date(ts))
  return day === chatDate ? time(ts) : `${formatJournalDate(day)} · ${time(ts)}`
}

function Attachment({ a }: { a: ChatAttachment }) {
  const label = (
    <>
      📎 {a.name}
      {a.meta && <span> · {a.meta}</span>}
    </>
  )
  if (!a.text) return <div className={styles.attachment}>{label}</div>
  return (
    <details className={styles.attachment}>
      <summary>{label}</summary>
      <ChatMarkdown source={a.text} />
    </details>
  )
}

function Message({ m, date, turn, flash }: { m: ChatMessage; date: string; turn?: number; flash: boolean }) {
  if (m.role === 'user')
    return (
      <div className={`${styles.user} ${flash ? styles.flash : ''}`} data-turn={turn}>
        {m.ts != null && (
          <time className={styles.stamp} dateTime={new Date(m.ts).toISOString()} title={new Date(m.ts).toLocaleString()}>
            {stamp(m.ts, date)}
          </time>
        )}
        {m.text && <ChatMarkdown source={m.text} />}
        {m.attachments?.map((a, i) => <Attachment key={i} a={a} />)}
      </div>
    )
  return (
    <div className={styles.assistant}>
      {m.text && <ChatMarkdown source={m.text} />}
      {m.tools && m.tools.length > 0 && (
        <details className={styles.tools}>
          <summary>
            {m.tools.length} tool call{m.tools.length === 1 ? '' : 's'}: {[...new Set(m.tools.map((t) => t.name))].slice(0, 4).join(', ')}
          </summary>
          <ul>
            {m.tools.map((t, i) => (
              <li key={i}>
                <code>{t.name}</code> {t.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
