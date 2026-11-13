import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyze } from '../lib/analyze'
import { ageYears } from '../lib/dates'
import { nearestFeeder, type FeederCapacity, type FeederPoint } from '../lib/feeders'
import { CAPEX_CITATION, FIT_115_CITATION } from '../lib/fit'
import { formatKwh, formatKwp, formatM2, formatPercent, formatTwd, formatYears } from '../lib/format'
import { ringAreaM2 } from '../lib/geo'
import { LAYOUT_PRESETS, type LayoutId } from '../lib/layout'
import { LiveError, fetchBuildings, fetchNasa, geocodeNlsc, loadFactories, loadFeeders, loadFit, loadTariff, type FetchStamp } from '../lib/remote'
import { groundShadowRing, shadeFractionAt } from '../lib/shading'
import { sunAt } from '../lib/solar'
import { highVoltageThreePart, lowVoltageEnergy, TARIFF_SOURCE } from '../lib/tariff'
import type { Building, FactoryRecord, Roof } from '../lib/types'
import type { FitBracket } from '../lib/fit'
import { Field, Missing, Problem, Source, StatusPill, control } from '../components/Bits'
import { MapView, tilesetFor } from '../components/MapView'
import { STRUCTURAL_CHECKLIST } from '../lib/gates'
import { useSession } from '../session'

type Load<T> = { status: 'loading' | 'ok' | 'error'; data: T | null; error: string; stamp: FetchStamp | null }

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

