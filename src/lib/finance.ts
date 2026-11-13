export function paybackYears(capexTwd: number, annualBenefitTwd: number): number | null {
  if (!(capexTwd > 0) || !(annualBenefitTwd > 0)) return null
  return capexTwd / annualBenefitTwd
}

export function fullSaleRevenue(annualKwh: number, fitTwdPerKwh: number): number {
  return annualKwh * fitTwdPerKwh
}

export function selfUseBenefit(annualKwh: number, selfUseRatio: number, retailTwd: number, fitTwd: number): number {
  const ratio = Math.min(1, Math.max(0, selfUseRatio))
  return annualKwh * ratio * retailTwd + annualKwh * (1 - ratio) * fitTwd
}

export function rentIncome(kwp: number, twdPerKwpYear: number): number {
  return kwp * twdPerKwpYear
}

export type HourWeight = { month: number; hour: number; kwh: number }

export type DaySchedule = { startMin: number; endMin: number; price: number }[]

export type TouSchedule = {
  summer: { weekday: DaySchedule; saturday: DaySchedule; sunday: DaySchedule }
  winter: { weekday: DaySchedule; saturday: DaySchedule; sunday: DaySchedule }
}

const MINUTES = (hour: number) => hour * 60 + 30

function priceAt(minute: number, windows: DaySchedule): number | null {
  for (const window of windows) {
    if (minute >= window.startMin && minute < window.endMin) return window.price
  }
  return null
}

/** High-voltage summer is 16 May–15 October. */
export function summerFraction(monthIndex: number): number {
  if (monthIndex >= 5 && monthIndex <= 8) return 1
  if (monthIndex === 4) return 16 / 31
  if (monthIndex === 9) return 15 / 31
  return 0
}

/**
 * Generation-weighted energy charge.
 * Week mix is 5 weekdays, 1 Saturday and 1 Sunday. Public holidays are not applied;
 * Taipower's holiday calendar is a PDF and is not in the JSON tariff.
 */
export function weightedEnergyRate(hours: HourWeight[], schedule: TouSchedule): number | null {
  let weighted = 0
  let weight = 0
  for (const hour of hours) {
    if (!(hour.kwh > 0)) continue
    const minute = MINUTES(hour.hour)
    const summer = summerFraction(hour.month)
    const rateFor = (day: 'weekday' | 'saturday' | 'sunday', season: 'summer' | 'winter') =>
      priceAt(minute, schedule[season][day])
    const summerRate = (5 * (rateFor('weekday', 'summer') ?? 0) + (rateFor('saturday', 'summer') ?? 0) + (rateFor('sunday', 'summer') ?? 0)) / 7
    const winterRate = (5 * (rateFor('weekday', 'winter') ?? 0) + (rateFor('saturday', 'winter') ?? 0) + (rateFor('sunday', 'winter') ?? 0)) / 7
    const rate = summer * summerRate + (1 - summer) * winterRate
    weighted += rate * hour.kwh
    weight += hour.kwh
  }
  if (!(weight > 0)) return null
  return weighted / weight
}

export function parseWindows(spec: string, price: number): DaySchedule {
  return spec.split('/').flatMap((part) => {
    const match = part.trim().match(/^(\d{2}):(\d{2})~(\d{2}):(\d{2})$/)
    if (!match) return []
    const startMin = Number(match[1]) * 60 + Number(match[2])
    let endMin = Number(match[3]) * 60 + Number(match[4])
    if (endMin === 0) endMin = 24 * 60
    return [{ startMin, endMin, price }]
  })
}
