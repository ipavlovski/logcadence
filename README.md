# logcadence

Logcadence (a cadence of daily logs) is a journaling knowledge base with two panes: **canvas | tags**. The journal is the canvas's first tab; YouTube, Reddit, Bookmarks, Images and AI chats are its other tabs. See [PROJECT.md](PROJECT.md) for the product spec.

Activity tracking (Map, Activity, Progress, the dashboard and checklists) moved to [logtracker](../logtracker), a separate desktop app.

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

## The logtracker split

Logcadence used to be a journal plus an activity tracker. The tracker half moved to its own desktop app,
[logtracker](../logtracker): the Map (GPS), Activity, Progress and dashboard tabs and the daily checklists, with the
GPS / Google Drive sync and the activity recorder. Logcadence keeps the knowledge base: the journal (now the canvas's
first tab), tags, YouTube, Reddit, Bookmarks, Images and AI chats. The two apps don't talk to each other; logtracker has
its own copy of the AI import, for its AI history.

- **The moved data**: migration `0013_drop_tracker_tables` drops `gps_*`, `activity_spans` and `checklist*` from
  content.db. Before a build with it opens a library, copy that data into logtracker with
  `pnpm import:logcadence <library>` (in ../logtracker), which reads the library without changing it. The library's
  `gps/` folder, `google.json` and `gps-drive.json` are left in place (logtracker copies them).
- **Old exports** still import: their GPS, activity and checklist tables and `gps/` folder are skipped with a warning.
- **Saved layouts** of the three-pane version come up as two panes, the journal pane's day becoming the Journal tab's.
- `tasks:progress` tags are kept as they are, but nothing reads them any more.
- Logtracker's AI history links each chat as `logcadence://ai/<chat id>`; logcadence doesn't register that link yet.

## Model

- **Entry**: belongs to a journal day, has a title and ordered tags. The first tag is primary and groups the entry in the journal.
- **Node**: an entry's children (markdown text + image gallery). Edits happen in memory and are pushed when editing ends.
- **Tag**: a colon-separated path (`system:windows:powertoys`). Ancestors are implicit. Tags no entry uses are pruned.
- **Archive**: entries and nodes can be archived. The tags pane hides archived items unless “archived” is on.

## Desktop app

The desktop app (Windows) is Electron around the same code: its main process runs the API server in-process on `127.0.0.1:3002` and the window shows the web app from it, so the renderer is the web build unchanged. 3002 is fixed because the Chrome extension posts to it, so the desktop app and `pnpm dev` can't run at the same time.

- **Library**: on first run the app asks for a library folder (an existing one, an empty one for a new library, or an empty one to import an export into), remembered in `%APPDATA%/Logcadence/config.json`. File → Open or create library / Import an export into a new library switch to another (the app restarts). `LOGCADENCE_DATA_DIR` overrides it.
- **Desktop-only features** go through `window.desktop` (`electron/preload.ts`, typed in `shared/desktop.ts`); the renderer feature-detects it, so `src/` never imports Electron. Ctrl+W / Ctrl+N and the other browser-reserved shortcuts work here, since the menu leaves them alone.
- **Build**: `scripts/build-electron.ts` bundles `electron/` with the server into `dist-electron/` (packages stay external: `dependencies` in package.json are exactly what the main process needs, renderer libraries are devDependencies). `electron-builder.yml` packages it with `dist/` and the migrations as resources. better-sqlite3's Node-API prebuilds load in both Node and Electron, so no native rebuild is needed. The NSIS installer has to be built on Windows (on Linux it needs Wine).
- **Dev previews**: work happens on the `dev` branch. `pnpm preview` (from WSL or Windows) builds the working tree as **LogcadenceDev** and installs it to `%LOCALAPPDATA%\Programs\LogcadenceDev`. If it's running it's closed gracefully first (taskkill without `/F`, so the databases are flushed), and then it's started again, in about 15 s. LogcadenceDev runs next to Logcadence: its own settings (`%APPDATA%\LogcadenceDev`), library (picked on its first run), port 3003 and window title with its version, and no auto-update.
- **Versions**: releases are `X.Y.Z`. Dev builds count towards the next minor: with the release at 0.1.0 they are 0.2.0.1, 0.2.0.2, … (`shared/versions.ts`; inside the app, where versions must be semver, 0.2.0.3 is `0.2.0-dev.3`). Previews are labelled with the dev build they lead up to (`0.2.0.3-preview`) and aren't tagged.
- **Dev builds**: `pnpm release:dev` (on `dev` with the sources committed) tags HEAD as the next `v0.2.0.N` after showing the commits since the previous build, and pushes `dev` and the tag. Tag only commits that are ready to test in the main app; ordinary commits aren't tagged. The release workflow publishes it as a GitHub **pre-release**.
- **Releases**: `pnpm release [minor|patch|major]` (default minor) bumps package.json, fast-forwards `main` to `dev`, tags `vX.Y.Z` (listing the dev builds it rolls up) and pushes main, dev and the tags. Both commands run the tests first and ask before pushing.
- **Publishing**: a pushed tag runs `.github/workflows/release.yml`. It checks the tag against package.json, builds the installer on a Windows runner with the tag's version, and publishes a GitHub Release of `ipavlovski/logcadence`. Its notes are the commits since the previous release, each with its body's bullets (`scripts/release-notes.ts`). The installer is unsigned, so Windows SmartScreen asks for "More info → Run anyway" on first install.
- **Updates**: installed apps check for releases 10 s after start and every 6 h, download in the background, and offer a restart (or install on quit). Pre-releases are left out, so dev builds only come from the **Updates** window: the top bar's ⤓ button lists releases and dev builds with their notes, with **Update** next to any newer than the installed version (`electron/updater.ts` points the updater at that release's files). Older releases aren't offered, since a database migrated by a newer version can't go back.

