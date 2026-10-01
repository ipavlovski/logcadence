---
category: Markdown
---
# Markdown

Renders the app's note markdown subset: paragraphs (single newlines become line breaks), fenced code blocks with line numbers, `` `inline code` ``, `**bold**`, `*italic*`, `[links](url)`, bare URLs, `#tags` (rendered as inline `TagChip`s) and `[[refs]]` (a `[[YYYY-MM-DD]]` ref links to that journal day, anything else to a tag). No headings, lists or tables.

`highlight` wraps case-insensitive matches in `<mark>` (find-in-pane).

```tsx
<Markdown source={'Long run, **14 km**. Notes in [[2026-09-28]], gear under #health/running.'} />
```

For a single line inside other UI use `InlineText`; for a standalone code listing use `CodeBlock`.
