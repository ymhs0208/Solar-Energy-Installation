export type District = 'guanyin' | 'dali'

export type FactoryRecord = {
  id: string
  name: string
  address: string
  village: string
  district: District
  org: string
  establishedRaw: string
  established: string | null
  registeredRaw: string
  registered: string | null
  industry: string
  products: string
  lat: number | null
  lng: number | null
  geocodeLabel: string | null
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
