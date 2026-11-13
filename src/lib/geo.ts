import { featureCollection, polygon } from '@turf/helpers'
import { area } from '@turf/area'
import { union } from '@turf/union'
import { difference } from '@turf/difference'

export const METERS_PER_DEG_LAT = 111_320

export type Xy = { x: number; y: number }
export type LatLng = [number, number]

export function isSimpleRing(ring: LatLng[]): boolean {
  if (ring.length < 3 || ringAreaM2(ring) < 0.1) return false
  return !ring.some(([ay, ax], i) => ring.some(([cy, cx], j) => {
    if (j <= i || j === i + 1 || (i === 0 && j === ring.length - 1)) return false
    const [by, bx] = ring[(i + 1) % ring.length]!
    const [dy, dx] = ring[(j + 1) % ring.length]!
    return segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)
  }))
}

export function roofAreaSummary(roofs: LatLng[][], exclusions: LatLng[][]) {
  const toPolygon = (ring: LatLng[]) => {
    const coordinates = ring.map(([lat, lng]) => [lng, lat])
    coordinates.push(coordinates[0]!)
    return polygon([coordinates])
  }
  if (!roofs.length) return { total: 0, usable: 0, excluded: 0 }
  const features = roofs.map(toPolygon)
  const merged = features.length === 1 ? features[0]! : union(featureCollection(features))
  if (!merged) return { total: 0, usable: 0, excluded: 0 }
  const total = area(merged)
  const remaining = exclusions.length ? difference(featureCollection([merged, ...exclusions.map(toPolygon)])) : merged
  const usable = remaining ? area(remaining) : 0
  return { total, usable, excluded: Math.max(0, total - usable) }
}

export function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

export function toLocal(lat: number, lng: number, originLat: number, originLng: number): Xy {
  return {
    x: (lng - originLng) * metersPerDegLng(originLat),
    y: (lat - originLat) * METERS_PER_DEG_LAT,
  }
}

export function fromLocal(point: Xy, originLat: number, originLng: number): LatLng {
  return [
    originLat + point.y / METERS_PER_DEG_LAT,
    originLng + point.x / metersPerDegLng(originLat),
  ]
}

export function ringAreaM2(latlngs: LatLng[]): number {
  if (latlngs.length < 3) return 0
  const coords = latlngs.map(([lat, lng]) => [lng, lat])
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) coords.push([first![0], first![1]])
  try {
    return area(polygon([coords]))
  } catch {
    return 0
  }
}

export function pointInRing(x: number, y: number, ring: Xy[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i]
    const pj = ring[j]
    if (!pi || !pj) continue
    const intersects = pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x
    if (intersects) inside = !inside
  }
  return inside
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6_371_000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

export function mergeRings(rings: LatLng[][]): LatLng[] | null {
  if (rings.length < 2) return null
  const features = rings.map((ring) => {
    const coords = ring.map(([lat, lng]) => [lng, lat])
    const first = coords[0]
    const last = coords[coords.length - 1]
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) coords.push([first![0], first![1]])
    return polygon([coords])
  })
  const merged = union(featureCollection(features))
  if (!merged || merged.geometry.type !== 'Polygon') return null
  const outer = merged.geometry.coordinates[0]
  if (!outer) return null
  return outer.slice(0, -1).map(([lng, lat]) => [lat, lng] as LatLng)
}

export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay)
  const d2 = cross(cx, cy, dx, dy, bx, by)
  const d3 = cross(ax, ay, bx, by, cx, cy)
  const d4 = cross(ax, ay, bx, by, dx, dy)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
