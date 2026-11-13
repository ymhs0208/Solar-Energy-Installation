import { unzipSync } from 'fflate'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import proj4 from 'proj4'
import { elementsToBuildings } from './osm'
import { parseRocDate } from './dates'
import { parseRoofFitTable, FIT_115_URL, type FitBracket } from './fit'
import type { Building, Climate, FactoryRecord } from './types'
import type { FeederCapacity, FeederPoint } from './feeders'

GlobalWorkerOptions.workerSrc = workerUrl

proj4.defs(
  'EPSG:3828',
  '+proj=tmerc +lat_0=0 +lon_0=121 +k=0.9999 +x_0=250000 +y_0=0 +ellps=aust_SA +towgs84=-752,-358,-179,-0.0000011698,0.0000018398,0.0000009822,0.0000230919 +units=m +no_defs',
)

export class LiveError extends Error {}

export type FetchStamp = { fetchedAt: string; modified: string | null; url: string }

const FACTORY_URL =
  'https://serv.gcis.nat.gov.tw/RDownLoad/Data/statistical/%E7%94%9F%E7%94%A2%E4%B8%AD%E5%B7%A5%E5%BB%A0%E6%B8%85%E5%86%8A.zip'
const TARIFF_URL = 'https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json'
const FEEDER_URL = {
  taoyuan: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAOYUAN.zip',
  taichung: 'https://service.taipower.com.tw/data/opendata/apply/file/d077009/TAICHUNG.zip',
} as const

