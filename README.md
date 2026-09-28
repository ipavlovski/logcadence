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

## Layout

```
shared/          domain types, tag paths, dates, ids (shared with future electron / react-native apps)
server/
  db/            schemas + migrations for content.db and events.db
  lib/           queries, tag operations, event log, markdown mirror
  routes/        Hono routes; `AppType` feeds the typed `hc` client
src/
  state/         panes/tabs store, change bus, journal cursor, UI state
  components/    Journal, Tags, Canvas (frame only), Pane, Spotlight, dialogs
  canvas/        canvas plugin registry (no plugins implemented yet)
  shortcuts.ts   every keyboard shortcut, used by the handler and the help overlay (press ?)
```

## Keyboard

Press `?` in the app for the full list. Browsers reserve `Ctrl+W`, `Ctrl+N`, `Ctrl+Shift+N` and `Ctrl+Shift+W`, so each also has an `Alt+` binding.
