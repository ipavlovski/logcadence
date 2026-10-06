import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../../db/client.ts'

// The importer's settings, next to the databases like the other sync settings. The API key is a secret: it is
// never sent back to the page and is left out of data exports.

const FILE = path.join(DATA_DIR, 'youtube.json')

export interface YtSettings {
  /** Import new videos of every playlist in the background (when the app starts, then every few hours). */
  auto: boolean
  /** YouTube Data API v3 key; without one, imports read the playlist page (no added dates). */
  apiKey?: string
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
  if (!next.apiKey) delete next.apiKey
  writeFileSync(FILE, JSON.stringify(next, null, 2))
  return next
}

/** The saved key, or YOUTUBE_API_KEY. */
export const apiKey = (): string | null => loadSettings().apiKey || process.env.YOUTUBE_API_KEY || null

/** What the page may see: the key only as its last characters. */
export function publicSettings() {
  const key = apiKey()
  return { auto: loadSettings().auto, apiKey: key ? `…${key.slice(-4)}` : null, apiKeyFromEnv: !loadSettings().apiKey && !!process.env.YOUTUBE_API_KEY }
}
