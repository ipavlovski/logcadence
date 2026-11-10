import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { formatJournalDate, formatTabDate, today } from '../../../shared/dates.ts'
import { parseQuery, queryLabel } from '../../../shared/query.ts'
import {
  activateTab,
  closeTab,
  dayOfTab,
  isDayKey,
  openQuery,
  journalActiveOf,
  paneTabs,
  panesStore,
  parseKey,
  pinPreviewDay,
  pinPreviewQuery,
  PRIMARY,
  setFocus,
  setPaneOpen,
  tabQuery,
  type PaneId,
} from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { setFind, uiStore } from '../../state/ui.ts'
import { Calendar } from '../Calendar/Calendar.tsx'
import { JournalDay } from '../Journal/JournalDay.tsx'
import { useJournalHistory } from '../Journal/useJournalHistory.ts'
import { MetaBrowser } from '../Tags/MetaBrowser.tsx'
import { QueryView } from '../Tags/QueryView.tsx'
import styles from './Pane.module.css'

const PANE_LABEL: Record<PaneId, string> = { canvas: 'Canvas', tags: 'Tags' }

function tabLabel(key: string): string {
  const s = panesStore.get()
  const loc = parseKey(key)
  switch (loc.kind) {
    case 'journal':
      return `Today · ${formatTabDate(today())}`
    case 'day':
    case 'preview-day':
      return formatTabDate(dayOfTab(s, key))
    case 'preview':
    case 'query':
      return queryLabel(parseQuery(tabQuery(s, key)))
  }
}

/** What a tab shows: its label, or for the tags pane's browser (no query), a "#". */
function TabLabel({ tabKey }: { tabKey: string }) {
  const browser = parseKey(tabKey).kind === 'preview' && !panesStore.get().previewQuery
  return browser ? (
    <span className={styles.hash} aria-label="Browse">
      #
    </span>
  ) : (
    <span className={styles.tabLabel}>{tabLabel(tabKey)}</span>
  )
}

/** A tab's tooltip: what it shows, and for a preview, how it's kept. */
function tabTitle(key: string): string {
  const s = panesStore.get()
  const loc = parseKey(key)
  switch (loc.kind) {
    case 'journal':
      return `Today: ${formatJournalDate(today())} (Ctrl+H) · click again for the calendar`
    case 'day':
      return `${formatJournalDate(loc.date)} · click again for the calendar`
    case 'preview-day':
      return `${formatJournalDate(dayOfTab(s, key))} · the day opened last: double-click to keep its tab, click again for the calendar`
    case 'preview':
      return s.previewQuery ? `${tabLabel(key)} · what you clicked last: double-click to keep it in a tab (Ctrl+H)` : 'Every tag (Ctrl+H)'
    case 'query':
      return tabLabel(key)
  }
}

