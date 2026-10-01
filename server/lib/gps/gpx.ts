// GPX track points (GPSLogger writes GPX 1.0: one <trkpt> per fix, with time, speed, hdop and
// whether the fix came from GPS or the network). Parsed with regexes: a day is ~9 MB and 40k+
// points, and only a handful of fields are needed.

export interface GpsPoint {
  /** Epoch ms. */
  t: number
  lat: number
  lon: number
}

export interface ParsedTrack {
  points: GpsPoint[]
  /** UTC offset of the recording, e.g. "-03:00" (from the first timestamp); "Z" when absent. */
  offset: string
  /** Points dropped as network fixes or imprecise (hdop above HDOP_MAX). */
  dropped: number
}

/** Horizontal dilution of precision above this is too vague to place someone within ~100 m. */
const HDOP_MAX = 5

const TRKPT = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)<\/trkpt>/g
const field = (body: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(body)?.[1]

export function parseGpx(xml: string): ParsedTrack {
  const points: GpsPoint[] = []
  let offset: string | null = null
  let dropped = 0
  for (const m of xml.matchAll(TRKPT)) {
    const body = m[3]!
    const time = field(body, 'time')
    if (!time) continue
    offset ??= /([+-]\d\d:\d\d|Z)$/.exec(time)?.[1] ?? 'Z'
    const hdop = Number(field(body, 'hdop') ?? 0)
    if (field(body, 'src') === 'network' || hdop > HDOP_MAX) {
      dropped++
      continue
    }
    points.push({ t: Date.parse(time), lat: Number(m[1]), lon: Number(m[2]) })
  }
  points.sort((a, b) => a.t - b.t)
  // Same timestamp twice (logger restarts): keep the first.
  const unique = points.filter((p, i) => i === 0 || p.t !== points[i - 1]!.t)
  return { points: unique, offset: offset ?? 'Z', dropped }
}
