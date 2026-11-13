import { describe, expect, it } from 'vitest'
import { fromLocal, isSimpleRing, roofAreaSummary, type LatLng } from './geo'
import { placePanels } from './layout'

const rect = (x: number, y: number, width: number, height: number): LatLng[] =>
  [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([a, b]) => fromLocal({ x: a!, y: b! }, 25, 121))
const roof = rect(0, 0, 20, 20)
const input = { ring: roof, lengthM: 2, widthM: 1, tiltDeg: 0, azimuthDeg: 180, gapM: 0, latitude: 25, pitch: 'gap' as const }

describe('roof exclusions', () => {
  it('rejects panels intersecting a thin passage even when their centers are outside it', () => {
    const base = placePanels(input)
    const excluded = placePanels({ ...input, exclusions: [rect(0, 10.25, 20, 0.1)] })
    expect(excluded.count).toBeLessThan(base.count)
    expect(placePanels({ ...input, exclusions: [rect(-1, -1, 22, 22)] }).count).toBe(0)
    expect(placePanels({ ...input, exclusions: [rect(30, 30, 5, 5)] }).count).toBe(base.count)
  })
  it('clips exclusions to roofs and counts overlapping exclusions once', () => {
    const excluded = rect(10, 0, 20, 20)
    const once = roofAreaSummary([roof], [excluded])
    const twice = roofAreaSummary([roof], [excluded, excluded])
    expect(once.usable / once.total).toBeCloseTo(0.5, 3)
    expect(twice.excluded).toBeCloseTo(once.excluded, 3)
    expect(roofAreaSummary([roof], [rect(30, 30, 2, 2)]).excluded).toBe(0)
  })
  it('rejects crossed drawings', () => {
    expect(isSimpleRing(roof)).toBe(true)
    expect(isSimpleRing([roof[0]!, roof[2]!, roof[1]!, roof[3]!])).toBe(false)
  })
})
