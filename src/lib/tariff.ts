import { parseWindows, type DaySchedule, type TouSchedule } from './finance'

type Node = Record<string, unknown>

function asNode(value: unknown): Node | null {
  return value && typeof value === 'object' ? (value as Node) : null
}

function windowsFromDay(day: Node | null, season: string): DaySchedule {
  if (!day) return []
  const windows: DaySchedule = []
  for (const period of Object.values(day)) {
    const row = asNode(asNode(period)?.[season])
    const spec = row?.['時段']
    const price = row?.['單價']
    if (typeof spec !== 'string' || typeof price !== 'number') continue
    windows.push(...parseWindows(spec === '全日' ? '00:00~24:00' : spec, price))
  }
  return windows
}

export function highVoltageThreePart(data: Node): TouSchedule | null {
  const root = asNode(data['高壓三段式時間電價(尖峰時間固定)'])
  const energy = asNode(root?.['流動電費'])
  if (!energy) return null
  const weekday = asNode(energy['週一至週五'])
  const saturday = asNode(energy['週六'])
  const sunday = asNode(energy['週日及離峰日'])
  const schedule: TouSchedule = {
    summer: {
      weekday: windowsFromDay(weekday, '夏月'),
      saturday: windowsFromDay(saturday, '夏月'),
      sunday: windowsFromDay(sunday, '夏月'),
    },
    winter: {
      weekday: windowsFromDay(weekday, '非夏月'),
      saturday: windowsFromDay(saturday, '非夏月'),
      sunday: windowsFromDay(sunday, '非夏月'),
    },
  }
  if (schedule.summer.weekday.length === 0) return null
  return schedule
}

export function lowVoltageEnergy(data: Node): { summer: number; winter: number } | null {
  const root = asNode(data['低壓電力非時間電價'])
  const energy = asNode(root?.['流動電費'])
  const summer = asNode(energy?.['夏月'])?.['單價']
  const winter = asNode(energy?.['非夏月'])?.['單價']
  if (typeof summer !== 'number' || typeof winter !== 'number') return null
  return { summer, winter }
}

export const TARIFF_SOURCE = {
  name: '台灣電力公司各類電價表',
  url: 'https://data.gov.tw/dataset/17060',
  file: 'https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json',
} as const
