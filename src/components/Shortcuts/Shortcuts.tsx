import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import type { EntryDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { matches } from '../../markdown.ts'
import {
  clashes,
  comboId,
  formatCombo,
  KEYBOARD,
  KEYBOARD_H,
  KEYBOARD_W,
  layerOf,
  MOD_LABEL,
  MODS,
  parseShortcuts,
  SHORTCUTS_TAG,
  shortcutApps,
  type Mod,
  type Shortcut,
} from '../../shortcutKeys.ts'
import { useRevision } from '../../state/bus.ts'
import { requestReveal } from '../../state/journal.ts'
import { openDate } from '../../state/panes.ts'
import { setShortcutApp, setShortcutMods, shortcutsStore, toggleShortcutMod } from '../../state/shortcuts.ts'
import { useStore } from '../../state/store.ts'
import styles from './Shortcuts.module.css'

const PALETTE = ['#6d9df0', '#5fb878', '#d9a25f', '#a48be0', '#e08a74', '#7fb4ad', '#d77fb0', '#e0c36b']

/** Modifier keys held down right now (anywhere in the app). */
function useHeldMods(): Mod[] {
  const [held, setHeld] = useState<Mod[]>([])
  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      const next = MODS.filter((m) => e[`${m}Key`])
      setHeld((h) => (h.join() === next.join() ? h : next))
    }
    const clear = () => setHeld([])
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return held
}

function reveal(e: MouseEvent, entry: EntryDTO, nodeId?: string) {
  e.stopPropagation()
  openDate(entry.date, { newTab: e.ctrlKey || e.metaKey })
  requestReveal({ date: entry.date, entryId: entry.id, nodeId, mode: 'flash' })
}

