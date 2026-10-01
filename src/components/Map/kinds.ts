import type { GpsKind, GpsPlaceDTO } from '../../../shared/types.ts'

// Movement types: labels and colors. Colors are one categorical set per theme, validated for
// lightness band, chroma, colour-blind separation and contrast against each theme's surface.
// Stays (A/B) are drawn as circles and movements as paths, and every row carries a text label,
// so identity never rests on color alone.

export const KIND_ORDER: GpsKind[] = ['A', 'B', 'A->B', 'B->B', 'B->A', 'A->A', 'gap']

export const KIND_LABEL: Record<GpsKind, string> = {
  A: 'Home',
  B: 'Place',
  'A->B': 'Home → place',
  'B->B': 'Place → place',
  'B->A': 'Place → home',
  'A->A': 'Round trip',
  gap: 'No data',
}

export const KIND_CODE: Record<GpsKind, string> = { A: 'A', B: 'B', 'A->B': 'A→B', 'B->B': 'B→B', 'B->A': 'B→A', 'A->A': 'A→A', gap: '–' }

const PALETTE = {
  dark: ['#5b8def', '#c4861c', '#3d9a74', '#a07ee0', '#d4645a', '#0aa2bd'],
  light: ['#3f74d8', '#a86f0e', '#1f8a5e', '#8460c9', '#c24f45', '#00879e'],
}
const GAP = { dark: '#636d7e', light: '#9aa0aa' }

export type Theme = 'dark' | 'light'

export function kindColor(kind: GpsKind, theme: Theme): string {
  const i = KIND_ORDER.indexOf(kind)
  return kind === 'gap' ? GAP[theme] : PALETTE[theme][i]!
}

export function rgb(hex: string, alpha = 255): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

export const isStay = (k: GpsKind) => k === 'A' || k === 'B'
export const isMove = (k: GpsKind) => k !== 'gap' && !isStay(k)

/** Place names: the user's name, "Home" for the homebase, else "Place n" in order of first visit that day. */
export function placeNamer(places: GpsPlaceDTO[], homebaseId: string | null, order: (string | null)[]) {
  const seen: string[] = []
  for (const id of order) if (id && id !== homebaseId && !seen.includes(id)) seen.push(id)
  const byId = new Map(places.map((p) => [p.id, p]))
  return (id: string | null): string => {
    if (!id) return 'somewhere'
    const named = byId.get(id)?.name
    if (named) return named
    if (id === homebaseId) return 'Home'
    return `Place ${seen.indexOf(id) + 1}`
  }
}

export function duration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`)
