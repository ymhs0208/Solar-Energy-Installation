import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyze } from '../lib/analyze'
import type { RoofCondition } from '../lib/gates'
import { nearestFeeder, type FeederCapacity, type FeederPoint } from '../lib/feeders'
import { CAPEX_CITATION, FIT_115_CITATION, LOSS_REFERENCE } from '../lib/fit'
import { formatKwh, formatKwp, formatM2, formatPercent, formatTwd, formatYears } from '../lib/format'
import { isSimpleRing, pointInRing, ringAreaM2, toLocal } from '../lib/geo'
import { LAYOUT_PRESETS, type LayoutId } from '../lib/layout'
import { LiveError, factoryCounty, normalizeFactorySearch, fetchBuildings, fetchNasa, geocodeNlsc, loadFactories, loadFeeders, loadFit, loadTariff, type FetchStamp } from '../lib/remote'
import { groundShadowRing, shadeFractionAt } from '../lib/shading'
import { sunAt } from '../lib/solar'
import { highVoltageThreePart, lowVoltageEnergy, TARIFF_SOURCE } from '../lib/tariff'
import type { Building, FactoryRecord, Roof } from '../lib/types'
import type { FitBracket } from '../lib/fit'
import { Field, Missing, Problem, Source, StatusPill, control } from '../components/Bits'
import { MapView, tilesetFor } from '../components/MapView'
import { STRUCTURAL_CHECKLIST } from '../lib/gates'
import { useSession } from '../session'
import { InstallationGuide } from '../components/InstallationGuide'

type Load<T> = { status: 'loading' | 'ok' | 'error'; data: T | null; error: string; stamp: FetchStamp | null }

const steps = ['選擇廠址', '圈選屋頂', '檢查三關', '估算與報告']
const panel = 'rounded-xl border border-line bg-card p-4 sm:p-6'
const primary = 'rounded-md bg-pine px-4 py-2.5 text-sm font-bold text-white hover:bg-pine/90 disabled:opacity-50'
const secondary = 'rounded-md border border-line bg-white px-4 py-2.5 text-sm font-bold hover:bg-paper disabled:opacity-50'
const referenceModule = {
  name: 'LONGi LR5-72HPH-550M',
  watt: '550',
  length: '2.278',
  width: '1.134',
  gamma: -0.0034,
  noct: 45,
  source: 'https://static.longi.com/Hi_MO_5m_LR_5_72_HPH_540_560_M_35_35_and_15_G2_V16_b8597c604e.pdf',
}

