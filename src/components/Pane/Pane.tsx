import { useEffect, useRef } from 'react'
import { formatJournalDate, formatTabDate, today } from '../../../shared/dates.ts'
import { LINK_ICON, pluginIcon, UNLINK_ICON } from '../../canvas/icons.tsx'
import { pluginByType } from '../../canvas/plugins.ts'
import { toggleFollowJournal } from '../../state/canvasDay.ts'
import { canvasTabsStore } from '../../state/canvasTabs.ts'
import {
  activateTab,
  closeTab,
  dayOfTab,
  journalActiveOf,
  paneTabs,
  panesStore,
  parseKey,
  pinPreviewDay,
  PRIMARY,
  setFocus,
  setPaneOpen,
  type PaneId,
} from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { prefsStore, setFind, uiStore } from '../../state/ui.ts'
import { CanvasPluginTab } from '../Canvas/Canvas.tsx'
import { JournalDay } from '../Journal/JournalDay.tsx'
import { useJournalHistory } from '../Journal/useJournalHistory.ts'
import { TagTree } from '../Tags/TagTree.tsx'
import { TagView } from '../Tags/TagView.tsx'
import styles from './Pane.module.css'

const PANE_LABEL: Record<PaneId, string> = { canvas: 'Canvas', tags: 'Tags' }

function tabLabel(key: string): string {
  const loc = parseKey(key)
  switch (loc.kind) {
    case 'journal':
      return `Today · ${formatTabDate(today())}`
    case 'day':
    case 'preview-day':
      return formatTabDate(dayOfTab(panesStore.get(), key))
    case 'plugin':
      return pluginByType(loc.type)?.title ?? loc.type
    case 'tree':
      return 'Tagtree'
    case 'tag':
      return `#${loc.tag}`
  }
}

export function Pane({ id }: { id: PaneId }) {
  const pane = useStore(panesStore, (s) => s.panes[id])
  const focused = useStore(panesStore, (s) => s.focus === id)
  const find = useStore(uiStore, (s) => s.find[id])
  const open = useStore(panesStore, (s) => s.open[id])
  // The canvas pane's day tabs, and its plugin tabs (Settings → Canvas).
  useStore(panesStore, (s) => s.pinnedDays)
  useStore(panesStore, (s) => s.previewDay)
  useStore(canvasTabsStore, (s) => s)
  const primary = PRIMARY[id]
  const tabs = paneTabs(id)

  if (!open)
    return (
      <section className={`${styles.pane} ${styles.minimized}`} data-pane={id} aria-label={`${PANE_LABEL[id]} (minimized)`}>
        <div className={styles.vTabs} role="tablist" aria-orientation="vertical">
          {tabs.map((key) => {
            const icon = parseKey(key).kind === 'plugin'
            return (
              <button
                key={key}
                role="tab"
                aria-selected={key === pane.active}
                aria-label={icon ? tabLabel(key) : undefined}
                className={`${styles.vTab} ${key === primary ? styles.vPinned : ''} ${key === pane.active ? styles.vActive : ''} ${icon ? styles.vIcon : ''}`}
                title={`${tabLabel(key)} · click to restore the pane`}
                onClick={() => {
                  activateTab(id, key)
                  setPaneOpen(id, true)
                  setFocus(id)
                }}
              >
                {icon ? pluginIcon((parseKey(key) as { type: string }).type) : tabLabel(key)}
              </button>
            )
          })}
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
          className={`${styles.pinned} ${primary === pane.active ? styles.pinnedActive : ''}`}
          onClick={() => activateTab(id, primary)}
          title={primary === 'journal' ? `Today: ${formatJournalDate(today())} (Ctrl+H)` : `${tabLabel(primary)} (Ctrl+H)`}
        >
          {tabLabel(primary)}
        </div>
        <div className={styles.tabs}>
          {tabs
            .filter((key) => key !== primary)
            .map((key) => {
              const loc = parseKey(key)
              if (loc.kind === 'plugin')
                return (
                  <div
                    key={key}
                    role="tab"
                    aria-selected={key === pane.active}
                    aria-label={tabLabel(key)}
                    className={`${styles.iconTab} ${key === pane.active ? styles.active : ''}`}
                    onClick={() => activateTab(id, key)}
                    onAuxClick={(e) => e.button === 1 && closeTab(id, key)}
                    title={tabLabel(key)}
                  >
                    {pluginIcon(loc.type)}
                  </div>
                )
              const preview = loc.kind === 'preview-day'
              return (
              <div
                key={key}
                role="tab"
                aria-selected={key === pane.active}
                className={`${styles.tab} ${key === pane.active ? styles.active : ''} ${preview ? styles.preview : ''}`}
                onClick={() => activateTab(id, key)}
                onDoubleClick={preview ? pinPreviewDay : undefined}
                onAuxClick={(e) => e.button === 1 && closeTab(id, key)}
                title={preview ? `${formatJournalDate(dayOfTab(panesStore.get(), key))} · the day opened last: double-click to keep its tab` : loc.kind === 'day' ? formatJournalDate(loc.date) : tabLabel(key)}
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
        {id === 'canvas' && <FollowButton />}
      </div>
      {find !== undefined && <FindBar pane={id} query={find} />}
      <div className={styles.body}>
        <PaneContent pane={id} tabKey={pane.active} find={find ?? ''} />
      </div>
    </section>
  )
}

/** End of the canvas tab bar: whether the canvas tabs follow the journal's day (ctrl+l). */
function FollowButton() {
  const follows = useStore(prefsStore, (s) => s.canvasFollowsJournal)
  return (
    <button
      className={`${styles.follow} ${follows ? styles.following : ''}`}
      onClick={toggleFollowJournal}
      aria-pressed={follows}
      aria-label="Follow the journal’s day"
      title={follows ? 'Following the journal’s day (Ctrl+L to browse days separately)' : 'Browsing days separately from the journal (Ctrl+L to follow it)'}
    >
      {follows ? LINK_ICON : UNLINK_ICON}
    </button>
  )
}

function PaneContent({ pane, tabKey, find }: { pane: PaneId; tabKey: string; find: string }) {
  const loc = parseKey(tabKey)
  switch (loc.kind) {
    case 'journal':
    case 'day':
    case 'preview-day':
      return <JournalTab tabKey={tabKey} find={find} />
    case 'plugin':
      return <CanvasPluginTab key={tabKey} type={loc.type} tabKey={tabKey} />
    case 'tree':
      return <TagTree find={find} />
    case 'tag':
      return <TagView key={loc.tag} tag={loc.tag} find={find} />
  }
  return <p>Unknown tab in {pane}</p>
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
