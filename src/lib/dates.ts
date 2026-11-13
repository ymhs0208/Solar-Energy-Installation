/** Republic of China dates in the factory registry look like 1100916 or 870512. */
export function parseRocDate(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim()
  if (!/^\d{6,7}$/.test(text)) return null
  const year = text.length === 7 ? Number(text.slice(0, 3)) : Number(text.slice(0, 2))
  const month = text.length === 7 ? Number(text.slice(3, 5)) : Number(text.slice(2, 4))
  const day = text.length === 7 ? Number(text.slice(5, 7)) : Number(text.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year + 1911}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Completed years between an ISO date and an as-of date. */
export function ageYears(iso: string | null, asOf = '2026-11-13'): number | null {
  if (!iso) return null
  const [year, month, day] = iso.split('-').map(Number)
  const [asYear, asMonth, asDay] = asOf.split('-').map(Number)
  if (!year || !month || !day || !asYear || !asMonth || !asDay) return null
  let age = asYear - year
  if (asMonth < month || (asMonth === month && asDay < day)) age -= 1
  if (age < 0 || age > 200) return null
  return age
}
