import { useEffect, useRef } from 'react'
import { formatJournalDate, formatTabDate, today } from '../../../shared/dates.ts'
import { parseQuery, queryLabel, typeView } from '../../../shared/query.ts'
import { LINK_ICON, pluginIcon, UNLINK_ICON } from '../../canvas/icons.tsx'
import { TYPE_VIEWS } from '../../canvas/plugins.ts'
import { toggleFollowJournal } from '../../state/canvasDay.ts'
import {
  activateTab,
  activeTypeView,
  closeTab,
  dayOfTab,
  journalActiveOf,
  openQuery,
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
import { prefsStore, setFind, uiStore } from '../../state/ui.ts'
import { JournalDay } from '../Journal/JournalDay.tsx'
import { useJournalHistory } from '../Journal/useJournalHistory.ts'
import { MetaBrowser } from '../Tags/MetaBrowser.tsx'
import { QueryView } from '../Tags/QueryView.tsx'
import { TypeView } from '../Tags/TypeView.tsx'
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

/** A tab's tooltip: what it shows, and for a preview, how it's kept. */
function tabTitle(key: string): string {
  const s = panesStore.get()
  const loc = parseKey(key)
  switch (loc.kind) {
    case 'journal':
      return `Today: ${formatJournalDate(today())} (Ctrl+H)`
    case 'day':
      return formatJournalDate(loc.date)
    case 'preview-day':
      return `${formatJournalDate(dayOfTab(s, key))} · the day opened last: double-click to keep its tab`
    case 'preview':
      return s.previewQuery ? `${tabLabel(key)} · what you clicked last: double-click to keep it in a tab (Ctrl+H)` : 'Every type, category and tag (Ctrl+H)'
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
              title={`${tabLabel(key)} · click to restore the pane`}
              onClick={() => {
                activateTab(id, key)
                setPaneOpen(id, true)
                setFocus(id)
              }}
            >
              {tabLabel(key)}
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
          className={`${styles.pinned} ${primary === pane.active ? styles.pinnedActive : ''} ${previewKind(primary) ? styles.preview : ''}`}
          onClick={() => activateTab(id, primary)}
          onDoubleClick={id === 'tags' ? pinPreviewQuery : undefined}
          title={tabTitle(primary)}
        >
          <span className={styles.tabLabel}>{tabLabel(primary)}</span>
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
                  onClick={() => activateTab(id, key)}
                  onDoubleClick={preview ? pin : undefined}
                  onAuxClick={(e) => e.button === 1 && closeTab(id, key)}
                  title={tabTitle(key)}
                >
                  <span className={styles.tabLabel}>{tabLabel(key)}</span>
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
        {id === 'tags' && <TypeViewButtons />}
        {id === 'tags' && <FollowButton />}
      </div>
      {find !== undefined && <FindBar pane={id} query={find} />}
      <div className={styles.body}>
        <PaneContent tabKey={pane.active} find={find ?? ''} />
      </div>
    </section>
  )
}

/** The tags pane's tab bar, right end: a type's view (YouTube, Bookmarks…) in the preview; ctrl+click, in a tab of its own. */
function TypeViewButtons() {
  const active = useStore(panesStore, (s) => activeTypeView(s))
  return (
    <>
      {TYPE_VIEWS.map((v) => (
        <button
          key={v.type}
          className={`${styles.iconTab} ${active === v.type ? styles.active : ''}`}
          aria-label={v.title}
          aria-pressed={active === v.type}
          title={`${v.title} (Ctrl+click: in a tab of its own)`}
          onClick={(e) => openQuery({ types: [v.type] }, { newTab: e.ctrlKey || e.metaKey })}
        >
          {pluginIcon(v.icon)}
        </button>
      ))}
    </>
  )
}

/** End of the tags pane's tab bar: whether the type views follow the journal's day (ctrl+l). */
function FollowButton() {
  const follows = useStore(prefsStore, (s) => s.canvasFollowsJournal)
  return (
    <button
      className={`${styles.follow} ${follows ? styles.following : ''}`}
      onClick={toggleFollowJournal}
      aria-pressed={follows}
      aria-label="Follow the journal’s day"
      title={follows ? 'The views follow the journal’s day (Ctrl+L to browse days separately)' : 'The views browse days separately from the journal (Ctrl+L to follow it)'}
    >
      {follows ? LINK_ICON : UNLINK_ICON}
    </button>
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
      const q = parseQuery(query)
      const type = typeView(q)
      // Keyed by the view, so a narrower query in the same view keeps its place (and its own filter syncs).
      return type ? <TypeView key={`${tabKey}|${type}`} type={type} tabKey={tabKey} query={q} /> : <QueryView key={`${tabKey}|${query}`} tabKey={tabKey} query={q} find={find} />
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
