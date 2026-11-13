import { fromLocal, pointInRing, segmentsIntersect, toLocal, type LatLng, type Xy } from './geo'

export type Obstacle = {
  id: string
  ring: LatLng[]
  heightM: number | null
}

export type ShadeSample = {
  fraction: number
  samples: number
  casters: number
}

function ringXy(ring: LatLng[], originLat: number, originLng: number): Xy[] {
  return ring.map(([lat, lng]) => toLocal(lat, lng, originLat, originLng))
}

function rayHits(origin: Xy, dirX: number, dirY: number, maxDist: number, ring: Xy[]): boolean {
  if (pointInRing(origin.x, origin.y, ring)) return true
  const endX = origin.x + dirX * maxDist
  const endY = origin.y + dirY * maxDist
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) continue
    if (segmentsIntersect(origin.x, origin.y, endX, endY, a.x, a.y, b.x, b.y)) return true
  }
  return false
}

function samplesOnRoof(roof: Xy[], spacingM: number): Xy[] {
  const xs = roof.map((p) => p.x)
  const ys = roof.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const found: Xy[] = []
  for (let x = minX + spacingM / 2; x <= maxX; x += spacingM) {
    for (let y = minY + spacingM / 2; y <= maxY; y += spacingM) {
      if (pointInRing(x, y, roof)) found.push({ x, y })
      if (found.length >= 140) return found
    }
  }
  if (found.length === 0 && roof.length) {
    const center = roof.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
    center.x /= roof.length
    center.y /= roof.length
    if (pointInRing(center.x, center.y, roof)) found.push(center)
  }
  return found
}

/**
 * Fraction of roof samples whose view of the sun is blocked by a taller footprint.
 * Returns null when the roof height is unknown — height is never assumed.
 * Azimuth is degrees clockwise from north, matching suncalc 2.1.
 */
export function shadeFractionAt(
  roof: LatLng[],
  roofHeightM: number | null,
  obstacles: Obstacle[],
  altitudeDeg: number,
  azimuthDeg: number,
  spacingM = 8,
): ShadeSample | null {
  if (roofHeightM == null || roof.length < 3) return null
  if (altitudeDeg <= 2) return { fraction: 1, samples: 0, casters: 0 }
  const origin = roof[0]
  if (!origin) return null
  const roofXy = ringXy(roof, origin[0], origin[1])
  const samples = samplesOnRoof(roofXy, spacingM)
  if (samples.length === 0) return { fraction: 0, samples: 0, casters: 0 }
  const casters = obstacles.filter((item) => item.heightM != null && item.heightM > roofHeightM && item.ring.length >= 3)
  if (casters.length === 0) return { fraction: 0, samples: samples.length, casters: 0 }
  const azimuth = (azimuthDeg * Math.PI) / 180
  const dirX = Math.sin(azimuth)
  const dirY = Math.cos(azimuth)
  const altitude = (altitudeDeg * Math.PI) / 180
  const casterRings = casters.map((item) => ({
    ring: ringXy(item.ring, origin[0], origin[1]),
    length: ((item.heightM ?? 0) - roofHeightM) / Math.tan(altitude),
  }))
  let shaded = 0
  for (const sample of samples) {
    const hit = casterRings.some((caster) => caster.length > 0 && rayHits(sample, dirX, dirY, caster.length, caster.ring))
    if (hit) shaded += 1
  }
  return { fraction: shaded / samples.length, samples: samples.length, casters: casters.length }
}

function convexHull(points: Xy[]): Xy[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return sorted
  const cross = (o: Xy, a: Xy, b: Xy) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Xy[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Xy[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Ground shadow outline used for the 3D view. The shading percent uses the ray test. */
export function groundShadowRing(
  ring: LatLng[],
  heightM: number,
  altitudeDeg: number,
  azimuthDeg: number,
): LatLng[] | null {
  if (ring.length < 3 || !(heightM > 0) || altitudeDeg <= 3) return null
  const origin = ring[0]
  if (!origin) return null
  const length = heightM / Math.tan((altitudeDeg * Math.PI) / 180)
  const azimuth = ((azimuthDeg + 180) * Math.PI) / 180
  const dx = Math.sin(azimuth) * length
  const dy = Math.cos(azimuth) * length
  const points = ring.flatMap(([lat, lng]) => {
    const local = toLocal(lat, lng, origin[0], origin[1])
    return [local, { x: local.x + dx, y: local.y + dy }]
  })
  const hull = convexHull(points)
  if (hull.length < 3) return null
  return hull.map((point) => fromLocal(point, origin[0], origin[1]))
}

export function shadeLookup(
  roofs: { ring: LatLng[]; heightM: number | null; areaM2: number }[],
  obstacles: Obstacle[],
): (sun: { altitudeDeg: number; azimuthDeg: number }) => number {
  const usable = roofs.filter((roof) => roof.heightM != null && roof.areaM2 > 0)
  return (sun) => {
    if (usable.length === 0) return 0
    let weighted = 0
    let weight = 0
    for (const roof of usable) {
      const sample = shadeFractionAt(roof.ring, roof.heightM, obstacles, sun.altitudeDeg, sun.azimuthDeg)
      if (!sample) continue
      weighted += sample.fraction * roof.areaM2
      weight += roof.areaM2
    }
    return weight > 0 ? weighted / weight : 0
  }
}
