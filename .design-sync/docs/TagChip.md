---
category: Tags
---
# TagChip

A clickable `#tag` pill in the tag color (`--tag`). Clicking opens the tag in the app's tags pane (Ctrl/Cmd+click: new tab). Hierarchical tags use `/` (`projects/logseq-rewrite`). `primary` = bold with a solid border (an entry's first tag); `inline` = tighter, for use inside running text (this is what `Markdown` renders for `#tags`).

```tsx
<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
  <TagChip tag="travel/lisbon" primary />
  <TagChip tag="food" />
</div>
```
