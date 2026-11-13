import { MONTH_DAYS } from './calendar'
import { ageYears } from './dates'
import { lookupFit, type FitBracket } from './fit'
import {
  fullSaleRevenue,
  paybackYears,
  rentIncome,
  selfUseBenefit,
  summerFraction,
  weightedEnergyRate,
  type HourWeight,
  type TouSchedule,
} from './finance'
import { gridGate, legalGate, qualification, structuralGate } from './gates'
import { LAYOUT_PRESETS, placePanels, type LayoutId } from './layout'
import { ringAreaM2 } from './geo'
import { shadeLookup } from './shading'
import { monthlyGeneration, type Climate as SolarClimate, type Surface } from './solar'
import type { Building, Roof } from './types'

export type LayoutResult = {
  id: LayoutId
  name: string
  tiltDeg: number
  count: number
  moduleAreaM2: number
  kwp: number | null
  efficiency: number | null
  annualKwh: number | null
  monthlyKwh: number[] | null
  specificYield: number | null
  shadingFraction: number | null
  temperatureApplied: boolean
  systemLossApplied: boolean
  albedoApplied: boolean
  capexTwd: number | null
  fitRate: number | null
  fitLabel: string | null
  fullSaleTwd: number | null
  fullPayback: number | null
  retailRate: number | null
  selfUseTwd: number | null
  selfPayback: number | null
  rentTwd: number | null
  panels: [number, number][][]
  truncated: boolean
}

export type Analysis = {
  areaM2: number
  ageYears: number | null
  gates: ReturnType<typeof gridGate>[]
  structural: ReturnType<typeof structuralGate>
  qualification: ReturnType<typeof qualification>
  layouts: LayoutResult[]
  missing: string[]
}

function efficiencyOf(watt: number | null, lengthM: number | null, widthM: number | null): number | null {
  if (watt == null || lengthM == null || widthM == null) return null
  const area = lengthM * widthM
  if (!(watt > 0) || !(area > 0)) return null
  return watt / (1000 * area)
}

