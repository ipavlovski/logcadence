import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell, type WebContents } from 'electron'
import { createWriteStream, rmSync } from 'node:fs'
import path from 'node:path'
import { today } from '../shared/dates.ts'
import type { ActionResult, TransferProgress, UpdateStatus } from '../shared/desktop.ts'
import type { RunningServer } from '../server/start.ts'
import { APP_NAME, BUILD_LABEL, IS_DEV_CHANNEL, PORT } from './channel.ts'
import { configuredLibrary, writeConfig } from './config.ts'
import { chooseImport, chooseLibrary, runImport } from './library.ts'
import { setMenu } from './menu.ts'
import { checkForUpdates, initUpdater, installUpdate, updateStatus } from './updater.ts'

// The desktop app: runs the API server in this process (server/start.ts) on 127.0.0.1:PORT (3002, or 3003 for
// LogcadenceDev, see channel.ts) and shows the web app from it, so the renderer is the unchanged web build.

// LogcadenceDev keeps its settings (and so its library and single-instance lock) apart from the released app's.
if (IS_DEV_CHANNEL) {
  app.setName(APP_NAME)
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))
}
// Read by the server when it loads (Spotify's redirect URI).
process.env.PORT = String(PORT)
// Set by `pnpm dev:electron`: the renderer comes from Vite (hot reload), which proxies the API to PORT.
const DEV_URL = process.env.ELECTRON_DEV_URL
const APP_URL = DEV_URL ?? `http://127.0.0.1:${PORT}`
const RESOURCES = app.isPackaged ? process.resourcesPath : app.getAppPath()
// Read lazily by server/db/open.ts.
process.env.LOGCADENCE_MIGRATIONS_DIR = app.isPackaged ? path.join(RESOURCES, 'migrations') : path.join(RESOURCES, 'server/db/migrations')

let server: RunningServer | undefined
let win: BrowserWindow | undefined
let setup: { win: BrowserWindow; resolve: (library: string | null) => void; done?: boolean } | undefined

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const w = win ?? setup?.win
    if (w?.isMinimized()) w.restore()
    w?.focus()
  })
  app.whenReady().then(main, (err: Error) => fatal(err))
}

async function main() {
  registerIpc()
  const library = process.env.LOGCADENCE_DATA_DIR ?? configuredLibrary() ?? (await runSetup())
  if (!library) return app.quit()
  process.env.LOGCADENCE_DATA_DIR = library

  // Imported only now: the server opens the library's databases when it loads.
  const { startServer } = await import('../server/start.ts')
  try {
    server = await startServer({
      port: PORT,
      staticDir: DEV_URL ? undefined : path.join(RESOURCES, 'dist'),
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE')
      return fatal(new Error(`Port ${PORT} is in use. Is the app (or the web server from \`pnpm dev\`) already running?`))
    throw err
  }

  watchPower()

  setMenu({
    exportData: (opts) => void exportData(opts),
    openLibrary: () => void switchLibrary(),
    importLibrary: () => void importLibrary(),
    showLibraryFolder: () => void shell.openPath(library),
    checkForUpdates: () => void checkForUpdates(),
  })
  createWindow()
  // Closed only now, so the app never has zero windows (which would quit it).
  const setupWin = setup?.win
  setup = undefined
  setupWin?.close()
  if (!IS_DEV_CHANNEL) initUpdater((s) => send('update-status', s))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#282c34',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  if (IS_DEV_CHANNEL) {
    win.on('page-title-updated', (e) => e.preventDefault())
    win.setTitle(`${APP_NAME} ${BUILD_LABEL}`)
  }
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = undefined))
  guardNavigation(win.webContents)
  win.webContents.on('did-finish-load', () => send('update-status', updateStatus()))
  // Vite may still be starting in dev.
  if (DEV_URL) win.webContents.on('did-fail-load', () => setTimeout(() => win?.loadURL(APP_URL), 500))
  void win.loadURL(APP_URL)
}

/** The app's own pages only; Spotify's login runs in the window, every other link opens in the browser. */
function guardNavigation(wc: WebContents) {
  const allowed = (url: string) => {
    const u = new URL(url)
    return u.origin === new URL(APP_URL).origin || u.origin === `http://127.0.0.1:${PORT}` || u.hostname === 'accounts.spotify.com'
  }
  const external = (url: string) => /^https?:/.test(url) && void shell.openExternal(url)
  wc.on('will-navigate', (e, url) => {
    if (!allowed(url)) e.preventDefault(), external(url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    external(url)
    return { action: 'deny' }
  })
}

// ── first run ───────────────────────────────────────────────────────────────

/** Shows the setup window until a library is opened, created or imported (null when it is closed). */
function runSetup(): Promise<string | null> {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 560,
      height: 460,
      resizable: false,
      backgroundColor: '#282c34',
      autoHideMenuBar: true,
      title: APP_NAME,
      webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    w.setMenu(null)
    const s: NonNullable<typeof setup> = { win: w, resolve }
    setup = s
    w.on('closed', () => {
      if (s.done) return
      setup = undefined
      resolve(null)
    })
    void w.loadFile(path.join(import.meta.dirname, 'setup.html'))
  })
}

