// The desktop app's bridge (electron/preload.ts → window.desktop). Only the Electron build has it: the web
// app (and later the mobile one) feature-detect it, so nothing outside electron/ depends on Electron.

export type UpdateStatus =
  | { state: 'checking' | 'none' }
  | { state: 'available' | 'ready'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'error'; message: string }

export interface TransferProgress {
  phase: 'tables' | 'assets' | 'gps'
  done: number
  total: number
}

export interface ActionResult {
  ok: boolean
  /** Set when the user cancelled a dialog. */
  cancelled?: boolean
  error?: string
}

export interface AppInfo {
  /** Semver: 0.1.0, 0.2.0-dev.3 (a dev build), 0.2.0-preview.3 (LogcadenceDev). */
  version: string
  /** "dev" is LogcadenceDev, which is updated by pnpm preview rather than from GitHub. */
  channel: 'release' | 'dev'
}

export interface ClipboardFile {
  name: string
  type: string
  data: Uint8Array
}

export interface DesktopApi {
  platform: string
  appInfo(): Promise<AppInfo>
  /** Writes an export zip to a file picked in a save dialog. */
  exportData(opts?: { assets?: boolean; gps?: boolean }): Promise<ActionResult>
  checkForUpdates(): Promise<void>
  /** Downloads one release (by tag, e.g. a dev build) as the next update; progress comes through onUpdate. */
  installRelease(tag: string): Promise<void>
  /** Restarts into a downloaded update. */
  installUpdate(): Promise<void>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  onProgress(cb: (p: TransferProgress) => void): () => void
  /**
   * The image or video file copied to the clipboard as a file (Explorer, ShareX), for pastes where the
   * page sees no file; null when the clipboard holds no such file.
   */
  clipboardFile(): Promise<ClipboardFile | null>

  // First-run setup window.
  /** Picks a folder: an existing library is opened, an empty one becomes a new library. */
  openLibrary(): Promise<ActionResult>
  /** Picks an export zip and an empty folder, and imports into it. */
  importLibrary(): Promise<ActionResult>
}

declare global {
  interface Window {
    desktop?: DesktopApi
  }
}
