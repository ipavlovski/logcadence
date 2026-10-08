import type { ReactNode } from 'react'
import { versionLabel } from '../../../shared/versions.ts'
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
          hint={`${formatCombo('mod+1')} and ${formatCombo('mod+3')} restore the canvas or tags pane when it is minimized. Off, they leave a minimized pane alone.`}
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
    </>
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
      <Group title="Pane">
        <PaneToggle pane="canvas" label="Show the canvas pane" />
      </Group>
      <Shortcuts pane="canvas" />
    </>
  )
}

function Journal() {
  return (
    <>
      <p className={styles.note}>The journal pane is always shown.</p>
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

function PaneToggle({ pane, label }: { pane: PaneId; label: string }) {
  const open = useStore(panesStore, (s) => s.open[pane])
  return <Check checked={open} onChange={(v) => setPaneOpen(pane, v)} label={label} hint="Hidden, it shrinks to its tab bar." />
}

function Shortcuts({ pane }: { pane: PaneId }) {
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
