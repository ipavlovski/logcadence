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

export interface DesktopApi {
  platform: string
  /** Writes an export zip to a file picked in a save dialog. */
  exportData(opts?: { assets?: boolean; gps?: boolean }): Promise<ActionResult>
  checkForUpdates(): Promise<void>
  /** Restarts into a downloaded update. */
  installUpdate(): Promise<void>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  onProgress(cb: (p: TransferProgress) => void): () => void

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
