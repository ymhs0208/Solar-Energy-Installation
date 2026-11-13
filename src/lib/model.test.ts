import { describe, expect, it } from 'vitest'
import { ageYears, parseRocDate } from './dates'
import { nearestFeeder } from './feeders'
import { lookupFit, parseRoofFitTable } from './fit'
import { fullSaleRevenue, parseWindows, paybackYears, selfUseBenefit, summerFraction, weightedEnergyRate } from './finance'
import { gridGate, legalGate, structuralGate } from './gates'
import { placePanels, rowPitchM, winterNoonAltitudeDeg } from './layout'
import { ringAreaM2, type LatLng } from './geo'
import { shadeFractionAt } from './shading'
import { monthlyGeneration, type Climate } from './solar'

const climate: Climate = {
  ghiDaily: Array(12).fill(4),
  dhiDaily: Array(12).fill(1.6),
  tAmb: Array(12).fill(25),
}

describe('dates', () => {
  it('parses ROC dates and age', () => {
    expect(parseRocDate('1100916')).toBe('2021-09-16')
    expect(parseRocDate('870512')).toBe('1998-05-12')
    expect(parseRocDate('')).toBeNull()
    expect(ageYears('2021-09-16', '2026-11-13')).toBe(5)
  })
})

describe('fit and finance', () => {
  it('reads the 115 rooftop brackets from announcement text', () => {
    const text = `
      屋頂型
      1 瓩以上不及 10 瓩 5.6279 5.6279
      10 瓩以上不及 20 瓩 5.3819 5.3819
      20 瓩以上不及 50 瓩 4.2505 4.2505
      50 瓩以上不及 100 瓩 4.0459 4.0459
      100瓩以上不及500瓩 3.7152 3.7152
      500瓩以上 3.6236 3.6236
      地面型 1瓩以上 3.5037 3.5037
    `
    const rows = parseRoofFitTable(text)
    expect(lookupFit(0.5, rows)).toBeNull()
    expect(lookupFit(9.9, rows)?.rate).toBe(5.6279)
    expect(lookupFit(10, rows)?.rate).toBe(5.3819)
    expect(lookupFit(500, rows)?.rate).toBe(3.6236)
  })

  it('computes payback and the two cashflows', () => {
    expect(paybackYears(1_000_000, 200_000)).toBeCloseTo(5)
    expect(paybackYears(100, 0)).toBeNull()
    expect(fullSaleRevenue(1000, 3.7152)).toBeCloseTo(3715.2)
    expect(selfUseBenefit(1000, 0.5, 5, 3)).toBeCloseTo(4000)
  })

  it('weights a flat weekday price by the published window', () => {
    const windows = parseWindows('00:00~24:00', 4)
    const schedule = {
      summer: { weekday: windows, saturday: windows, sunday: windows },
      winter: { weekday: windows, saturday: windows, sunday: windows },
    }
    const rate = weightedEnergyRate([{ month: 6, hour: 11, kwh: 10 }], schedule)
    expect(rate).toBeCloseTo(4)
    expect(summerFraction(6)).toBe(1)
    expect(summerFraction(0)).toBe(0)
    expect(summerFraction(4)).toBeCloseTo(16 / 31)
  })
})

describe('gates', () => {
  it('flags drawn roofs more than 15% over the registered area', () => {
    expect(legalGate(1000, 1000).status).toBe('pass')
    expect(legalGate(1140, 1000).status).toBe('pass')
    expect(legalGate(1160, 1000).status).toBe('fail')
    expect(legalGate(1000, null).status).toBe('insufficient')
  })

  it('compares feeder capacity without inventing a missing feeder', () => {
    expect(gridGate({ capacityKw: null, distanceM: null, feeder: null, kwp: 100 }).status).toBe('insufficient')
    expect(gridGate({ capacityKw: 0, distanceM: 100, feeder: 'A', kwp: 100 }).status).toBe('fail')
    expect(gridGate({ capacityKw: 80, distanceM: 100, feeder: 'A', kwp: 100 }).status).toBe('warn')
    expect(gridGate({ capacityKw: 200, distanceM: 100, feeder: 'A', kwp: 100 }).status).toBe('pass')
    expect(gridGate({ capacityKw: 200, distanceM: 1500, feeder: 'A', kwp: 100 }).status).toBe('warn')
  })

  it('raises structural risk for an old metal roof and keeps a new RC roof low', () => {
    expect(structuralGate({ ageYears: null, roofType: null, leakOrRust: false, seismicRetrofit: false, rooftopAddOn: false }).status).toBe('insufficient')
    expect(structuralGate({ ageYears: 5, roofType: 'rc', leakOrRust: false, seismicRetrofit: false, rooftopAddOn: false }).risk).toBe('低')
    const old = structuralGate({ ageYears: 28, roofType: 'metal', leakOrRust: true, seismicRetrofit: false, rooftopAddOn: false })
    expect(old.risk).toBe('高')
    expect(old.status).toBe('fail')
  })
})

