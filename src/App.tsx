import { Fragment, useEffect } from 'react'
import { newEntryWithDialog } from './actions.ts'
import { Modal } from './components/Modal/Modal.tsx'
import { NewEntryDialog } from './components/NewEntryDialog/NewEntryDialog.tsx'
import { Pane } from './components/Pane/Pane.tsx'
import { Splitter } from './components/Splitter/Splitter.tsx'
import { Spotlight } from './components/Spotlight/Spotlight.tsx'
import { TagOpDialog } from './components/Tags/TagOpDialog.tsx'
import { BINDINGS, EDITOR_KEYS, formatCombo, handleGlobalKey } from './shortcuts.ts'
import { panesStore, PANES, togglePane } from './state/panes.ts'
import { useStore } from './state/store.ts'
import { openSpotlight, prefsStore, setPref, toggleHelp, uiStore } from './state/ui.ts'
import styles from './App.module.css'

export function App() {
  const open = useStore(panesStore, (s) => s.open)
  const weights = useStore(panesStore, (s) => s.weights)
  const theme = useStore(prefsStore, (s) => s.theme)
  const visible = PANES.filter((id) => open[id])

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
        <span className={styles.brand}>logseq·rewrite</span>
        <div className={styles.paneToggles}>
          {PANES.map((id) => (
            <button key={id} className={open[id] ? styles.on : ''} onClick={() => togglePane(id)} title={`Show/hide ${id} pane`}>
              {id}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
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
        </div>
      </header>
      <main className={styles.panes}>
        {visible.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && <Splitter left={visible[i - 1]!} right={id} />}
            <div className={styles.paneSlot} style={{ flexGrow: weights[id] }}>
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
    </div>
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

function Toast() {
  const toast = useStore(uiStore, (s) => s.toast)
  return toast ? (
    <div className={styles.toast} role="status">
      {toast.message}
    </div>
  ) : null
}
