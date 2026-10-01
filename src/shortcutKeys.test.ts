import { describe, expect, it } from 'vitest'
import type { EntryDTO } from '../shared/types.ts'
import { clashes, comboId, formatCombo, parseCombo, parseShortcuts, shortcutApps } from './shortcutKeys.ts'

const entry = (id: string, tags: string[], nodes: string[]): EntryDTO => ({
  id,
  date: '2026-09-30',
  title: `title ${id}`,
  position: 1,
  archived: false,
  tags,
  nodes: nodes.map((content, i) => ({ id: `${id}-n${i}`, entryId: id, content, position: i, archived: false, activeImageId: null, images: [], createdAt: 0, updatedAt: 0 })),
  chat: null,
  createdAt: 0,
  updatedAt: 0,
})

const summary = (e: EntryDTO) => parseShortcuts(e).map((s) => [comboId(s), s.action, s.section, s.planned])

describe('shortcuts', () => {
  it('parses combos, tolerating aliases and typos', () => {
    expect(parseCombo('ctrl+shif+j')).toEqual({ mods: ['ctrl', 'shift'], keys: ['j'] })
    expect(parseCombo('Shift + Ctrl + S')).toEqual({ mods: ['ctrl', 'shift'], keys: ['s'] })
    expect(parseCombo("ctrl+''")).toEqual({ mods: ['ctrl'], keys: ["'"] })
    expect(parseCombo('ctrl+[]')).toEqual({ mods: ['ctrl'], keys: ['[', ']'] })
    expect(parseCombo('alt+pgup')).toEqual({ mods: ['alt'], keys: ['pageup'] })
    expect(parseCombo('deselect')).toBeNull()
    expect(parseCombo('ctrl+shift')).toBeNull()
    expect(parseCombo('a+b')).toBeNull()
  })

  it('reads sections, shift variants, open checkboxes and unknown actions', () => {
    const e = entry('e', ['shortcuts:illustrator'], [
      'TOOLS:\n- b -> brush + blob brush\n- c -> ?\n- f -> artboard + ?',
      'TEMP REMOVED:\n- [ ] deselect\n\nMissing CHARs:\n- [ ] ctrl+shif+j -> justify text left (text)',
      '## Top row\n- ctrl+[] -> toggle order\n- ctrl+shift+s -> save as + nothing',
    ])
    expect(summary(e)).toEqual([
      ['b', 'brush', 'TOOLS', false],
      ['shift+b', 'blob brush', 'TOOLS', false],
      ['c', '', 'TOOLS', false],
      ['f', 'artboard', 'TOOLS', false],
      ['shift+f', '', 'TOOLS', false],
      ['ctrl+shift+j', 'justify text left (text)', 'Missing CHARs', true],
      ['ctrl+[', 'toggle order', 'Top row', false],
      ['ctrl+]', 'toggle order', 'Top row', false],
      // Already on Shift: " + " stays part of the action.
      ['ctrl+shift+s', 'save as + nothing', 'Top row', false],
    ])
    expect(formatCombo(parseShortcuts(e)[5]!)).toBe('Ctrl+Shift+J')
  })

  it('groups entries by the app in their primary tag', () => {
    const apps = shortcutApps([
      entry('a', ['shortcuts:illustrator'], []),
      entry('b', ['shortcuts:davinci-resolve:edit'], []),
      entry('c', ['dev', 'shortcuts:revit'], []),
      entry('d', ['shortcuts'], []),
      entry('e', ['shortcuts:illustrator', 'design'], []),
    ])
    expect([...apps].map(([app, es]) => [app, es.map((e) => e.id)])).toEqual([
      ['illustrator', ['a', 'e']],
      ['davinci-resolve:edit', ['b']],
    ])
  })

  it('flags combos bound to different actions, ignoring unknown ones', () => {
    const list = parseShortcuts(entry('e', ['shortcuts:x'], ['- ctrl+shift+f -> paste in back\n- [ ] ctrl+shift+f -> justify all lines\n- ctrl+e -> ?\n- ctrl+e -> effect\n- ctrl+s -> save\n- ctrl+s -> Save']))
    expect([...clashes(list)]).toEqual(['ctrl+shift+f'])
  })
})
