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

The canvas **Map** tab turns a day of GPS into a timetable of stays and trips for the journal's active day. Drop GPSLogger files (`YYYYMMDD.zip` or `.gpx`) into `data/gps/` (git-ignored; `LOGSEQ_GPS_DIR` overrides): the server classifies new and changed files at startup and on **Scan**. Staying within 120 m for 5+ minutes is a place; the place slept at (around 03:00) is the homebase **A**, others are **B**; trips between them are **A→B**, **B→B**, **B→A**, or **A→A** for a round trip without a stop, and missing data shows as gaps. Rows tile the day, so the durations sum to 24 h. Places are shared across days and can be named by clicking them; a place can be made the day's homebase (a hotel while travelling). The map uses free OpenFreeMap tiles with deck.gl layers on MapLibre (kept on 5.x until deck.gl supports MapLibre 6).

The canvas **Spotify** tab tracks listening through the Spotify Web API. Setup: create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (Web API), add the Redirect URI `http://127.0.0.1:3002/api/spotify/callback`, paste its Client ID in the tab (or set `SPOTIFY_CLIENT_ID`) and connect; the login and tokens are kept in `data/spotify.json`. While the server runs it syncs every 3 minutes: every song played (Spotify counts a play after ~30s) with the playlist or album it came from, and liked songs by the day they were liked. Spotify only keeps the last 50 plays, so plays from long stretches with the server off are lost. The tab shows what is playing, heatmaps of songs played and liked per day, each day's plays grouped by playlist, and **Continue from yesterday**, which starts a playlist at the last track heard on the previous listening day (Premium only).

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
  canvas/        canvas plugin registry (AI chats, Threads, Shortcuts, Spotify and Map are built; Images is a placeholder)
  shortcuts.ts   every keyboard shortcut, used by the handler and the help overlay (press ?)
```

## Keyboard

Press `?` in the app for the full list. Browsers reserve `Ctrl+W`, `Ctrl+N`, `Ctrl+Shift+N` and `Ctrl+Shift+W`, so each also has an `Alt+` binding.
