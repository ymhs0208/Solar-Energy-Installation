import { fromLocal, pointInRing, segmentsIntersect, toLocal, type LatLng, type Xy } from './geo'

export type LayoutId = 'south' | 'ew' | 'flat'

export type LayoutPreset = {
  id: LayoutId
  name: string
  /** Design setting, not a measurement. */
  tiltDeg: number
  azimuthsDeg: number[]
  pitch: 'winter' | 'gap'
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'south', name: '南向固定傾角', tiltDeg: 15, azimuthsDeg: [180], pitch: 'winter' },
  { id: 'ew', name: '東西向', tiltDeg: 10, azimuthsDeg: [90, 270], pitch: 'gap' },
  { id: 'flat', name: '平鋪', tiltDeg: 0, azimuthsDeg: [180], pitch: 'gap' },
]

/** Solar noon altitude on the December solstice, northern hemisphere, degrees. */
export function winterNoonAltitudeDeg(latitude: number): number {
  return 90 - latitude - 23.45
}

/** Distance from one row to the next, in meters, including the module's horizontal footprint. */
export function rowPitchM(
  lengthM: number,
  tiltDeg: number,
  latitude: number,
  gapM: number,
  mode: 'winter' | 'gap',
): number {
  const tilt = (tiltDeg * Math.PI) / 180
  const footprint = lengthM * Math.cos(tilt)
  if (mode === 'gap' || tiltDeg <= 0) return footprint + gapM
  const altitude = (winterNoonAltitudeDeg(latitude) * Math.PI) / 180
  const shadeGap = (lengthM * Math.sin(tilt)) / Math.tan(altitude)
  return footprint + shadeGap + gapM
}

export type PanelPlacement = {
  panels: LatLng[][]
  count: number
  moduleAreaM2: number
  truncated: boolean
}

/**
 * Places module footprints whose centers fall inside the roof.
 * South-facing rows add the winter-solstice self-shade pitch.
 * East-west and flat rows use only the projected module depth plus the user's gap.
 * East-west energy is averaged on east and west azimuths; the drawn rows alternate color by index.
 */
export function placePanels(input: {
  ring: LatLng[]
  lengthM: number
  widthM: number
  tiltDeg: number
  azimuthDeg: number
  gapM: number
  latitude: number
  pitch: 'winter' | 'gap'
  maxDrawn?: number
  exclusions?: LatLng[][]
}): PanelPlacement {
  const { ring, lengthM, widthM, tiltDeg, azimuthDeg, gapM, latitude, pitch } = input
  const maxDrawn = input.maxDrawn ?? 700
  if (ring.length < 3 || !(lengthM > 0) || !(widthM > 0)) {
    return { panels: [], count: 0, moduleAreaM2: 0, truncated: false }
  }
  const origin = ring[0]!
  const local = ring.map(([lat, lng]) => toLocal(lat, lng, origin[0], origin[1]))
  const excluded = (input.exclusions ?? []).map((ring) => ring.map(([lat, lng]) => toLocal(lat, lng, origin[0], origin[1])))
  const crosses = (a: Xy[], b: Xy[]) => a.some((p, i) => b.some((q, j) => {
    const nextA = a[(i + 1) % a.length]!
    const nextB = b[(j + 1) % b.length]!
    return segmentsIntersect(p.x, p.y, nextA.x, nextA.y, q.x, q.y, nextB.x, nextB.y)
  }))
  const azimuth = (azimuthDeg * Math.PI) / 180
  const v = { x: Math.sin(azimuth), y: Math.cos(azimuth) }
  const u = { x: Math.cos(azimuth), y: -Math.sin(azimuth) }
  const toUv = (p: Xy) => ({ u: p.x * u.x + p.y * u.y, v: p.x * v.x + p.y * v.y })
  const fromUv = (uu: number, vv: number): Xy => ({ x: uu * u.x + vv * v.x, y: uu * u.y + vv * v.y })
  const uv = local.map(toUv)
  const minU = Math.min(...uv.map((p) => p.u))
  const maxU = Math.max(...uv.map((p) => p.u))
  const minV = Math.min(...uv.map((p) => p.v))
  const maxV = Math.max(...uv.map((p) => p.v))
  const tilt = (tiltDeg * Math.PI) / 180
  const depth = lengthM * Math.cos(tilt)
  const pitchV = rowPitchM(lengthM, tiltDeg, latitude, gapM, pitch)
  const pitchU = widthM + gapM
  if (!(pitchV > 0) || !(pitchU > 0)) return { panels: [], count: 0, moduleAreaM2: 0, truncated: false }
  const panels: LatLng[][] = []
  let count = 0
  for (let vv = minV + depth / 2; vv <= maxV; vv += pitchV) {
    for (let uu = minU + widthM / 2; uu <= maxU; uu += pitchU) {
      const center = fromUv(uu, vv)
      if (!pointInRing(center.x, center.y, local)) continue
      const corners = [
          fromUv(uu - widthM / 2, vv - depth / 2),
          fromUv(uu + widthM / 2, vv - depth / 2),
          fromUv(uu + widthM / 2, vv + depth / 2),
          fromUv(uu - widthM / 2, vv + depth / 2),
      ]
      if (!corners.every((p) => pointInRing(p.x, p.y, local)) || crosses(corners, local)) continue
      if (excluded.some((zone) => corners.some((p) => pointInRing(p.x, p.y, zone)) || zone.some((p) => pointInRing(p.x, p.y, corners)) || crosses(corners, zone))) continue
      count += 1
      if (panels.length < maxDrawn) {
        panels.push(corners.map((point) => fromLocal(point, origin[0], origin[1])))
      }
    }
  }
  return {
    panels,
    count,
    moduleAreaM2: count * lengthM * widthM,
    truncated: count > panels.length,
  }
}
