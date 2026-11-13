import { haversineM } from './geo'

export type FeederPoint = { region: string; feeder: string; lat: number; lng: number }
export type FeederCapacity = { region: string; feeder: string; capacityKw: number }

export type FeederMatch = {
  feeder: string
  distanceM: number
  capacityKw: number | null
}

/** Refuse matches farther than 3 km rather than borrow a distant feeder. */
export const FEEDER_MAX_M = 3000

export function nearestFeeder(
  lat: number,
  lng: number,
  points: FeederPoint[],
  capacities: FeederCapacity[],
): FeederMatch | null {
  let best: FeederPoint | null = null
  let bestDistance = Infinity
  for (const point of points) {
    const distance = haversineM(lat, lng, point.lat, point.lng)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  if (!best || bestDistance > FEEDER_MAX_M) return null
  const capacity =
    capacities.find((item) => item.feeder === best?.feeder && item.region === best.region) ??
    capacities.find((item) => item.feeder === best?.feeder)
  return {
    feeder: best.feeder,
    distanceM: bestDistance,
    capacityKw: capacity ? capacity.capacityKw : null,
  }
}
