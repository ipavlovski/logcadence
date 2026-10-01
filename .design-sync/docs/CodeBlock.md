---
category: Markdown
---
# CodeBlock

A code listing with line numbers, the same block `Markdown` renders for fenced code. All three props are required: `code` (newline-separated), `lang` (stored as a `data-lang` attribute, not displayed; pass `''` for none) and `highlight` (find query to mark; pass `''` for none). No syntax coloring.

```tsx
<CodeBlock code={'pnpm i\npnpm dev'} lang="sh" highlight="" />
```
