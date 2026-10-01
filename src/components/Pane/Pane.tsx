import { useEffect, useRef } from 'react'
import { formatJournalDate, today } from '../../../shared/dates.ts'
import { pluginByType } from '../../canvas/plugins.ts'
import { activateTab, closeTab, parseKey, PRIMARY, setFocus, setPaneOpen, panesStore, type PaneId } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { setFind, uiStore } from '../../state/ui.ts'
import { CanvasDashboard, CanvasPluginTab } from '../Canvas/Canvas.tsx'
import { JournalDay } from '../Journal/JournalDay.tsx'
import { TagTree } from '../Tags/TagTree.tsx'
import { TagView } from '../Tags/TagView.tsx'
import styles from './Pane.module.css'

const PANE_LABEL: Record<PaneId, string> = { canvas: 'Canvas', journal: 'Journal', tags: 'Tags' }

function tabLabel(key: string): string {
  const loc = parseKey(key)
  switch (loc.kind) {
    case 'dashboard':
      return 'Dashboard'
    case 'plugin':
      return pluginByType(loc.type)?.title ?? loc.type
    case 'today':
      return 'Today'
    case 'date':
      return formatJournalDate(loc.date)
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
  const primary = PRIMARY[id]

  if (!open)
    return (
      <section className={`${styles.pane} ${styles.minimized}`} data-pane={id} aria-label={`${PANE_LABEL[id]} (minimized)`}>
        <div className={styles.vTabs} role="tablist" aria-orientation="vertical">
          {pane.tabs.map((key) => (
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
          className={`${styles.pinned} ${primary === pane.active ? styles.pinnedActive : ''}`}
          onClick={() => activateTab(id, primary)}
          title={primary === 'today' ? `Today · ${formatJournalDate(today())}` : tabLabel(primary)}
        >
          {tabLabel(primary)}
        </div>
        <div className={styles.tabs}>
          {pane.tabs
            .filter((key) => key !== primary)
            .map((key) => (
              <div
                key={key}
                role="tab"
                aria-selected={key === pane.active}
                className={`${styles.tab} ${key === pane.active ? styles.active : ''}`}
                onClick={() => activateTab(id, key)}
                onAuxClick={(e) => e.button === 1 && closeTab(id, key)}
                title={tabLabel(key)}
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
            ))}
        </div>
      </div>
      {find !== undefined && <FindBar pane={id} query={find} />}
      <div className={styles.body}>
        <PaneContent pane={id} tabKey={pane.active} find={find ?? ''} />
      </div>
    </section>
  )
}

function PaneContent({ pane, tabKey, find }: { pane: PaneId; tabKey: string; find: string }) {
  const loc = parseKey(tabKey)
  switch (loc.kind) {
    case 'dashboard':
      return <CanvasDashboard />
    case 'plugin':
      return <CanvasPluginTab key={tabKey} type={loc.type} tabKey={tabKey} />
    case 'today': {
      const d = today()
      return <JournalDay key={d} date={d} find={find} />
    }
    case 'date':
      return <JournalDay key={loc.date} date={loc.date} find={find} />
    case 'tree':
      return <TagTree find={find} />
    case 'tag':
      return <TagView key={loc.tag} tag={loc.tag} find={find} />
  }
  return <p>Unknown tab in {pane}</p>
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
        placeholder={pane === 'journal' ? 'Filter this day…' : pane === 'tags' ? 'Filter…' : 'Find…'}
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