export function ToolPage() {
  const session = useSession()
  const navigate = useNavigate()
  const [factories, setFactories] = useState<Load<FactoryRecord[]>>(loading())
  const [feeders, setFeeders] = useState<Load<{ points: FeederPoint[]; capacities: FeederCapacity[] }>>(loading())
  const [tariff, setTariff] = useState<Load<{ data: Record<string, unknown>; meta: Record<string, unknown> }>>(loading())
  const [fit, setFit] = useState<Load<FitBracket[]>>(loading())
  const [query, setQuery] = useState('')
  const [site, setSite] = useState<{ name: string; address: string; established: string | null; lat: number; lng: number; label: string; fetchedAt: string } | null>(null)
  const [geoError, setGeoError] = useState('')
  const [geoLoading, setGeoLoading] = useState(false)
  const [climateError, setClimateError] = useState('')
  const [climate, setClimate] = useState<Awaited<ReturnType<typeof fetchNasa>> | null>(null)
  const [buildingError, setBuildingError] = useState('')
  const [buildings, setBuildings] = useState<Building[]>([])
  const [roofs, setRoofs] = useState<Roof[]>([])
  const [draft, setDraft] = useState<[number, number][]>([])
  const [drawing, setDrawing] = useState(false)
  const [mode, setMode] = useState<'2d' | '3d'>('2d')
  const [basemap, setBasemap] = useState<'photo' | 'osm'>('photo')
  const [tileNote, setTileNote] = useState('')
  const [registered, setRegistered] = useState('')
  const [roofType, setRoofType] = useState<'' | 'metal' | 'rc'>('')
  const [leak, setLeak] = useState(false)
  const [retrofit, setRetrofit] = useState(false)
  const [addon, setAddon] = useState(false)
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
  const [layoutId, setLayoutId] = useState<LayoutId>('south')
  const [tariffMode, setTariffMode] = useState<'none' | 'tou' | 'flat'>('none')
  const [sunDate, setSunDate] = useState(taipeiToday)
  const [sunHour, setSunHour] = useState(12)
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

  async function locate(address: string, name: string, established: string | null) {
    setGeoError('')
    setGeoLoading(true)
    setClimate(null)
    setBuildings([])
    setRoofs([])
    setDraft([])
    try {
      const hit = await geocodeNlsc(address)
      setSite({ name, address, established, lat: hit.lat, lng: hit.lng, label: hit.label, fetchedAt: hit.fetchedAt })
      setQuery(address)
    } catch (error) {
      setGeoError(error instanceof LiveError || error instanceof Error ? error.message : '定位失敗')
    } finally {
      setGeoLoading(false)
    }
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

  const matches = useMemo(() => {
    const text = query.replace(/\s/g, '')
    if (!factories.data || text.length < 1) return []
    return factories.data.filter((factory) => `${factory.name}${factory.address}`.replace(/\s/g, '').includes(text)).slice(0, 8)
  }, [factories.data, query])

  const quick = useMemo(() => {
    const rows = factories.data ?? []
    const take = (village: string) => rows.filter((factory) => factory.village === village).slice(0, 4)
    return [...take('桃園市觀音區草漯里'), ...take('桃園市觀音區樹林里'), ...take('臺中市大里區仁化里')]
  }, [factories.data])

  const feeder = site && feeders.data ? nearestFeeder(site.lat, site.lng, feeders.data.points, feeders.data.capacities) : null
  const tou = tariff.data ? highVoltageThreePart(tariff.data.data) : null
  const flat = tariff.data ? lowVoltageEnergy(tariff.data.data) : null
  const sun = site ? sunAt(site.lat, site.lng, sunDate, sunHour) : null
  const area = roofs.reduce((sum, roof) => sum + ringAreaM2(roof.ring), 0)

  const obstacles = buildings.map((building) => ({
    id: building.id,
    ring: building.ring,
    heightM: heightOverrides[building.id] ?? building.heightM,
  }))
  const shadeNow = useMemo(() => {
    if (!sun || roofs.length === 0) return null
    let weighted = 0
    let weight = 0
    for (const roof of roofs) {
      const sample = shadeFractionAt(roof.ring, roof.heightM, obstacles, sun.altitude, sun.azimuth)
      if (!sample) continue
      const roofArea = ringAreaM2(roof.ring)
      weighted += sample.fraction * roofArea
      weight += roofArea
    }
    return weight > 0 ? weighted / weight : null
  }, [sun, roofs, buildings, heightOverrides])

  const shadows = useMemo(() => {
    if (!sun || sun.altitude <= 3) return []
    const rings = [
      ...buildings.map((building) => groundShadowRing(building.ring, heightOverrides[building.id] ?? building.heightM ?? 0, sun.altitude, sun.azimuth)),
      ...roofs.map((roof) => groundShadowRing(roof.ring, roof.heightM ?? 0, sun.altitude, sun.azimuth)),
    ]
    return rings.filter((ring): ring is [number, number][] => ring != null)
  }, [sun, buildings, roofs, heightOverrides])

  const result = useMemo(() => {
    if (!site) return null
    return analyze({
      lat: site.lat,
      lng: site.lng,
      climate,
      feeder,
      roofs,
      buildings,
      heightOverrides,
      established: site.established,
      registeredAreaM2: asNumber(registered),
      roofType: roofType || null,
      leakOrRust: leak,
      seismicRetrofit: retrofit,
      rooftopAddOn: addon,
      moduleWatt: asNumber(moduleWatt),
      moduleLengthM: asNumber(moduleLength),
      moduleWidthM: asNumber(moduleWidth),
      systemLoss: asNumber(systemLoss),
      gammaPerC: asNumber(gamma),
      noctC: asNumber(noct),
      albedo: asNumber(albedo),
      capexPerKwp: asNumber(capex),
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
  }, [site, climate, feeder, roofs, buildings, heightOverrides, registered, roofType, leak, retrofit, addon, moduleWatt, moduleLength, moduleWidth, systemLoss, gamma, noct, albedo, capex, selfUse, rent, gap, tilts, tariffMode, tou, flat, fit.data, layoutId])

  const chosen = result?.layouts.find((item) => item.id === layoutId) ?? result?.layouts[0]
  const knownHeights = buildings.filter((building) => (heightOverrides[building.id] ?? building.heightM) != null).length

  function publishReport() {
    if (!site || !result || !chosen) return
    session.setReport({
      name: site.name,
      address: site.address,
      label: site.label,
      lat: site.lat,
      lng: site.lng,
      analysis: result,
      shadeNow,
      sunText: `${sunDate} ${String(sunHour).padStart(2, '0')}:00 台北時間，太陽高度 ${sun ? sun.altitude.toFixed(1) : '—'}°、方位 ${sun ? sun.azimuth.toFixed(1) : '—'}°`,
      layoutName: chosen.name,
      sources: [
        { label: '內政部國土測繪中心門牌定位', href: 'https://api.nlsc.gov.tw/idc/TextQueryMap/', when: site.fetchedAt },
        { label: '經濟部產業發展署登記工廠名錄', href: 'https://data.gov.tw/dataset/6569', when: factories.stamp?.modified },
        { label: '台電再生能源可併網容量', href: 'https://data.gov.tw/dataset/161874', when: feeders.stamp?.modified },
        { label: 'NASA POWER climatology', href: 'https://power.larc.nasa.gov/', when: climate?.range },
        { label: FIT_115_CITATION.name, href: FIT_115_CITATION.url, when: fit.stamp?.modified },
        { label: TARIFF_SOURCE.name, href: TARIFF_SOURCE.url, when: String(tariff.data?.meta['實施日期'] ?? tariff.stamp?.modified ?? '') },
        { label: 'OpenStreetMap 建物（Overpass）', href: 'https://overpass.openstreetmap.fr/api/interpreter', when: null },
      ],
      notes: result.missing,
    })
    navigate('/report')
  }

  function pushLead() {
    if (!site || !result || !chosen) return
    session.addLead({
      id: site.address + chosen.id,
      createdAt: new Date().toISOString(),
      name: site.name,
      address: site.address,
      district: site.address.includes('觀音') ? '桃園觀音' : site.address.includes('大里') ? '台中大里' : '其他',
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
    })
    setLeadNote(result.qualification.qualified ? '已放進案源清單。' : '三關未全部可判定或有未過，仍可在案源頁看到，但不會標成合格。')
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2">
        <Resource name="工廠名錄" load={factories} onRetry={() => void refreshFactories()} href="https://data.gov.tw/dataset/6569" />
        <Resource name="台電可併網容量" load={feeders} onRetry={() => void refreshFeeders()} href="https://data.gov.tw/dataset/161874" />
        <Resource name="115 年躉購費率" load={fit} onRetry={() => void refreshFit()} href={FIT_115_CITATION.url} />
        <Resource name="台電電價表" load={tariff} onRetry={() => void refreshTariff()} href={TARIFF_SOURCE.file} />
      </section>

      <section className="rounded-lg border border-line bg-card p-4">
        <h1 className="text-xl font-bold">廠址</h1>
        <p className="mt-1 text-sm text-stone-600">輸入地址，或從剛下載的工廠名錄挑選。定位走國土測繪中心門牌服務。</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className={control} value={query} placeholder="例如桃園市觀音區大同二路 11 號" onChange={(event) => setQuery(event.target.value)} />
          <button
            type="button"
            className="rounded-md bg-copper px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            disabled={geoLoading || query.trim().length < 2}
            onClick={() => void locate(query.trim(), query.trim(), null)}
          >
            {geoLoading ? '定位中' : '定位'}
          </button>
        </div>
        {geoError ? <div className="mt-2"><Problem message={geoError} onRetry={() => void locate(query.trim(), query.trim(), null)} /></div> : null}
        {matches.length > 0 ? (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {matches.map((factory) => (
              <li key={factory.id}>
                <button type="button" className="w-full py-2 text-left text-sm hover:bg-paper" onClick={() => void locate(factory.address, factory.name, factory.established ?? factory.registered)}>
                  <span className="font-bold">{factory.name}</span>
                  <span className="mt-0.5 block text-stone-600">{factory.address}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {quick.map((factory) => (
            <button key={factory.id} type="button" className="rounded-full border border-line bg-white px-3 py-1 text-xs" onClick={() => void locate(factory.address, factory.name, factory.established ?? factory.registered)}>
              {factory.name}
            </button>
          ))}
        </div>
        {site ? (
          <div className="mt-3 text-sm">
            <p className="font-bold">{site.name}</p>
            <p>{site.label}</p>
            <p className="text-stone-600">{site.lat.toFixed(6)}, {site.lng.toFixed(6)} · 屋齡資料 {ageYears(site.established) ?? '無法換算'} 年</p>
            <Source label="內政部國土測繪中心門牌定位" href="https://maps.nlsc.gov.tw/" when={site.fetchedAt} />
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" className={mode === '2d' ? 'rounded bg-ink px-3 py-1 text-sm text-white' : 'rounded px-3 py-1 text-sm'} onClick={() => setMode('2d')}>平面圈選</button>
          <button type="button" className={mode === '3d' ? 'rounded bg-ink px-3 py-1 text-sm text-white' : 'rounded px-3 py-1 text-sm'} onClick={() => setMode('3d')}>三維日照</button>
          <button type="button" className="rounded border border-line px-3 py-1 text-sm" onClick={() => setBasemap((value) => (value === 'photo' ? 'osm' : 'photo'))}>{basemap === 'photo' ? '正射影像' : '街道圖'}</button>
          <button type="button" className="rounded border border-line px-3 py-1 text-sm" onClick={() => { setDrawing(true); setMode('2d') }}>新增屋頂</button>
          <button type="button" className="rounded border border-line px-3 py-1 text-sm" disabled={draft.length < 3} onClick={() => { setRoofs((list) => [...list, { id: crypto.randomUUID(), source: 'draw', ring: draft, heightM: null }]); setDraft([]); setDrawing(false) }}>完成此棟</button>
          <button type="button" className="rounded border border-line px-3 py-1 text-sm" onClick={() => setDraft((points) => points.slice(0, -1))}>復原一點</button>
          <button type="button" className="rounded border border-line px-3 py-1 text-sm" onClick={() => { setDraft([]); setDrawing(false) }}>取消</button>
          <span className="text-sm text-stone-600">{drawing ? '在圖上點角點' : '點建物輪廓可納入或移除'}</span>
        </div>
        <MapView
          lat={site?.lat ?? null}
          lng={site?.lng ?? null}
          buildings={buildings}
          roofs={roofs}
          draft={draft}
          panels={chosen?.panels ?? []}
          shadows={shadows}
          mode={mode}
          drawing={drawing}
          basemap={basemap}
          onAddPoint={(point) => setDraft((points) => [...points, point])}
          onPickBuilding={(id) => {
            const building = buildings.find((item) => item.id === id)
            if (!building) return
            setRoofs((list) => list.some((roof) => roof.osmId === id) ? list.filter((roof) => roof.osmId !== id) : [...list, { id: crypto.randomUUID(), source: 'osm', osmId: id, ring: building.ring, heightM: building.heightM }])
          }}
          onTilesetIssue={setTileNote}
        />
        <div className="space-y-2 px-3 py-3 text-sm">
          {buildingError ? <Problem message={buildingError} onRetry={() => site && void fetchBuildings(site.lat, site.lng).then(setBuildings).catch((error: unknown) => setBuildingError(error instanceof Error ? error.message : '建物失敗'))} /> : null}
          {tileNote ? <p className="text-amber-800">{tileNote}</p> : null}
          <p>圈選合計 {formatM2(area)} · 周圍建物 {buildings.length} 棟，其中有高度 {knownHeights} 棟。沒有 height 標籤的不推估樓高。</p>
          <Source label="正射影像與三維建物：內政部國土測繪中心" href="https://3dtiles.nlsc.gov.tw/tiles3d/Service" when={site ? tilesetFor(site.lat, site.lng)?.name ?? '此座標沒有對應縣市三維圖磚' : null} />
          <Source label="建物輪廓：OpenStreetMap Overpass" href="https://overpass.openstreetmap.fr/api/interpreter" when={null} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="日期">
              <input className={control} type="date" value={sunDate} onChange={(event) => setSunDate(event.target.value)} />
            </Field>
            <Field label={`時刻 ${sunHour}:00`}>
              <input className="w-48" type="range" min={5} max={19} value={sunHour} onChange={(event) => setSunHour(Number(event.target.value))} />
            </Field>
            <p>目前遮蔽 {shadeNow == null ? '無法計算（缺屋頂高度）' : formatPercent(shadeNow)}。百分比用射線對有高度的建物，畫面陰影畫在地面。</p>
          </div>
          <ul className="space-y-2">
            {roofs.map((roof) => (
              <li key={roof.id} className="flex flex-wrap items-center gap-2">
                <span>{roof.source === 'osm' ? `OSM ${roof.osmId}` : '手繪'} · {formatM2(ringAreaM2(roof.ring))}</span>
                <input className="w-28 rounded border border-line px-2 py-1" placeholder="高度公尺" value={roof.heightM ?? ''} onChange={(event) => setRoofs((list) => list.map((item) => item.id === roof.id ? { ...item, heightM: asNumber(event.target.value) } : item))} />
                <button type="button" className="text-fail" onClick={() => setRoofs((list) => list.filter((item) => item.id !== roof.id))}>刪除</button>
              </li>
            ))}
          </ul>
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
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {result?.gates.map((gate) => (
          <article key={gate.id} className="rounded-lg border border-line bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{gate.title}</h2>
              <StatusPill status={gate.status} />
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {gate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </article>
        ))}
      </section>
      <section className="grid gap-3 rounded-lg border border-line bg-card p-4 md:grid-cols-3">
        <Field label="登記廠房面積（平方公尺）">
          <input className={control} value={registered} onChange={(event) => setRegistered(event.target.value)} />
        </Field>
        <Missing text="登記工廠名錄沒有廠房面積，15% 只是這個工具的篩選門檻。" />
        <Field label="屋面">
          <select className={control} value={roofType} onChange={(event) => setRoofType(event.target.value as '' | 'metal' | 'rc')}>
            <option value="">請選擇，公開資料沒有</option>
            <option value="rc">RC</option>
            <option value="metal">鐵皮</option>
          </select>
        </Field>
        <label className="text-sm"><input type="checkbox" checked={leak} onChange={(event) => setLeak(event.target.checked)} /> 漏水或鏽蝕</label>
        <label className="text-sm"><input type="checkbox" checked={retrofit} onChange={(event) => setRetrofit(event.target.checked)} /> 做過結構補強</label>
        <label className="text-sm"><input type="checkbox" checked={addon} onChange={(event) => setAddon(event.target.checked)} /> 屋頂另有加蓋</label>
        <div className="md:col-span-3 text-sm text-stone-600">
          <p>結構快篩不取代技師簽證。檢查項目：</p>
          <ul className="list-disc pl-5">{STRUCTURAL_CHECKLIST.map((item) => <li key={item}>{item}</li>)}</ul>
          {feeder ? (
            <div className="mt-2">
              最近饋線 {feeder.feeder}，{Math.round(feeder.distanceM)} 公尺，容量 {feeder.capacityKw ?? '無對應容量'} 瓩。
              <Source label="台電開放資料，TWD67 以 EPSG:3828 轉成 WGS84 後取最近變壓器" href="https://data.gov.tw/dataset/44195" when={feeders.stamp?.modified} />
            </div>
          ) : (
            <p className="mt-2">尚無饋線比對結果。</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="text-lg font-bold">發電與配置</h2>
        {climateError ? <div className="mt-2"><Problem message={climateError} onRetry={() => site && void fetchNasa(site.lat, site.lng).then(setClimate).catch((error: unknown) => setClimateError(error instanceof Error ? error.message : '射量失敗'))} /></div> : null}
        {climate ? <Source label={`NASA POWER ${climate.sources.join(', ')} ${climate.range}`} href="https://power.larc.nasa.gov/" when="即時 climatology" /> : <Missing text="選址後會向 NASA POWER 要月射量與氣溫。" />}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="模組額定功率（W）"><input className={control} value={moduleWatt} onChange={(event) => setModuleWatt(event.target.value)} /></Field>
          <Field label="模組長（公尺）"><input className={control} value={moduleLength} onChange={(event) => setModuleLength(event.target.value)} /></Field>
          <Field label="模組寬（公尺）"><input className={control} value={moduleWidth} onChange={(event) => setModuleWidth(event.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-stone-600">效率用功率除以模組面積，不另假設。系統損失、溫度係數、NOCT、地面反照率都沒有公開預設，空白就不計。</p>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold">進階係數與配置參數</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="系統損失（0–1）"><input className={control} value={systemLoss} onChange={(event) => setSystemLoss(event.target.value)} /></Field>
            <Field label="溫度係數（1/°C）"><input className={control} value={gamma} onChange={(event) => setGamma(event.target.value)} /></Field>
            <Field label="NOCT（°C）"><input className={control} value={noct} onChange={(event) => setNoct(event.target.value)} /></Field>
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
            <button key={layout.id} type="button" onClick={() => setLayoutId(layout.id)} className={`rounded-lg border p-3 text-left ${layout.id === layoutId ? 'border-copper bg-orange-50' : 'border-line'}`}>
              <p className="font-bold">{layout.name} · {layout.tiltDeg}°</p>
              <p className="mt-1 text-sm">{layout.kwp == null ? '缺模組規格' : formatKwp(layout.kwp)} · {layout.count} 片</p>
              <p className="text-sm">{layout.annualKwh == null ? '尚無發電量' : formatKwh(layout.annualKwh)}</p>
              <p className="text-xs text-stone-600">效率 {layout.efficiency == null ? '—' : formatPercent(layout.efficiency)} · 遮蔽 {layout.shadingFraction == null ? '未計' : formatPercent(layout.shadingFraction)}</p>
              <p className="text-xs text-stone-600">{layout.temperatureApplied ? '含溫度修正' : '未計溫度'} · {layout.systemLossApplied ? '含系統損失' : '未計系統損失'}</p>
            </button>
          ))}
        </div>
        {chosen?.monthlyKwh ? <MonthBars values={chosen.monthlyKwh} /> : null}
      </section>

      <section className="grid gap-3 rounded-lg border border-line bg-card p-4 md:grid-cols-2">
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
          <Field label="每 kWp 成本（元）"><input className={control} value={capex} onChange={(event) => setCapex(event.target.value)} /></Field>
          <p className="mt-1 text-xs text-stone-600">{CAPEX_CITATION.text}</p>
          <Source label={CAPEX_CITATION.name} href={CAPEX_CITATION.url} when={CAPEX_CITATION.date} />
          <p className="mt-2 text-sm">總成本 {chosen?.capexTwd == null ? '—' : formatTwd(chosen.capexTwd)}</p>
          <p className="text-sm">躉購回收 {formatYears(chosen?.fullPayback ?? null)} · 自用回收 {formatYears(chosen?.selfPayback ?? null)}</p>
        </div>
      </section>

      <section className="no-print flex flex-wrap items-end gap-3">
        <button type="button" className="rounded-md bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={publishReport} disabled={!result}>
          打開報告
        </button>
        <Field label="案源報價（自行填寫，無公開行情）">
          <input className={control} value={leadPrice} onChange={(event) => setLeadPrice(event.target.value)} />
        </Field>
        <button type="button" className="rounded-md border border-ink px-4 py-2 text-sm font-bold" onClick={pushLead} disabled={!result}>放入案源</button>
        {leadNote ? <p className="text-sm">{leadNote}</p> : null}
      </section>
    </div>
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
