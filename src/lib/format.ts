export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function formatM2(value: number): string {
  return `${formatNumber(value, 0)} 平方公尺`
}

export function formatKwp(value: number): string {
  return `${formatNumber(value, 1)} kWp`
}

export function formatKwh(value: number): string {
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, 1)} 萬度`
  return `${formatNumber(value, 0)} 度`
}

export function formatTwd(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 100_000_000) return `${sign}${formatNumber(abs / 100_000_000, 2)} 億元`
  if (abs >= 10_000) return `${sign}${formatNumber(abs / 10_000, 1)} 萬元`
  return `${sign}${formatNumber(abs, 0)} 元`
}

export function formatYears(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '無法估算'
  if (value > 40) return '超過 40 年'
  return `${formatNumber(value, 1)} 年`
}

export function formatPercent(fraction: number): string {
  return `${formatNumber(fraction * 100, 1)}%`
}
