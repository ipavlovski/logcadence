import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_NAME } from './channel.ts'

// The desktop app's own settings (userData/config.json): just which library folder to open.

interface Config {
  libraryPath?: string
  /** The version that last ran, to notice an update (main.ts clears the web cache then). */
  lastVersion?: string
}

const file = () => path.join(app.getPath('userData'), 'config.json')

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Config
  } catch {
    return {}
  }
}

/** Updates the given settings, keeping the others. */
export function writeConfig(c: Config) {
  mkdirSync(path.dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify({ ...readConfig(), ...c }, null, 2))
}

/** The configured library, if its folder still exists (an unplugged drive sends the user to setup). */
export function configuredLibrary(): string | null {
  const p = readConfig().libraryPath
  return p && existsSync(p) ? p : null
}

export const defaultLibraryPath = () => path.join(app.getPath('documents'), APP_NAME)
