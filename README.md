# logcadence

Logcadence (a cadence of daily logs) is a journaling knowledge base with three panes: **canvas | journal | tags**. See [PROJECT.md](PROJECT.md) for the product spec.

Stack: TypeScript, React + CSS modules (Vite), Hono, SQLite via drizzle (better-sqlite3).

## Run

```sh
pnpm install
pnpm seed      # optional: sample entries (only if the database is empty)
pnpm dev       # API on :3002, web on http://localhost:5174
pnpm test      # server API + parser tests
pnpm build && pnpm start   # production: one server on :3002
pnpm dev:electron          # desktop app with the renderer from Vite (restart it after electron/ or server changes)
pnpm dist:win              # Windows installer into release/ (on Windows; see Desktop app)
```

Data lives in `data/` (override with `LOGCADENCE_DATA_DIR`):

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

## Desktop app

The desktop app (Windows) is Electron around the same code: its main process runs the API server in-process on `127.0.0.1:3002` and the window shows the web app from it, so the renderer is the web build unchanged. 3002 is fixed because Spotify's redirect URI is registered for it, so the desktop app and `pnpm dev` can't run at the same time.

- **Library**: on first run the app asks for a library folder (an existing one, an empty one for a new library, or an empty one to import an export into), remembered in `%APPDATA%/Logcadence/config.json`. File → Open or create library / Import an export into a new library switch to another (the app restarts). `LOGCADENCE_DATA_DIR` overrides it.
- **Desktop-only features** go through `window.desktop` (`electron/preload.ts`, typed in `shared/desktop.ts`); the renderer feature-detects it, so `src/` never imports Electron. Ctrl+W / Ctrl+N and the other browser-reserved shortcuts work here, since the menu leaves them alone.
- **Build**: `scripts/build-electron.ts` bundles `electron/` with the server into `dist-electron/` (packages stay external: `dependencies` in package.json are exactly what the main process needs, renderer libraries are devDependencies). `electron-builder.yml` packages it with `dist/` and the migrations as resources. better-sqlite3's Node-API prebuilds load in both Node and Electron, so no native rebuild is needed. The NSIS installer has to be built on Windows (on Linux it needs Wine).
- **Releases and updates**: pushing a `v<version>` tag that matches package.json runs `.github/workflows/release.yml`, which builds the installer on a Windows runner and publishes it as a GitHub Release of `ipavlovski/logcadence`. Installed apps check its releases 10 s after start and every 6 h (Help → Check for updates), download in the background, and offer a restart (or install on quit). The installer is unsigned, so Windows SmartScreen asks for "More info → Run anyway" on first install.

## Data export / import

An export is one zip holding the whole library: `manifest.json` (format version, schema version, row counts and checksums), one NDJSON file per table under `tables/`, the media under `assets/` and the raw GPS files under `gps/`. The Spotify Client ID comes along, its tokens don't (connect again after importing). The journal markdown mirror is left out; the server rebuilds it on start when `journals/` is empty. The zip uses zip64 throughout, so a multi-GB library is fine.

- **Export**: "Export everything" on the canvas dashboard (streams `GET /api/export`; `?assets=0&gps=0` leaves media and GPS out), or `pnpm export:data [out.zip] [--no-assets] [--no-gps]`. Both are safe while the app runs.
- **Import**: `pnpm import:data <export.zip> [--data-dir <dir>]`, into an **empty** library only (no entries, events or assets) and with the app not running on it. The databases and assets are built in `<dir>/.importing` and moved into place when complete, so a failed import changes nothing.

This is how data moves from the web app into the desktop app. The format (see `server/lib/transfer/format.ts`) is plain JSON and media files, so later builds (mobile included) can read it; `formatVersion` only changes when existing rows change meaning.

## AI chats

The canvas **AI** tab imports chats as journal entries: titled like the chat, tagged `ai:<source>`, dated the day the chat started, one node per prompt. These entries are read-only apart from their tags, and their `ai:<source>` tag stays locked as the primary tag; clicking a prompt shows it with its reply in the AI tab, and “transcript ↗” on the entry opens the whole chat. Opening the tab scans automatically; **Scan** forces it; export files can also be dropped on the tab.

The canvas **Map** tab turns a day of GPS into a timetable of stays and trips for the journal's active day. Drop GPSLogger files (`YYYYMMDD.zip` or `.gpx`) into `data/gps/` (git-ignored; `LOGCADENCE_GPS_DIR` overrides): the server classifies new and changed files at startup and on **Scan**. Staying within 120 m for 5+ minutes is a place; the place slept at (around 03:00) is the homebase **A**, others are **B**; trips between them are **A→B**, **B→B**, **B→A**, or **A→A** for a round trip without a stop, and missing data shows as gaps. Rows tile the day, so the durations sum to 24 h. Places are shared across days and can be named by clicking them; a place can be made the day's homebase (a hotel while travelling). The map uses free OpenFreeMap tiles with deck.gl layers on MapLibre (kept on 5.x until deck.gl supports MapLibre 6).

The canvas **Spotify** tab tracks listening through the Spotify Web API. Setup: create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (Web API), add the Redirect URI `http://127.0.0.1:3002/api/spotify/callback`, paste its Client ID in the tab (or set `SPOTIFY_CLIENT_ID`) and connect; the login and tokens are kept in `data/spotify.json`. While the server runs it syncs every 3 minutes: every song played (Spotify counts a play after ~30s) with the playlist or album it came from, and liked songs by the day they were liked. Spotify only keeps the last 50 plays, so plays from long stretches with the server off are lost. The tab shows what is playing, heatmaps of songs played and liked per day, each day's plays grouped by playlist, and **Continue from yesterday**, which starts a playlist at the last track heard on the previous listening day (Premium only).

The canvas **Shortcuts** tab draws an app's hotkeys on a keyboard. They come from entries whose primary tag is `shortcuts:<app>` (e.g. `#shortcuts:illustrator`), one per line: `- ctrl+shift+s -> save as`. A line ending in `:` starts a section; `b -> brush + blob brush` puts the second action on Shift; `- [ ] …` marks a planned binding and `-> ?` a key whose action is still undecided; `[]` binds both brackets. Toggle Shift/Ctrl/Alt/Win, or hold the real keys, to see that layer; combos bound to two different actions are flagged as clashes.

| source | where it comes from |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` in the WSL home and every Windows profile under `/mnt/c/Users`: the VS Code extension, the CLI and the desktop app's Code tab (titles from the app's session metadata) |
| Antigravity | `~/.gemini/antigravity` (titles from `conversation_summaries.db`, turns decoded from each conversation's protobuf steps) |
| Claude (claude.ai) | the data export (Settings → Privacy → Export data), picked up from Downloads (`data-*.zip`, `conversations*.zip`) |
| Gemini | Google Takeout → My Activity → Gemini Apps, **JSON** format (`takeout-*.zip` in Downloads). Takeout has no conversations or titles, so prompts are grouped by 30-minute gaps and titled after the first prompt |

Re-imports append new turns and refresh nodes and titles that still read as imported; anything edited by hand is left alone, and a deleted entry is not recreated. `LOGCADENCE_AI_HOMES` (path-delimited) overrides the home directories that are scanned.

## Layout

```
electron/        desktop app: main process (runs the server), preload bridge, setup window, import worker, updater
shared/          domain types, tag paths, dates, ids, desktop bridge types (shared with the electron / future react-native apps)
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
