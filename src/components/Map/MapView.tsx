import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { LngLatBounds, Map as MapLibre, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef } from 'react'
import type { GpsDayDTO, GpsSegmentDTO } from '../../../shared/types.ts'
import { clock, duration, isMove, isStay, KIND_LABEL, kindColor, km, rgb, type Theme } from './kinds.ts'
import styles from './Map.module.css'

// maplibre-gl stays on 5.x: deck.gl 9.4's MapLibre integration reads map.transform, which 6.x removed.
// OpenFreeMap: free OpenStreetMap vector tiles, no key and no usage limits.
const STYLE: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

interface Stop {
  placeId: string
  lon: number
  lat: number
  kind: 'A' | 'B'
  ms: number
  idxs: number[]
}

interface Props {
  day: GpsDayDTO
  theme: Theme
  name: (placeId: string | null) => string
  /** Timetable row under the pointer / clicked. */
  hovered: number | null
  selected: number | null
  onHover: (idx: number | null) => void
  onSelect: (idx: number) => void
}

/** MapLibre basemap with deck.gl layers interleaved below its labels: trips as paths, stays as circles. */
export function MapView({ day, theme, name, hovered, selected, onHover, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const overlay = useRef<MapboxOverlay | null>(null)

  const moves = useMemo(() => day.segments.map((s, idx) => ({ ...s, idx })).filter((s) => isMove(s.kind) && s.path.length > 1), [day])
  const stops = useMemo(() => {
    const byPlace = new Map<string, Stop>()
    day.segments.forEach((s, idx) => {
      if (!isStay(s.kind) || !s.placeId) return
      const p = day.places.find((x) => x.id === s.placeId)
      if (!p) return
      const stop = byPlace.get(p.id) ?? { placeId: p.id, lon: p.lon, lat: p.lat, kind: s.kind as 'A' | 'B', ms: 0, idxs: [] }
      stop.ms += s.end - s.start
      stop.idxs.push(idx)
      byPlace.set(p.id, stop)
    })
    return [...byPlace.values()]
  }, [day])

  // Map and overlay live as long as the component.
  useEffect(() => {
    const m = new MapLibre({ container: el.current!, style: STYLE[theme], center: [0, 0], zoom: 1, attributionControl: { compact: true } })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // The compact attribution opens expanded and covers the map; start it folded to its (i) button.
    m.once('load', () => el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'))
    const o = new MapboxOverlay({ interleaved: true, layers: [] })
    m.addControl(o)
    map.current = m
    overlay.current = o
    return () => {
      m.remove()
      map.current = null
      overlay.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    map.current?.setStyle(STYLE[theme])
  }, [theme])

  // Frame the day.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const b = new LngLatBounds()
    for (const s of moves) for (const [lon, lat] of s.path) b.extend([lon, lat])
    for (const s of stops) b.extend([s.lon, s.lat])
    if (!b.isEmpty()) m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 })
  }, [moves, stops])

  // Fly to a clicked row.
  useEffect(() => {
    const m = map.current
    const s = selected !== null ? day.segments[selected] : null
    if (!m || !s) return
    const b = new LngLatBounds()
    for (const [lon, lat] of s.path) b.extend([lon, lat])
    const place = s.placeId ? day.places.find((p) => p.id === s.placeId) : null
    if (place) b.extend([place.lon, place.lat])
    if (!b.isEmpty()) m.fitBounds(b, { padding: 64, maxZoom: 16, duration: 600 })
  }, [selected, day])

  useEffect(() => {
    const o = overlay.current
    if (!o) return
    const active = hovered ?? selected
    const dim = (idxs: number[]) => active !== null && !idxs.includes(active)
    const surface = rgb(theme === 'dark' ? '#2b313c' : '#f7f7f4')
    o.setProps({
      layers: [
        new PathLayer<(typeof moves)[number]>({
          id: 'moves',
          data: moves,
          getPath: (s) => s.path.map(([lon, lat]) => [lon, lat] as [number, number]),
          getColor: (s) => rgb(kindColor(s.kind, theme), dim([s.idx]) ? 70 : 235),
          getWidth: (s) => (s.idx === active ? 6 : 3),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          pickable: true,
          onHover: (info) => onHover(info.object ? info.object.idx : null),
          onClick: (info) => info.object && onSelect(info.object.idx),
          updateTriggers: { getColor: [active, theme], getWidth: [active] },
        }),
        new ScatterplotLayer<Stop>({
          id: 'stops',
          data: stops,
          getPosition: (s) => [s.lon, s.lat],
          // ≥ 8 px, growing with time spent there.
          getRadius: (s) => 8 + Math.min(14, Math.sqrt(s.ms / 60_000)),
          radiusUnits: 'pixels',
          getFillColor: (s) => rgb(kindColor(s.kind, theme), dim(s.idxs) ? 80 : 240),
          getLineColor: surface,
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          stroked: true,
          pickable: true,
          onHover: (info) => onHover(info.object ? info.object.idxs[0]! : null),
          onClick: (info) => info.object && onSelect(info.object.idxs[0]!),
          updateTriggers: { getFillColor: [active, theme], getLineColor: [theme] },
        }),
      ],
      getTooltip: ({ object }) => {
        if (!object) return null
        if ('placeId' in object && 'idxs' in object) {
          const s = object as Stop
          return `${name(s.placeId)} · ${duration(s.ms)} in ${s.idxs.length} visit${s.idxs.length === 1 ? '' : 's'}`
        }
        const s = object as GpsSegmentDTO
        return `${KIND_LABEL[s.kind]} · ${name(s.fromPlaceId)} → ${name(s.toPlaceId)}\n${clock(s.start)}–${clock(s.end)} · ${duration(s.end - s.start)} · ${km(s.distanceM)}`
      },
    })
  }, [moves, stops, hovered, selected, theme, name, onHover, onSelect])

  return <div ref={el} className={styles.map} />
}
