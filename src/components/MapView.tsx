import { useEffect, useMemo, useRef } from 'react'
import { LngLatBounds, Map, Marker, NavigationControl, ScaleControl } from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Tile3DLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Building, Roof } from '../lib/types'
import { pointInRing, toLocal } from '../lib/geo'

type Ring = [number, number][]

function closeRing(ring: Ring): [number, number][] {
  const coords = ring.map(([lat, lng]) => [lng, lat] as [number, number])
  const first = coords[0]
  const last = coords[coords.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coords.push(first)
  return coords
}

function polygonCollection(items: { id: string; ring: Ring; height: number | null }[]) {
  return {
    type: 'FeatureCollection' as const,
    features: items.map((item) => ({
      type: 'Feature' as const,
      properties: { id: item.id, height: item.height ?? 0, known: item.height != null },
      geometry: { type: 'Polygon' as const, coordinates: [closeRing(item.ring)] },
    })),
  }
}

export function tilesetFor(lat: number, lng: number): { name: string; url: string } | null {
  if (lat > 24.55 && lat < 25.2 && lng > 120.9 && lng < 121.5) {
    return { name: '國土測繪中心桃園市建物模型', url: 'https://3dtiles.nlsc.gov.tw/building/tiles3d/7/tileset.json' }
  }
  if (lat > 23.95 && lat < 24.55 && lng > 120.4 && lng < 121.15) {
    return { name: '國土測繪中心臺中市建物模型', url: 'https://3dtiles.nlsc.gov.tw/building/tiles3d/1/tileset.json' }
  }
  return null
}

export function MapView({
  lat,
  lng,
  buildings,
  candidate,
  roofs,
  exclusions,
  focusedRoof,
  draft,
  panels,
  panelTilt,
  panelLayout,
  previewRoofHeight,
  mountingHeight,
  constructionStage,
  shadows,
  mode,
  useOfficialTiles,
  drawing,
  basemap,
  onAddPoint,
  onPickBuilding,
  onTilesetIssue,
}: {
  lat: number | null
  lng: number | null
  buildings: Building[]
  candidate?: string
  roofs: Roof[]
  exclusions: { id: string; ring: Ring }[]
  focusedRoof: { id: string; request: number } | null
  draft: Ring
  panels: Ring[]
  panelTilt: number
  panelLayout: string
  previewRoofHeight: number | null
  mountingHeight: number
  constructionStage: 'roof' | 'frame' | 'complete'
  shadows: Ring[]
  mode: '2d' | '3d'
  useOfficialTiles: boolean
  drawing: boolean
  basemap: 'photo' | 'osm'
  onAddPoint: (point: [number, number]) => void
  onPickBuilding: (id: string) => void
  onTilesetIssue: (message: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const drawingRef = useRef(drawing)
  const modeRef = useRef(mode)
  const addRef = useRef(onAddPoint)
  const pickRef = useRef(onPickBuilding)
  const issueRef = useRef(onTilesetIssue)
  const roofsRef = useRef(roofs)
  const modelRoofs = useMemo(() => roofs.map((roof) => ({ ...roof, heightM: roof.heightM ?? previewRoofHeight })), [roofs, previewRoofHeight])
  const panelLayers = useMemo(() => {
    const elevated: GeoJSON.Feature<GeoJSON.Polygon>[] = []
    const supports: GeoJSON.Feature<GeoJSON.LineString>[] = []
    const flat: { id: string; ring: Ring; height: null }[] = []
    const knownRoofs = modelRoofs.flatMap((roof) => roof.heightM == null ? [] : [{
      height: roof.heightM,
      ring: roof.ring.map(([lat, lng]) => ({ x: lng, y: lat })),
    }])
    panels.forEach((ring, index) => {
      const coordinates = closeRing(ring)
      const [lng, lat] = ring.reduce(([x, y], [pLat, pLng]) => [x + pLng / ring.length, y + pLat / ring.length], [0, 0])
      const roof = mode === '3d' ? knownRoofs.find((item) => pointInRing(lng, lat, item.ring)) : undefined
      const azimuth = panelLayout === 'ew' ? (index % 2 ? 270 : 90) : 180
      const radians = azimuth * Math.PI / 180
      const projections = coordinates.map(([x, y]) => {
        const local = toLocal(y, x, lat, lng)
        return -(local.x * Math.sin(radians) + local.y * Math.cos(radians))
      })
      const minimum = Math.min(...projections)
      const vertices = roof ? coordinates.map(([x, y], vertex) => [x, y, roof.height + mountingHeight + ((projections[vertex] ?? minimum) - minimum) * Math.tan(Math.min(60, Math.max(0, panelTilt)) * Math.PI / 180)]) : []
      if (roof) {
        vertices.slice(0, -1).forEach(([x, y, z]) => supports.push({
          type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[x!, y!, roof.height], [x!, y!, z!]] },
        }))
        supports.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: vertices } })
        elevated.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [vertices] },
      })
      }
      else flat.push({ id: String(index), ring, height: null })
    })
    return { flat: polygonCollection(mode === '3d' && constructionStage !== 'complete' ? [] : flat), elevated, supports }
  }, [panels, modelRoofs, mode, panelTilt, panelLayout, mountingHeight, constructionStage])
  drawingRef.current = drawing
  modeRef.current = mode
  addRef.current = onAddPoint
  pickRef.current = onPickBuilding
  issueRef.current = onTilesetIssue
  roofsRef.current = roofs

  useEffect(() => {
    const node = host.current
    if (!node) return
    const map = new Map({
      container: node,
      style: {
        version: 8,
        sources: {
          photo: {
            type: 'raster',
            tiles: ['https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: '正射影像 © 內政部國土測繪中心',
            maxzoom: 19,
          },
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap',
            maxzoom: 19,
          },
        },
        layers: [
          { id: 'photo', type: 'raster', source: 'photo' },
          { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        ],
      },
      center: [121.12, 25.05],
      zoom: 16,
      maxPitch: 70,
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.doubleClickZoom.disable()
    map.on('load', () => {
      map.addSource('buildings', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('roofs', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('exclusions', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('vertices', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('panels', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('shadows', { type: 'geojson', data: polygonCollection([]) })
      map.addLayer({ id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': '#1c1915', 'fill-opacity': 0.28 } })
      map.addLayer({ id: 'buildings-fill', type: 'fill', source: 'buildings', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.18 } })
      map.addLayer({ id: 'buildings-outline', type: 'line', source: 'buildings', paint: { 'line-color': '#252525', 'line-width': 3 } })
      map.addLayer({ id: 'buildings-line', type: 'line', source: 'buildings', paint: { 'line-color': '#ffffff', 'line-width': 1.5 } })
      map.addLayer({ id: 'candidate-line', type: 'line', source: 'buildings', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#34d399', 'line-width': 5 } })
      map.addLayer({ id: 'roofs-fill', type: 'fill', source: 'roofs', paint: { 'fill-color': '#fb923c', 'fill-opacity': 0.48 } })
      map.addLayer({ id: 'roofs-outline', type: 'line', source: 'roofs', paint: { 'line-color': '#1c1915', 'line-width': 7 } })
      map.addLayer({ id: 'roofs-line', type: 'line', source: 'roofs', paint: { 'line-color': '#ffad55', 'line-width': 4 } })
      map.addLayer({ id: 'panels', type: 'fill', source: 'panels', paint: { 'fill-color': '#1d4e89', 'fill-opacity': 0.55 } })
      map.addLayer({ id: 'exclusions-fill', type: 'fill', source: 'exclusions', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.55 } })
      map.addLayer({ id: 'exclusions-line', type: 'line', source: 'exclusions', paint: { 'line-color': '#fef2f2', 'line-width': 3, 'line-dasharray': [2, 1] } })
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.32 } })
      map.addLayer({ id: 'draft-outline', type: 'line', source: 'draft', paint: { 'line-color': '#083344', 'line-width': 8 } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#67e8f9', 'line-width': 4 } })
      map.addLayer({ id: 'draft-vertices', type: 'circle', source: 'vertices', paint: { 'circle-radius': 9, 'circle-color': '#67e8f9', 'circle-stroke-color': '#083344', 'circle-stroke-width': 2 } })
    })
    map.on('click', (event) => {
      if (modeRef.current === '3d') return
      if (drawingRef.current) {
        addRef.current([event.lngLat.lat, event.lngLat.lng])
        return
      }
      if (!map.getLayer('buildings-fill')) return
      const hits = map.queryRenderedFeatures(event.point, { layers: ['buildings-fill'] })
      const id = hits[0]?.properties?.id
      if (id) pickRef.current(String(id))
    })
    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
      overlayRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      map.setLayoutProperty('photo', 'visibility', basemap === 'photo' ? 'visible' : 'none')
      map.setLayoutProperty('osm', 'visibility', basemap === 'osm' ? 'visible' : 'none')
    }
    if (map.getLayer('photo')) apply()
    else map.once('load', apply)
    return () => { map.off('load', apply) }
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const set = (id: string, data: GeoJSON.FeatureCollection) => {
        ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
      }
      set('buildings', polygonCollection(buildings.map((item) => ({ id: item.id, ring: item.ring, height: item.heightM }))))
      map.setFilter('candidate-line', ['==', ['get', 'id'], candidate ?? ''])
      set('roofs', polygonCollection(roofs.map((item) => ({ id: item.id, ring: item.ring, height: item.heightM }))))
      set('exclusions', polygonCollection(exclusions.map((item) => ({ ...item, height: null }))))
      set('panels', panelLayers.flat)
      set('shadows', polygonCollection(shadows.map((ring, index) => ({ id: String(index), ring, height: null }))))
      const draftLine = draft.map(([latP, lngP]) => [lngP, latP] as [number, number])
      const draftFeature =
        draft.length >= 3
          ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [closeRing(draft)] } }
          : draft.length >= 2
            ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: draftLine } }
            : null
      set('draft', { type: 'FeatureCollection', features: draftFeature ? [draftFeature] : [] })
      set('vertices', {
        type: 'FeatureCollection',
        features: draftLine.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } })),
      })
    }
    if (map.getSource('roofs')) apply()
    else map.once('load', apply)
    return () => { map.off('load', apply) }
  }, [buildings, candidate, roofs, exclusions, draft, panelLayers, shadows])

  useEffect(() => {
    const map = mapRef.current
    if (!map || lat == null || lng == null) return
    const marker = new Marker({ color: '#1d6b48', scale: 0.8 }).setLngLat([lng, lat]).addTo(map)
    const element = marker.getElement()
    element.style.pointerEvents = 'none'
    element.setAttribute('aria-label', '廠址定位點')
    map.flyTo({ center: [lng, lat], zoom: 17, duration: 700 })
    return () => { marker.remove() }
  }, [lat, lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return
    const canvas = map.getCanvas()
    canvas.style.cursor = 'crosshair'
    const markers = draft.map(([lat, lng], index) => {
      const badge = document.createElement('span')
      badge.className = 'grid size-5 place-items-center rounded-full border-2 border-cyan-950 bg-cyan-300 text-[10px] font-bold text-cyan-950'
      badge.style.pointerEvents = 'none'
      badge.textContent = String(index + 1)
      badge.setAttribute('aria-hidden', 'true')
      return new Marker({ element: badge }).setLngLat([lng, lat]).addTo(map)
    })
    return () => {
      canvas.style.cursor = ''
      markers.forEach((marker) => marker.remove())
    }
  }, [draft, drawing])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (mode === '2d') {
      map.easeTo({ pitch: 0, bearing: 0, duration: 450 })
      return
    }
    const bounds = new LngLatBounds()
    roofsRef.current.forEach((roof) => roof.ring.forEach(([lat, lng]) => bounds.extend([lng, lat])))
    if (bounds.isEmpty()) map.easeTo({ pitch: 52, bearing: -28, duration: 500 })
    else map.fitBounds(bounds, { padding: 70, maxZoom: 19, pitch: 52, bearing: -28, duration: 550 })
    // Keep the user's camera when they change layers or edit a height.
  }, [mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (mode !== '3d') {
      if (overlayRef.current) {
        map.removeControl(overlayRef.current)
        overlayRef.current = null
      }
      return
    }
    const tileset = useOfficialTiles && lat != null && lng != null ? tilesetFor(lat, lng) : null
    const roofData = polygonCollection(modelRoofs.filter((roof) => roof.heightM != null).map((roof) => ({ id: roof.id, ring: roof.ring, height: roof.heightM })))
    const knownBuildings = polygonCollection(
      buildings.filter((item) => item.heightM != null && !roofs.some((roof) => roof.osmId === item.id)).map((item) => ({ id: item.id, ring: item.ring, height: item.heightM })),
    )
    const layers = []
    if (tileset) {
      layers.push(
        new Tile3DLayer({
          id: 'nlsc-3d',
          data: tileset.url,
          pickable: false,
          onTilesetLoad: (tileset3d) => {
            const options = (tileset3d as { options?: { maximumScreenSpaceError?: number } }).options
            if (options) options.maximumScreenSpaceError = 24
          },
          onTileError: () => issueRef.current('國土測繪中心圖磚載入失敗，可切換到高度輪廓。'),
        }),
      )
    } else {
      layers.push(
        new GeoJsonLayer({
          id: 'osm-extrude',
          data: knownBuildings,
          extruded: true,
          getElevation: (feature) => Number(feature.properties?.height ?? 0),
          getFillColor: [91, 103, 117, 160],
        }),
      )
    }
    layers.push(
      new GeoJsonLayer({
        id: 'roof-extrude',
        data: roofData,
        extruded: true,
        getElevation: (feature) => Number(feature.properties?.height ?? 0),
        getFillColor: [196, 111, 49, 230],
      }),
    )
    if (constructionStage !== 'roof') {
      layers.push(new GeoJsonLayer({
        id: 'mounting-frame',
        data: { type: 'FeatureCollection', features: panelLayers.supports },
        getLineColor: [185, 195, 207, 255],
        lineWidthMinPixels: 2,
      }))
    }
    if (panelLayers.elevated.length && constructionStage === 'complete') {
      layers.push(new GeoJsonLayer({
        id: 'roof-panels',
        data: { type: 'FeatureCollection', features: panelLayers.elevated },
        getFillColor: [20, 54, 104, 250],
        getLineColor: [172, 214, 255, 255],
        lineWidthMinPixels: 1,
      }))
    }
    const overlay = new MapboxOverlay({ layers })
    map.addControl(overlay)
    overlayRef.current = overlay
    return () => {
      if (overlayRef.current) map.removeControl(overlayRef.current)
      overlayRef.current = null
    }
  }, [mode, lat, lng, buildings, roofs, modelRoofs, useOfficialTiles, panelLayers, constructionStage])

  function fitRoofs() {
    const bounds = new LngLatBounds()
    roofs.forEach((roof) => roof.ring.forEach(([lat, lng]) => bounds.extend([lng, lat])))
    if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds, { padding: 48, maxZoom: 19, duration: 500 })
  }

  useEffect(() => {
    const roof = roofsRef.current.find((roof) => roof.id === focusedRoof?.id)
    if (!roof) return
    const bounds = new LngLatBounds()
    roof.ring.forEach(([lat, lng]) => bounds.extend([lng, lat]))
    if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds, { padding: 65, maxZoom: 20, duration: 500 })
    host.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusedRoof])

  return (
    <>
      <div className="relative">
        <div ref={host} className="h-[420px] w-full sm:h-[540px]" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5 pr-10">
          {lat != null && lng != null ? (
            <button type="button" className="rounded-md border border-line bg-white px-3 py-2 text-xs font-bold shadow-sm" onClick={() => mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 500 })}>回到廠址</button>
          ) : null}
          {roofs.length ? (
            <button type="button" className="rounded-md border border-line bg-white px-3 py-2 text-xs font-bold shadow-sm" onClick={fitRoofs}>查看已選屋頂</button>
          ) : null}
          {mode === '3d' ? (
            <button type="button" className="rounded-md border border-line bg-white px-3 py-2 text-xs font-bold shadow-sm" onClick={() => {
              const map = mapRef.current
              if (map) map.easeTo({ bearing: map.getBearing() + 90, pitch: 52, duration: 450 })
            }}>旋轉 90°</button>
          ) : null}
        </div>
      </div>
      <ul aria-label="地圖圖例" className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-xs text-stone-700">
        <li><span className="mr-1.5 inline-block size-2.5 rounded-full bg-pine" />廠址定位點</li>
        {mode === '2d' && buildings.length > 0 ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm border border-stone-700 bg-white" />可點選建物</li> : null}
        {roofs.length > 0 ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-copper" />已選屋頂</li> : null}
        {exclusions.length > 0 ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-red-500" />排除區</li> : null}
        {candidate ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-emerald-400" />候選屋頂</li> : null}
        {drawing ? <li><span className="mr-1.5 inline-block size-2.5 rounded-full border border-cyan-950 bg-cyan-300" />正在繪製</li> : null}
        {panels.length > 0 ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-blue-800" />模組配置</li> : null}
        {mode === '3d' && shadows.length > 0 ? <li><span className="mr-1.5 inline-block size-2.5 rounded-sm bg-stone-600" />地面陰影</li> : null}
      </ul>
    </>
  )
}
