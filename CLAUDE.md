# Logcadence

## After changing code

When a turn changes the app's code (`src/`, `server/`, `shared/`, `electron/`, `scripts/`, migrations, styles), finish by running `pnpm preview` — once, at the end of the turn, after the typecheck and tests pass. It builds the working tree as LogcadenceDev and restarts it on Windows so the change can be tried right away; it closes a running LogcadenceDev first (cleanly), and takes a minute or two. Report if it fails.

Skip it when nothing the app runs changed (docs only, notes, git operations).