## Data export / import

An export is one zip holding the whole library: `manifest.json` (format version, schema version, row counts and checksums), one NDJSON file per table under `tables/`, and the media under `assets/`. Exports made before the logtracker split also carry GPS, activity and checklist tables and a `gps/` folder; an import skips those with a warning. The journal markdown mirror is left out; the server rebuilds it on start when `journals/` is empty. The zip uses zip64 throughout, so a multi-GB library is fine.

- **Export**: Settings → General → Export the library (streams `GET /api/export`; `?assets=0` leaves media out), or `pnpm export:data [out.zip] [--no-assets]`. Both are safe while the app runs.
- **Import**: `pnpm import:data <export.zip> [--data-dir <dir>]`, into an **empty** library only (no entries, events or assets) and with the app not running on it. The databases and assets are built in `<dir>/.importing` and moved into place when complete, so a failed import changes nothing.

This is how data moves from the web app into the desktop app. The format (see `server/lib/transfer/format.ts`) is plain JSON and media files, so later builds (mobile included) can read it; `formatVersion` only changes when existing rows change meaning.

## AI chats

The canvas **AI** tab imports chats as journal entries: titled like the chat, tagged `ai:<source>`, dated the day the chat started, one node per prompt. These entries are read-only apart from their tags, and their `ai:<source>` tag stays locked as the primary tag; clicking a prompt shows it with its reply in the AI tab, and “transcript ↗” on the entry opens the whole chat. Opening the tab scans automatically; **Scan** forces it; export files can also be dropped on the tab.

The **App shortcuts** window (`Ctrl+Shift+?`) draws an app's hotkeys on a keyboard. They come from entries whose primary tag is `shortcuts:<app>` (e.g. `#shortcuts:illustrator`), one per line: `- ctrl+shift+s -> save as`. A line ending in `:` starts a section; `b -> brush + blob brush` puts the second action on Shift; `- [ ] …` marks a planned binding and `-> ?` a key whose action is still undecided; `[]` binds both brackets. Toggle Shift/Ctrl/Alt/Win, or hold the real keys, to see that layer; combos bound to two different actions are flagged as clashes.

