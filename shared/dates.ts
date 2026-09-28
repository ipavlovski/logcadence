// Journal days are local calendar dates as YYYY-MM-DD strings.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
}

export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const today = (): string => toIsoDate(new Date())

export function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

/** "Sep 20th, 2026" */
export function formatJournalDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return `${MONTHS[m - 1]} ${d}${ordinal(d)}, ${y}`
}

export function weekday(iso: string): string {
  return WEEKDAYS[new Date(iso + 'T12:00:00').getDay()]!
}
