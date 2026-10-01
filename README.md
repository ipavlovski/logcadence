# logseq-rewrite

A journaling knowledge base with three panes: **canvas | journal | tags**. See [PROJECT.md](PROJECT.md) for the product spec.

Stack: TypeScript, React + CSS modules (Vite), Hono, SQLite via drizzle (better-sqlite3).

## Run

```sh
pnpm install
pnpm seed      # optional: sample entries (only if the database is empty)
pnpm dev       # API on :3002, web on http://localhost:5174
pnpm test      # server API + parser tests
pnpm build && pnpm start   # production: one server on :3002
```

Data lives in `data/` (override with `LOGSEQ_DATA_DIR`):

| path | contents |
| --- | --- |
| `db/content.db` | entries, nodes, tags, images |
| `db/events.db` | append-only log of every mutation (`{node_id, op, payload}`) |
| `journals/YYYY_MM_DD.md` | markdown mirror of each day (the DB is the source of truth) |
| `assets/` | pasted images |

After changing a schema: `pnpm db:generate` (writes migrations for both databases; they run on server start).

## Model

- **Entry**: belongs to a journal day, has a title and ordered tags. The first tag is primary and groups the entry in the journal.
- **Node**: an entry's children (markdown text + image gallery). Edits happen in memory and are pushed when editing ends.
- **Tag**: a colon-separated path (`system:windows:powertoys`). Ancestors are implicit. Tags no entry uses are pruned.
- **Archive**: entries and nodes can be archived. The tags pane hides archived items unless “archived” is on.

## AI chats

The canvas **AI** tab imports chats as journal entries: titled like the chat, tagged `ai:<source>`, dated the day the chat started, one node per prompt. These entries are read-only apart from their tags, and their `ai:<source>` tag stays locked as the primary tag; clicking a prompt shows it with its reply in the AI tab, and “transcript ↗” on the entry opens the whole chat. Opening the tab scans automatically; **Scan** forces it; export files can also be dropped on the tab.

The canvas **Shortcuts** tab draws an app's hotkeys on a keyboard. They come from entries whose primary tag is `shortcuts:<app>` (e.g. `#shortcuts:illustrator`), one per line: `- ctrl+shift+s -> save as`. A line ending in `:` starts a section; `b -> brush + blob brush` puts the second action on Shift; `- [ ] …` marks a planned binding and `-> ?` a key whose action is still undecided; `[]` binds both brackets. Toggle Shift/Ctrl/Alt/Win, or hold the real keys, to see that layer; combos bound to two different actions are flagged as clashes.

| source | where it comes from |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` in the WSL home and every Windows profile under `/mnt/c/Users`: the VS Code extension, the CLI and the desktop app's Code tab (titles from the app's session metadata) |
| Antigravity | `~/.gemini/antigravity` (titles from `conversation_summaries.db`, turns decoded from each conversation's protobuf steps) |
| Claude (claude.ai) | the data export (Settings → Privacy → Export data), picked up from Downloads (`data-*.zip`, `conversations*.zip`) |
| Gemini | Google Takeout → My Activity → Gemini Apps, **JSON** format (`takeout-*.zip` in Downloads). Takeout has no conversations or titles, so prompts are grouped by 30-minute gaps and titled after the first prompt |

Re-imports append new turns and refresh nodes and titles that still read as imported; anything edited by hand is left alone, and a deleted entry is not recreated. `LOGSEQ_AI_HOMES` (path-delimited) overrides the home directories that are scanned.

## Layout

```
shared/          domain types, tag paths, dates, ids (shared with future electron / react-native apps)
server/
  db/            schemas + migrations for content.db and events.db
  lib/           queries, tag operations, event log, markdown mirror
  lib/ai/        AI chat import: one parser per source, zip and protobuf readers
  routes/        Hono routes; `AppType` feeds the typed `hc` client
src/
  state/         panes/tabs store, change bus, journal cursor, UI state
  components/    Journal, Tags, Canvas (frame only), Pane, Spotlight, dialogs
  canvas/        canvas plugin registry (AI chats, Threads and Shortcuts are built; the rest are placeholders)
  shortcuts.ts   every keyboard shortcut, used by the handler and the help overlay (press ?)
```

## Keyboard

Press `?` in the app for the full list. Browsers reserve `Ctrl+W`, `Ctrl+N`, `Ctrl+Shift+N` and `Ctrl+Shift+W`, so each also has an `Alt+` binding.
