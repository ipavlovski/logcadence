import { shiftDate } from '../shared/dates.ts'
import { newEntryAtCursor, newEntryWithDialog } from './actions.ts'
import { runCommand } from './state/commands.ts'
import { activeJournalDate, closeAllTabs, closeTab, cycleTab, focusPane, goHistory, openDate, openLoc, panesStore, PRIMARY, togglePane, type PaneId } from './state/panes.ts'
import { openFind, openSettings, openSpotlight, prefsStore, toggleAppKeys, toggleHelp, uiStore } from './state/ui.ts'
import { openYtJump } from './state/youtube.ts'

// Single source for keyboard shortcuts: drives both the global handler and the help overlay.
// Browsers reserve ctrl+w / ctrl+n / ctrl+t / ctrl+1… and friends, so the web build also binds alt+ variants;
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
  /** Listed under this pane in Settings (bindings scoped to a pane are listed there anyway). */
  about?: PaneId
}

/** Moves keyboard focus out of an editor in another pane, so typing doesn't carry on there. */
function leaveOtherPanes(pane: PaneId) {
  const el = document.activeElement
  if (panesStore.get().focus === pane && el instanceof HTMLElement && !el.closest(`[data-pane="${pane}"]`)) el.blur()
}

const focusOn = (pane: PaneId) => () => {
  focusPane(pane, prefsStore.get().openHiddenPane)
  leaveOtherPanes(pane)
}

const toggle = (pane: PaneId) => () => {
  togglePane(pane)
  leaveOtherPanes(pane)
}

export const BINDINGS: Binding[] = [
  { keys: ['mod+f'], label: 'Search within pane', group: 'Search', run: (p) => openFind(p), inInputs: true },
  { keys: ['mod+shift+f'], label: 'Search everything', group: 'Search', run: () => openSpotlight('search'), inInputs: true },
  { keys: ['mod+k'], label: 'Tag spotlight', group: 'Search', run: () => openSpotlight('tags'), inInputs: true },
  { keys: ['mod+w', 'alt+w'], label: 'Close tab', group: 'Navigation', run: (p) => closeTab(p), inInputs: true },
  { keys: ['mod+shift+w', 'alt+shift+w'], label: 'Close all tabs', group: 'Navigation', run: (p) => closeAllTabs(p), inInputs: true },
  { keys: ['mod+shift+tab'], label: 'Previous tab', group: 'Navigation', run: (p) => cycleTab(p, -1), inInputs: true },
  { keys: ['mod+tab'], label: 'Next tab', group: 'Navigation', run: (p) => cycleTab(p, 1), inInputs: true },
  { keys: ['mod+1', 'alt+1'], label: 'Focus canvas pane', group: 'Navigation', run: focusOn('canvas'), inInputs: true, about: 'canvas' },
  { keys: ['mod+2', 'alt+2'], label: 'Focus journal pane', group: 'Navigation', run: focusOn('journal'), inInputs: true, about: 'journal' },
  { keys: ['mod+3', 'alt+3'], label: 'Focus tags pane', group: 'Navigation', run: focusOn('tags'), inInputs: true, about: 'tags' },
  { keys: ['mod+b'], label: 'Show / hide canvas pane', group: 'Navigation', run: toggle('canvas'), inInputs: true, about: 'canvas' },
  { keys: ['mod+t', 'alt+t'], label: 'Show / hide tags pane', group: 'Navigation', run: toggle('tags'), inInputs: true, about: 'tags' },
  { keys: ['mod+h'], label: 'Home tab (dashboard / today / tag tree)', group: 'Navigation', run: (p) => openLoc(p, PRIMARY[p]), inInputs: true },
  // A canvas tab keeps its own history (the active plugin registers canvas.back/forward); other panes step through their tabs.
  { keys: ['alt+arrowleft'], label: 'Back', group: 'Navigation', run: (p) => (p === 'canvas' ? runCommand('canvas.back') : goHistory(p, -1)) },
  { keys: ['alt+arrowright'], label: 'Forward', group: 'Navigation', run: (p) => (p === 'canvas' ? runCommand('canvas.forward') : goHistory(p, 1)) },
  { keys: ['mod+j'], label: 'YouTube: jump to date', group: 'Navigation', pane: 'canvas', run: () => openYtJump(), inInputs: true },
  { keys: ['mod+n', 'alt+n'], label: 'New entry at cursor', group: 'Journal', run: () => newEntryAtCursor(), inInputs: true, about: 'journal' },
  { keys: ['mod+shift+n', 'alt+shift+n'], label: 'New entry…', group: 'Journal', run: () => newEntryWithDialog(), inInputs: true, about: 'journal' },
  { keys: ['mod+['], label: 'Previous day', group: 'Journal', pane: 'journal', run: () => openDate(shiftDate(activeJournalDate(), -1)), inInputs: true },
  { keys: ['mod+]'], label: 'Next day', group: 'Journal', pane: 'journal', run: () => openDate(shiftDate(activeJournalDate(), 1)), inInputs: true },
  { keys: ['mod+.'], label: 'Fold / unfold all entries', group: 'Journal', run: () => runCommand('journal.toggleFoldAll'), inInputs: true, about: 'journal' },
  { keys: ['delete'], label: 'Archive / unarchive selection', group: 'Tags', pane: 'tags', run: () => runCommand('tags.archive') },
  { keys: ['shift+delete'], label: 'Delete selection', group: 'Tags', pane: 'tags', run: () => runCommand('tags.delete') },
  { keys: ['mod+,'], label: 'Settings', group: 'General', run: () => openSettings(uiStore.get().settings ? null : 'general'), inInputs: true },
  { keys: ['mod+/'], label: 'Keyboard shortcuts', group: 'General', run: () => toggleHelp(), inInputs: true },
  { keys: ['shift+?'], label: 'Keyboard shortcuts', group: 'General', run: () => toggleHelp() },
  { keys: ['mod+shift+?'], label: 'App shortcuts (shortcuts:<app> entries)', group: 'General', run: () => toggleAppKeys(), inInputs: true },
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
        ({ mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: 'Shift', arrowleft: '←', arrowright: '→', delete: 'Del', tab: 'Tab', '?': '?' })[k] ??
        k.toUpperCase(),
    )
    .join('+')
}

/** Bindings shown in a pane's Settings section. */
export const paneBindings = (pane: PaneId) => BINDINGS.filter((b) => b.pane === pane || b.about === pane)

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
