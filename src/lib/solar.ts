import { getPosition } from 'suncalc'
import { MONTH_DAYS } from './calendar'

export { MONTH_DAYS } from './calendar'

export type Climate = {
  /** NASA ALLSKY_SFC_SW_DWN, kWh/m²/day, January–December. */
  ghiDaily: number[]
  /** NASA ALLSKY_SFC_SW_DIFF, kWh/m²/day. */
  dhiDaily: number[]
  /** NASA T2M, °C. */
  tAmb: number[]
}

export type Surface = {
  tiltDeg: number
  /** Clockwise from north. 180 faces south. Several values are averaged. */
  azimuthsDeg: number[]
}

export type ShadeQuery = { altitudeDeg: number; azimuthDeg: number }

export type GenerationOptions = {
  year?: number
  /** Ground reflectance. Null skips the ground-reflected term. */
  albedo: number | null
  /** Module power temperature coefficient, 1/°C, typically negative. */
  gammaPerC: number | null
  /** Nominal operating cell temperature, °C. */
  noctC: number | null
  /** Extra fraction removed after irradiance, shading and temperature. Null skips it. */
  systemLoss: number | null
  shadeFraction?: (sun: ShadeQuery) => number
}

export type MonthGeneration = {
  month: number
  ghiKwhPerM2: number
  poaKwhPerM2: number
  shadedPoaKwhPerM2: number
  tempFactor: number | null
  hourly: { hour: number; poaKwhPerM2: number; shadedPoaKwhPerM2: number }[]
}

export type Generation = {
  months: MonthGeneration[]
  annualKwh: number
  monthlyKwh: number[]
  annualGhiKwhPerM2: number
  annualPoaKwhPerM2: number
  /** 1 − shaded/unshaded. Null when no shade function was supplied. */
  shadingFraction: number | null
  temperatureApplied: boolean
  systemLossApplied: boolean
  albedoApplied: boolean
  specificYieldKwhPerKwp: number | null
}

/** 2026 is not a leap year; the hourly shape uses the 15th, then scales to the NASA daily total. */
export function taipeiWallTime(year: number, monthIndex: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour - 8, 0, 0))
}

export function sunAt(lat: number, lng: number, isoDate: string, hour: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return null
  return getPosition(taipeiWallTime(year, month - 1, day, hour), lat, lng)
}

export function incidenceCos(
  altitudeDeg: number,
  sunAzimuthDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
): number {
  const altitude = (altitudeDeg * Math.PI) / 180
  const tilt = (tiltDeg * Math.PI) / 180
  const delta = ((sunAzimuthDeg - surfaceAzimuthDeg) * Math.PI) / 180
  return Math.sin(altitude) * Math.cos(tilt) + Math.cos(altitude) * Math.sin(tilt) * Math.cos(delta)
}

function planeIrradiance(
  altitudeDeg: number,
  sunAzimuthDeg: number,
  ghi: number,
  dhi: number,
  surface: Surface,
  albedo: number | null,
): number {
  const beam = Math.max(0, ghi - dhi)
  const tilt = (surface.tiltDeg * Math.PI) / 180
  const sinAlt = Math.sin((altitudeDeg * Math.PI) / 180)
  let sum = 0
  const count = Math.max(1, surface.azimuthsDeg.length)
  for (const azimuth of surface.azimuthsDeg) {
    const cosInc = incidenceCos(altitudeDeg, sunAzimuthDeg, surface.tiltDeg, azimuth)
    let beamTilt = 0
    if (cosInc > 0 && sinAlt > 1e-3) beamTilt = beam * Math.min(cosInc / sinAlt, 5)
    const diffuseTilt = dhi * (1 + Math.cos(tilt)) / 2
    const groundTilt = albedo == null ? 0 : ghi * albedo * (1 - Math.cos(tilt)) / 2
    sum += Math.max(0, beamTilt + diffuseTilt + groundTilt)
  }
  return sum / count
}

