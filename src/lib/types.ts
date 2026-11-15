export type FactoryRecord = {
  id: string
  name: string
  address: string
  county: string
  registered: string | null
  searchText: string
}

export type Climate = {
  ghiDaily: number[]
  dhiDaily: number[]
  tAmb: number[]
  live: boolean
  range: string
  sources: string[]
}

export type Building = {
  id: string
  name?: string
  ring: [number, number][]
  heightM: number | null
  levels: number | null
}

export type Roof = {
  id: string
  source: 'draw' | 'osm'
  osmId?: string
  ring: [number, number][]
  heightM: number | null
}

export type GateStatus = 'pass' | 'warn' | 'fail' | 'insufficient'

export type Lead = {
  id: string
  createdAt: string
  name: string
  address: string
  district: string
  areaM2: number
  kwp: number | null
  annualKwh: number | null
  gates: { grid: GateStatus; legal: GateStatus; structural: GateStatus }
  qualified: boolean
  conditional: boolean
  priceTwd: number | null
  feeder: string | null
  capacityKw: number | null
}