function loading<T>(): Load<T> {
  return { status: 'loading', data: null, error: '', stamp: null }
}

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function asNumber(value: string): number | null {
  if (value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function ToolPage({ active }: { active: boolean }) {
  const session = useSession()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [factories, setFactories] = useState<Load<FactoryRecord[]>>(loading())
  const [feeders, setFeeders] = useState<Load<{ points: FeederPoint[]; capacities: FeederCapacity[] }>>(loading())
  const [tariff, setTariff] = useState<Load<{ data: Record<string, unknown>; meta: Record<string, unknown> }>>(loading())
  const [fit, setFit] = useState<Load<FitBracket[]>>(loading())
  const [query, setQuery] = useState('')
  const [county, setCounty] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [site, setSite] = useState<{ name: string; address: string; registrationDate: string | null; lat: number; lng: number; label: string; fetchedAt: string } | null>(null)
  const [geoError, setGeoError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [lastSearch, setLastSearch] = useState<{ address: string; name: string; registrationDate: string | null } | null>(null)
  const [climateError, setClimateError] = useState('')
  const [climate, setClimate] = useState<Awaited<ReturnType<typeof fetchNasa>> | null>(null)
  const [buildingError, setBuildingError] = useState('')
  const [buildings, setBuildings] = useState<Building[]>([])
  const [roofs, setRoofs] = useState<Roof[]>([])
  const [draft, setDraft] = useState<[number, number][]>([])
  const [drawing, setDrawing] = useState(false)
  const [drawingExclusion, setDrawingExclusion] = useState(false)
  const [exclusions, setExclusions] = useState<{ id: string; ring: [number, number][] }[]>([])
  const [expandedMap, setExpandedMap] = useState(false)
  const [focusedRoof, setFocusedRoof] = useState<{ id: string; request: number } | null>(null)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [previewingLayout, setPreviewingLayout] = useState(false)
  const [constructionPreview, setConstructionPreview] = useState(false)
  const [previewRoofHeight, setPreviewRoofHeight] = useState(8)
  const [mountingHeight, setMountingHeight] = useState(0.2)
  const [constructionStage, setConstructionStage] = useState<'roof' | 'frame' | 'complete'>('complete')
  const [showPanels, setShowPanels] = useState(true)
  const [showShadows, setShowShadows] = useState(true)
  const [basemap, setBasemap] = useState<'photo' | 'osm'>('photo')
  const [tileNote, setTileNote] = useState('')
  const [useOfficialTiles, setUseOfficialTiles] = useState(false)
  const [registered, setRegistered] = useState('')
  const [roofType, setRoofType] = useState<'' | 'metal' | 'rc'>('')
  const [completionYear, setCompletionYear] = useState('')
  const [leak, setLeak] = useState<RoofCondition>(null)
  const [retrofit, setRetrofit] = useState<RoofCondition>(null)
  const [addon, setAddon] = useState<RoofCondition>(null)
  const [moduleMode, setModuleMode] = useState('reference')
  const [heightOverrides, setHeightOverrides] = useState<Record<string, number>>({})
  const [moduleWatt, setModuleWatt] = useState('')
  const [moduleLength, setModuleLength] = useState('')
  const [moduleWidth, setModuleWidth] = useState('')
  const [systemLoss, setSystemLoss] = useState('')
  const [gamma, setGamma] = useState('')
  const [noct, setNoct] = useState('')
  const [albedo, setAlbedo] = useState('')
  const [capex, setCapex] = useState('')
  const [selfUse, setSelfUse] = useState('')
  const [rent, setRent] = useState('')
  const [gap, setGap] = useState('0')
  const [tilts, setTilts] = useState<Record<LayoutId, number>>({ south: 15, ew: 10, flat: 0 })
  const [layoutId, setLayoutId] = useState<LayoutId | 'auto'>('auto')
  const [tariffMode, setTariffMode] = useState<'none' | 'tou' | 'flat'>('none')
  const [sunDate, setSunDate] = useState(taipeiToday)
  const [sunHour, setSunHour] = useState(12)
  const [playingSun, setPlayingSun] = useState(false)
  const sunMinutes = Math.round(sunHour * 60)
  const sunClock = `${String(Math.floor(sunMinutes / 60)).padStart(2, '0')}:${String(sunMinutes % 60).padStart(2, '0')}`
  const [leadPrice, setLeadPrice] = useState('')
  const [leadNote, setLeadNote] = useState('')

  async function refreshFactories() {
    setFactories(loading())
    try {
      const result = await loadFactories()
      setFactories({ status: 'ok', data: result.rows, error: '', stamp: result.stamp })
    } catch (error) {
      setFactories({ status: 'error', data: null, error: error instanceof Error ? error.message : '工廠名錄失敗', stamp: null })
    }
  }
  async function refreshFeeders() {
    setFeeders(loading())
    try {
      const result = await loadFeeders()
      setFeeders({ status: 'ok', data: { points: result.points, capacities: result.capacities }, error: '', stamp: result.stamp })
    } catch (error) {
      setFeeders({ status: 'error', data: null, error: error instanceof Error ? error.message : '饋線資料失敗', stamp: null })
    }
  }
  async function refreshTariff() {
    setTariff(loading())
    try {
      const result = await loadTariff()
      setTariff({ status: 'ok', data: { data: result.data, meta: result.meta }, error: '', stamp: result.stamp })
    } catch (error) {
      setTariff({ status: 'error', data: null, error: error instanceof Error ? error.message : '電價表失敗', stamp: null })
    }
  }
  async function refreshFit() {
    setFit(loading())
    try {
      const result = await loadFit()
      setFit({ status: 'ok', data: result.rows, error: '', stamp: result.stamp })
    } catch (error) {
      setFit({ status: 'error', data: null, error: error instanceof Error ? error.message : '躉購費率失敗', stamp: null })
    }
  }

  useEffect(() => {
    void refreshFactories()
    void refreshFeeders()
    void refreshTariff()
    void refreshFit()
  }, [])

  async function locate(address: string, name: string, registrationDate: string | null) {
    setLastSearch({ address, name, registrationDate })
    setGeoError('')
    setGeoLoading(true)
    try {
      const hit = await geocodeNlsc(address)
      setClimate(null)
      setBuildings([])
      setRoofs([])
      setConstructionPreview(false)
      setExclusions([])
      setDrawingExclusion(false)
      setDraft([])
      setDrawing(false)
      setMode('2d')
      setShowPanels(true)
      setShowShadows(true)
      setTileNote('')
      setUseOfficialTiles(false)
      setRegistered('')
      setRoofType('')
      setCompletionYear('')
      setLeak(null)
      setRetrofit(null)
      setAddon(null)
      setHeightOverrides({})
      setLeadPrice('')
      setLeadNote('')
      setLayoutId('auto')
      setSite({ name, address, registrationDate, lat: hit.lat, lng: hit.lng, label: hit.label, fetchedAt: hit.fetchedAt })
      setQuery(address)
      goToStep(1)
    } catch (error) {
      setGeoError(error instanceof LiveError || error instanceof Error ? error.message : '定位失敗')
    } finally {
      setGeoLoading(false)
    }
  }

  function goToStep(next: number) {
    setPlayingSun(false)
    setPreviewingLayout(false)
    setStep(next)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    if (!playingSun || !active || step !== 1 || mode !== '3d') return
    const timer = window.setInterval(() => setSunHour((hour) => hour >= 19 ? 5 : hour + 0.25), 400)
    return () => window.clearInterval(timer)
  }, [playingSun, active, step, mode])

  function editModule() {
    goToStep(1)
    requestAnimationFrame(() => {
      const picker = document.getElementById('module-mode')
      picker?.focus()
      picker?.scrollIntoView({ block: 'center' })
    })
  }

  useEffect(() => {
    if (!site) return
    let cancel = false
    setClimateError('')
    void fetchNasa(site.lat, site.lng)
      .then((value) => {
        if (!cancel) setClimate(value)
      })
      .catch((error: unknown) => {
        if (!cancel) setClimateError(error instanceof Error ? error.message : '射量讀取失敗')
      })
    setBuildingError('')
    void fetchBuildings(site.lat, site.lng)
      .then((value) => {
        if (!cancel) setBuildings(value)
      })
      .catch((error: unknown) => {
        if (!cancel) setBuildingError(error instanceof Error ? error.message : '建物輪廓讀取失敗')
      })
    return () => {
      cancel = true
    }
  }, [site])

  const counties = useMemo(() => [...new Set(factories.data?.map((factory) => factory.county).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-TW')), [factories.data])
  const matches = useMemo(() => {
    const terms = deferredQuery.trim().split(/\s+/).map(normalizeFactorySearch).filter(Boolean)
    if (!factories.data || !terms.length) return []
    const found: FactoryRecord[] = []
    for (const factory of factories.data) {
      if ((!county || county === factory.county) && terms.every((term) => factory.searchText.includes(term))) {
        found.push(factory)
        if (found.length === 20) break
      }
    }
    return found
  }, [factories.data, deferredQuery, county])

  const siteCounty = site ? factoryCounty(site.label) || factoryCounty(site.address) : ''
  const candidateRoof = useMemo(() => {
    if (!site) return null
    const candidates = buildings.flatMap((building) => {
      if (building.ring.length < 3) return []
      const ring = building.ring.map(([lat, lng]) => toLocal(lat, lng, site.lat, site.lng))
      const contains = pointInRing(0, 0, ring)
      const distance = Math.min(...ring.map(({ x, y }, index) => {
        const next = ring[(index + 1) % ring.length]
        if (!next) return Infinity
        const dx = next.x - x
        const dy = next.y - y
        const length = dx * dx + dy * dy
        const along = length ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length)) : 0
        return Math.hypot(x + along * dx, y + along * dy)
      }))
      return contains || distance <= 30 ? [{ building, contains, distance, area: ringAreaM2(building.ring) }] : []
    })
    candidates.sort((a, b) => Number(b.contains) - Number(a.contains) || a.distance - b.distance || b.area - a.area)
    return candidates[0] ?? null
  }, [site, buildings])
  const feederCovered = siteCounty === '桃園市' || siteCounty === '臺中市'
  const feeder = site && feeders.data && feederCovered ? nearestFeeder(site.lat, site.lng, feeders.data.points, feeders.data.capacities) : null
  const tou = tariff.data ? highVoltageThreePart(tariff.data.data) : null
  const flat = tariff.data ? lowVoltageEnergy(tariff.data.data) : null
  const sun = site ? sunAt(site.lat, site.lng, sunDate, sunHour) : null
  const area = roofs.reduce((sum, roof) => sum + ringAreaM2(roof.ring), 0)

  const obstacles = useMemo(() => buildings.map((building) => ({
    ...building,
    heightM: heightOverrides[building.id] ?? building.heightM,
  })), [buildings, heightOverrides])
  const tileSet = site ? tilesetFor(site.lat, site.lng) : null
  const shadeNow = useMemo(() => {
    if (!sun || sun.altitude <= 2 || roofs.length === 0) return null
    let weighted = 0
    let weight = 0
    for (const roof of roofs) {
      const sample = shadeFractionAt(roof.ring, roof.heightM, obstacles.filter((building) => building.id !== roof.osmId), sun.altitude, sun.azimuth)
      if (!sample || !sample.samples) continue
      const roofArea = ringAreaM2(roof.ring)
      weighted += sample.fraction * roofArea
      weight += roofArea
    }
    return weight > 0 ? weighted / weight : null
  }, [sun, roofs, obstacles])

  const shadows = useMemo(() => {
    if (!sun || sun.altitude <= 3) return []
    const rings = [
      ...buildings.map((building) => groundShadowRing(building.ring, heightOverrides[building.id] ?? building.heightM ?? 0, sun.altitude, sun.azimuth)),
      ...roofs.map((roof) => groundShadowRing(roof.ring, roof.heightM ?? 0, sun.altitude, sun.azimuth)),
    ]
    return rings.filter((ring): ring is [number, number][] => ring != null)
  }, [sun, buildings, roofs, heightOverrides])

  const moduleSpec = useMemo(() => {
    if (moduleMode === 'reference') return { watt: Number(referenceModule.watt), length: Number(referenceModule.length), width: Number(referenceModule.width) }
    if (moduleMode === 'manual') return { watt: asNumber(moduleWatt), length: asNumber(moduleLength), width: asNumber(moduleWidth) }
    return { watt: null, length: null, width: null }
  }, [moduleMode, moduleWatt, moduleLength, moduleWidth])
  const hasModule = [moduleSpec.watt, moduleSpec.length, moduleSpec.width].every((value) => value != null && value > 0)
  const gammaValue = asNumber(gamma) ?? (moduleMode === 'reference' ? referenceModule.gamma : null)
  const noctValue = asNumber(noct) ?? (moduleMode === 'reference' ? referenceModule.noct : null)

  const customLoss = asNumber(systemLoss)
  const customCost = asNumber(capex)
  const lossValue = customLoss != null && customLoss >= 0 && customLoss <= 0.95 ? customLoss : LOSS_REFERENCE.rate
  const costValue = customCost != null && customCost > 0 ? customCost : CAPEX_CITATION.rate

  const result = useMemo(() => {
    if (!site) return null
    return analyze({
      lat: site.lat,
      lng: site.lng,
      climate,
      feeder,
      roofs,
      exclusions: exclusions.map((zone) => zone.ring),
      buildings,
      heightOverrides,
      completionYear: asNumber(completionYear),
      registeredAreaM2: asNumber(registered),
      roofType: roofType || null,
      leakOrRust: leak,
      seismicRetrofit: retrofit,
      rooftopAddOn: addon,
      moduleWatt: moduleSpec.watt,
      moduleLengthM: moduleSpec.length,
      moduleWidthM: moduleSpec.width,
      systemLoss: lossValue,
      gammaPerC: gammaValue,
      noctC: noctValue,
      albedo: asNumber(albedo),
      capexPerKwp: costValue,
      selfUseRatio: asNumber(selfUse),
      rentPerKwpYear: asNumber(rent),
      gapM: asNumber(gap) ?? 0,
      tilts,
      tariffMode,
      tou,
      flatRetail: flat,
      fitRows: fit.data,
      layoutId,
      shadeNow: null,
    })
  }, [site, climate, feeder, roofs, exclusions, buildings, heightOverrides, registered, completionYear, roofType, leak, retrofit, addon, moduleSpec, lossValue, gammaValue, noctValue, albedo, costValue, selfUse, rent, gap, tilts, tariffMode, tou, flat, fit.data, layoutId])

  const recommendation = result?.recommendation
  const recommendedLayout = result?.layouts.find((item) => item.id === recommendation?.id)
  const chosen = (layoutId === 'auto' ? recommendedLayout : result?.layouts.find((item) => item.id === layoutId)) ?? result?.layouts[0]
  const knownHeights = obstacles.filter((building) => building.heightM != null).length
  const roofHeightCount = roofs.filter((roof) => roof.heightM != null).length
  const shadeObstacles = obstacles.filter((building) => !roofs.some((roof) => roof.osmId === building.id))
  const shadeHeights = shadeObstacles.filter((building) => building.heightM != null).length
  const shadeCoverage = `${roofHeightCount}/${roofs.length} 處屋頂、${shadeHeights}/${shadeObstacles.length} 棟周圍建物有高度`
  const shadeDescription = !roofs.length ? '待確認：請先圈選屋頂。'
    : sun && sun.altitude <= 2 ? '太陽接近或低於地平線，暫停屋頂遮蔽估算。'
      : !roofHeightCount ? '待確認：請補填屋頂高度。'
        : !shadeHeights ? '待確認：缺少周圍建物高度。'
          : shadeNow == null ? '待確認：沒有有效的屋頂取樣。'
            : shadeNow === 0 ? '已知圖資未偵測到遮蔽，現場遮蔽仍待確認。'
              : `依已知高度估算屋頂遮蔽約 ${formatPercent(shadeNow)}，現場遮蔽仍待確認。`

  function reportSnapshot() {
    if (!site || !result || !chosen) return null
    return {
      name: site.name,
      address: site.address,
      label: site.label,
      lat: site.lat,
      lng: site.lng,
      analysis: { ...result, layouts: result.layouts.map((layout) => ({ ...layout, panels: [] })) },
      shadeNow,
      shadeEvidence: { description: shadeDescription, coverage: shadeCoverage },
      sunText: `${sunDate} ${sunClock} 台北時間，太陽高度 ${sun ? sun.altitude.toFixed(1) : '—'}°、方位 ${sun ? sun.azimuth.toFixed(1) : '—'}°`,
      layoutName: chosen.name,
      registrationDate: site.registrationDate,
      completionYear: result.ageYears == null ? null : asNumber(completionYear),
      moduleName: moduleMode === 'reference' ? referenceModule.name : moduleMode === 'manual' ? '手動輸入' : null,
      inputs: {
        registeredArea: asNumber(registered),
        roofType: roofType === 'rc' ? 'RC' : roofType === 'metal' ? '鐵皮' : '待確認',
        module: hasModule ? `${moduleSpec.watt} W · ${moduleSpec.length} × ${moduleSpec.width} m` : null,
        systemLoss: lossValue,
        systemLossSource: lossValue === customLoss ? '使用者輸入' : 'PVWatts 參考情境',
        selfUse: asNumber(selfUse),
        capex: costValue,
        capexSource: costValue === customCost ? '使用者輸入' : '內政部公開參考值',
      },
      estimateLimits: [
        !chosen.temperatureApplied ? '未計入模組溫度修正' : null,
        !chosen.systemLossApplied ? '未計入系統損失' : null,
        chosen.shadingFraction == null ? '未計入屋頂遮蔽' : null,
      ].filter((item) => item != null),
      sources: [
        { label: '內政部國土測繪中心門牌定位', href: 'https://api.nlsc.gov.tw/idc/TextQueryMap/', when: site.fetchedAt },
        { label: '經濟部產業發展署登記工廠名錄', href: 'https://data.gov.tw/dataset/6569', when: factories.stamp?.modified },
        { label: '台電再生能源可併網容量', href: 'https://data.gov.tw/dataset/161874', when: feeders.stamp?.modified },
        { label: 'NASA POWER climatology', href: 'https://power.larc.nasa.gov/', when: climate?.range },
        { label: FIT_115_CITATION.name, href: FIT_115_CITATION.url, when: fit.stamp?.modified },
        { label: TARIFF_SOURCE.name, href: TARIFF_SOURCE.url, when: String(tariff.data?.meta['實施日期'] ?? tariff.stamp?.modified ?? '') },
        { label: 'OpenStreetMap 建物（Overpass）', href: 'https://overpass.openstreetmap.fr/api/interpreter', when: null },
        ...(moduleMode === 'reference' ? [{ label: referenceModule.name, href: referenceModule.source }] : []),
        ...(lossValue !== customLoss ? [{ label: LOSS_REFERENCE.label, href: LOSS_REFERENCE.url }] : []),
        ...(costValue !== customCost ? [{ label: CAPEX_CITATION.name, href: CAPEX_CITATION.url }] : []),
      ],
      notes: result.missing,
    }
  }

  function publishReport() {
    const report = reportSnapshot()
    if (!report) return
    session.setReport(report)
    navigate('/report')
    window.scrollTo(0, 0)
  }

  function pushLead() {
    const report = reportSnapshot()
    if (!site || !result || !chosen || !report) return
    const persisted = session.addLead({
      id: site.address.replace(/\s/g, ''),
      createdAt: new Date().toISOString(),
      name: site.name,
      address: site.address,
      district: siteCounty || '其他',
      areaM2: result.areaM2,
      kwp: chosen.kwp,
      annualKwh: chosen.annualKwh,
      gates: {
        grid: result.gates[0]?.status ?? 'insufficient',
        legal: result.gates[1]?.status ?? 'insufficient',
        structural: result.gates[2]?.status ?? 'insufficient',
      },
      qualified: result.qualification.qualified,
      conditional: result.qualification.conditional,
      priceTwd: asNumber(leadPrice),
      feeder: feeder?.feeder ?? null,
      capacityKw: feeder?.capacityKw ?? null,
    }, report)
    setLeadNote(persisted ? '案場與報告已儲存在這個瀏覽器。' : '案場已加入本次工作階段，瀏覽器儲存空間目前無法寫入。')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className={step === 0 && !site ? 'rounded-xl bg-pine px-5 py-6 text-white sm:px-8 sm:py-9' : ''}>
        <h1 className="text-2xl font-bold sm:text-3xl">屋頂太陽能快篩</h1>
        {step === 0 && !site ? <p className="mt-2 text-sm text-white/90">輸入廠址並圈選屋頂，即可估算裝置容量、比較配置，產出現勘待辦。</p> : null}
        {site && step > 0 ? <p className="mt-1 text-sm text-stone-600">{site.name === site.address ? site.address : `${site.name} · ${site.address}`}</p> : null}
      </header>
      <nav aria-label="快篩步驟">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                aria-current={step === index ? 'step' : undefined}
                disabled={geoLoading || (!site && index > 0)}
                onClick={() => goToStep(index)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-bold disabled:opacity-50 ${step === index ? 'border-pine bg-pine text-white' : 'border-line bg-card hover:border-pine'}`}
              >
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${step === index ? 'bg-white/20' : 'bg-paper text-stone-600'}`}>{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 0 ? (
        <section className={panel}>
          <h2 className="text-xl font-bold">選擇廠址</h2>
          <p className="mt-1 text-sm text-stone-600">可輸入完整地址直接定位，也可用廠名、地址或工廠登記編號搜尋全台名錄。</p>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => {
            event.preventDefault()
            const address = query.trim()
            if (!geoLoading && address.length >= 2) void locate(address, address, null)
          }}>
            <label className="min-w-0 flex-1 text-sm font-medium">
              <span className="mb-1 block">工廠地址或名稱</span>
              <input className={control} value={query} disabled={geoLoading} placeholder="例如桃園市觀音區大同二路 11 號" onChange={(event) => { setQuery(event.target.value); setGeoError('') }} />
            </label>
            <button
              type="submit"
              className={primary}
              disabled={geoLoading || query.trim().length < 2}
            >
              {geoLoading ? '定位中…' : '定位地址'}
            </button>
          </form>
          <p className="sr-only" role="status">{geoLoading ? '正在查詢廠址' : ''}</p>
          {geoError && lastSearch ? <div className="mt-2"><Problem message={geoError} onRetry={() => void locate(lastSearch.address, lastSearch.name, lastSearch.registrationDate)} /></div> : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              縣市
              <select className="rounded-md border border-line bg-white px-2 py-1" value={county} onChange={(event) => setCounty(event.target.value)}>
                <option value="">全台</option>
                {counties.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <p className="text-sm text-stone-600" role="status">
              {factories.status === 'loading' ? '正在載入全台工廠名錄…' : factories.data ? `全台名錄 ${factories.data.length.toLocaleString('zh-TW')} 筆` : ''}
            </p>
          </div>
          {factories.status === 'error' ? <div className="mt-2"><Problem message={factories.error} onRetry={() => void refreshFactories()} /></div> : null}
          {matches.length === 20 && query !== site?.address ? <p className="mt-2 text-xs text-stone-600">顯示前 20 筆，可加上縣市或更完整的關鍵字。</p> : null}
          {factories.data && deferredQuery === query && query.trim() && query !== site?.address && !matches.length ? <p className="mt-2 text-sm text-stone-600">名錄沒有符合的工廠。若輸入的是完整地址，仍可直接定位。</p> : null}
          {matches.length > 0 && query !== site?.address ? (
            <ul aria-label="符合的工廠" className="mt-3 divide-y divide-line rounded-lg border border-line">
              {matches.map((factory) => (
                <li key={factory.id}>
                  <button type="button" disabled={geoLoading} className="w-full px-3 py-2 text-left text-sm hover:bg-paper disabled:opacity-50" onClick={() => void locate(factory.address, factory.name, factory.registered)}>
                    <span className="font-bold">{factory.name}</span>
                    <span className="mt-0.5 block text-stone-600">{factory.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {site ? (
            <div className="mt-3 text-sm">
              <p className="font-bold">{site.name}</p>
              <p>{site.label}</p>
              <p className="text-stone-600">{site.lat.toFixed(6)}, {site.lng.toFixed(6)} · 工廠登記日期 {site.registrationDate ?? '未取得'}</p>
              <Source label="內政部國土測繪中心門牌定位" href="https://maps.nlsc.gov.tw/" when={site.fetchedAt} />
            </div>
          ) : null}
        </section>
      ) : null}

      {site && step === 1 ? (
        <div className={expandedMap ? 'grid gap-4' : 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]'}>
        <section className="overflow-hidden rounded-lg border border-line bg-card">
          <div className="border-b border-line p-4 sm:px-6">
            <h2 className="text-xl font-bold">圈選屋頂</h2>
            <p className="mt-1 text-sm text-stone-600">點擊建物輪廓可查看基本資訊，再加入評估屋頂，也可以手動畫出範圍。</p>
          </div>
          {candidateRoof && !drawing && !roofs.length && mode === '2d' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-green-50 p-3 text-sm">
              <div>
                <p className="font-bold">候選屋頂 · {formatM2(candidateRoof.area)}</p>
                <p>{candidateRoof.contains ? '廠址定位點落在此建物輪廓內。' : `輪廓距定位點約 ${Math.round(candidateRoof.distance)} 公尺。`}請在地圖上核對。</p>
              </div>
              <button type="button" className={primary} onClick={() => {
                const building = candidateRoof.building
                setRoofs([{ id: crypto.randomUUID(), source: 'osm', osmId: building.id, ring: building.ring, heightM: building.heightM }])
              }}>採用候選屋頂</button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {drawing ? (
              <>
                <button type="button" className={primary} disabled={!isSimpleRing(draft)} onClick={() => {
                  if (drawingExclusion) setExclusions((list) => [...list, { id: crypto.randomUUID(), ring: draft }])
                  else setRoofs((list) => [...list, { id: crypto.randomUUID(), source: 'draw', ring: draft, heightM: null }])
                  setDraft([])
                  setDrawing(false)
                }}>{drawingExclusion ? '完成排除區' : '完成圈選'}</button>
                <button type="button" className={secondary} disabled={!draft.length} onClick={() => setDraft((points) => points.slice(0, -1))}>復原一點</button>
                <button type="button" className={secondary} onClick={() => { setDraft([]); setDrawing(false) }}>取消</button>
                <span className="text-sm text-stone-600">{drawingExclusion ? '圈出設備或通道' : '圈出屋頂'} · 已標記 {draft.length} 點，至少需要 3 點{draft.length >= 3 && !isSimpleRing(draft) ? "；請復原交叉或重複的角點" : ""}</span>
              </>
            ) : (
              <>
                <button type="button" className={primary} onClick={() => { setDraft([]); setDrawingExclusion(false); setDrawing(true); setMode('2d') }}>手動畫屋頂</button>
                <button type="button" className={secondary} disabled={!roofs.length} onClick={() => { setDraft([]); setDrawingExclusion(true); setDrawing(true); setMode('2d') }}>標記排除區</button>
                <button type="button" className={secondary} onClick={() => setExpandedMap(!expandedMap)}>{expandedMap ? '還原工作台' : '展開地圖'}</button>
                <button type="button" className={secondary} onClick={() => { setPlayingSun(false); setMode(mode === '2d' ? '3d' : '2d'); setTileNote('') }}>{mode === '2d' ? '查看三維日照' : '返回平面地圖'}</button>
                <button type="button" className={secondary} onClick={() => setBasemap((value) => (value === 'photo' ? 'osm' : 'photo'))}>{basemap === 'photo' ? '切換街道圖' : '切換正射影像'}</button>
              </>
            )}
          </div>
          {mode === '3d' ? (
            <div className="space-y-3 border-b border-line bg-paper/50 p-4">
              <label className="flex items-center gap-2 font-bold">
                <input type="checkbox" checked={constructionPreview} onChange={(event) => {
                  setConstructionPreview(event.target.checked)
                  setUseOfficialTiles(false)
                  setPlayingSun(false)
                  setShowPanels(true)
                }} /> 3D 建設情境預覽
              </label>
              {constructionPreview ? (
                <div className="space-y-3 rounded-lg border border-line bg-white p-3">
                  <div className="flex flex-wrap gap-2" aria-label="建設階段">
                    {([['roof', '屋頂'], ['frame', '支架'], ['complete', '完工排板']] as const).map(([value, label]) => (
                      <button key={value} type="button" aria-pressed={constructionStage === value} className={constructionStage === value ? primary : secondary} onClick={() => setConstructionStage(value)}>{label}</button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label={`缺高度屋頂的情境值 ${previewRoofHeight} 公尺`}>
                      <input type="range" min={3} max={30} step={0.5} value={previewRoofHeight} onChange={(event) => setPreviewRoofHeight(Number(event.target.value))} className="w-full accent-pine" />
                    </Field>
                    <Field label={`支架底部離屋頂 ${mountingHeight} 公尺`}>
                      <input type="range" min={0.1} max={3} step={0.1} value={mountingHeight} onChange={(event) => setMountingHeight(Number(event.target.value))} className="w-full accent-pine" />
                    </Field>
                    {chosen ? <Field label={`配置傾角 ${chosen.tiltDeg}°`}>
                      <input type="range" min={0} max={40} step={1} value={chosen.tiltDeg} onChange={(event) => {
                        setLayoutId(chosen.id)
                        setTilts((current) => ({ ...current, [chosen.id]: Number(event.target.value) }))
                      }} className="w-full accent-pine" />
                    </Field> : null}
                  </div>
                  <p className="text-xs leading-5 text-amber-900">模擬高度只用於模型外觀。陰影與遮蔽仍依已知高度計算；調整傾角會重新計算排板與發電初估。支架呈現安裝概念，施工尺寸須由工程設計確認。</p>
                </div>
              ) : null}
              {previewingLayout && chosen ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{chosen.name}配置 · {chosen.count} 片</p>
                    <p className="text-sm text-stone-600">{constructionPreview ? '缺少實測高度的屋頂採用情境值，模型為裝設概念預覽。' : '有高度的屋頂顯示抬升後的模組位置，其餘顯示平面投影。'}</p>
                  </div>
                  <button type="button" className={secondary} onClick={() => goToStep(3)}>返回配置比較</button>
                </div>
              ) : null}
              <div className="grid items-end gap-3 sm:grid-cols-3">
                <Field label="模擬日期">
                  <input className={control} type="date" value={sunDate} onChange={(event) => { if (event.target.value) setSunDate(event.target.value) }} />
                </Field>
                <Field label={`台北時間 ${sunClock}`}>
                  <input className="w-full accent-pine" type="range" min={5} max={19} step={0.25} value={sunHour} onChange={(event) => { setPlayingSun(false); setSunHour(Number(event.target.value)) }} />
                </Field>
                <Field label="三維建物圖層">
                  <select className={control} value={tileSet && useOfficialTiles ? 'official' : 'height'} onChange={(event) => { setUseOfficialTiles(event.target.value === 'official'); setTileNote('') }}>
                    {tileSet ? <option value="official">國土測繪中心模型</option> : null}
                    <option value="height">{constructionPreview ? '配置模型（含模擬高度）' : '配置模型（依已知高度）'}</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={primary} onClick={() => setPlayingSun(!playingSun)}>{playingSun ? '暫停日照模擬' : '播放日照模擬'}</button>
                {[9, 12, 15].map((hour) => (
                  <button key={hour} type="button" aria-pressed={sunHour === hour} className={sunHour === hour ? primary : secondary} onClick={() => { setPlayingSun(false); setSunHour(hour) }}>{hour}:00</button>
                ))}
                {sun ? <span className="text-sm text-stone-600">太陽高度 {sun.altitude.toFixed(1)}° · 方位 {sun.azimuth.toFixed(1)}°</span> : null}
              </div>
              <p className="text-sm">{shadeDescription} <span className="text-stone-600">{shadeCoverage}。</span></p>
              <p className="text-xs text-stone-600">模組依配置傾角示意，支架底部暫以屋頂上方 {constructionPreview ? mountingHeight : 0.2} 公尺呈現。東西向以相鄰模組交替示意。遮蔽計算使用周圍建物高度，模組互遮仍待工程設計確認。</p>
              {tileNote ? <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-amber-800" role="status">{tileNote}</p>
                <button type="button" className={secondary} onClick={() => { setUseOfficialTiles(false); setTileNote('') }}>切換高度輪廓</button>
              </div> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white px-4 py-3 text-sm">
            <span className="font-bold">地圖疊圖</span>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" className="accent-pine" checked={showPanels} disabled={!chosen?.panels.length} onChange={(event) => setShowPanels(event.target.checked)} />
              模組配置
            </label>
            {mode === '3d' ? (
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" className="accent-pine" checked={showShadows} onChange={(event) => setShowShadows(event.target.checked)} />
                地面陰影
              </label>
            ) : null}
            {roofs.length && result?.layouts.some((layout) => layout.count > 0) ? (
              <label className="ml-auto inline-flex items-center gap-2">
                配置方案
                <select className="rounded border border-line bg-white px-2 py-1" value={layoutId} onChange={(event) => setLayoutId(event.target.value as LayoutId | 'auto')}>
                  <option value="auto">系統推薦</option>
                  {result.layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {active ? <MapView
            lat={site?.lat ?? null}
            lng={site?.lng ?? null}
            buildings={obstacles}
            candidate={mode === '2d' && !drawing && !roofs.length ? candidateRoof?.building.id : undefined}
            roofs={roofs}
            exclusions={exclusions}
            focusedRoof={focusedRoof}
            draft={draft}
            panels={showPanels ? chosen?.panels ?? [] : []}
            panelTilt={chosen?.tiltDeg ?? 0}
            panelLayout={chosen?.id ?? 'flat'}
            previewRoofHeight={constructionPreview ? previewRoofHeight : null}
            mountingHeight={constructionPreview ? mountingHeight : 0.2}
            constructionStage={constructionPreview ? constructionStage : 'complete'}
            shadows={mode === '3d' && showShadows ? shadows : []}
            mode={mode}
            useOfficialTiles={useOfficialTiles}
            drawing={drawing}
            basemap={basemap}
            onAddPoint={(point) => setDraft((points) => [...points, point])}
            onPickBuilding={(id) => {
              const building = buildings.find((item) => item.id === id)
              if (!building) return
              setRoofs((list) => list.some((roof) => roof.osmId === id) ? list.filter((roof) => roof.osmId !== id) : [...list, { id: crypto.randomUUID(), source: 'osm', osmId: id, ring: building.ring, heightM: building.heightM }])
            }}
            onTilesetIssue={setTileNote}
          /> : null}
          <div className="space-y-2 px-3 py-3 text-sm">
            {buildingError ? <Problem message={buildingError} onRetry={() => void fetchBuildings(site.lat, site.lng).then((value) => { setBuildings(value); setBuildingError('') }).catch((error: unknown) => setBuildingError(error instanceof Error ? error.message : '建物失敗'))} /> : null}
            <p className="font-bold" role="status">{roofs.length ? `已圈選 ${roofs.length} 處屋頂 · 合計 ${formatM2(area)}` : '尚未圈選屋頂'}</p>
            {result && roofs.length > 0 ? <p className="text-sm">扣除排除區 {formatM2(result.excludedAreaM2 ?? 0)} · 可配置範圍 {formatM2(result.usableAreaM2 ?? area)}</p> : null}
            {exclusions.length ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="font-bold">排除區域</p>
                <p className="text-xs">紅色區域將避開排板。此範圍只代表不可裝設區，遮蔽仍依已知建物高度估算。</p>
                <ul>{exclusions.map((zone, index) => (
                  <li key={zone.id} className="mt-2 flex items-center justify-between gap-2">
                    <span>排除區 {index + 1} · {formatM2(ringAreaM2(zone.ring))}</span>
                    <button type="button" className="text-fail underline" onClick={() => setExclusions((list) => list.filter((item) => item.id !== zone.id))}>移除排除區 {index + 1}</button>
                  </li>
                ))}</ul>
              </div>
            ) : null}
            {roofs.length && chosen?.kwp != null ? (
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  ['模組片數', `${chosen.count} 片`],
                  ['容量初估', formatKwp(chosen.kwp)],
                  ['年發電量初估', chosen.annualKwh == null ? '待取得氣候資料' : formatKwh(chosen.annualKwh)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-line bg-paper/60 p-2">
                    <dt className="text-xs text-stone-600">{label}</dt>
                    <dd className="mt-1 font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <details className="py-1">
              <summary className="cursor-pointer font-medium">地圖資料來源</summary>
              <p className="mt-2">周圍建物 {buildings.length} 棟，其中有高度 {knownHeights} 棟。</p>
              <Source label="正射影像與三維建物：內政部國土測繪中心" href="https://3dtiles.nlsc.gov.tw/tiles3d/Service" when={site ? tilesetFor(site.lat, site.lng)?.name ?? '此座標沒有對應縣市三維圖磚' : null} />
              <Source label="建物輪廓：OpenStreetMap Overpass" href="https://overpass.openstreetmap.fr/api/interpreter" when={null} />
            </details>
            <ul className="space-y-2">
              {roofs.map((roof, index) => (
                <li key={roof.id} className="flex flex-wrap items-center gap-2">
                  <button type="button" className="font-bold text-pine underline" onClick={() => setFocusedRoof({ id: roof.id, request: Date.now() })}>定位屋頂 {index + 1}</button>
                  <span>{roof.source === 'osm' ? '圖資輪廓' : '手繪'} · {formatM2(ringAreaM2(roof.ring))}</span>
                  <input aria-label="屋頂高度（公尺）" className="w-28 rounded border border-line px-2 py-1" placeholder="高度（公尺）" inputMode="decimal" value={roof.heightM ?? ''} onChange={(event) => setRoofs((list) => list.map((item) => item.id === roof.id ? { ...item, heightM: asNumber(event.target.value) } : item))} />
                  <button type="button" className="text-fail" onClick={() => setRoofs((list) => list.filter((item) => item.id !== roof.id))}>刪除</button>
                </li>
              ))}
            </ul>
            {mode === '3d' && buildings.some((building) => building.heightM == null) ? (
              <details>
                <summary className="cursor-pointer font-medium">補填周圍建物高度</summary>
                {buildings.filter((building) => building.heightM == null).slice(0, 6).map((building) => (
                  <label key={building.id} className="mr-3 inline-flex items-center gap-1 text-xs text-stone-600">
                    OSM {building.id}{building.levels ? `（${building.levels} 層，不換算）` : ''}
                    <input className="w-20 rounded border border-line px-1 py-0.5" placeholder="手動高度" value={heightOverrides[building.id] ?? ''} onChange={(event) => {
                      const value = asNumber(event.target.value)
                      setHeightOverrides((current) => {
                        const next = { ...current }
                        if (value == null) delete next[building.id]
                        else next[building.id] = value
                        return next
                      })
                    }} />
                  </label>
                ))}
              </details>
            ) : null}
          </div>
        </section>
        <aside aria-label="裝設評估摘要" className="space-y-3 xl:sticky xl:top-24">
          <section className={panel}>
            <h2 className="font-bold">目前裝設方案</h2>
            <p className="mt-1 text-sm text-stone-600">{chosen?.name ?? '選擇屋頂後開始估算'}</p>
            <dl className="mt-3 space-y-3">
              {[
                ['屋頂範圍', roofs.length ? formatM2(area) : '待選擇'],
                ['直流容量', chosen?.kwp != null ? formatKwp(chosen.kwp) : '待估算'],
                ['年發電初估', chosen?.annualKwh != null ? formatKwh(chosen.annualKwh) : climateError ? '氣候資料載入失敗' : '等待資料'],
              ].map(([label, value]) => (
                <div key={label}><dt className="text-xs text-stone-600">{label}</dt><dd className="mt-1 text-lg font-bold">{value}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-5 text-stone-600">配置依圈選範圍與參考模組估算。設備、維修通道及現場可用範圍仍須確認。</p>
            <button type="button" className={`${secondary} mt-3 w-full`} onClick={() => goToStep(3)}>比較配置與收益</button>
          </section>
          <section className={panel}>
            <h2 className="font-bold">可行性因素</h2>
            <ul className="mt-3 space-y-3">
              {result?.gates.map((gate) => (
                <li key={gate.id}>
                  <div className="flex items-center justify-between gap-2"><span className="text-sm">{gate.title}</span><StatusPill status={gate.status} /></div>
                  <p className="mt-1 text-xs leading-5 text-stone-600">{gate.reasons[gate.reasons.length - 1]}</p>
                </li>
              ))}
            </ul>
            <button type="button" className={`${secondary} mt-3 w-full`} onClick={() => goToStep(2)}>查看依據與裝設條件</button>
          </section>
        </aside>
        </div>
      ) : null}

      {step === 1 && roofs.length > 0 ? (
        <section className={panel}>
          <h2 className="mb-1 text-lg font-bold">模組與容量初估</h2>
          <p className="mb-3 text-sm text-stone-600">預先帶入參考模組。有實際規格時可以更換。</p>
          <Field label="模組規格">
            <select id="module-mode" className={control} value={moduleMode} onChange={(event) => setModuleMode(event.target.value)}>
              <option value="skip">先略過容量估算</option>
              <option value="reference">{referenceModule.name}（參考規格）</option>
              <option value="manual">手動輸入</option>
            </select>
          </Field>
          {moduleMode === 'reference' ? (
            <Source label={`${referenceModule.name} 原廠規格表`} href={referenceModule.source} when="550 W · 2.278 × 1.134 公尺" />
          ) : null}
          {moduleMode === 'manual' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="模組額定功率（W）"><input className={control} inputMode="decimal" value={moduleWatt} onChange={(event) => setModuleWatt(event.target.value)} /></Field>
              <Field label="模組長（公尺）"><input className={control} inputMode="decimal" value={moduleLength} onChange={(event) => setModuleLength(event.target.value)} /></Field>
              <Field label="模組寬（公尺）"><input className={control} inputMode="decimal" value={moduleWidth} onChange={(event) => setModuleWidth(event.target.value)} /></Field>
              {!hasModule ? <p className="text-sm text-amber-800 sm:col-span-3">請輸入大於零的功率、長度與寬度。</p> : null}
            </div>
          ) : null}
          {chosen?.kwp != null ? <p className="mt-2 text-sm" role="status">{chosen.name}配置初估 {formatKwp(chosen.kwp)}</p> : hasModule ? <p className="mt-2 text-sm text-amber-800">目前配置放不下模組，請檢查屋頂範圍或模組尺寸。</p> : null}
        </section>
      ) : null}

      {step === 2 ? (
        <>
          <InstallationGuide />
          <section className={panel}>
            <h2 className="text-xl font-bold">檢查三關</h2>
            <p className="mt-1 text-sm text-stone-600">補填已知的廠房資料，查看併網、登記面積與結構的快篩結果。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {result?.gates.map((gate) => (
                <article key={gate.id} className="rounded-lg border border-line bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold">{gate.title}</h2>
                    <StatusPill status={gate.status} />
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {gate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    {gate.id === 'grid' && siteCounty && !feederCovered ? <li>目前饋線資料涵蓋桃園市與臺中市，請向台電確認此址的接入點與容量。</li> : null}
                  </ul>
                  {gate.id === 'grid' && chosen?.kwp == null ? (
                    <button type="button" className="mt-2 text-sm font-bold text-pine underline" onClick={roofs.length ? editModule : () => goToStep(1)}>
                      {roofs.length === 0 ? '先圈選屋頂' : hasModule ? '檢查模組規格與屋頂' : '補填模組規格'}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
          <details className={panel}>
            <summary className="cursor-pointer font-bold">補填廠房資料（可略過）</summary>
            <p className="my-3 text-sm text-stone-600">工廠登記日期 {site?.registrationDate ?? '未取得'}。未填的資料會列入報告待辦。</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="建物完工年份（西元）">
                <input className={control} inputMode="numeric" maxLength={4} placeholder="例如 2008，未知可留空" value={completionYear} onChange={(event) => setCompletionYear(event.target.value)} />
              </Field>
              <p className="self-center text-sm text-stone-600">{result?.ageYears != null ? `依完工年份估算屋齡約 ${result.ageYears} 年` : '請依竣工或使用執照資料填寫。'}</p>
              <Field label="登記廠房面積（平方公尺）">
                <input className={control} inputMode="decimal" value={registered} onChange={(event) => setRegistered(event.target.value)} />
              </Field>
              <Field label="屋面">
                <select className={control} value={roofType} onChange={(event) => setRoofType(event.target.value as '' | 'metal' | 'rc')}>
                  <option value="">請選擇，公開資料沒有</option>
                  <option value="rc">RC</option>
                  <option value="metal">鐵皮</option>
                </select>
              </Field>
              <p className="text-xs text-stone-600 md:col-span-2">請依廠房登記文件填寫面積。15% 為此工具使用的篩選門檻。</p>
              <div className="grid gap-3 sm:grid-cols-3 md:col-span-2">
                <ConditionField label="漏水或鏽蝕" value={leak} onChange={setLeak} />
                <ConditionField label="結構補強紀錄" value={retrofit} onChange={setRetrofit} />
                <ConditionField label="屋頂另有加蓋" value={addon} onChange={setAddon} />
              </div>
              <details className="text-sm text-stone-600 md:col-span-2">
                <summary className="cursor-pointer font-medium">結構檢查項目與饋線比對</summary>
                <p className="mt-2">結構快篩供初步評估，正式判定仍須技師簽證。</p>
                <ul className="list-disc pl-5">{STRUCTURAL_CHECKLIST.map((item) => <li key={item}>{item}</li>)}</ul>
                {feeder ? (
                  <div className="mt-2">
                    最近饋線 {feeder.feeder}，{Math.round(feeder.distanceM)} 公尺，容量 {feeder.capacityKw ?? '無對應容量'} 瓩。
                    <Source label="台電開放資料，TWD67 以 EPSG:3828 轉成 WGS84 後取最近變壓器" href="https://data.gov.tw/dataset/44195" when={feeders.stamp?.modified} />
                  </div>
                ) : (
                  <p className="mt-2">尚無饋線比對結果。</p>
                )}
              </details>
            </div>
          </details>
          {feeders.status === 'error' ? <Problem message={feeders.error} onRetry={() => void refreshFeeders()} /> : null}
        </>
      ) : null}

      {step === 3 ? (
        <>
          <section className={panel}>
            <h2 className="text-xl font-bold">估算與報告</h2>
            {roofs.length > 0 ? <p className="mt-1 text-sm text-stone-600">
              {moduleMode === 'reference' ? referenceModule.name : hasModule ? '使用手動輸入的模組規格' : '比較配置前請先填入模組規格。'}
              {' '}<button type="button" className="font-bold text-pine underline" onClick={editModule}>{hasModule ? '修改模組規格' : '補填模組規格'}</button>
            </p> : null}
            {roofs.length === 0 ? <p className="mt-2 text-sm text-amber-800">請先<button type="button" onClick={() => goToStep(1)} className="underline">圈選屋頂</button>，才能估算配置與發電量。</p> : null}
            {climateError ? <div className="mt-2"><Problem message={climateError} onRetry={() => site && void fetchNasa(site.lat, site.lng).then((value) => { setClimate(value); setClimateError('') }).catch((error: unknown) => setClimateError(error instanceof Error ? error.message : '射量失敗'))} /></div> : null}
            {climate ? <Source label={`NASA POWER ${climate.sources.join(', ')} ${climate.range}`} href="https://power.larc.nasa.gov/" when="即時 climatology" /> : !climateError ? <p className="mt-2 text-sm text-stone-600">正在載入射量與氣溫…</p> : null}
            <p className="mt-2 text-xs text-stone-600">系統損失採用 {formatPercent(lossValue)}{lossValue === customLoss ? '（自行輸入）' : '（PVWatts 參考情境，遮蔽另計）'}。可在進階設定調整。</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold">進階係數與配置參數</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="系統損失（0–0.95）"><input className={control} inputMode="decimal" placeholder={String(LOSS_REFERENCE.rate)} value={systemLoss} onChange={(event) => setSystemLoss(event.target.value)} /></Field>
                <Field label="溫度係數（1/°C）"><input className={control} value={gamma} placeholder={moduleMode === 'reference' ? String(referenceModule.gamma) : undefined} onChange={(event) => setGamma(event.target.value)} /></Field>
                <Field label="NOCT（°C）"><input className={control} value={noct} placeholder={moduleMode === 'reference' ? String(referenceModule.noct) : undefined} onChange={(event) => setNoct(event.target.value)} /></Field>
                <Field label="地面反照率"><input className={control} value={albedo} onChange={(event) => setAlbedo(event.target.value)} /></Field>
                <Field label="維修間隙（公尺，配置設定）"><input className={control} value={gap} onChange={(event) => setGap(event.target.value)} /></Field>
                {LAYOUT_PRESETS.map((preset) => (
                  <Field key={preset.id} label={`${preset.name}傾角（配置設定）`}>
                    <input className={control} value={tilts[preset.id]} onChange={(event) => setTilts((current) => ({ ...current, [preset.id]: Number(event.target.value) }))} />
                  </Field>
                ))}
              </div>
            </details>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {result?.layouts.map((layout) => (
                <button key={layout.id} type="button" aria-pressed={layout.id === chosen?.id} onClick={() => setLayoutId(layout.id)} className={`rounded-lg border p-3 text-left ${layout.id === chosen?.id ? 'border-copper bg-orange-50' : 'border-line'}`}>
                  <p className="font-bold">{layout.name} · {layout.tiltDeg}°</p>
                  <p className="mt-1 text-sm">{layout.kwp == null ? '缺模組規格' : formatKwp(layout.kwp)} · {layout.count} 片</p>
                  <p className="text-sm">{layout.annualKwh == null ? '尚無發電量' : formatKwh(layout.annualKwh)}</p>
                  <p className="text-xs text-stone-600">效率 {layout.efficiency == null ? '—' : formatPercent(layout.efficiency)} · 遮蔽 {layout.shadingFraction == null ? '待確認' : layout.shadingFraction === 0 ? '已知圖資未偵測到' : `依已知高度估算 ${formatPercent(layout.shadingFraction)}`}</p>
                  <p className="text-xs text-stone-600">{layout.temperatureApplied ? '含溫度修正' : '未計溫度'} · {layout.systemLossApplied ? '含系統損失' : '未計系統損失'}</p>
                </button>
              ))}
            </div>
            {recommendation && recommendedLayout ? (
              <div className="mt-3 rounded-lg border border-line bg-paper/60 p-3 text-sm">
                <p className="font-bold">建議先看 {recommendedLayout.name}</p>
                <p className="mt-1">{recommendation.basis === 'energy' ? '依目前條件比較年發電量初估。' : '年發電量尚未齊全，目前先依直流裝置容量比較。'}
                  {recommendation.difference != null ? recommendation.difference === 0 ? ' 前兩名在此指標相同。' : ` 比第二名高 ${recommendation.basis === 'energy' ? formatKwh(recommendation.difference) : formatKwp(recommendation.difference)}。` : ' 目前只有一種配置可排入模組。'}
                </p>
                <p className="mt-1 text-stone-600">屋頂可用範圍、遮蔽、系統損失及實際接入條件都可能影響選擇。</p>
                {layoutId !== 'auto' ? <button type="button" className="mt-2 font-bold text-pine underline" onClick={() => setLayoutId('auto')}>改用系統推薦</button> : null}
              </div>
            ) : null}
            {chosen?.monthlyKwh ? <MonthBars values={chosen.monthlyKwh} /> : null}
            {chosen && chosen.panels.length > 0 ? (
              <button type="button" className={`${primary} mt-4`} onClick={() => {
                goToStep(1)
                setPreviewingLayout(true)
                setDrawing(false)
                setTileNote('')
                setMode('3d')
              }}>在 3D 地圖查看此配置</button>
            ) : null}
          </section>

          <details className={panel}>
            <summary className="cursor-pointer text-lg font-bold">收益與回收試算</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h2 className="font-bold">全額躉購</h2>
                <p className="mt-1 text-sm">費率 {chosen?.fitLabel ?? '—'} {chosen?.fitRate ?? '—'}</p>
                <p className="text-2xl font-bold">{chosen?.fullSaleTwd == null ? '—' : formatTwd(chosen.fullSaleTwd)} / 年</p>
                <Source label={FIT_115_CITATION.name} href={FIT_115_CITATION.url} when={fit.stamp?.modified ?? FIT_115_CITATION.date} />
              </div>
              <div>
                <h2 className="font-bold">自發自用</h2>
                <Field label="自用比例（0–1）"><input className={control} value={selfUse} onChange={(event) => setSelfUse(event.target.value)} /></Field>
                <Field label="電價">
                  <select className={control} value={tariffMode} onChange={(event) => setTariffMode(event.target.value as 'none' | 'tou' | 'flat')}>
                    <option value="none">尚未選擇</option>
                    <option value="tou">高壓三段式（尖峰固定），依發電小時加權</option>
                    <option value="flat">低壓電力非時間電價，依夏月日數加權</option>
                  </select>
                </Field>
                <p className="mt-2 text-sm">加權電價 {chosen?.retailRate == null ? '—' : `${chosen.retailRate.toFixed(3)} 元/度`}</p>
                <p className="text-2xl font-bold">{chosen?.selfUseTwd == null ? '—' : formatTwd(chosen.selfUseTwd)} / 年</p>
                <p className="text-xs text-stone-600">平日、週六、週日按 5:1:1，沒有套用國定假日曆。</p>
                <Source label={TARIFF_SOURCE.name} href={TARIFF_SOURCE.url} when={String(tariff.data?.meta['實施日期'] ?? '')} />
              </div>
              <div>
                <h2 className="font-bold">屋頂出租</h2>
                <Field label="每 kWp 年租金（元）"><input className={control} value={rent} onChange={(event) => setRent(event.target.value)} /></Field>
                <Missing text="沒有公開租金行情。" />
                <p className="text-2xl font-bold">{chosen?.rentTwd == null ? '—' : formatTwd(chosen.rentTwd)} / 年</p>
              </div>
              <div>
                <h2 className="font-bold">建置成本與回收</h2>
                <Field label="每 kWp 成本（元）"><input className={control} inputMode="decimal" placeholder={String(CAPEX_CITATION.rate)} value={capex} onChange={(event) => setCapex(event.target.value)} /></Field>
                <p className="mt-1 text-xs text-stone-600">{costValue === customCost ? '採用自行輸入的建置單價。' : CAPEX_CITATION.text}</p>
                <Source label={CAPEX_CITATION.name} href={CAPEX_CITATION.url} />
                <p className="mt-2 text-sm">總成本 {chosen?.capexTwd == null ? '—' : formatTwd(chosen.capexTwd)}</p>
                <p className="text-sm">躉購回收 {formatYears(chosen?.fullPayback ?? null)} · 自用回收 {formatYears(chosen?.selfPayback ?? null)}</p>
              </div>
              {fit.status === 'error' ? <Problem message={fit.error} onRetry={() => void refreshFit()} /> : null}
              {tariff.status === 'error' ? <Problem message={tariff.error} onRetry={() => void refreshTariff()} /> : null}
            </div>
          </details>

          <section className={panel}>
            <details>
        <summary className="cursor-pointer font-bold">儲存案場與報告</summary>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field label="案源報價（自行填寫，無公開行情）">
                  <input className={control} value={leadPrice} onChange={(event) => setLeadPrice(event.target.value)} />
                </Field>
                <button type="button" className={secondary} onClick={pushLead} disabled={!result}>儲存案源</button>
              </div>
              {leadNote ? <p className="mt-2 text-sm" role="status">{leadNote}</p> : null}
            </details>
          </section>
        </>
      ) : null}

      {site && !geoLoading ? (
        <div className="no-print sticky bottom-0 z-10 xl:static flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card/95 p-3 shadow-sm backdrop-blur">
          {step > 0 ? <button type="button" className={secondary} onClick={() => goToStep(step - 1)}>上一步</button> : null}
          {step < 3 ? (
            <button type="button" className={`${primary} ml-auto`} onClick={() => goToStep(step + 1)}>
              {step === 0 ? '返回目前廠址的地圖' : step === 1 ? (roofs.length ? '下一步：檢查三關' : '略過圈選，先檢查三關') : '下一步：估算與報告'}
            </button>
          ) : <button type="button" className={primary} onClick={publishReport}>查看快篩報告</button>}
        </div>
      ) : null}

      <details className="rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-stone-600">官方資料來源與載入狀態</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Resource name="工廠名錄" load={factories} onRetry={() => void refreshFactories()} href="https://data.gov.tw/dataset/6569" />
          <Resource name="台電可併網容量" load={feeders} onRetry={() => void refreshFeeders()} href="https://data.gov.tw/dataset/161874" />
          <Resource name="115 年躉購費率" load={fit} onRetry={() => void refreshFit()} href={FIT_115_CITATION.url} />
          <Resource name="台電電價表" load={tariff} onRetry={() => void refreshTariff()} href={TARIFF_SOURCE.file} />
        </div>
      </details>
    </div>
  )
}

function ConditionField({ label, value, onChange }: { label: string; value: RoofCondition; onChange: (value: RoofCondition) => void }) {
  return (
    <Field label={label}>
      <select className={control} value={value == null ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}>
        <option value="">未知</option>
        <option value="true">有</option>
        <option value="false">無</option>
      </select>
    </Field>
  )
}

function Resource({ name, load, onRetry, href }: { name: string; load: Load<unknown>; onRetry: () => void; href: string }) {
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-sm">
      <p className="font-bold">{name}</p>
      {load.status === 'loading' ? <p>正在向官方網址下載…</p> : null}
      {load.status === 'error' ? <Problem message={load.error} onRetry={onRetry} /> : null}
      {load.status === 'ok' ? <Source label="官方檔案" href={href} when={load.stamp?.modified ?? load.stamp?.fetchedAt} /> : null}
    </div>
  )
}

function MonthBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
  return (
    <div className="mt-4 flex h-36 items-end gap-1">
      {values.map((value, index) => (
        <div key={labels[index]} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-sm bg-copper" style={{ height: `${(value / max) * 100}%` }} />
          <span className="text-[10px] text-stone-500">{labels[index]}</span>
        </div>
      ))}
    </div>
  )
}
