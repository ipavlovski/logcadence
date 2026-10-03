import { spawnSync, type SpawnSyncOptions } from 'node:child_process'

// Small process helpers for the build scripts.

/** Runs a command with its output shown; throws if it fails. */
export function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`)
}

/** Runs a command and returns its trimmed stdout ('' when it fails and `ok` is set). */
export function out(cmd: string, args: string[], opts: SpawnSyncOptions & { ok?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.error) throw r.error
  if (r.status !== 0 && !opts.ok) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}: ${r.stderr}`)
  return String(r.stdout ?? '').trim()
}

export const git = (...args: string[]) => out('git', args)

/** Changes that would make a build differ from HEAD: edits and new files in the sources (docs don't count). */
export function uncommitted(): string[] {
  const SOURCES = /^(src|server|shared|electron|scripts|\.github)\/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|index\.html|vite\.config\.ts|tsconfig\.json|electron-builder.*\.yml)$/
  return git('status', '--porcelain')
    .split('\n')
    .filter(Boolean)
    .filter((l) => SOURCES.test(l.slice(3)))
}
