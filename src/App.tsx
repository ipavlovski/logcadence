import { Fragment, useEffect } from 'react'
import { versionLabel } from '../shared/versions.ts'
import { Modal } from './components/Modal/Modal.tsx'
import { NewEntryDialog } from './components/NewEntryDialog/NewEntryDialog.tsx'
import { Pane } from './components/Pane/Pane.tsx'
import { Settings } from './components/Settings/Settings.tsx'
import { AppShortcuts } from './components/Shortcuts/Shortcuts.tsx'
import { Splitter } from './components/Splitter/Splitter.tsx'
import { Spotlight } from './components/Spotlight/Spotlight.tsx'
import { TagOpDialog } from './components/Tags/TagOpDialog.tsx'
import { Updates } from './components/Updates/Updates.tsx'
import { BINDINGS, EDITOR_KEYS, formatCombo, handleGlobalKey } from './shortcuts.ts'
import { panesStore, PANES } from './state/panes.ts'
import { useStore } from './state/store.ts'
import { openSettings, openSpotlight, prefsStore, toggleHelp, toggleImageMode, uiStore } from './state/ui.ts'
import { updatesStore } from './state/updates.ts'
import styles from './App.module.css'

export function App() {
  const open = useStore(panesStore, (s) => s.open)
  const weights = useStore(panesStore, (s) => s.weights)
  const theme = useStore(prefsStore, (s) => s.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // The desktop app's window buttons sit on the top bar, so they take its colors.
    const css = getComputedStyle(document.documentElement)
    void window.desktop?.setTitleBarColors({ color: css.getPropertyValue('--bg-2').trim(), symbolColor: css.getPropertyValue('--text-muted').trim() })
  }, [theme])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  return (
    <div className={styles.app}>
      {/* In the desktop app this is also the window's title bar: drag it to move the window, double-click to maximize. */}
      <header className={styles.topBar}>
        <SearchBox />
        <div className={styles.actions}>
          <ImageModeButton />
          <SettingsButton />
        </div>
      </header>
      <main className={styles.panes}>
        {PANES.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && <Splitter left={PANES[i - 1]!} right={id} />}
            {/* The minimized tags pane is just its tab bar; drag its splitter out or click a tab to restore it. */}
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
      <Settings />
      <AppShortcuts />
      <Updates />
      <UpdatePrompt />
    </div>
  )
}

/** Looks like a search field; opens the search spotlight, where the typing happens. */
function SearchBox() {
  return (
    <button className={styles.search} onClick={() => openSpotlight('search')} title="Search everything (Ctrl+Shift+F)">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className={styles.searchText}>Search entries and notes…</span>
      <kbd>{formatCombo('mod+shift+f')}</kbd>
    </button>
  )
}

/** Image mode (ctrl+i): the panes show only images, under their categories and days. */
function ImageModeButton() {
  const on = useStore(prefsStore, (s) => s.imageMode)
  return (
    <button
      className={`${styles.iconButton} ${on ? styles.toggleOn : ''}`}
      aria-pressed={on}
      aria-label="Image mode"
      onClick={() => toggleImageMode()}
      title={on ? 'Back to entries (Ctrl+I)' : 'Image mode: only the images (Ctrl+I)'}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m21 16-5-5-9 9" />
      </svg>
    </button>
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
      <p className={styles.helpNote}>Browsers reserve Ctrl+W / Ctrl+N / Ctrl+T / Ctrl+Tab / Ctrl+1…; use the Alt variants on the web where there are some. The desktop app gets the Ctrl ones.</p>
    </Modal>
  )
}

/** Opens Settings (theme, shortcuts, updates…); the dot means an update is downloading or ready. */
function SettingsButton() {
  const state = useStore(updatesStore, (s) => s.status?.state)
  const pending = state === 'available' || state === 'downloading' || state === 'ready'
  return (
    <button className={styles.iconButton} onClick={() => openSettings('general')} title={pending ? 'Settings (Ctrl+,): an update is downloading or ready' : 'Settings (Ctrl+,)'} aria-label="Settings">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      {pending && <i className={styles.badge} />}
    </button>
  )
}

/** Desktop app only: offers a restart once an update has downloaded (it also installs on quit). */

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
