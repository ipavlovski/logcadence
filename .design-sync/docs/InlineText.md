---
category: Markdown
---
# InlineText

One line of the note markdown subset (inline code, bold, italic, links, `#tags`, `[[refs]]`) rendered as an inline fragment — no wrapping element, no paragraphs or code blocks. Use it for titles and list rows that may contain tags or refs; use `Markdown` for multi-line content.

- `text`: the line.
- `highlight` (optional): wraps matches in `<mark>`.

```tsx
<h3 style={{ margin: 0, fontSize: 15 }}><InlineText text="Trip planning for #travel/lisbon" /></h3>
```
