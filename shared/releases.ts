import { tagVersion } from './versions.ts'

// The app's GitHub Releases (published by .github/workflows/release.yml): releases and dev builds (pre-releases),
// listed in the Updates window and installed by electron/updater.ts.

export const GITHUB_OWNER = 'ipavlovski'
export const GITHUB_REPO = 'logcadence'

export interface Release {
  tag: string
  /** App version (semver): 0.2.0, or 0.2.0-dev.3 for the dev build v0.2.0.3. */
  version: string
  dev: boolean
  title: string
  /** Markdown, from scripts/lib/notes.ts. */
  notes: string
  publishedAt: string // ISO time
  url: string
}

/** Published releases from the GitHub API's list, newest first; drafts and other tags are left out. */
export function parseReleases(list: unknown): Release[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((r: Record<string, unknown>) => {
    const tag = String(r.tag_name ?? '')
    const version = tagVersion(tag)
    if (!version || r.draft) return []
    return [{ tag, version, dev: version.includes('-'), title: String(r.name || tag), notes: String(r.body ?? ''), publishedAt: String(r.published_at ?? r.created_at ?? ''), url: String(r.html_url ?? '') }]
  })
}

/** Where a release's installer and latest.yml are downloaded from. */
export const releaseDownloadUrl = (tag: string) => `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}`
