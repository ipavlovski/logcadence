import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The desktop app's own settings (userData/config.json): just which library folder to open.

interface Config {
  libraryPath?: string
}

const file = () => path.join(app.getPath('userData'), 'config.json')

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Config
  } catch {
    return {}
  }
}

export function writeConfig(c: Config) {
  mkdirSync(path.dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(c, null, 2))
}

/** The configured library, if its folder still exists (an unplugged drive sends the user to setup). */
export function configuredLibrary(): string | null {
  const p = readConfig().libraryPath
  return p && existsSync(p) ? p : null
}

export const defaultLibraryPath = () => path.join(app.getPath('documents'), 'Logcadence')