export function analyze(input: {
  lat: number
  lng: number
  climate: SolarClimate | null
  feeder: { feeder: string; distanceM: number; capacityKw: number | null } | null
  roofs: Roof[]
  buildings: Building[]
  heightOverrides: Record<string, number>
  established: string | null
  registeredAreaM2: number | null
  roofType: 'metal' | 'rc' | null
  leakOrRust: boolean
  seismicRetrofit: boolean
  rooftopAddOn: boolean
  moduleWatt: number | null
  moduleLengthM: number | null
  moduleWidthM: number | null
  systemLoss: number | null
  gammaPerC: number | null
  noctC: number | null
  albedo: number | null
  capexPerKwp: number | null
  selfUseRatio: number | null
  rentPerKwpYear: number | null
  gapM: number
  tilts: Record<LayoutId, number>
  tariffMode: 'none' | 'tou' | 'flat'
  tou: TouSchedule | null
  flatRetail: { summer: number; winter: number } | null
  fitRows: FitBracket[] | null
  layoutId: 'south' | 'ew' | 'flat'
  shadeNow: { altitudeDeg: number; azimuthDeg: number } | null
}): Analysis & { shadeNow: number | null } {
  const areaM2 = input.roofs.reduce((sum, roof) => sum + ringAreaM2(roof.ring), 0)
  const age = ageYears(input.established)
  const efficiency = efficiencyOf(input.moduleWatt, input.moduleLengthM, input.moduleWidthM)
  const roofsForShade = input.roofs.map((roof) => ({
    ring: roof.ring,
    heightM: roof.heightM,
    areaM2: ringAreaM2(roof.ring),
  }))
  const selectedOsm = new Set(input.roofs.map((roof) => roof.osmId).filter(Boolean))
  const obstacles = input.buildings
    .filter((building) => !selectedOsm.has(building.id))
    .map((building) => ({
      id: building.id,
      ring: building.ring,
      heightM: input.heightOverrides[building.id] ?? building.heightM,
    }))
  const canShade = roofsForShade.some((roof) => roof.heightM != null)
  const shade = canShade ? shadeLookup(roofsForShade, obstacles) : undefined
  const shadeNow =
    input.shadeNow && shade ? shade(input.shadeNow) : input.shadeNow && !canShade ? null : null

  const layouts: LayoutResult[] = LAYOUT_PRESETS.map((preset) => {
    const tiltDeg = input.tilts[preset.id]
    const placed = input.roofs.map((roof) =>
      placePanels({
        ring: roof.ring,
        lengthM: input.moduleLengthM ?? 0,
        widthM: input.moduleWidthM ?? 0,
        tiltDeg,
        azimuthDeg: preset.azimuthsDeg[0] ?? 180,
        gapM: input.gapM,
        latitude: input.lat,
        pitch: preset.pitch,
      }),
    )
    const count = placed.reduce((sum, item) => sum + item.count, 0)
    const moduleAreaM2 = input.moduleLengthM && input.moduleWidthM ? count * input.moduleLengthM * input.moduleWidthM : 0
    const kwp = input.moduleWatt != null && count > 0 ? (count * input.moduleWatt) / 1000 : null
    const surface: Surface = { tiltDeg, azimuthsDeg: [...preset.azimuthsDeg] }
    let generation = null
    if (input.climate && efficiency != null && moduleAreaM2 > 0) {
      generation = monthlyGeneration(input.lat, input.lng, input.climate, surface, moduleAreaM2, efficiency, {
        albedo: input.albedo,
        gammaPerC: input.gammaPerC,
        noctC: input.noctC,
        systemLoss: input.systemLoss,
        shadeFraction: shade,
      })
    }
    const fit = kwp != null && input.fitRows ? lookupFit(kwp, input.fitRows) : null
    const fullSaleTwd = generation && fit ? fullSaleRevenue(generation.annualKwh, fit.rate) : null
    const capexTwd = kwp != null && input.capexPerKwp != null ? kwp * input.capexPerKwp : null
    let retailRate: number | null = null
    if (generation && input.tariffMode === 'flat' && input.flatRetail) {
      const weights = generation.months.map((month) => ({
        kwh: month.shadedPoaKwhPerM2 * (MONTH_DAYS[month.month] ?? 30),
        price: summerFraction(month.month) * input.flatRetail!.summer + (1 - summerFraction(month.month)) * input.flatRetail!.winter,
      }))
      const weight = weights.reduce((sum, item) => sum + item.kwh, 0)
      retailRate = weight > 0 ? weights.reduce((sum, item) => sum + item.kwh * item.price, 0) / weight : null
    }
    if (generation && input.tariffMode === 'tou' && input.tou) {
      const hours: HourWeight[] = generation.months.flatMap((month) =>
        month.hourly.map((hour) => ({
          month: month.month,
          hour: hour.hour,
          kwh: hour.shadedPoaKwhPerM2 * (MONTH_DAYS[month.month] ?? 30),
        })),
      )
      retailRate = weightedEnergyRate(hours, input.tou)
    }
    const selfUseTwd =
      generation && fit && retailRate != null && input.selfUseRatio != null
        ? selfUseBenefit(generation.annualKwh, input.selfUseRatio, retailRate, fit.rate)
        : null
    return {
      id: preset.id,
      name: preset.name,
      tiltDeg,
      count,
      moduleAreaM2,
      kwp,
      efficiency,
      annualKwh: generation?.annualKwh ?? null,
      monthlyKwh: generation?.monthlyKwh ?? null,
      specificYield: generation?.specificYieldKwhPerKwp ?? null,
      shadingFraction: generation?.shadingFraction ?? null,
      temperatureApplied: generation?.temperatureApplied ?? false,
      systemLossApplied: generation?.systemLossApplied ?? false,
      albedoApplied: generation?.albedoApplied ?? false,
      capexTwd,
      fitRate: fit?.rate ?? null,
      fitLabel: fit?.label ?? null,
      fullSaleTwd,
      fullPayback: capexTwd != null && fullSaleTwd != null ? paybackYears(capexTwd, fullSaleTwd) : null,
      retailRate,
      selfUseTwd,
      selfPayback: capexTwd != null && selfUseTwd != null ? paybackYears(capexTwd, selfUseTwd) : null,
      rentTwd: kwp != null && input.rentPerKwpYear != null ? rentIncome(kwp, input.rentPerKwpYear) : null,
      panels: placed.flatMap((item) => item.panels),
      truncated: placed.some((item) => item.truncated),
    }
  })

  const chosen = layouts.find((item) => item.id === input.layoutId) ?? layouts[0]
  const grid = gridGate({
    capacityKw: input.feeder?.capacityKw ?? null,
    distanceM: input.feeder?.distanceM ?? null,
    feeder: input.feeder?.feeder ?? null,
    kwp: chosen?.kwp ?? null,
  })
  const legal = legalGate(areaM2, input.registeredAreaM2)
  const structural = structuralGate({
    ageYears: age,
    roofType: input.roofType,
    leakOrRust: input.leakOrRust,
    seismicRetrofit: input.seismicRetrofit,
    rooftopAddOn: input.rooftopAddOn,
  })
  const gates = [grid, legal, structural]
  const missing: string[] = []
  if (!input.fitRows) missing.push('115 年度屋頂型躉購費率')
  if (!input.climate) missing.push('NASA POWER 月射量與氣溫')
  if (input.moduleWatt == null || input.moduleLengthM == null || input.moduleWidthM == null) missing.push('模組功率與長寬')
  if (input.registeredAreaM2 == null) missing.push('登記廠房面積')
  if (input.roofType == null) missing.push('屋面種類')
  if (!input.feeder) missing.push('3 公里內的台電饋線容量')
  if (input.capexPerKwp == null) missing.push('每瓩建置成本')
  if (input.selfUseRatio == null || input.tariffMode === 'none') missing.push('自用比例或電價種類')
  if (input.rentPerKwpYear == null) missing.push('屋頂租金')
  if (!canShade) missing.push('屋頂高度（遮蔽百分比）')
  return {
    areaM2,
    ageYears: age,
    gates,
    structural,
    qualification: qualification(gates),
    layouts,
    missing,
    shadeNow: shadeNow ?? null,
  }
}
