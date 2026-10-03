// Releases the dev branch: bumps package.json, fast-forwards main to it, tags vX.Y.Z (listing the dev builds it
// rolls up) and pushes main, dev and the tags. The tag starts the release workflow, which builds the installer
// and publishes it as a GitHub Release that installed apps update from.
// Usage: pnpm release [minor|patch|major] [--yes]   (default minor: the version the dev builds were numbered for)

import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { git, run, uncommitted } from './lib/run.ts'
import { bump, sortDevTags, type Bump } from './lib/versions.ts'

const args = process.argv.slice(2)
const kind = (args.find((a) => !a.startsWith('--')) ?? 'minor') as Bump
if (!['major', 'minor', 'patch'].includes(kind)) throw new Error('usage: pnpm release [minor|patch|major] [--yes]')

const fail = (msg: string) => (console.error(msg), process.exit(1))
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'dev') fail('Release from the dev branch.')
const dirty = uncommitted()
if (dirty.length) fail(`Commit or stash these first:\n${dirty.join('\n')}`)
git('fetch', 'origin', 'main')
if (git('rev-parse', 'main') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main: sync it first.')
// main only moves by releases, so dev is always ahead of it.
if (git('merge-base', 'main', 'dev') !== git('rev-parse', 'main')) fail('main has commits that dev lacks: merge main into dev first.')

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const version = bump(pkg.version, kind)
const devTags = sortDevTags(git('tag', '-l', '--merged', 'dev', '--no-merged', 'main').split('\n'))
const log = git('log', '--oneline', 'main..dev')

console.log(`Release ${pkg.version} → ${version}\n`)
console.log(log ? `Commits:\n${log}\n` : 'No commits since the last release.\n')
console.log(devTags.length ? `Dev builds: ${devTags.join(', ')}\n` : '')
if (!args.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Commit, tag v${version} and push main + dev to origin? [y/N] `)
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') process.exit(0)
}

// The release workflow runs these too; failing here keeps a broken tag from being pushed.
run('pnpm', ['typecheck'])
run('pnpm', ['test'])

writeFileSync('package.json', readFileSync('package.json', 'utf8').replace(`"version": "${pkg.version}"`, `"version": "${version}"`))
git('commit', '-am', `Release ${version}`)
git('checkout', 'main')
git('merge', '--ff-only', 'dev')
git('tag', '-a', `v${version}`, '-m', `Logcadence ${version}${devTags.length ? `\n\nRolls up the dev builds ${devTags.join(', ')}.` : ''}`)
git('checkout', 'dev')
// --follow-tags: the release tag and the dev builds' tags (dev tags don't match the workflow's trigger).
run('git', ['push', '--follow-tags', 'origin', 'main', 'dev'])
console.log(`\nPushed v${version}. The release workflow is building it: https://github.com/ipavlovski/logcadence/actions`)
