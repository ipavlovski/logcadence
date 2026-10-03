import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/desktop.ts'
import { IS_DEV_CHANNEL } from './channel.ts'

// Auto-update from the GitHub Releases of the public repo (electron-builder.yml → publish). Updates download in
// the background and install on quit, or right away from the "restart" prompt.

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 6 * 60 * 60_000

let last: UpdateStatus = { state: 'none' }
let manual = false

export function initUpdater(send: (s: UpdateStatus) => void) {
  const set = (s: UpdateStatus) => send((last = s))
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  autoUpdater.on('update-not-available', () => {
    set({ state: 'none' })
    if (manual) void dialog.showMessageBox({ message: 'You have the latest version.', detail: `Logcadence ${app.getVersion()}` })
    manual = false
  })
  autoUpdater.on('error', (err) => {
    set({ state: 'error', message: err.message })
    if (manual) void dialog.showMessageBox({ type: 'error', message: "Couldn't check for updates.", detail: err.message })
    manual = false
  })

  setTimeout(() => void checkForUpdates(false), 10_000)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS).unref()
}

/** The latest status, for a window that (re)loaded after it was sent. */
export const updateStatus = () => last

export async function checkForUpdates(byUser = true) {
  if (IS_DEV_CHANNEL) {
    if (byUser) await dialog.showMessageBox({ message: 'LogcadenceDev is updated with pnpm preview, not from GitHub.' })
    return
  }
  if (!app.isPackaged) {
    if (byUser) await dialog.showMessageBox({ message: 'Updates are only checked in the installed app.' })
    return
  }
  manual = byUser
  await autoUpdater.checkForUpdates().catch(() => {}) // reported through the 'error' event
}

export const installUpdate = () => autoUpdater.quitAndInstall()
