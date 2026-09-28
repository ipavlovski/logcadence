/** Random UUID; falls back for insecure contexts (plain http over LAN) where crypto.randomUUID is missing. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Fractional position strictly between two neighbours (either may be missing). */
export function between(prev: number | undefined, next: number | undefined): number {
  if (prev == null && next == null) return 1
  if (prev == null) return next! - 1
  if (next == null) return prev + 1
  return (prev + next) / 2
}