export function monthlyGeneration(
  lat: number,
  lng: number,
  climate: Climate,
  surface: Surface,
  moduleAreaM2: number,
  efficiency: number,
  options: GenerationOptions,
): Generation {
  const year = options.year ?? 2026
  const temperatureApplied = options.gammaPerC != null && options.noctC != null
  const systemLossApplied = options.systemLoss != null
  const albedoApplied = options.albedo != null
  const shadingApplied = typeof options.shadeFraction === 'function'
  const loss = systemLossApplied ? Math.min(0.95, Math.max(0, options.systemLoss ?? 0)) : 0
  const months: MonthGeneration[] = []

  for (let month = 0; month < 12; month++) {
    const ghiDaily = climate.ghiDaily[month] ?? 0
    const dhiDaily = climate.dhiDaily[month] ?? 0
    const tAmb = climate.tAmb[month] ?? 0
    const days = MONTH_DAYS[month] ?? 30
    const kd = ghiDaily > 0 ? Math.min(1, Math.max(0, dhiDaily / ghiDaily)) : 0
    const samples: { hour: number; altitude: number; azimuth: number; rel: number }[] = []
    let shape = 0
    for (let hour = 0; hour < 24; hour++) {
      const position = getPosition(taipeiWallTime(year, month, 15, hour), lat, lng)
      const rel = position.altitude > 0 ? Math.sin((position.altitude * Math.PI) / 180) : 0
      samples.push({ hour, altitude: position.altitude, azimuth: position.azimuth, rel })
      shape += rel
    }
    const hourly: MonthGeneration['hourly'] = []
    let poaDay = 0
    let shadedDay = 0
    let tempWeight = 0
    let tempSum = 0
    const scale = shape > 0 ? ghiDaily / shape : 0
    for (const sample of samples) {
      if (sample.rel <= 0 || scale <= 0) continue
      const ghi = sample.rel * scale
      const dhi = kd * ghi
      const poa = planeIrradiance(sample.altitude, sample.azimuth, ghi, dhi, surface, options.albedo)
      const shade = shadingApplied
        ? Math.min(1, Math.max(0, options.shadeFraction?.({ altitudeDeg: sample.altitude, azimuthDeg: sample.azimuth }) ?? 0))
        : 0
      const shaded = poa * (1 - shade)
      hourly.push({ hour: sample.hour, poaKwhPerM2: poa, shadedPoaKwhPerM2: shaded })
      poaDay += poa
      shadedDay += shaded
      if (temperatureApplied && shaded > 0 && options.noctC != null && options.gammaPerC != null) {
        const irradiance = shaded * 1000
        const cell = tAmb + ((options.noctC - 20) * irradiance) / 800
        const factor = 1 + options.gammaPerC * (cell - 25)
        tempWeight += shaded
        tempSum += factor * shaded
      }
    }
    months.push({
      month,
      ghiKwhPerM2: ghiDaily * days,
      poaKwhPerM2: poaDay * days,
      shadedPoaKwhPerM2: shadedDay * days,
      tempFactor: temperatureApplied && tempWeight > 0 ? tempSum / tempWeight : null,
      hourly,
    })
  }

  const monthlyKwh = months.map((month) => {
    const temp = temperatureApplied && month.tempFactor != null ? month.tempFactor : 1
    return month.shadedPoaKwhPerM2 * moduleAreaM2 * efficiency * temp * (1 - loss)
  })
  const annualKwh = monthlyKwh.reduce((sum, value) => sum + value, 0)
  const annualPoa = months.reduce((sum, month) => sum + month.poaKwhPerM2, 0)
  const annualShaded = months.reduce((sum, month) => sum + month.shadedPoaKwhPerM2, 0)
  const kwp = moduleAreaM2 * efficiency
  return {
    months,
    annualKwh,
    monthlyKwh,
    annualGhiKwhPerM2: months.reduce((sum, month) => sum + month.ghiKwhPerM2, 0),
    annualPoaKwhPerM2: annualPoa,
    shadingFraction: shadingApplied && annualPoa > 0 ? 1 - annualShaded / annualPoa : null,
    temperatureApplied,
    systemLossApplied,
    albedoApplied,
    specificYieldKwhPerKwp: kwp > 0 ? annualKwh / kwp : null,
  }
}