/** Continues startup with `library`; the setup window stays up until the main window exists. */
function finishSetup(library: string) {
  writeConfig({ libraryPath: library })
  setup!.done = true
  setup!.resolve(library)
}

// ── library actions ─────────────────────────────────────────────────────────

/** From the menu: open another library (the app restarts into it). */
async function switchLibrary() {
  const dir = await chooseLibrary(win)
  if (dir) relaunchInto(dir)
}

async function importLibrary(): Promise<ActionResult> {
  const parent = setup?.win ?? win
  const job = await chooseImport(parent)
  if (!job) return { ok: false, cancelled: true }
  try {
    await runImport(job, (p) => progress(parent, p))
  } catch (err) {
    progress(parent, null)
    await dialog.showMessageBox(parent!, { type: 'error', message: 'The import failed.', detail: (err as Error).message })
    return { ok: false, error: (err as Error).message }
  }
  progress(parent, null)
  if (setup) finishSetup(job.dataDir)
  else relaunchInto(job.dataDir)
  return { ok: true }
}

function relaunchInto(library: string) {
  writeConfig({ libraryPath: library })
  app.relaunch()
  app.quit() // before-quit stops the server first
}

async function exportData(opts: { assets?: boolean; gps?: boolean } = {}): Promise<ActionResult> {
  const r = await dialog.showSaveDialog(win!, {
    title: 'Export data',
    defaultPath: path.join(app.getPath('documents'), `logcadence-${today()}.zip`),
    filters: [{ name: 'Data export', extensions: ['zip'] }],
  })
  if (r.canceled || !r.filePath) return { ok: false, cancelled: true }
  const file = r.filePath
  // Already loaded by the server, so these resolve to its open databases.
  const { db, eventsDb, DATA_DIR } = await import('../server/db/client.ts')
  const { GPS_DIR } = await import('../server/lib/gps/scan.ts')
  const { exportTo } = await import('../server/lib/transfer/export.ts')
  try {
    await exportTo(createWriteStream(file), { db, eventsDb, dataDir: DATA_DIR, gpsDir: GPS_DIR }, { ...opts, onProgress: (p) => progress(win, p) })
    return { ok: true }
  } catch (err) {
    rmSync(file, { force: true })
    await dialog.showMessageBox(win!, { type: 'error', message: 'The export failed.', detail: (err as Error).message })
    return { ok: false, error: (err as Error).message }
  } finally {
    progress(win, null)
  }
}

/** Taskbar progress plus the page's own indicator; null clears both. */
function progress(w: BrowserWindow | undefined, p: TransferProgress | null) {
  if (!w || w.isDestroyed()) return
  w.setProgressBar(p ? (p.phase === 'tables' ? 0.02 : p.done / Math.max(1, p.total)) : -1)
  if (p) w.webContents.send('transfer-progress', p)
}

/** Screen locks and sleep end the open activity spans; while locked, input doesn't count. */
function watchPower() {
  powerMonitor.on('lock-screen', () => server?.activity?.setLocked(true))
  powerMonitor.on('unlock-screen', () => server?.activity?.setLocked(false))
  powerMonitor.on('suspend', () => server?.activity?.close())
}

// ── plumbing ────────────────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle('export-data', (_e, opts?: { assets?: boolean; gps?: boolean }) => exportData(opts))
  ipcMain.handle('check-for-updates', () => checkForUpdates())
  ipcMain.handle('install-update', async () => {
    await stopServer()
    installUpdate()
  })
  ipcMain.handle('open-library', async (): Promise<ActionResult> => {
    const dir = await chooseLibrary(setup?.win ?? win)
    if (!dir) return { ok: false, cancelled: true }
    if (setup) finishSetup(dir)
    else relaunchInto(dir)
    return { ok: true }
  })
  ipcMain.handle('import-library', () => importLibrary())
}

function send(channel: string, value: UpdateStatus | TransferProgress) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value)
}

async function stopServer() {
  const s = server
  server = undefined
  await s?.stop()
}

// Flush the journal mirror and close the databases before quitting.
app.on('before-quit', (e) => {
  if (!server) return
  e.preventDefault()
  void stopServer().finally(() => app.quit())
})
app.on('window-all-closed', () => {
  if (!setup) app.quit()
})

function fatal(err: Error) {
  dialog.showErrorBox(APP_NAME, err.message)
  app.exit(1)
}
