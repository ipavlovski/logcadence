import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/desktop.ts'
import { GITHUB_OWNER, GITHUB_REPO, releaseDownloadUrl } from '../shared/releases.ts'
import { tagVersion } from '../shared/versions.ts'
import { IS_DEV_CHANNEL } from './channel.ts'

// Auto-update from the GitHub Releases of the public repo (electron-builder.yml → publish). Updates download in
// the background and install on quit, or right away from the "restart" prompt. The background check only follows
// releases (GitHub's "latest"); dev builds are pre-releases, installed only when picked in the Updates window.

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 6 * 60 * 60_000
const GITHUB_FEED = { provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO, releaseType: 'release' } as const

let last: UpdateStatus = { state: 'none' }
let manual = false

export function initUpdater(send: (s: UpdateStatus) => void) {
  const set = (s: UpdateStatus) => send((last = s))
  if (!app.isPackaged) return

  // A dev build's version is a semver prerelease, which would otherwise make it follow newer dev builds.
  autoUpdater.allowPrerelease = false
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

/**
 * Downloads one release (a dev build, say) as the pending update, if it is newer than this version: the updater is
 * pointed at that release's files (its latest.yml names its installer) for this one check, then back at GitHub.
 */
export async function installRelease(tag: string) {
  if (IS_DEV_CHANNEL || !app.isPackaged || !tagVersion(tag)) return
  manual = false // the Updates window shows the progress
  autoUpdater.setFeedURL({ provider: 'generic', url: releaseDownloadUrl(tag) })
  try {
    const r = await autoUpdater.checkForUpdates()
    await r?.downloadPromise
  } catch {
    // reported through the 'error' event
  } finally {
    autoUpdater.setFeedURL(GITHUB_FEED)
  }
}

export const installUpdate = () => autoUpdater.quitAndInstall()