async function proxied(path: string): Promise<{ bytes: Uint8Array; stamp: FetchStamp; textType: boolean }> {
  const response = await fetch(path)
  const modified = response.headers.get('x-upstream-modified')
  const url = response.headers.get('x-upstream-url') ?? path
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new LiveError(detail || `${response.status} ${response.statusText}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const type = response.headers.get('content-type') ?? ''
  return {
    bytes,
    textType: type.includes('json') || type.includes('xml') || type.includes('text') || type.includes('csv'),
    stamp: { fetchedAt: new Date().toISOString(), modified, url },
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else if (c !== '\r') cur += c
  }
  if (cur.length || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

function objects(text: string): Record<string, string>[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  const header = rows[0]?.map((cell) => cell.trim()) ?? []
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    header.forEach((key, index) => {
      record[key] = (cells[index] ?? '').trim()
    })
    return record
  })
}

function zipEntry(bytes: Uint8Array, nameIncludes: string): Uint8Array {
  const files = unzipSync(bytes)
  const names = Object.keys(files).filter(
    (name) => name.includes(nameIncludes) && !name.includes('schema-') && name !== 'manifest.csv',
  )
  names.sort((a, b) => (files[b]?.length ?? 0) - (files[a]?.length ?? 0))
  const file = names[0] ? files[names[0]] : undefined
  if (!file) throw new LiveError(`壓縮檔找不到 ${nameIncludes}`)
  return file
}

function unzipText(bytes: Uint8Array, nameIncludes: string): string {
  return new TextDecoder('utf-8').decode(zipEntry(bytes, nameIncludes))
}

export function factoryCounty(text: string): string {
  return text.trim().match(/^[\u4e00-\u9fff]{2}[縣市]/)?.[0]?.replace(/^台/, '臺') ?? ''
}

export function normalizeFactorySearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s/g, '').replace(/台/g, '臺')
}

export async function loadFactories(): Promise<{ rows: FactoryRecord[]; stamp: FetchStamp }> {
  const { bytes, stamp } = await proxied('/live/factories')
  const text = unzipText(bytes, '.csv')
  const rows: FactoryRecord[] = []
  for (const row of objects(text)) {
    const id = row['工廠登記編號']
    if (!id) continue
    const name = row['工廠名稱'] ?? ''
    const address = row['工廠地址'] ?? ''
    rows.push({
      id,
      name,
      address,
      county: factoryCounty(row['工廠市鎮鄉村里'] ?? '') || factoryCounty(address),
      registered: parseRocDate(row['工廠登記核准日期']),
      searchText: normalizeFactorySearch(`${name} ${address} ${id}`),
    })
  }
  if (rows.length === 0) throw new LiveError('清冊未讀到有效的工廠登記資料')
  return { rows, stamp: { ...stamp, url: FACTORY_URL } }
}

export async function loadTariff(): Promise<{ data: Record<string, unknown>; meta: Record<string, unknown>; stamp: FetchStamp }> {
  const { bytes, stamp } = await proxied('/live/tariff')
  const json = JSON.parse(new TextDecoder().decode(bytes)) as { metadata?: Record<string, unknown>; data?: Record<string, unknown> }
  if (!json.data) throw new LiveError('電價表 JSON 沒有 data')
  return { data: json.data, meta: json.metadata ?? {}, stamp: { ...stamp, url: TARIFF_URL } }
}

export async function loadFeeders(): Promise<{ points: FeederPoint[]; capacities: FeederCapacity[]; stamp: FetchStamp }> {
  const points: FeederPoint[] = []
  const capacities: FeederCapacity[] = []
  const stamps: FetchStamp[] = []
  for (const [city, region] of [
    ['taoyuan', 'guanyin'],
    ['taichung', 'dali'],
  ] as const) {
    const { bytes, stamp } = await proxied(`/live/feeder?city=${city}`)
    stamps.push(stamp)
    const capacityText = unzipText(bytes, 'capacity')
    for (const row of objects(capacityText)) {
      const capacityKw = Number(row.CAPACITY)
      if (!row.FEEDER || Number.isNaN(capacityKw)) continue
      capacities.push({ region, feeder: row.FEEDER, capacityKw })
    }
    for (const row of objects(new TextDecoder().decode(zipEntry(bytes, 'tr_feeder')))) {
      const x = Number(row.X)
      const y = Number(row.Y)
      if (!row.FEEDER || Number.isNaN(x) || Number.isNaN(y)) continue
      const [lng, lat] = proj4('EPSG:3828', 'EPSG:4326', [x, y])
      if (lat < 21 || lat > 26 || lng < 119 || lng > 123) continue
      points.push({ region, feeder: row.FEEDER, lat, lng })
    }
  }
  if (points.length === 0) throw new LiveError('變壓器座標是空的')
  return {
    points,
    capacities,
    stamp: { fetchedAt: new Date().toISOString(), modified: stamps.map((item) => item.modified).filter(Boolean).join(' / ') || null, url: `${FEEDER_URL.taoyuan}、${FEEDER_URL.taichung}` },
  }
}

export async function loadFit(): Promise<{ rows: FitBracket[]; stamp: FetchStamp }> {
  const { bytes, stamp } = await proxied('/live/fit')
  const pdf = await getDocument({ data: bytes }).promise
  let text = ''
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
    text += '\n'
  }
  return { rows: parseRoofFitTable(text), stamp: { ...stamp, url: FIT_115_URL } }
}

export async function geocodeNlsc(query: string): Promise<{ lat: number; lng: number; label: string; fetchedAt: string }> {
  const { bytes } = await proxied(`/live/nlsc?q=${encodeURIComponent(query)}`)
  const xml = new TextDecoder().decode(bytes)
  const label = xml.match(/<CONTENT>([^<]*)<\/CONTENT>/)?.[1]?.trim() ?? query
  const location = xml.match(/<LOCATION>\s*([0-9.]+)\s*,\s*([0-9.]+)\s*<\/LOCATION>/)
  if (!location?.[1] || !location[2]) throw new LiveError('國土測繪中心沒有這筆門牌座標')
  return { lng: Number(location[1]), lat: Number(location[2]), label, fetchedAt: new Date().toISOString() }
}

export async function fetchNasa(lat: number, lng: number): Promise<Climate> {
  const url = new URL('https://power.larc.nasa.gov/api/temporal/climatology/point')
  url.searchParams.set('parameters', 'ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M')
  url.searchParams.set('community', 'RE')
  url.searchParams.set('longitude', lng.toFixed(4))
  url.searchParams.set('latitude', lat.toFixed(4))
  url.searchParams.set('format', 'JSON')
  const response = await fetch(url.toString())
  if (!response.ok) throw new LiveError(`NASA POWER ${response.status}`)
  const json = (await response.json()) as {
    properties?: { parameter?: Record<string, Record<string, number>> }
    header?: { range?: string; sources?: string[] }
  }
  const parameter = json.properties?.parameter
  if (!parameter?.ALLSKY_SFC_SW_DWN || !parameter.ALLSKY_SFC_SW_DIFF || !parameter.T2M) {
    throw new LiveError('NASA POWER 回傳缺少射量或氣溫')
  }
  const keys = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const series = (row: Record<string, number>) => keys.map((key) => Number(row[key]))
  const ghiDaily = series(parameter.ALLSKY_SFC_SW_DWN)
  if (ghiDaily.some((value) => !(value > 0))) throw new LiveError('NASA POWER 月射量無效')
  return {
    ghiDaily,
    dhiDaily: series(parameter.ALLSKY_SFC_SW_DIFF),
    tAmb: series(parameter.T2M),
    live: true,
    range: json.header?.range ?? '',
    sources: json.header?.sources ?? [],
  }
}

export async function fetchBuildings(lat: number, lng: number): Promise<Building[]> {
  const dLat = 220 / 111320
  const dLng = 220 / (111320 * Math.cos((lat * Math.PI) / 180))
  const query = `[out:json][timeout:20];way["building"](${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng});out geom;`
  const response = await fetch('/live/overpass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!response.ok) throw new LiveError(`OpenStreetMap Overpass ${response.status}`)
  const json = (await response.json()) as { elements?: Parameters<typeof elementsToBuildings>[0] }
  return elementsToBuildings(json.elements ?? [])
}
