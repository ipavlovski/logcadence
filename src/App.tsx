import { Fragment, useEffect, type MouseEvent } from 'react'
import { shiftDate } from '../shared/dates.ts'
import { versionLabel } from '../shared/versions.ts'
import { newEntryWithDialog } from './actions.ts'
import { Modal } from './components/Modal/Modal.tsx'
import { NewEntryDialog } from './components/NewEntryDialog/NewEntryDialog.tsx'
import { Pane } from './components/Pane/Pane.tsx'
import { Splitter } from './components/Splitter/Splitter.tsx'
import { Spotlight } from './components/Spotlight/Spotlight.tsx'
import { TagOpDialog } from './components/Tags/TagOpDialog.tsx'
import { Updates } from './components/Updates/Updates.tsx'
import { BINDINGS, EDITOR_KEYS, formatCombo, handleGlobalKey } from './shortcuts.ts'
import { runCommand } from './state/commands.ts'
import { dayFoldStore } from './state/fold.ts'
import { journalDateOf, openDate, panesStore, PANES } from './state/panes.ts'
import { useStore } from './state/store.ts'
import { openSpotlight, prefsStore, setPref, toggleHelp, uiStore } from './state/ui.ts'
import { openUpdates, updatesStore } from './state/updates.ts'
import styles from './App.module.css'

export function App() {
  const open = useStore(panesStore, (s) => s.open)
  const weights = useStore(panesStore, (s) => s.weights)
  const theme = useStore(prefsStore, (s) => s.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  return (
    <div className={styles.app}>
      <header className={styles.topBar}>
        <span className={styles.brand}>logcadence</span>
        <div className={styles.actions}>
          <DayNav />
          <FoldButton />
          <button onClick={() => openSpotlight('search')} title="Search everything (Ctrl+Shift+F)">
            search
          </button>
          <button onClick={() => openSpotlight('tags')} title="Tag spotlight (Ctrl+K)">
            #tags
          </button>
          <button onClick={newEntryWithDialog} title="New entry (Ctrl+Shift+N / Alt+Shift+N)">
            + entry
          </button>
          <button onClick={() => setPref('theme', theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button onClick={() => toggleHelp(true)} title="Keyboard shortcuts (Ctrl+/)">
            ?
          </button>
          {window.desktop && <UpdatesButton />}
        </div>
      </header>
      <main className={styles.panes}>
        {PANES.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && <Splitter left={PANES[i - 1]!} right={id} />}
            {/* A minimized side pane is just its tab bar; drag its splitter out or click a tab to restore it. */}
            <div className={open[id] ? styles.paneSlot : styles.paneBar} data-slot={id} style={open[id] ? { flexGrow: weights[id] } : undefined}>
              <Pane id={id} />
            </div>
          </Fragment>
        ))}
      </main>
      <Spotlight />
      <NewEntryDialog />
      <TagOpDialog />
      <Help />
      <Toast />
      <Updates />
      <UpdatePrompt />
    </div>
  )
}

/** Folds or unfolds all entries of the open journal day; the chevron points right when they're all folded. */
function FoldButton() {
  const allFolded = useStore(dayFoldStore, (s) => s.allFolded)
  return (
    <button
      className={styles.foldButton}
      disabled={allFolded === null}
      onClick={() => runCommand('journal.toggleFoldAll')}
      title={allFolded ? 'Unfold all entries (Ctrl+.)' : 'Fold all entries (Ctrl+.); Shift+click a title folds one'}
    >
      <i className={allFolded ? styles.chevron : `${styles.chevron} ${styles.chevronOpen}`} />
      fold
    </button>
  )
}

/** Journal day picker: steps the journal pane's active day (ctrl+click opens a new tab). */
function DayNav() {
  const date = useStore(panesStore, journalDateOf)
  const nav = (e: MouseEvent, d: string) => openDate(d, { newTab: e.ctrlKey || e.metaKey })
  return (
    <nav className={styles.dayNav}>
      <button title="Previous day (Ctrl+click: new tab)" onClick={(e) => nav(e, shiftDate(date, -1))}>
        ‹
      </button>
      <input type="date" value={date} onChange={(e) => e.target.value && openDate(e.target.value)} aria-label="Journal date" />
      <button title="Next day (Ctrl+click: new tab)" onClick={(e) => nav(e, shiftDate(date, 1))}>
        ›
      </button>
    </nav>
  )
}

function Help() {
  const open = useStore(uiStore, (s) => s.help)
  if (!open) return null
  const groups = [...new Set(BINDINGS.map((b) => b.group))]
  return (
    <Modal title="Keyboard shortcuts" onClose={() => toggleHelp(false)}>
      {groups.map((g) => (
        <section key={g} className={styles.helpGroup}>
          <h3>{g}</h3>
          {[...new Set(BINDINGS.filter((b) => b.group === g).map((b) => b.label))].map((label) => (
            <div key={label} className={styles.helpRow}>
              <span>{label}</span>
              <span>
                {BINDINGS.filter((b) => b.label === label).flatMap((b) => b.keys).map((k) => (
                  <kbd key={k}>{formatCombo(k)}</kbd>
                ))}
              </span>
            </div>
          ))}
        </section>
      ))}
      <section className={styles.helpGroup}>
        <h3>Editing</h3>
        {EDITOR_KEYS.map(([k, label]) => (
          <div key={k} className={styles.helpRow}>
            <span>{label}</span>
            <kbd>{k}</kbd>
          </div>
        ))}
      </section>
      <p className={styles.helpNote}>Browsers reserve Ctrl+W / Ctrl+N; use the Alt variants on the web. The desktop app gets the Ctrl ones.</p>
    </Modal>
  )
}

/** Desktop app only: offers a restart once an update has downloaded (it also installs on quit). */
/** Opens the Updates window; the dot means an update is downloading or ready. */
function UpdatesButton() {
  const state = useStore(updatesStore, (s) => s.status?.state)
  const pending = state === 'available' || state === 'downloading' || state === 'ready'
  return (
    <button className={styles.iconButton} onClick={() => openUpdates(true)} title={pending ? 'Updates: an update is downloading or ready' : 'Updates and releases'} aria-label="Updates">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 2.5v7M5 6.75 8 9.75l3-3M3 12.5h10" />
      </svg>
      {pending && <i className={styles.badge} />}
    </button>
  )
}

function UpdatePrompt() {
  const status = useStore(updatesStore, (s) => s.status)
  if (status?.state !== 'ready') return null
  return (
    <div className={styles.update} role="status">
      Version {versionLabel(status.version)} is ready.
      <button onClick={() => window.desktop!.installUpdate()}>Restart to update</button>
    </div>
  )
}

function Toast() {
  const toast = useStore(uiStore, (s) => s.toast)
  return toast ? (
    <div className={styles.toast} role="status">
      {toast.message}
    </div>
  ) : null
}
