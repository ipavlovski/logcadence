import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../../db/client.ts'

// The importer's settings, next to the databases like the other sync settings.

const FILE = path.join(DATA_DIR, 'youtube.json')

export interface YtSettings {
  /** Import new videos of every playlist in the background (when the app starts, then every few hours). */
  auto: boolean
}

export function loadSettings(): YtSettings {
  try {
    return { auto: true, ...(existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Partial<YtSettings>) : {}) }
  } catch {
    return { auto: true }
  }
}

export function saveSettings(patch: Partial<YtSettings>): YtSettings {
  const next = { ...loadSettings(), ...patch }
  writeFileSync(FILE, JSON.stringify(next, null, 2))
  return next
}