/** Canvas "Shortcuts" tab: an app's hotkeys from its shortcuts:<app> entries, on a keyboard. */
export function Shortcuts(_: CanvasPluginProps) {
  const rev = useRevision()
  const { data, error } = useFetch(`shortcuts|${rev}`, (signal) =>
    unwrap(api.tags.entries.$get({ query: { tag: SHORTCUTS_TAG, archived: '0', sub: '1' } }, { init: { signal } })),
  )
  const stored = useStore(shortcutsStore, (s) => s.app)
  const toggled = useStore(shortcutsStore, (s) => s.mods)
  const held = useHeldMods()
  const mods = held.length ? held : toggled
  const layer = layerOf(mods)

  const apps = useMemo(() => shortcutApps(data?.entries ?? []), [data])
  const names = useMemo(() => [...apps.keys()].sort(), [apps])
  const app = stored && apps.has(stored) ? stored : names[0]
  const entries = useMemo(() => (app ? apps.get(app)! : []), [apps, app])
  const all = useMemo(() => entries.flatMap(parseShortcuts), [entries])
  const clash = useMemo(() => clashes(all), [all])
  const sections = useMemo(() => [...new Set(all.map((s) => s.section))], [all])
  const color = (section: string) => PALETTE[sections.indexOf(section) % PALETTE.length]!
  const onLayer = useMemo(() => {
    const m = new Map<string, Shortcut[]>()
    for (const s of all) if (layerOf(s.mods) === layer) m.set(s.key, [...(m.get(s.key) ?? []), s])
    return m
  }, [all, layer])

  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const pick = (s: Shortcut) => {
    setShortcutMods(s.mods)
    setSelected(s.key)
  }

  if (error) return <p className={styles.error}>{error.message}</p>
  if (!data) return <div className={styles.frame} />

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Shortcuts</h2>
        <div className={styles.apps}>
          {names.map((n) => (
            <button key={n} className={n === app ? styles.on : ''} onClick={() => setShortcutApp(n)}>
              {n}
            </button>
          ))}
        </div>
        {entries.map((e) => (
          <button key={e.id} className={styles.link} title="Edit in the journal (Ctrl+click: new tab)" onClick={(ev) => reveal(ev, e)}>
            {e.title || 'untitled'} ↗
          </button>
        ))}
      </header>

      {!app ? (
        <Empty />
      ) : (
        <>
          <div className={styles.modBar}>
            {(['shift', 'ctrl', 'alt', 'meta'] as Mod[]).map((m) => (
              <button key={m} className={mods.includes(m) ? styles.on : ''} onClick={() => toggleShortcutMod(m)}>
                {MOD_LABEL[m]}
              </button>
            ))}
            <span className={styles.hint}>
              {onLayer.size} keys {layer ? `on ${mods.map((m) => MOD_LABEL[m]).join('+')}` : 'without modifiers'}
              {' · '}hold a modifier key to preview its layer
            </span>
            {clash.size > 0 && <span className={styles.clashNote}>{clash.size} clash{clash.size === 1 ? '' : 'es'}</span>}
          </div>

          <div className={styles.keyboardWrap}>
            <div className={styles.keyboard} style={{ '--kw': KEYBOARD_W, '--kh': KEYBOARD_H } as CSSProperties}>
              {KEYBOARD.map((k, i) => {
                const list = onLayer.get(k.id) ?? []
                const first = list[0]
                const isClash = list.some((s) => clash.has(comboId(s)))
                const cls = [
                  styles.key,
                  first && styles.mapped,
                  first && !list.some((s) => s.action) && styles.unknown,
                  first && list.every((s) => s.planned) && styles.planned,
                  isClash && styles.clash,
                  k.mod && mods.includes(k.mod) && styles.held,
                  (selected === k.id || hovered === k.id) && styles.selected,
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <button
                    key={`${k.id}-${i}`}
                    className={cls}
                    style={{ '--x': k.x, '--y': k.y, '--w': k.w, '--h': k.h, '--c': first ? color(first.section) : undefined } as CSSProperties}
                    title={list.length ? list.map((s) => `${formatCombo(s)}: ${s.action || '?'}${s.planned ? ' (planned)' : ''}`).join('\n') : k.label}
                    onClick={() => (k.mod ? toggleShortcutMod(k.mod) : setSelected(selected === k.id ? null : k.id))}
                  >
                    <span className={styles.cap}>{k.label}</span>
                    {first && <span className={styles.action}>{first.action || '?'}</span>}
                    {list.length > 1 && <span className={styles.count}>{list.length}</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={styles.panels}>
            <ActiveKey keyId={selected} all={all} layer={layer} clash={clash} entries={entries} onPick={pick} />
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h3>Commands</h3>
                <input className={styles.search} value={q} placeholder="Search…" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className={styles.commands}>
                {sections.map((sec) => {
                  const rows = all.filter((s) => s.section === sec && (matches(s.action, q.trim()) || matches(formatCombo(s), q.trim())))
                  if (!rows.length) return null
                  return (
                    <div key={sec} className={styles.section} style={{ '--c': color(sec) } as CSSProperties}>
                      <h4>{sec}</h4>
                      {rows.map((s, i) => (
                        <button
                          key={i}
                          className={`${styles.command} ${layerOf(s.mods) === layer ? styles.current : ''} ${s.planned ? styles.plannedRow : ''}`}
                          onClick={() => pick(s)}
                          onMouseEnter={() => layerOf(s.mods) === layer && setHovered(s.key)}
                          onMouseLeave={() => setHovered(null)}
                        >
                          <span className={s.action ? '' : styles.muted}>{s.action || '?'}</span>
                          <kbd className={clash.has(comboId(s)) ? styles.clashKbd : ''}>{formatCombo(s)}</kbd>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function ActiveKey({
  keyId,
  all,
  layer,
  clash,
  entries,
  onPick,
}: {
  keyId: string | null
  all: Shortcut[]
  layer: string
  clash: Set<string>
  entries: EntryDTO[]
  onPick: (s: Shortcut) => void
}) {
  // Plain key first, then by number of modifiers.
  const rows = keyId ? all.filter((s) => s.key === keyId).sort((a, b) => a.mods.length - b.mods.length || layerOf(a.mods).localeCompare(layerOf(b.mods))) : []
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Active key</h3>
        {keyId && <kbd>{formatCombo({ mods: [], key: keyId })}</kbd>}
      </div>
      {!keyId ? (
        <p className={styles.muted}>Click a key to see everything bound to it.</p>
      ) : !rows.length ? (
        <p className={styles.muted}>Free on every layer.</p>
      ) : (
        <div className={styles.commands}>
          {rows.map((s, i) => {
            const entry = entries.find((e) => e.id === s.entryId)!
            return (
              <div key={i} className={`${styles.command} ${layerOf(s.mods) === layer ? styles.current : ''} ${s.planned ? styles.plannedRow : ''}`}>
                <kbd className={clash.has(comboId(s)) ? styles.clashKbd : ''} onClick={() => onPick(s)}>
                  {formatCombo(s)}
                </kbd>
                <span className={s.action ? '' : styles.muted} onClick={() => onPick(s)}>
                  {s.action || '?'}
                  {s.planned && <em> · planned</em>}
                </span>
                <button className={styles.link} title={`${s.section} · show in the journal`} onClick={(e) => reveal(e, entry, s.nodeId)}>
                  ↗
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Empty() {
  return (
    <div className={styles.empty}>
      <p>
        No shortcut lists yet. Give an entry the primary tag <code>#shortcuts:&lt;app&gt;</code> (e.g. <code>#shortcuts:illustrator</code>) and list one
        hotkey per line:
      </p>
      <pre>{`TOOLS:
- b -> brush + blob brush      (second action on Shift)
- ctrl+shift+s -> save as
- [ ] ctrl+shift+b -> bold     (planned)
- c -> ?                       (taken, action to decide)`}</pre>
    </div>
  )
}
