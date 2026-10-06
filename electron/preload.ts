import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopApi, TransferProgress, UpdateStatus } from '../shared/desktop.ts'

// Sandboxed preload: the page gets window.desktop and nothing else from Electron or Node.

function subscribe<T>(channel: string, cb: (v: T) => void) {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.off(channel, listener)
}

const api: DesktopApi = {
  platform: process.platform,
  exportData: (opts) => ipcRenderer.invoke('export-data', opts),
  appInfo: () => ipcRenderer.invoke('app-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installRelease: (tag) => ipcRenderer.invoke('install-release', tag),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (cb) => subscribe<UpdateStatus>('update-status', cb),
  onProgress: (cb) => subscribe<TransferProgress>('transfer-progress', cb),
  clipboardFile: () => ipcRenderer.invoke('clipboard-file'),
  openLibrary: () => ipcRenderer.invoke('open-library'),
  importLibrary: () => ipcRenderer.invoke('import-library'),
}

contextBridge.exposeInMainWorld('desktop', api)
