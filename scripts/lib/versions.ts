// Version scheme. main releases are X.Y.Z (package.json "version", tag vX.Y.Z, published by the release workflow).
// Builds of the dev branch count towards the next minor release: with main at 0.1.0 they are 0.2.0.1, 0.2.0.2, …
// (tags v0.2.0.N, never published), until `pnpm release` rolls them up into v0.2.0.

export type Bump = 'major' | 'minor' | 'patch'

export function parseRelease(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  if (!m) throw new Error(`not an X.Y.Z version: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function bump(v: string, kind: Bump): string {
  const [a, b, c] = parseRelease(v)
  return kind === 'major' ? `${a + 1}.0.0` : kind === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`
}

/** The release that dev builds of `release` lead up to: the next minor. */
export const devSeries = (release: string) => bump(release, 'minor')

/** N of the tags vSERIES.N. */
export function devNumbers(series: string, tags: string[]): number[] {
  const prefix = `v${series}.`
  return tags.flatMap((t) => (t.startsWith(prefix) && /^\d+$/.test(t.slice(prefix.length)) ? [Number(t.slice(prefix.length))] : []))
}

export const nextDevNumber = (series: string, tags: string[]) => Math.max(0, ...devNumbers(series, tags)) + 1

/** Tags of dev builds (vA.B.C.N), in version order. */
export function sortDevTags(tags: string[]): string[] {
  const key = (t: string) => t.slice(1).split('.').map(Number)
  const compare = (a: number[], b: number[]) => a.map((n, i) => n - b[i]!).find((d) => d !== 0) ?? 0
  return tags.filter((t) => /^v\d+\.\d+\.\d+\.\d+$/.test(t)).sort((x, y) => compare(key(x), key(y)))
}

/** package.json's version must be semver: 0.2.0.3 is packaged as the prerelease 0.2.0-dev.3. */
export const devSemver = (series: string, n: number) => `${series}-dev.${n}`
