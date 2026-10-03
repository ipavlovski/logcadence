import { describe, expect, it } from 'vitest'
import { bump, devSemver, devSeries, nextDevNumber, sortDevTags } from './lib/versions.ts'

describe('versions', () => {
  it('numbers dev builds towards the next minor release', () => {
    expect(devSeries('0.1.0')).toBe('0.2.0')
    expect(devSeries('0.2.3')).toBe('0.3.0')
    const tags = ['v0.1.0', 'v0.2.0.1', 'v0.2.0.2', 'v0.2.0.10', 'v0.1.0.7', 'v0.2.0.x', 'other']
    expect(nextDevNumber('0.2.0', tags)).toBe(11)
    expect(nextDevNumber('0.3.0', tags)).toBe(1)
    expect(devSemver('0.2.0', 3)).toBe('0.2.0-dev.3')
  })

  it('bumps releases and sorts dev tags numerically', () => {
    expect(['major', 'minor', 'patch'].map((k) => bump('1.4.2', k as 'major'))).toEqual(['2.0.0', '1.5.0', '1.4.3'])
    expect(() => bump('0.2.0.1', 'minor')).toThrow()
    expect(sortDevTags(['v0.2.0.10', 'v0.2.0', 'v0.2.0.2', 'v0.1.0.9'])).toEqual(['v0.1.0.9', 'v0.2.0.2', 'v0.2.0.10'])
  })
})
