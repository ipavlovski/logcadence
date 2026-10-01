import { app, Menu } from 'electron'

// The window menu. It deliberately has no close-window / new-window accelerators: Ctrl+W, Ctrl+N and friends
// belong to the app's own shortcuts (src/shortcuts.ts), which a browser reserves but the desktop app can have.
// No Edit menu either: on Windows and Linux the clipboard keys work without one.

export interface MenuActions {
  exportData(opts: { assets: boolean; gps: boolean }): void
  openLibrary(): void
  importLibrary(): void
  showLibraryFolder(): void
  checkForUpdates(): void
}

export function setMenu(a: MenuActions) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Export data…', click: () => a.exportData({ assets: true, gps: true }) },
          { label: 'Export without media and GPS files…', click: () => a.exportData({ assets: false, gps: false }) },
          { type: 'separator' },
          { label: 'Open or create library…', click: a.openLibrary },
          { label: 'Import an export into a new library…', click: a.importLibrary },
          { label: 'Show library folder', click: a.showLibraryFolder },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'Check for updates…', click: a.checkForUpdates },
          { label: `Version ${app.getVersion()}`, enabled: false },
        ],
      },
    ]),
  )
}
