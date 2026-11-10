import { useEffect, useState, type ReactNode } from 'react'
import { versionLabel } from '../../../shared/versions.ts'
import { HANDLERS } from '../../../shared/handlers.ts'
import { formatCombo, paneBindings } from '../../shortcuts.ts'
import { panesStore, setPaneOpen, type PaneId } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { openSettings, prefsStore, setPref, toggleHelp, uiStore, type SettingsSection } from '../../state/ui.ts'
import { openUpdates, updatesStore } from '../../state/updates.ts'
import { Modal } from '../Modal/Modal.tsx'
import styles from './Settings.module.css'

// The Settings window: a section list on the left (General and one per pane), the section's settings on the right.

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'journal', label: 'Journal' },
  { id: 'tags', label: 'Tags' },
]

export function Settings() {
  const section = useStore(uiStore, (s) => s.settings)
  return section ? <SettingsWindow section={section} /> : null
}

function SettingsWindow({ section }: { section: SettingsSection }) {
  const close = () => openSettings(null)
  return (
    <Modal large className={styles.window} title="Settings" onClose={close}>
      <header className={styles.header}>
        <h2>Settings</h2>
        <button onClick={close} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </header>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={s.id === section ? styles.selected : ''} onClick={() => openSettings(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <article className={styles.content}>
          <h1>{SECTIONS.find((s) => s.id === section)!.label}</h1>
          {section === 'general' ? <General /> : section === 'canvas' ? <Canvas /> : section === 'journal' ? <Journal /> : <Tags />}
        </article>
      </div>
    </Modal>
  )
}

function General() {
  const theme = useStore(prefsStore, (s) => s.theme)
  const openHidden = useStore(prefsStore, (s) => s.openHiddenPane)
  return (
    <>
      {window.desktop && <UpdatesGroup />}
      <Group title="Appearance">
        <Row label="Theme">
          <div className={styles.segmented} role="radiogroup" aria-label="Theme">
            {(['dark', 'light'] as const).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? styles.on : ''} onClick={() => setPref('theme', t)}>
                {t === 'dark' ? '☾ Dark' : '☀ Light'}
              </button>
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Panes">
        <Check
          checked={openHidden}
          onChange={(v) => setPref('openHiddenPane', v)}
          label="Open a hidden pane with its focus shortcut"
          hint={`${formatCombo('mod+2')} restores the tags pane when it is minimized. Off, it leaves the minimized pane alone.`}
        />
      </Group>
      <Group title="Keyboard">
        <Row label="Keyboard shortcuts" hint={formatCombo('mod+/')}>
          <button
            onClick={() => {
              openSettings(null)
              toggleHelp(true)
            }}
          >
            Show all
          </button>
        </Row>
      </Group>
      {window.desktop && <LibraryGroup />}
      <Group title="Data">
        <Row label="Export the library" hint="Entries, bookmarks, media. An export can be imported into an empty library, e.g. the desktop app.">
          <DataExport />
        </Row>
      </Group>
    </>
  )
}

/** Desktop app only: the open library, and switching to another one (the app restarts into it). */
function LibraryGroup() {
  const desktop = window.desktop!
  const library = useStore(updatesStore, (s) => s.app?.library)
  return (
    <Group title="Library">
      <Row label="Library folder" hint={library}>
        <button onClick={() => void desktop.showLibraryFolder()}>Show folder</button>
      </Row>
      <Row label="Switch library" hint="Opens an existing library, or makes a new one in an empty folder. The app restarts into it.">
        <button onClick={() => void desktop.openLibrary()}>Open or create…</button>
      </Row>
      <Row label="Import an export" hint="Into a new library in an empty folder. The app restarts into it.">
        <button onClick={() => void desktop.importLibrary()}>Import…</button>
      </Row>
    </Group>
  )
}

const PHASES = { tables: 'Exporting entries', assets: 'Exporting media' }

/** Browser: plain downloads. Desktop app: a save dialog, with progress (a full library is many GB). */
function DataExport() {
  const desktop = window.desktop
  const [status, setStatus] = useState('')
  useEffect(() => desktop?.onProgress((p) => setStatus(`${PHASES[p.phase]}… ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`)), [desktop])

  if (!desktop)
    return (
      <div className={styles.buttons}>
        <a href="/api/export" download>
          Everything
        </a>
        <a href="/api/export?assets=0" download>
          Without media
        </a>
      </div>
    )

  const run = async (opts: { assets: boolean }) => {
    setStatus('')
    const r = await desktop.exportData(opts)
    setStatus(r.ok ? 'Export written.' : (r.error ?? ''))
  }
  return (
    <div className={styles.buttons}>
      <button onClick={() => run({ assets: true })}>Everything…</button>
      <button onClick={() => run({ assets: false })}>Without media…</button>
      {status && <span className={styles.hint}>{status}</span>}
    </div>
  )
}

/** Desktop app only: the installed version and the Updates window; the dot means an update is downloading or ready. */
function UpdatesGroup() {
  const { app, status } = useStore(updatesStore, (s) => s)
  const pending = status?.state === 'available' || status?.state === 'downloading' || status?.state === 'ready'
  return (
    <Group title="Updates">
      <Row label={app ? `Installed ${versionLabel(app.version)}${app.channel === 'dev' ? ' · LogcadenceDev' : ''}` : 'Installed version'} hint={pending ? 'An update is downloading or ready.' : undefined}>
        <button
          onClick={() => {
            openSettings(null)
            openUpdates(true)
          }}
        >
          {pending && <i className={styles.dot} />}
          Updates and releases
        </button>
      </Row>
    </Group>
  )
}

function Canvas() {
  return (
    <>
      <p className={styles.note}>The canvas shows days: Today, the days pinned (double-click the preview day tab, or Ctrl+click a date), and the day opened last.</p>
      <Shortcuts pane="canvas" />
    </>
  )
}

function Journal() {
  return (
    <>
      <p className={styles.note}>Today is the canvas’s first tab, which is always there.</p>
      <Extension />
      <Shortcuts pane="journal" />
    </>
  )
}

function Tags() {
  const showArchived = useStore(prefsStore, (s) => s.showArchived)
  const includeSub = useStore(prefsStore, (s) => s.includeSubtags)
  return (
    <>
      <Group title="Pane">
        <PaneToggle pane="tags" label="Show the tags pane" />
      </Group>
      <Group title="Tag views">
        <Check checked={showArchived} onChange={(v) => setPref('showArchived', v)} label="Show archived entries and nodes" hint="Greyed out, in the tag tree and tag views." />
        <Check checked={includeSub} onChange={(v) => setPref('includeSubtags', v)} label="Include sub-tags" hint="A tag view also lists the entries of its sub-tags." />
      </Group>
      <Shortcuts pane="tags" />
    </>
  )
}

/** What the Chrome extension's captures become: an entry of today, by the handler of the page's site. */
function Extension() {
  return (
    <Group title="Browser extension">
      <p className={styles.note}>
        A page bookmarked with the Logcadence extension becomes an entry of today: its title links to the page, its first node holds the screenshot. Capturing
        it again adds the new screenshot to the same entry.
      </p>
      <ul className={styles.tabList}>
        {HANDLERS.map((h) => (
          <li key={h.id}>
            <label>
              <span>
                <b>{h.name}</b> <span className={styles.hint}>{h.domains.join(', ')}</span>
                <span className={styles.hint}>{h.about}</span>
                <span className={styles.hint}>{h.capture}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Group>
  )
}

function PaneToggle({ pane, label }: { pane: PaneId; label: string }) {
  const open = useStore(panesStore, (s) => s.open[pane])
  return <Check checked={open} onChange={(v) => setPaneOpen(pane, v)} label={label} hint="Hidden, it shrinks to its tab bar." />
}

function Shortcuts({ pane }: { pane: PaneId | 'journal' }) {
  return (
    <Group title="Keyboard shortcuts">
      {paneBindings(pane).map((b) => (
        <div key={b.label} className={styles.keyRow}>
          <span>{b.label}</span>
          <span>
            {b.keys.map((k) => (
              <kbd key={k}>{formatCombo(k)}</kbd>
            ))}
          </span>
        </div>
      ))}
    </Group>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div>
        <div>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={styles.row}>
      <div>
        <div>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
