---
category: Tags
---
# TagInput

Editable tag list: chips plus an input. Enter, Tab or `,` commits the typed text as a tag; Backspace on an empty input removes the last chip. The first chip is the primary tag — other chips get a ★ button (make primary) and × (remove). Autocomplete suggestions come from the app's tag API and are absent outside the app; typing still works.

- `value` / `onChange(tags)`: controlled `string[]`.
- `single`: one tag only (tag pickers).
- `locked`: a primary tag that can't be removed or demoted.
- `placeholder`, `autoFocus`, `onSubmit` (Enter on empty input), `onKeyDown`, `onFocus`, `className`.

It has no border of its own: wrap it in a bordered box.

```tsx
const [tags, setTags] = React.useState(['travel/lisbon', 'food'])
<div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', padding: '6px 8px' }}>
  <TagInput value={tags} onChange={setTags} placeholder="first tag is primary…" />
</div>
```
