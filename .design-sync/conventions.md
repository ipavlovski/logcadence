# Logseq Rewrite UI — conventions

A dark-first, monospace, dense note-taking UI (journal, tags, canvas). Components come from `window.LogseqUI` (`AutoTextarea`, `CodeBlock`, `Heatmap`, `ImageGallery`, `InlineText`, `Markdown`, `Modal`, `ModalActions`, `TagChip`, `TagInput`). They are React components styled by CSS modules — there are **no utility classes and no style props**; you style your own layout with inline styles or your own CSS using the `var(--*)` tokens below.

## Setup

- No provider or wrapper is needed. `styles.css` loads the font (JetBrains Mono, from Google Fonts), the tokens and the base element styles.
- The theme is **dark by default**. For the light theme, set `data-theme="light"` on `<html>` (`document.documentElement.dataset.theme = 'light'`); every token switches.
- The base styles set `html, body { height: 100%; margin: 0 }` and `body { overflow: hidden; background: var(--bg); color: var(--text); font: 14px/1.55 var(--font) }`. The page itself never scrolls. Build full-viewport layouts and give scrolling regions `overflow: auto` (the app is a top bar plus side-by-side panes, each scrolling on its own).
- Never paint text on a white background: `--text` is light in the dark theme. Surfaces come from tokens.

## Tokens (`var(--name)`)

| Role | Tokens |
|---|---|
| Backgrounds | `--bg` (page), `--bg-2` (recessed: sidebars, bars), `--surface` (cards, dialogs), `--surface-2` (raised controls, buttons), `--code-bg` |
| Text | `--text`, `--text-muted` (secondary, labels), `--text-faint` (hints, placeholders) |
| Lines | `--border` |
| Accent | `--accent` (links, focus, primary actions), `--accent-text` (text on accent) |
| Semantic | `--tag` (tags), `--date` (dates/day refs), `--danger`, `--mark` (search hit), `--flash`, `--selection` |
| Shape | `--radius` (6px; dialogs use 10px), `--shadow` (overlays), `--font` |
| Layout | `--topbar-h` (40px), `--tabbar-h` (36px) |

Type scale used throughout: 14px body, 12.5–13px for chips/code/meta, 11px uppercase `letter-spacing: .06em` `--text-muted` for field labels, 15px for dialog titles. Spacing is tight: 4/6/8px inside controls, 12–20px between blocks.

## Idioms

- **Inputs and boxes** (the app's form field): `border: 1px solid var(--border); background: var(--bg); border-radius: var(--radius); padding: 6px 8px; outline: none`, with `border-color: var(--accent)` on focus. `TagInput` and `AutoTextarea` have no border of their own — wrap or style them this way.
- **Buttons**: plain `<button>`s inherit the font and nothing else. Inside `ModalActions` they get styled, and `data-primary` / `data-danger` mark the main or destructive action. Elsewhere, style them yourself: `border: 1px solid var(--border); background: var(--surface-2); border-radius: var(--radius); padding: 5px 14px`.
- **Tags** are always rendered with `TagChip` (`#path/sub`), never as hand-made pills. Note text containing `#tags`, `[[refs]]`, `**bold**` or code goes through `Markdown` (multi-line) or `InlineText` (one line).
- `Modal` is `position: fixed` over a scrim. Render it conditionally, and put `ModalActions` last inside it.

## Where the truth lives

`styles.css` → `_ds_bundle.css` holds the tokens (top) and every component's compiled CSS. Read it before styling. Each component's `<Name>.prompt.md` documents its props with an example; `<Name>.d.ts` is the exact contract.

## Example

```tsx
const { Modal, ModalActions, TagInput } = window.LogseqUI
function NewEntry({ onClose }) {
  const [tags, setTags] = React.useState(['travel/lisbon'])
  return (
    <Modal title="New entry" onClose={onClose}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)' }}>Tags</span>
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: '6px 8px' }}>
          <TagInput value={tags} onChange={setTags} placeholder="first tag is primary…" />
        </div>
      </label>
      <ModalActions>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" data-primary>Create</button>
      </ModalActions>
    </Modal>
  )
}
```
