import { TAG_SEP } from '../shared/tags.ts'
import type { EntryDTO } from '../shared/types.ts'

// Shortcuts canvas tab. An entry whose primary tag is "shortcuts:<app>" lists that app's hotkeys,
// one per line, in any of its nodes:
//
//   TOOLS:                         a line ending in ':' (or a # heading) starts a section
//   - b -> brush + blob brush      " + " in the action: the second one is on Shift
//   - ctrl+shift+s -> save as
//   - [ ] ctrl+shift+b -> bold     an open checkbox: planned, not set up yet
//   - c -> ?                       '?': the key is taken, the action is still to be decided
//   - ctrl+[] -> toggle order      '[]' binds both brackets; '' is the quote key

export const SHORTCUTS_TAG = 'shortcuts'

export type Mod = 'ctrl' | 'shift' | 'alt' | 'meta'
/** Canonical modifier order, also used for layer ids ("ctrl+shift"). */
export const MODS: Mod[] = ['ctrl', 'shift', 'alt', 'meta']
export const MOD_LABEL: Record<Mod, string> = { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win' }

export interface Shortcut {
  mods: Mod[]
  /** Key id on the keyboard layout ("a", "f5", "[", "pageup"…). */
  key: string
  /** Empty when the action is still to be decided ('?'). */
  action: string
  section: string
  /** Listed with an open checkbox: planned, not set up yet. */
  planned: boolean
  entryId: string
  nodeId: string
}

export const layerOf = (mods: readonly Mod[]) => MODS.filter((m) => mods.includes(m)).join('+')
export const comboId = (s: Pick<Shortcut, 'mods' | 'key'>) => [layerOf(s.mods), s.key].filter(Boolean).join('+')

const MOD_ALIASES: Record<string, Mod> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  shift: 'shift',
  shif: 'shift',
  shft: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  win: 'meta',
  meta: 'meta',
  super: 'meta',
  cmd: 'meta',
}

const KEY_ALIASES: Record<string, string[]> = {
  "''": ["'"],
  '""': ["'"],
  '"': ["'"],
  '[]': ['[', ']'],
  '{}': ['[', ']'],
  escape: ['esc'],
  del: ['delete'],
  ins: ['insert'],
  bksp: ['backspace'],
  return: ['enter'],
  spacebar: ['space'],
  capslock: ['caps'],
  pgup: ['pageup'],
  'page up': ['pageup'],
  pgdn: ['pagedown'],
  'page down': ['pagedown'],
  '↑': ['up'],
  '↓': ['down'],
  '←': ['left'],
  '→': ['right'],
  arrowup: ['up'],
  arrowdown: ['down'],
  arrowleft: ['left'],
  arrowright: ['right'],
  '<': [','],
  '>': ['.'],
  '?': ['/'],
  '{': ['['],
  '}': [']'],
  ':': [';'],
  '~': ['`'],
}

/** "ctrl+shift+[]" → one combo per key it names; null when it is not a combo. */
export function parseCombo(text: string): { mods: Mod[]; keys: string[] } | null {
  const parts = text
    .trim()
    .toLowerCase()
    .split(/\s*\+\s*/)
  const mods = new Set<Mod>()
  let key: string | null = null
  for (const p of parts) {
    const mod = MOD_ALIASES[p]
    if (mod) mods.add(mod)
    else if (key !== null || !p) return null
    else key = p
  }
  if (key === null) return null
  const keys = KEY_ALIASES[key] ?? [key]
  if (!keys.every((k) => KEY_IDS.has(k))) return null
  return { mods: MODS.filter((m) => mods.has(m)), keys }
}