describe('solar model', () => {
  it('matches horizontal irradiance when the array is flat and losses are off', () => {
    const result = monthlyGeneration(25, 121, climate, { tiltDeg: 0, azimuthsDeg: [180] }, 10, 0.2, {
      albedo: null,
      gammaPerC: null,
      noctC: null,
      systemLoss: null,
    })
    expect(result.annualGhiKwhPerM2).toBeCloseTo(4 * 365, 0)
    expect(result.annualPoaKwhPerM2).toBeCloseTo(result.annualGhiKwhPerM2, 0)
    expect(result.annualKwh).toBeCloseTo(4 * 365 * 10 * 0.2, 0)
    expect(result.temperatureApplied).toBe(false)
    expect(result.shadingFraction).toBeNull()
  })

  it('reduces yield when the cell runs hotter than 25°C', () => {
    const base = monthlyGeneration(25, 121, climate, { tiltDeg: 0, azimuthsDeg: [180] }, 10, 0.2, {
      albedo: null,
      gammaPerC: null,
      noctC: null,
      systemLoss: null,
    })
    const hot = monthlyGeneration(25, 121, climate, { tiltDeg: 0, azimuthsDeg: [180] }, 10, 0.2, {
      albedo: null,
      gammaPerC: -0.004,
      noctC: 45,
      systemLoss: null,
    })
    expect(hot.annualKwh).toBeLessThan(base.annualKwh)
  })

  it('returns zero energy for zero module area', () => {
    const result = monthlyGeneration(25, 121, climate, { tiltDeg: 15, azimuthsDeg: [180] }, 0, 0.2, {
      albedo: 0.2,
      gammaPerC: null,
      noctC: null,
      systemLoss: 0.1,
    })
    expect(result.annualKwh).toBe(0)
  })
})

describe('shading and layout', () => {
  it('shades a roof when a taller building sits toward the sun', () => {
    const roof: LatLng[] = [
      [25.00108, 120.9999],
      [25.00108, 121.0001],
      [25.00092, 121.0001],
      [25.00092, 120.9999],
    ]
    const building: LatLng[] = [
      [25.00075, 120.9999],
      [25.00075, 121.0001],
      [25.00055, 121.0001],
      [25.00055, 120.9999],
    ]
    const shaded = shadeFractionAt(roof, 8, [{ id: 'b', ring: building, heightM: 40 }], 45, 180, 4)
    const clear = shadeFractionAt(roof, 8, [{ id: 'b', ring: building, heightM: 6 }], 45, 180, 4)
    expect(shaded?.fraction).toBeGreaterThan(0.3)
    expect(clear?.fraction).toBe(0)
    expect(shadeFractionAt(roof, null, [], 45, 180)).toBeNull()
  })

  it('packs fewer south-tilted rows than a flat layout', () => {
    const lat = 24.1
    const lng = 120.7
    const heightM = 40
    const widthM = 20
    const dLat = heightM / 111320
    const dLng = widthM / (111320 * Math.cos((lat * Math.PI) / 180))
    const ring: LatLng[] = [
      [lat, lng],
      [lat, lng + dLng],
      [lat + dLat, lng + dLng],
      [lat + dLat, lng],
    ]
    expect(ringAreaM2(ring)).toBeGreaterThan(700)
    const flat = placePanels({
      ring,
      lengthM: 2,
      widthM: 1,
      tiltDeg: 0,
      azimuthDeg: 180,
      gapM: 0,
      latitude: lat,
      pitch: 'gap',
    })
    const south = placePanels({
      ring,
      lengthM: 2,
      widthM: 1,
      tiltDeg: 15,
      azimuthDeg: 180,
      gapM: 0,
      latitude: lat,
      pitch: 'winter',
    })
    expect(flat.count).toBeGreaterThan(south.count)
    expect(south.count).toBeGreaterThan(0)
    expect(rowPitchM(2, 15, 25, 0, 'winter')).toBeGreaterThan(rowPitchM(2, 0, 25, 0, 'gap'))
    expect(winterNoonAltitudeDeg(25)).toBeCloseTo(41.55, 1)
  })
})

describe('feeders', () => {
  it('picks the nearest transformer and ignores anything past 3 km', () => {
    const points = [
      { region: 'guanyin', feeder: 'NEAR', lat: 25.001, lng: 121.001 },
      { region: 'guanyin', feeder: 'FAR', lat: 25.02, lng: 121.02 },
    ]
    const capacities = [
      { region: 'guanyin', feeder: 'NEAR', capacityKw: 120 },
      { region: 'guanyin', feeder: 'FAR', capacityKw: 5 },
    ]
    expect(nearestFeeder(25, 121, points, capacities)?.feeder).toBe('NEAR')
    expect(nearestFeeder(23, 120, points, capacities)).toBeNull()
  })
})
