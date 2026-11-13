import { useEffect, useRef } from 'react'
import { Map, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { Tile3DLayer } from '@deck.gl/geo-layers'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Building, Roof } from '../lib/types'

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
  roofs,
  draft,
  panels,
  shadows,
  mode,
  drawing,
  basemap,
  onAddPoint,
  onPickBuilding,
  onTilesetIssue,
}: {
  lat: number | null
  lng: number | null
  buildings: Building[]
  roofs: Roof[]
  draft: Ring
  panels: Ring[]
  shadows: Ring[]
  mode: '2d' | '3d'
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
  drawingRef.current = drawing
  modeRef.current = mode
  addRef.current = onAddPoint
  pickRef.current = onPickBuilding
  issueRef.current = onTilesetIssue

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
    map.doubleClickZoom.disable()
    map.on('load', () => {
      map.addSource('buildings', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('roofs', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('panels', { type: 'geojson', data: polygonCollection([]) })
      map.addSource('shadows', { type: 'geojson', data: polygonCollection([]) })
      map.addLayer({ id: 'shadows', type: 'fill', source: 'shadows', paint: { 'fill-color': '#1c1915', 'fill-opacity': 0.28 } })
      map.addLayer({ id: 'buildings-fill', type: 'fill', source: 'buildings', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.18 } })
      map.addLayer({ id: 'buildings-line', type: 'line', source: 'buildings', paint: { 'line-color': '#ffffff', 'line-width': 2 } })
      map.addLayer({ id: 'roofs-fill', type: 'fill', source: 'roofs', paint: { 'fill-color': '#b85a28', 'fill-opacity': 0.45 } })
      map.addLayer({ id: 'roofs-line', type: 'line', source: 'roofs', paint: { 'line-color': '#8a3e16', 'line-width': 2 } })
      map.addLayer({ id: 'panels', type: 'fill', source: 'panels', paint: { 'fill-color': '#1d4e89', 'fill-opacity': 0.55 } })
      map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#b85a28', 'fill-opacity': 0.25 } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#b85a28', 'line-width': 2, 'line-dasharray': [2, 1] } })
    })
    map.on('click', (event) => {
      if (modeRef.current === '3d') return
      if (drawingRef.current) {
        addRef.current([event.lngLat.lat, event.lngLat.lng])
        return
      }
      const hits = map.queryRenderedFeatures(event.point, { layers: ['buildings-fill'] })
      const id = hits[0]?.properties?.id
      if (id) pickRef.current(String(id))
    })
    mapRef.current = map
    return () => {
      overlayRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    map.setLayoutProperty('photo', 'visibility', basemap === 'photo' ? 'visible' : 'none')
    map.setLayoutProperty('osm', 'visibility', basemap === 'osm' ? 'visible' : 'none')
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const set = (id: string, data: GeoJSON.FeatureCollection) => {
        ;(map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
      }
      set('buildings', polygonCollection(buildings.map((item) => ({ id: item.id, ring: item.ring, height: item.heightM }))))
      set('roofs', polygonCollection(roofs.map((item) => ({ id: item.id, ring: item.ring, height: item.heightM }))))
      set('panels', polygonCollection(panels.map((ring, index) => ({ id: String(index), ring, height: null }))))
      set('shadows', polygonCollection(shadows.map((ring, index) => ({ id: String(index), ring, height: null }))))
      const draftLine = draft.map(([latP, lngP]) => [lngP, latP] as [number, number])
      const draftFeature =
        draft.length >= 3
          ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [closeRing(draft)] } }
          : draft.length >= 2
            ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: draftLine } }
            : null
      set('draft', { type: 'FeatureCollection', features: draftFeature ? [draftFeature] : [] })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [buildings, roofs, draft, panels, shadows])

  useEffect(() => {
    if (lat == null || lng == null) return
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 700 })
  }, [lat, lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: mode === '3d' ? 58 : 0, bearing: mode === '3d' ? -18 : 0, duration: 500 })
    if (mode !== '3d') {
      if (overlayRef.current) {
        map.removeControl(overlayRef.current)
        overlayRef.current = null
      }
      return
    }
    const tileset = lat != null && lng != null ? tilesetFor(lat, lng) : null
    const roofData = polygonCollection(roofs.filter((roof) => roof.heightM != null).map((roof) => ({ id: roof.id, ring: roof.ring, height: roof.heightM })))
    const knownBuildings = polygonCollection(
      buildings.filter((item) => item.heightM != null).map((item) => ({ id: item.id, ring: item.ring, height: item.heightM })),
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
          onTileError: () => issueRef.current('部分三維圖磚載入失敗，可重試或改看平面輪廓。'),
        }),
      )
    } else {
      layers.push(
        new GeoJsonLayer({
          id: 'osm-extrude',
          data: knownBuildings,
          extruded: true,
          getElevation: (feature) => Number(feature.properties?.height ?? 0),
          getFillColor: [70, 70, 70, 160],
        }),
      )
    }
    layers.push(
      new GeoJsonLayer({
        id: 'roof-extrude',
        data: roofData,
        extruded: true,
        getElevation: (feature) => Number(feature.properties?.height ?? 0),
        getFillColor: [184, 90, 40, 180],
      }),
    )
    const overlay = new MapboxOverlay({ layers })
    map.addControl(overlay)
    overlayRef.current = overlay
    return () => {
      if (overlayRef.current) map.removeControl(overlayRef.current)
      overlayRef.current = null
    }
  }, [mode, lat, lng, buildings, roofs])

  return <div ref={host} className="h-[560px] w-full" />
}
