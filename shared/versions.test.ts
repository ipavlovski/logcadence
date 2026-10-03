import { describe, expect, it } from 'vitest'
import { parseReleases } from './releases.ts'
import { bump, compareVersions, devSemver, devSeries, nextDevNumber, sortDevTags, sortTags, tagVersion, versionLabel } from './versions.ts'

describe('versions', () => {
  it('numbers dev builds towards the next minor release', () => {
    expect(devSeries('0.1.0')).toBe('0.2.0')
    expect(devSeries('0.2.3')).toBe('0.3.0')
    const tags = ['v0.1.0', 'v0.2.0.1', 'v0.2.0.2', 'v0.2.0.10', 'v0.1.0.7', 'v0.2.0.x', 'other']
    expect(nextDevNumber('0.2.0', tags)).toBe(11)
    expect(nextDevNumber('0.3.0', tags)).toBe(1)
    expect(devSemver('0.2.0', 3)).toBe('0.2.0-dev.3')
  })

  it('bumps releases', () => {
    expect(['major', 'minor', 'patch'].map((k) => bump('1.4.2', k as 'major'))).toEqual(['2.0.0', '1.5.0', '1.4.3'])
    expect(() => bump('0.2.0.1', 'minor')).toThrow()
  })

  it('maps tags to app versions and labels', () => {
    expect(tagVersion('v0.2.0')).toBe('0.2.0')
    expect(tagVersion('v0.2.0.3')).toBe('0.2.0-dev.3')
    expect(tagVersion('v0.2')).toBeNull()
    expect(tagVersion('0.2.0')).toBeNull()
    expect(versionLabel('0.2.0-dev.3')).toBe('0.2.0.3')
    expect(versionLabel('0.2.0-preview.4')).toBe('0.2.0.4-preview')
    expect(versionLabel('0.2.0')).toBe('0.2.0')
  })

  it('orders a release after its dev builds', () => {
    const sorted = ['0.2.0', '0.2.0-dev.10', '0.1.0', '0.2.0-dev.2', '0.3.0-dev.1', '0.1.1'].sort(compareVersions)
    expect(sorted).toEqual(['0.1.0', '0.1.1', '0.2.0-dev.2', '0.2.0-dev.10', '0.2.0', '0.3.0-dev.1'])
    expect(sortTags(['v0.2.0', 'v0.2.0.10', 'junk', 'v0.2.0.2', 'v0.1.0'])).toEqual(['v0.1.0', 'v0.2.0.2', 'v0.2.0.10', 'v0.2.0'])
    expect(sortDevTags(['v0.2.0.10', 'v0.2.0', 'v0.2.0.2', 'v0.1.0.9'])).toEqual(['v0.1.0.9', 'v0.2.0.2', 'v0.2.0.10'])
  })

  it('reads GitHub releases, skipping drafts and other tags', () => {
    const list = [
      { tag_name: 'v0.2.0.2', name: 'Logcadence 0.2.0.2 (dev build)', body: '## Changes', prerelease: true, draft: false, published_at: '2026-10-03T12:00:00Z', html_url: 'u' },
      { tag_name: 'v0.2.0.3', draft: true },
      { tag_name: 'nightly', draft: false },
      { tag_name: 'v0.1.0', name: '', body: null, draft: false, published_at: '2026-10-01T12:00:00Z', html_url: 'v' },
    ]
    expect(parseReleases(list).map((r) => [r.tag, r.version, r.dev, r.title])).toEqual([
      ['v0.2.0.2', '0.2.0-dev.2', true, 'Logcadence 0.2.0.2 (dev build)'],
      ['v0.1.0', '0.1.0', false, 'v0.1.0'],
    ])
  })
})