const LINE = /^\s*(?:[-*+]\s+)?(?:\[([ xX])\]\s+)?(.+?)\s*->\s*(.*?)\s*$/
const HEADING = /^\s*(?:#+\s*)?\**\s*(.+?)\s*\**\s*:?\s*$/

/** Hotkeys listed in one entry's nodes, in order. */
export function parseShortcuts(entry: EntryDTO): Shortcut[] {
  const out: Shortcut[] = []
  let section = entry.title || 'Shortcuts'
  for (const node of entry.nodes) {
    for (const line of node.content.split('\n')) {
      const m = LINE.exec(line)
      if (!m) {
        const t = line.trim()
        if (t && (t.endsWith(':') || t.startsWith('#'))) section = HEADING.exec(t)?.[1] ?? section
        continue
      }
      const combo = parseCombo(m[2]!)
      if (!combo) continue
      const planned = m[1] === ' '
      const clean = (a: string | undefined) => (a === undefined || a.trim() === '?' ? '' : a.trim())
      // "brush + blob brush": the second action is the Shift variant.
      const actions = m[3]!.split(/\s+\+\s+/)
      const variants: [Mod[], string][] =
        actions.length === 2 && !combo.mods.includes('shift')
          ? [
              [combo.mods, clean(actions[0])],
              [MODS.filter((x) => x === 'shift' || combo.mods.includes(x)), clean(actions[1])],
            ]
          : [[combo.mods, clean(m[3])]]
      for (const key of combo.keys)
        for (const [mods, action] of variants) out.push({ mods, key, action, section, planned, entryId: entry.id, nodeId: node.id })
    }
  }
  return out
}

/** App name → entries whose primary tag is shortcuts:<app>. */
export function shortcutApps(entries: EntryDTO[]): Map<string, EntryDTO[]> {
  const prefix = SHORTCUTS_TAG + TAG_SEP
  const apps = new Map<string, EntryDTO[]>()
  for (const e of entries) {
    const primary = e.tags[0]
    if (!primary?.startsWith(prefix) || primary.length === prefix.length) continue
    const app = primary.slice(prefix.length)
    apps.set(app, [...(apps.get(app) ?? []), e])
  }
  return apps
}

/** Combos bound to more than one distinct action. */
export function clashes(list: Shortcut[]): Set<string> {
  const actions = new Map<string, Set<string>>()
  for (const s of list) {
    if (!s.action) continue
    const id = comboId(s)
    actions.set(id, (actions.get(id) ?? new Set()).add(s.action.toLowerCase()))
  }
  return new Set([...actions].filter(([, a]) => a.size > 1).map(([id]) => id))
}

export function formatCombo(s: Pick<Shortcut, 'mods' | 'key'>): string {
  return [...s.mods.map((m) => MOD_LABEL[m]), KEY_BY_ID.get(s.key)?.label ?? s.key].join('+')
}

// ── keyboard layout (ANSI, with the navigation cluster), in key units ──────

export interface KeyCap {
  id: string
  label: string
  x: number
  y: number
  w: number
  h: number
  /** Modifier this key toggles. */
  mod?: Mod
}

export const KEYBOARD_W = 18.5
export const KEYBOARD_H = 6.5

function row(y: number, x: number, keys: (string | [string, number] | [string, number, string] | number)[]): KeyCap[] {
  const caps: KeyCap[] = []
  for (const k of keys) {
    if (typeof k === 'number') {
      x += k
      continue
    }
    const [id, w, label] = typeof k === 'string' ? [k, 1, undefined] : k
    const mod = MOD_ALIASES[id]
    caps.push({ id, label: label ?? (id.length === 1 ? id.toUpperCase() : id), x, y, w, h: 1, mod })
    x += w
  }
  return caps
}

const fkeys = (from: number) => [0, 1, 2, 3].map((i) => `f${from + i}`)

export const KEYBOARD: KeyCap[] = [
  ...row(0, 0, ['esc', 1, ...fkeys(1), 0.5, ...fkeys(5), 0.5, ...fkeys(9), 0.5, ['prtsc', 1, 'prt sc'], ['scrlk', 1, 'scr lk'], 'pause']),
  ...row(1.5, 0, ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', ['backspace', 2], 0.5, ['insert', 1, 'ins'], 'home', ['pageup', 1, 'pg up']]),
  ...row(2.5, 0, [['tab', 1.5], ...'qwertyuiop[]', ['\\', 1.5], 0.5, ['delete', 1, 'del'], 'end', ['pagedown', 1, 'pg dn']]),
  ...row(3.5, 0, [['caps', 1.75, 'caps lock'], ...'asdfghjkl;\'', ['enter', 2.25]]),
  ...row(4.5, 0, [['shift', 2.25], ...'zxcvbnm,./', ['shift', 2.75], 1.5, ['up', 1, '↑']]),
  ...row(5.5, 0, [
    ['ctrl', 1.25],
    ['meta', 1.25, 'win'],
    ['alt', 1.25],
    ['space', 6.25],
    ['alt', 1.25],
    ['meta', 1.25, 'win'],
    ['menu', 1.25],
    ['ctrl', 1.25],
    0.5,
    ['left', 1, '←'],
    ['down', 1, '↓'],
    ['right', 1, '→'],
  ]),
]

const KEY_IDS = new Set(KEYBOARD.map((k) => k.id))
const KEY_BY_ID = new Map(KEYBOARD.map((k) => [k.id, k]))
