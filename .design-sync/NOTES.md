# design-sync notes — logseq-rewrite

## How this repo syncs
- This is an app, not a DS package: there is no library build or `.d.ts` tree. `.design-sync/entry.ts` is the bundle entry (pass `--entry ./.design-sync/entry.ts`, `--node-modules ./node_modules`). It re-exports the synced components and imports `src/styles/global.css` + `.design-sync/fonts.css`, so all CSS rides through esbuild into `_ds_bundle.css` (no `cssEntry`).
- Scope (user's choice, 2026-10-01): presentational components only. Pane, Splitter, Journal, Tags, Canvas, Map, Spotify, Spotlight, Threads, AiChats, Shortcuts, NewEntryDialog are left out: they're bound to the app's stores/API. Adding one = export it from entry.ts, add to `componentSrcMap`, `dtsPropsFor`, `docs/`, `previews/`.
- Props contracts are hand-written in `cfg.dtsPropsFor` (no .d.ts to extract from). **When a component's `Props` interface changes in src/, update its `dtsPropsFor` entry and its `docs/<Name>.md`.**
- Groups come from `docs/<Name>.md` frontmatter `category`, but only when the dir-derived group is `general`; components sharing a dir with another (InlineText/CodeBlock in Markdown/, ModalActions in Modal/) get the dir name — that's why the categories are `Markdown` and `Modal`.
- Font: JetBrains Mono isn't in the repo (the app relies on a local install). User chose loading it from Google Fonts via `.design-sync/fonts.css` → validate prints `[FONT_REMOTE]` (expected).
- Playwright: the machine's cached browser is chromium-1067 → `playwright@1.35.1` installed into `.ds-sync/` (`npm i playwright@1.35.1` there after re-staging).

## Preview gotchas
- The default theme is dark (light `--text`) and the card harness is white: every preview wraps stories in a local `Frame` painted with `var(--bg)`/`var(--text)`. Keep doing this for new previews.
- `Modal` is `position: fixed`; its preview frame uses `transform: translateZ(0)` as containing block, and `overrides.Modal = {cardMode: single, primaryStory: Form}` (validate's GRID_OVERFLOW remedy).
- TagInput's ★/× chip buttons only show on hover/focus → the `Editing` story uses `autoFocus`. Autocomplete calls `/api/tags`, which fails outside the app (handled; no suggestions shown).
- ImageGallery previews use inline SVG data-URIs (no network); Heatmap previews use a seeded LCG (deterministic → grades carry forward).

## Known render warns
- (none outstanding)

## Re-sync risks
- `dtsPropsFor` and `docs/*.md` duplicate the source props by hand — they rot silently when a component's props change. Diff each component's `interface Props` against its entry on every re-sync.
- `entry.ts` pins file paths under `src/components/`; a rename/move breaks the build (esbuild resolve error).
- Google Fonts is a network dependency for every design render.
- TagChip/Markdown refs call the app's pane store on click (`openTag`/`openDate`) — harmless in designs (writes localStorage) but not meaningful there.