export function Pane({ id }: { id: PaneId }) {
  const pane = useStore(panesStore, (s) => s.panes[id])
  const focused = useStore(panesStore, (s) => s.focus === id)
  const find = useStore(uiStore, (s) => s.find[id])
  const open = useStore(panesStore, (s) => s.open[id])
  // The canvas pane's day tabs; the tags pane's preview.
  useStore(panesStore, (s) => s.pinnedDays)
  useStore(panesStore, (s) => s.previewDay)
  const previewQuery = useStore(panesStore, (s) => s.previewQuery)
  const primary = PRIMARY[id]
  const tabs = paneTabs(id)
  const previewKind = (key: string) => {
    const kind = parseKey(key).kind
    return (kind === 'preview-day') || (kind === 'preview' && !!previewQuery)
  }
  const pin = id === 'canvas' ? pinPreviewDay : pinPreviewQuery
  // The day tab whose calendar is open, and the tab it hangs under.
  const [calendar, setCalendar] = useState<{ key: string; anchor: HTMLElement } | null>(null)
  // A click on the active day tab opens its calendar; on another tab, shows it.
  const clickTab = (key: string) => (e: MouseEvent<HTMLElement>) => {
    if (isDayKey(key) && key === pane.active) {
      const anchor = e.currentTarget
      setCalendar((c) => (c?.key === key ? null : { key, anchor }))
    } else {
      setCalendar(null)
      activateTab(id, key)
    }
  }

  if (!open)
    return (
      <section className={`${styles.pane} ${styles.minimized}`} data-pane={id} aria-label={`${PANE_LABEL[id]} (minimized)`}>
        <div className={styles.vTabs} role="tablist" aria-orientation="vertical">
          {tabs.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={key === pane.active}
              className={`${styles.vTab} ${key === primary ? styles.vPinned : ''} ${key === pane.active ? styles.vActive : ''}`}
              aria-label={tabLabel(key)}
              title={`${tabLabel(key)} · click to restore the pane`}
              onClick={() => {
                activateTab(id, key)
                setPaneOpen(id, true)
                setFocus(id)
              }}
            >
              {key === primary && id === 'tags' && !previewQuery ? '#' : tabLabel(key)}
            </button>
          ))}
        </div>
      </section>
    )

  return (
    <section
      className={`${styles.pane} ${focused ? styles.focused : ''}`}
      data-pane={id}
      onPointerDownCapture={() => setFocus(id)}
      onFocusCapture={() => setFocus(id)}
      aria-label={PANE_LABEL[id]}
    >
      <div className={styles.tabBar} role="tablist">
        <div
          role="tab"
          aria-selected={primary === pane.active}
          className={`${styles.tab} ${styles.pinned} ${primary === pane.active ? styles.active : ''} ${previewKind(primary) ? styles.preview : ''}`}
          onClick={clickTab(primary)}
          onDoubleClick={id === 'tags' ? pinPreviewQuery : undefined}
          title={tabTitle(primary)}
        >
          <TabLabel tabKey={primary} />
          {id === 'tags' && previewQuery && (
            <button
              className={styles.close}
              aria-label="Back to all tags"
              title="Back to all tags"
              onClick={(e) => {
                e.stopPropagation()
                setCalendar(null)
                openQuery('')
              }}
            >
              ×
            </button>
          )}
        </div>
        <div className={styles.tabs}>
          {tabs
            .filter((key) => key !== primary)
            .map((key) => {
              const preview = previewKind(key)
              return (
                <div
                  key={key}
                  role="tab"
                  aria-selected={key === pane.active}
                  className={`${styles.tab} ${key === pane.active ? styles.active : ''} ${preview ? styles.preview : ''}`}
                  onClick={clickTab(key)}
                  onDoubleClick={preview ? pin : undefined}
                  onAuxClick={(e) => e.button === 1 && closeTab(id, key)}
                  title={tabTitle(key)}
                >
                  <TabLabel tabKey={key} />
                  <button
                    className={styles.close}
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(id, key)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            })}
        </div>
      </div>
      {calendar && calendar.key === pane.active && <Calendar date={dayOfTab(panesStore.get(), calendar.key)} anchor={calendar.anchor} onClose={() => setCalendar(null)} />}
      {find !== undefined && <FindBar pane={id} query={find} />}
      <div className={styles.body}>
        <PaneContent tabKey={pane.active} find={find ?? ''} />
      </div>
    </section>
  )
}

function PaneContent({ tabKey, find }: { tabKey: string; find: string }) {
  const query = useStore(panesStore, (s) => tabQuery(s, tabKey))
  const loc = parseKey(tabKey)
  switch (loc.kind) {
    case 'journal':
    case 'day':
    case 'preview-day':
      return <JournalTab tabKey={tabKey} find={find} />
    case 'preview':
    case 'query': {
      if (!query) return <MetaBrowser find={find} />
      return <QueryView key={tabKey} tabKey={tabKey} query={parseQuery(query)} find={find} />
    }
  }
}

/** A day tab (Today, a pinned day or the preview), with alt+left/right through the days opened. */
function JournalTab({ tabKey, find }: { tabKey: string; find: string }) {
  const date = useStore(panesStore, (s) => dayOfTab(s, tabKey))
  useJournalHistory()
  return <JournalDay key={date} date={date} find={find} />
}

function FindBar({ pane, query }: { pane: PaneId; query: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const focusNonce = useStore(uiStore, (s) => s.findFocus)
  useEffect(() => {
    if (panesStore.get().focus !== pane) return
    ref.current?.focus()
    ref.current?.select()
  }, [focusNonce, pane])

  return (
    <div className={styles.findBar}>
      <input
        ref={ref}
        value={query}
        placeholder={pane === 'tags' ? 'Filter…' : journalActiveOf(panesStore.get()) ? 'Filter this day…' : 'Find…'}
        spellCheck={false}
        onChange={(e) => setFind(pane, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setFind(pane, undefined)
          }
        }}
      />
      <button onClick={() => setFind(pane, undefined)} aria-label="Close find">
        ×
      </button>
    </div>
  )
}
