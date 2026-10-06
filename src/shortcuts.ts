import { newEntryAtCursor, newEntryWithDialog } from './actions.ts'
import { runCommand } from './state/commands.ts'
import { closeAllTabs, closeTab, cycleTab, goHistory, panesStore, type PaneId } from './state/panes.ts'
import { openFind, openSpotlight, toggleHelp } from './state/ui.ts'

// Single source for keyboard shortcuts: drives both the global handler and the help overlay.
// Browsers reserve ctrl+w / ctrl+n / ctrl+shift+n / ctrl+shift+w, so the web build also binds alt+ variants;
// the electron build gets the ctrl+ ones.

export interface Binding {
  keys: string[]
  label: string
  group: 'Search' | 'Navigation' | 'Journal' | 'Tags' | 'General'
  run: (pane: PaneId) => void
  /** Only when this pane has focus. */
  pane?: PaneId
  /** Also fires while typing in an input. */
  inInputs?: boolean
}

export const BINDINGS: Binding[] = [
  { keys: ['mod+f'], label: 'Search within pane', group: 'Search', run: (p) => openFind(p), inInputs: true },
  { keys: ['mod+shift+f'], label: 'Search everything', group: 'Search', run: () => openSpotlight('search'), inInputs: true },
  { keys: ['mod+k'], label: 'Tag spotlight', group: 'Search', run: () => openSpotlight('tags'), inInputs: true },
  { keys: ['mod+w', 'alt+w'], label: 'Close tab', group: 'Navigation', run: (p) => closeTab(p), inInputs: true },
  { keys: ['mod+shift+w', 'alt+shift+w'], label: 'Close all tabs', group: 'Navigation', run: (p) => closeAllTabs(p), inInputs: true },
  { keys: ['mod+['], label: 'Previous tab', group: 'Navigation', run: (p) => cycleTab(p, -1), inInputs: true },
  { keys: ['mod+]'], label: 'Next tab', group: 'Navigation', run: (p) => cycleTab(p, 1), inInputs: true },
  { keys: ['alt+arrowleft'], label: 'Back', group: 'Navigation', run: (p) => goHistory(p, -1) },
  { keys: ['alt+arrowright'], label: 'Forward', group: 'Navigation', run: (p) => goHistory(p, 1) },
  { keys: ['mod+n', 'alt+n'], label: 'New entry at cursor', group: 'Journal', run: () => newEntryAtCursor(), inInputs: true },
  { keys: ['mod+shift+n', 'alt+shift+n'], label: 'New entry…', group: 'Journal', run: () => newEntryWithDialog(), inInputs: true },
  { keys: ['mod+.'], label: 'Fold / unfold all entries', group: 'Journal', run: () => runCommand('journal.toggleFoldAll'), inInputs: true },
  { keys: ['delete'], label: 'Archive / unarchive selection', group: 'Tags', pane: 'tags', run: () => runCommand('tags.archive') },
  { keys: ['shift+delete'], label: 'Delete selection', group: 'Tags', pane: 'tags', run: () => runCommand('tags.delete') },
  { keys: ['mod+/'], label: 'Keyboard shortcuts', group: 'General', run: () => toggleHelp(), inInputs: true },
  { keys: ['shift+?'], label: 'Keyboard shortcuts', group: 'General', run: () => toggleHelp() },
]

/** Shortcuts handled by the editor itself, listed in the help overlay. */
export const EDITOR_KEYS: [string, string][] = [
  ['Enter', 'New node below (split at caret)'],
  ['Shift+Enter', 'Line break'],
  ['Backspace at start', 'Merge into node above'],
  ['↑ / ↓ at edge', 'Move between nodes and titles'],
  ['Esc', 'Stop editing'],
  ['Paste / drop image or video', 'Add to node gallery'],
  ['Ctrl+click', 'Open link / tag / date in a new tab'],
  ['Shift+click a title', 'Fold / unfold that entry'],
  ['Shift+click', 'Multi-select (tags pane)'],
]

const KEY_NAMES: Record<string, string> = { BracketLeft: '[', BracketRight: ']' }

/** Normalized combo, e.g. "mod+shift+f". */
export function comboOf(e: KeyboardEvent): string {
  const key = KEY_NAMES[e.code] ?? e.key.toLowerCase()
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey && key !== 'shift') parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

export function formatCombo(combo: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  return combo
    .split('+')
    .map(
      (k) =>
        ({ mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: 'Shift', arrowleft: '←', arrowright: '→', delete: 'Del', '?': '?' })[k] ??
        k.toUpperCase(),
    )
    .join('+')
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

export function handleGlobalKey(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const combo = comboOf(e)
  const pane = panesStore.get().focus
  for (const b of BINDINGS) {
    if (!b.keys.includes(combo)) continue
    if (b.pane && b.pane !== pane) continue
    if (!b.inInputs && isEditable(e.target)) continue
    e.preventDefault()
    b.run(pane)
    return
  }
}
