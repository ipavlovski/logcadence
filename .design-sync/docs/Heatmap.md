---
category: Data
---
# Heatmap

GitHub-style calendar heatmap: one column per week, as many weeks as fit the container width (12–53), most recent on the right. Cells are colored on a 5-step ramp of one hue (`tone`), hovering shows a readout in the footer, clicking calls `onSelect(date)`.

- `counts` is a `Map` from ISO date (`YYYY-MM-DD`) to a number; missing days are 0.
- `end` is the last day shown (usually today), ISO date.
- `describe(n)` formats a count for the readout and tooltips, e.g. ``(n) => `${n} songs played` ``.
- `tone`: `'green'` or `'pink'`.
- `selected` highlights one day (ISO date).

Give it a width (it fills its container); it needs at least ~200px.

```tsx
const counts = new Map([['2026-09-28', 12], ['2026-09-29', 3], ['2026-09-30', 27]])
<Heatmap title="Listening" counts={counts} end="2026-10-01" tone="green" describe={(n) => `${n} songs played`} onSelect={(d) => setDay(d)} />
```