| source | where it comes from |
| --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` in the WSL home and every Windows profile under `/mnt/c/Users`: the VS Code extension, the CLI and the desktop app's Code tab (titles from the app's session metadata) |
| Antigravity | `~/.gemini/antigravity` (titles from `conversation_summaries.db`, turns decoded from each conversation's protobuf steps) |
| Claude (claude.ai) | the data export (Settings → Privacy → Export data), picked up from Downloads (`data-*.zip`, `conversations*.zip`) |
| Gemini | Google Takeout → My Activity → Gemini Apps, **JSON** format (`takeout-*.zip` in Downloads). Takeout has no conversations or titles, so prompts are grouped by 30-minute gaps and titled after the first prompt |

Re-imports append new turns and refresh nodes and titles that still read as imported; anything edited by hand is left alone, and a deleted entry is not recreated. `LOGCADENCE_AI_HOMES` (path-delimited) overrides the home directories that are scanned.

## Chrome extension: Reddit and Bookmarks

The canvas **Reddit** and **Bookmarks** tabs are filled by the Chrome extension in `extension/`, which sends a screenshot of the page with its url, title and favicon to the running app. A Reddit post goes to **Reddit** as one screenshot of the whole post, scrolled through and stitched, with its subreddit, author, points, comment count and post date. Any other page goes to **Bookmarks** as what's on screen. Each capture gets tags and notes in the app, and Reddit posts also get comments. Capturing a page again replaces its screenshot and keeps the rest.

**Install**

1. Run `pnpm preview`. It copies `extension/` to `%LOCALAPPDATA%\LogcadenceChromeExtension`, since Chrome on Windows doesn't load an unpacked extension reliably from a WSL path.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick `%LOCALAPPDATA%\LogcadenceChromeExtension`.
3. Pin the extension to the toolbar (optional).
4. In the popup, set **Send to** to the app that should receive captures: Logcadence (port 3002) or LogcadenceDev (port 3003). A green dot means that app is running.

After `pnpm preview` brings a change to the extension, click its reload button on `chrome://extensions`.

**Shortcuts**

| keys | what it does |
| --- | --- |
| `Alt+Shift+S` | Opens the popup (same as the toolbar button). On a Reddit post it offers **Capture post → Reddit**, **Add as comment** and **Save as bookmark instead**; on any other page, **Bookmark this page** |
| `Alt+Shift+D` | Captures right away: a Reddit post to Reddit, any other page to Bookmarks. The toolbar icon shows ✓ or !; hover it for the message |

Both can be changed at `chrome://extensions/shortcuts`.

**Add as comment** puts what's on screen into the Comments of a post captured before: scroll to a comment thread on the post, then capture it. Screenshots can also be pasted or dropped into a capture's Notes or Comments in the app.

The extension POSTs to `http://127.0.0.1:<port>/api/capture` (body: `CaptureRequest` in `shared/types.ts`, images as jpeg `data:` urls) with an `x-logcadence-capture` header. A web page can't add that header to a request to another origin without a CORS preflight, which the server never answers, so pages open in the browser can't send captures. An open tab picks up new captures within a few seconds, or as soon as the app window gets focus.

## Layout

```
electron/        desktop app: main process (runs the server), preload bridge, setup window, import worker, updater
extension/       Chrome extension (Manifest V3, no build step) that captures pages for the Reddit and Bookmarks tabs
shared/          domain types, tag paths, dates, ids, desktop bridge types (shared with the electron / future react-native apps)
server/
  db/            schemas + migrations for content.db and events.db
  lib/           queries, tag operations, event log, markdown mirror
  lib/ai/        AI chat import: one parser per source, zip and protobuf readers
  routes/        Hono routes; `AppType` feeds the typed `hc` client
src/
  state/         panes/tabs store, change bus, journal cursor, UI state
  components/    Journal, Tags, Canvas (frame only), Pane, Spotlight, dialogs
  canvas/        canvas plugin registry (YouTube, Reddit, Bookmarks, Images and AI chats); the journal tab itself is in components/Pane
  shortcuts.ts   every keyboard shortcut, used by the handler and the help overlay (press ?)
```

## Keyboard

Press `?` in the app for the full list. `Ctrl+1` / `Ctrl+2` focus the canvas / tags pane and `Ctrl+T` minimizes or restores the tags pane. On the journal tab, `Ctrl+[` / `Ctrl+]` step the day and `Alt+←` / `Alt+→` go back and forward through the days shown. Journal entries fold to their title and tags: the top bar's **fold** button (its chevron points right when the day's entries are all folded) or `Ctrl+.` folds or unfolds all of the open day's entries, and `Shift+click` on a title folds one (with Shift held, titles show a fold or unfold cursor). Folds are remembered per entry; a find (`Ctrl+F`) shows its matches inside folded entries. Browsers reserve `Ctrl+W`, `Ctrl+N`, `Ctrl+Shift+N` and `Ctrl+Shift+W`, so each also has an `Alt+` binding.
