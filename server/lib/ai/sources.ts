import { execFileSync } from 'node:child_process'
import { existsSync, globSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChatSourceInfo } from '../../../shared/types.ts'

// Where each AI app keeps its chats. Under WSL the Windows profiles (/mnt/c/Users/*) are
// scanned too, since the desktop apps (Claude, Antigravity) and the browser live there; on native
// Windows (the desktop app) it is the other way round, and the homes of running WSL distros are added.
// LOGCADENCE_AI_HOMES (path-delimited) replaces the list of home directories.

const NOT_USERS = new Set(['Public', 'Default', 'Default User', 'All Users', 'Administrator'])
const WIN_USERS = '/mnt/c/Users'

export function homes(): string[] {
  const env = process.env.LOGCADENCE_AI_HOMES
  if (env) return env.split(path.delimiter).filter(Boolean)
  const list = [os.homedir()]
  if (existsSync(WIN_USERS))
    for (const u of readdirSync(WIN_USERS, { withFileTypes: true })) if (u.isDirectory() && !NOT_USERS.has(u.name)) list.push(path.join(WIN_USERS, u.name))
  list.push(...wslHomes())
  return [...new Set(list)]
}

/** \\wsl.localhost\<distro>\home\* of the running distros only, so a scan never boots WSL. */
function wslHomes(): string[] {
  if (process.platform !== 'win32') return []
  let distros: string[]
  try {
    const out = execFileSync('wsl.exe', ['--list', '--running', '--quiet'], { encoding: 'utf16le', timeout: 3000, windowsHide: true })
    distros = out
      .split(/\r?\n/)
      .map((d) => d.replaceAll('\0', '').trim())
      .filter(Boolean)
  } catch {
    return [] // no WSL, or nothing running
  }
  return distros.flatMap((d) => {
    const root = `\\\\wsl.localhost\\${d}\\home`
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((u) => u.isDirectory())
        .map((u) => path.join(root, u.name))
    } catch {
      return []
    }
  })
}

/** globSync, split at the first wildcard: it finds nothing under a UNC path (\\wsl.localhost\…) unless that is the cwd. */
function glob(pattern: string): string[] {
  const parts = pattern.split(path.sep)
  const i = parts.findIndex((p) => /[*?[{]/.test(p))
  if (i < 0) return existsSync(pattern) ? [pattern] : []
  const cwd = parts.slice(0, i).join(path.sep) || path.sep
  if (!existsSync(cwd)) return []
  return globSync(parts.slice(i).join('/'), { cwd }).map((f) => path.join(cwd, f))
}

function originOf(file: string): string {
  if (/^\/mnt\/[a-z]\//.test(file)) return 'windows'
  if (/^[\\/]{2}wsl(\.localhost|\$)[\\/]/i.test(file)) return 'wsl'
  if (process.env.WSL_DISTRO_NAME) return 'wsl'
  return process.platform
}

export interface ClaudeCodeFile {
  file: string
  sessionId: string
  origin: string
}

/** One transcript per session: the Windows Store build mirrors some sessions into two folders. */
export function claudeCodeFiles(): ClaudeCodeFile[] {
  const best = new Map<string, { f: ClaudeCodeFile; size: number }>()
  for (const home of homes())
    for (const file of glob(path.join(home, '.claude', 'projects', '*', '*.jsonl'))) {
      const sessionId = path.basename(file, '.jsonl')
      const size = statSync(file).size
      const cur = best.get(sessionId)
      if (!cur || size > cur.size) best.set(sessionId, { f: { file, sessionId, origin: originOf(file) }, size })
    }
  return [...best.values()].map((b) => b.f)
}

/** Desktop app session metadata (titles for its Code tab). */
export function claudeDesktopSessionFiles(): string[] {
  const roots = homes().flatMap((h) => [
    path.join(h, 'AppData', 'Roaming', 'Claude'),
    ...glob(path.join(h, 'AppData', 'Local', 'Packages', 'Claude_*', 'LocalCache', 'Roaming', 'Claude')),
    path.join(h, 'Library', 'Application Support', 'Claude'),
    path.join(h, '.config', 'Claude'),
  ])
  return roots.flatMap((r) => glob(path.join(r, 'claude-code-sessions', '*', '*', 'local_*.json')))
}

export function antigravityRoots(): string[] {
  return homes()
    .map((h) => path.join(h, '.gemini', 'antigravity'))
    .filter((r) => existsSync(path.join(r, 'conversation_summaries.db')))
}

// Claude's data export ("data-….zip", "conversations-….zip") and Google Takeout ("takeout-….zip").
const EXPORT_NAME = /^(data-.*|conversations.*|takeout-.*)\.zip$|^conversations\.json$/i

/** Chat exports sitting in Downloads, oldest first (so the newest export wins). */
export function exportFiles(): string[] {
  const files: { file: string; mtime: number }[] = []
  for (const home of homes()) {
    const dir = path.join(home, 'Downloads')
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!EXPORT_NAME.test(name)) continue
      const file = path.join(dir, name)
      files.push({ file, mtime: statSync(file).mtimeMs })
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime).map((f) => f.file)
}

export function describeSources(): ChatSourceInfo[] {
  const exportsIn = homes()
    .map((h) => path.join(h, 'Downloads'))
    .filter(existsSync)
  const dirsOf = (files: string[], up: number) => [...new Set(files.map((f) => path.resolve(f, ...Array(up).fill('..'))))]
  return [
    {
      source: 'claude',
      paths: exportsIn,
      hint: 'In the desktop app, connect claude.ai to sync every chat (Claude Desktop’s too). Or: claude.ai → Settings → Privacy → Export data, and leave the zip in Downloads (or drop it here).',
    },
    {
      source: 'claude-code',
      paths: dirsOf(
        claudeCodeFiles().map((f) => f.file),
        2,
      ),
      hint: 'Read from ~/.claude/projects (VS Code extension, CLI, and the desktop app’s Code tab).',
    },
    {
      source: 'gemini',
      paths: exportsIn,
      hint: 'takeout.google.com → My Activity → Gemini Apps, format JSON. Leave the zip in Downloads (or drop it here).',
    },
    {
      source: 'antigravity',
      paths: antigravityRoots(),
      hint: 'Read from ~/.gemini/antigravity.',
    },
  ]
}
