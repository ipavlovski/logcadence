import { dialog, utilityProcess, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { TransferProgress } from '../shared/desktop.ts'
import { libraryNotEmpty } from '../server/lib/transfer/import.ts'
import { defaultLibraryPath } from './config.ts'

// Picking the library folder: an existing library, or an empty folder to start one or import into.

const isLibrary = (dir: string) => existsSync(path.join(dir, 'db', 'content.db'))
const isEmptyDir = (dir: string) => !existsSync(dir) || readdirSync(dir).length === 0

async function pickFolder(win: BrowserWindow | undefined, title: string): Promise<string | null> {
  const defaultPath = defaultLibraryPath()
  mkdirSync(defaultPath, { recursive: true })
  const opts: OpenDialogOptions = { title, defaultPath, buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] }
  const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

/** An existing library to open, or an empty folder for a new one. */
export async function chooseLibrary(win?: BrowserWindow): Promise<string | null> {
  for (;;) {
    const dir = await pickFolder(win, 'Open a library, or pick an empty folder for a new one')
    if (!dir || isLibrary(dir) || isEmptyDir(dir)) return dir
    await message(win, 'That folder has other files in it.', 'Pick an existing library or an empty folder.')
  }
}

/** An export zip and an empty folder to import it into. */
export async function chooseImport(win?: BrowserWindow): Promise<{ zip: string; dataDir: string } | null> {
  const opts: OpenDialogOptions = { title: 'Import a data export', filters: [{ name: 'Data export', extensions: ['zip'] }], properties: ['openFile'] }
  const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
  const zip = r.canceled ? undefined : r.filePaths[0]
  if (!zip) return null
  for (;;) {
    const dataDir = await pickFolder(win, 'Pick an empty folder for the imported library')
    if (!dataDir) return null
    const problem = isLibrary(dataDir) ? libraryNotEmpty(dataDir) : isEmptyDir(dataDir) ? null : 'it has other files in it'
    if (!problem) return { zip, dataDir }
    await message(win, `Can't import into that folder: ${problem}.`, 'Pick an empty folder.')
  }
}

/** Imports in a utility process (see importWorker.ts). */
export function runImport(job: { zip: string; dataDir: string }, onProgress: (p: TransferProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(import.meta.dirname, 'import-worker.js'), [], { serviceName: 'Data import', stdio: 'inherit' })
    child.on('message', (m: { type: 'progress'; progress: TransferProgress } | { type: 'done'; warnings: string[] } | { type: 'error'; message: string }) => {
      if (m.type === 'progress') onProgress(m.progress)
      else if (m.type === 'done') {
        for (const w of m.warnings) console.warn(`import: ${w}`)
        resolve()
      } else reject(new Error(m.message))
    })
    // Settles nothing once done/error arrived; catches a crash.
    child.on('exit', (code) => reject(new Error(`the import stopped unexpectedly (exit code ${code})`)))
    child.postMessage(job)
  })
}

function message(win: BrowserWindow | undefined, msg: string, detail: string) {
  const opts = { type: 'warning' as const, message: msg, detail }
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
}
