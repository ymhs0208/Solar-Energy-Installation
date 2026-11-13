import type { Building } from './types'

type OverpassElement = {
  id: number
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
}

function parseHeight(value: string | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*m?$/i)
  if (!match?.[1]) return null
  const height = Number(match[1])
  return height > 0 && height < 400 ? height : null
}

function parseLevels(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const levels = Number(value)
  return levels >= 1 && levels <= 120 ? levels : null
}

export function elementsToBuildings(elements: OverpassElement[]): Building[] {
  const buildings: Building[] = []
  for (const element of elements) {
    const geom = element.geometry
    if (!geom || geom.length < 4) continue
    const ring = geom.map((point) => [point.lat, point.lon] as [number, number])
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (first && last && first[0] === last[0] && first[1] === last[1]) ring.pop()
    if (ring.length < 3) continue
    buildings.push({
      id: String(element.id),
      ring,
      heightM: parseHeight(element.tags?.height),
      levels: parseLevels(element.tags?.['building:levels']),
    })
  }
  return buildings
}
