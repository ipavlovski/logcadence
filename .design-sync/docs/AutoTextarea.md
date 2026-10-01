---
category: Forms
---
# AutoTextarea

A `<textarea>` that grows with its content (starts at one row, resizes on every `value` change). Accepts every native textarea prop and forwards its ref. Use it controlled (`value` + `onChange`) — the height is recomputed when `value` changes.

It ships unstyled: it inherits font and color from the page, so give it a border/background from the tokens yourself.

```tsx
const [note, setNote] = React.useState('')
<AutoTextarea
  value={note}
  onChange={(e) => setNote(e.target.value)}
  placeholder="optional"
  style={{ width: '100%', resize: 'none', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 8px', outline: 'none' }}
/>
```
