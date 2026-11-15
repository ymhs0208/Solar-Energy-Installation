import { PanelShadeDetails, type PanelInspection } from './PanelShadeDetails';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import * as SunCalc from 'suncalc';
import { getSolarPosition } from '../lib/solarPosition';
import * as THREE from 'three';
import {
  Box,
  Building2,
  Check,
  Compass,
  Flame,
  Layers,
  LayoutGrid,
  Map as MapIcon,
  Pause,
  PenTool,
  Play,
  RotateCcw,
  Scissors,
  Sun,
  X,
} from 'lucide-react';
import type {
  Gate1AlternativeFeeder,
  OsmBuildingFeature,
  RoofExclusionPolygon,
  TaipowerFeederItem,
  UserEngineeringParams,
} from '../types/solar';
import type { ParsedNlscBuildingMesh } from '../lib/nlsc3dTiles';
import {
  DEFAULT_USER_PARAMS,
  computeInstantRoofShadingRatio,
  computePolygonMetrics,
  createSunRayGeoJson,
  generateRoofPanelLayoutGeoJson,
  getPolygonCentroid,
  pointInPolygon2D,
  projectPolygonShadowGeoJson,
  projectToLocalMeters,
} from '../lib/solarEngine';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface RoofMapCanvasProps {
  centerLat: number;
  centerLon: number;
  hasTargetPoint: boolean;
  siteFocusRequest: number;
  siteLabel: string;
  roofPolygon: [number, number][];
  onRoofPolygonChange: (coords: [number, number][]) => void;
  exclusionPolygons?: RoofExclusionPolygon[];
  onAddExclusionPolygon?: (coords: [number, number][]) => void;
  onRemoveExclusionPolygon?: (id: string) => void;
  onClearExclusionPolygons?: () => void;
  onMapPointClick?: (lat: number, lon: number) => void;
  osmBuildings: OsmBuildingFeature[];
  nlsc3dBuildings?: ParsedNlscBuildingMesh[];
  nlsc3dLoading?: boolean;
  shadingBuildings?: OsmBuildingFeature[];
  nearbyFeeders: TaipowerFeederItem[];
  recommendedAltFeeders?: Gate1AlternativeFeeder[];
  focusCoordinate?: { lat: number; lon: number; nonce: number } | null;
  targetRoofHeightM: number;
  onApplyTargetRoofHeight?: (heightM: number) => void;
  engineeringParams?: UserEngineeringParams;
  onOpen3DSimulator?: () => void;
}

const SOLAR_TERM_PRESETS = [
  { label: '春分 3/20', month: 3, day: 20 },
  { label: '夏至 6/21', month: 6, day: 21 },
  { label: '秋分 9/23', month: 9, day: 23 },
  { label: '冬至 12/21', month: 12, day: 21 },
];

function azimuthToCardinal(deg: number): string {
  const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function formatTaipeiTime(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function RoofMapCanvas({
  centerLat,
  centerLon,
  hasTargetPoint,
  siteFocusRequest,
  siteLabel,
  roofPolygon,
  onRoofPolygonChange,
  exclusionPolygons = [],
  onAddExclusionPolygon,
  onRemoveExclusionPolygon,
  onClearExclusionPolygons,
  onMapPointClick,
  osmBuildings,
  nlsc3dBuildings = [],
  nlsc3dLoading = false,
  shadingBuildings,
  nearbyFeeders,
  recommendedAltFeeders = [],
  focusCoordinate = null,
  targetRoofHeightM,
  onApplyTargetRoofHeight,
  engineeringParams,
  onOpen3DSimulator,
}: RoofMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [baseLayer, setBaseLayer] = useState<'PHOTO2' | 'EMAP'>('PHOTO2');
  const [is3D, setIs3D] = useState(false);
  const [showPanelsOnMap, setShowPanelsOnMap] = useState(true);
  const [showShadingHeatmap, setShowShadingHeatmap] = useState(false);
  const [showNlsc3d, setShowNlsc3d] = useState(true);
  const [nlscStyle, setNlscStyle] = useState<'massing' | 'textured'>('massing');
  const userToggled3DRef = useRef(false);
  const [drawMode, setDrawMode] = useState<'roof' | 'exclusion' | null>(null);
  const isDrawing = drawMode !== null;
  const [draftVertices, setDraftVertices] = useState<[number, number][]>([]);
  const [simDate, setSimDate] = useState<{ month: number; day: number }>({ month: 6, day: 21 });
  const [simHour, setSimHour] = useState<number>(15); // 5.5 .. 18.5 (Taiwan UTC+8)
  const [isPlayingSun, setIsPlayingSun] = useState(false);

  // Refs so map click listeners & MapLibre CustomLayer always see latest state
  const drawModeRef = useRef<'roof' | 'exclusion' | null>(drawMode);
  drawModeRef.current = drawMode;
  const isDrawingRef = useRef(isDrawing);
  isDrawingRef.current = isDrawing;
  const is3DRef = useRef(is3D);
  is3DRef.current = is3D;
  const showNlsc3dRef = useRef(showNlsc3d);
  showNlsc3dRef.current = showNlsc3d;
  const siteOriginRef = useRef<[number, number]>([centerLon, centerLat]);
  siteOriginRef.current = [centerLon, centerLat];

  const threeOverlayRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer | null;
    tilesGroup: THREE.Group;
    sunLight: THREE.DirectionalLight;
    hemiLight: THREE.HemisphereLight;
  } | null>(null);

  const draftRef = useRef(draftVertices);
  draftRef.current = draftVertices;
  const onRoofPolygonChangeRef = useRef(onRoofPolygonChange);
  onRoofPolygonChangeRef.current = onRoofPolygonChange;
  const onAddExclusionRef = useRef(onAddExclusionPolygon);
  onAddExclusionRef.current = onAddExclusionPolygon;
  const onMapPointClickRef = useRef(onMapPointClick);
  onMapPointClickRef.current = onMapPointClick;
  const osmRef = useRef(osmBuildings);
  osmRef.current = osmBuildings;
  const nlscBuildingsRef = useRef(nlsc3dBuildings);
  nlscBuildingsRef.current = nlsc3dBuildings;

  const effectiveShadingBuildings = useMemo(
    () => (shadingBuildings ?? osmBuildings),
    [shadingBuildings, osmBuildings],
  );

  // Detect if the user's drawn roof overlaps an official NLSC 3D Tiles building
  const matchedTargetNlscBuilding = useMemo(() => {
    if (roofPolygon.length < 3 || nlsc3dBuildings.length === 0) return null;
    const [rLon, rLat] = getPolygonCentroid(roofPolygon);
    for (const b of nlsc3dBuildings) {
      if (b.feature.coordinates.length < 3) continue;
      const bLocal = b.feature.coordinates.map(([lon, lat]) =>
        projectToLocalMeters(lon, lat, rLon, rLat),
      );
      if (pointInPolygon2D(0, 0, bLocal)) {
        return b;
      }
    }
    return null;
  }, [roofPolygon, nlsc3dBuildings]);

  const anchorPoint = useMemo<[number, number]>(() => {
    if (roofPolygon.length >= 3) {
      return getPolygonCentroid(roofPolygon);
    }
    return [centerLon, centerLat];
  }, [roofPolygon, centerLat, centerLon]);

  // Sun position & sunrise/sunset for interactive 3D shadow timeline
  const sunInfo = useMemo(() => {
    const totalUtcMinutes = Math.round((simHour - 8) * 60);
    const date = new Date(Date.UTC(2026, simDate.month - 1, simDate.day, 0, totalUtcMinutes, 0));
    const [aLon, aLat] = anchorPoint;
    const pos = getSolarPosition(date, aLat, aLon);
    const altDeg = pos.altitudeDeg;
    const azCompassDeg = pos.compassAzimuthDeg;
    const noonDate = new Date(Date.UTC(2026, simDate.month - 1, simDate.day, 4, 0, 0));
    const times = SunCalc.getTimes(noonDate, aLat, aLon);
    return {
      date,
      pos,
      altDeg,
      azCompassDeg,
      cardinal: azimuthToCardinal(azCompassDeg),
      sunriseStr: formatTaipeiTime(times.sunrise),
      sunsetStr: formatTaipeiTime(times.sunset),
    };
  }, [simDate, simHour, anchorPoint]);

  // Instantaneous shaded fraction on target roof at slider time (uses NLSC + OSM heights)
  const instantShading = useMemo(
    () =>
      computeInstantRoofShadingRatio(
        roofPolygon,
        effectiveShadingBuildings,
        sunInfo.date,
        anchorPoint[1],
        anchorPoint[0],
        targetRoofHeightM,
      ),
    [roofPolygon, effectiveShadingBuildings, sunInfo.date, anchorPoint, targetRoofHeightM],
  );

  // Physical 2D / 3D solar panel layout on target roof (automatically skips exclusion zones & scores per-panel shading)
  const panelLayout = useMemo(() => {
    const p = engineeringParams ?? DEFAULT_USER_PARAMS;
    return generateRoofPanelLayoutGeoJson(
      roofPolygon,
      {
        targetRoofHeightM,
        canopyHeightM: p.canopyHeightM,
        setbackM: p.setbackM,
        walkwayRatioPct: p.walkwayRatioPct,
        moduleWidthM: p.moduleWidthM,
        moduleLengthM: p.moduleLengthM,
        tiltDeg: p.tiltDeg,
        azimuthDeg: p.azimuthDeg,
        excludeShadedThresholdPct: p.excludeShadedThresholdPct,
      },
      p.maxModuleCountOverride && p.maxModuleCountOverride > 0 ? p.maxModuleCountOverride : undefined,
      exclusionPolygons,
      {
        buildings: effectiveShadingBuildings,
        lat: anchorPoint[1],
        lon: anchorPoint[0],
      },
    );
  }, [
    roofPolygon,
    exclusionPolygons,
    engineeringParams,
    targetRoofHeightM,
    effectiveShadingBuildings,
    anchorPoint,
  ]);

  const [panelInspection, setPanelInspection] = useState<{ layout: typeof panelLayout; panel: PanelInspection } | null>(null);
  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;

  // Sun sweep animation timer (15-min increments)
  useEffect(() => {
    if (!isPlayingSun) return;
    const timer = window.setInterval(() => {
      setSimHour((h) => (h >= 18.25 ? 6.0 : Number((h + 0.25).toFixed(2))));
    }, 240);
    return () => window.clearInterval(timer);
  }, [isPlayingSun]);

  // Automatically enable 3D view once a site point is located (unless user manually forced 2D)
  useEffect(() => {
    if (hasTargetPoint && !userToggled3DRef.current && !isDrawing) {
      setIs3D(true);
    }
  }, [hasTargetPoint, isDrawing]);

  // Initialize MapLibre GL once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          'nlsc-photo2': {
            type: 'raster',
            tiles: ['/live/nlsc-tile/PHOTO2/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 20,
            attribution: '正射影像 © 內政部國土測繪中心 (NLSC)',
          },
          'nlsc-emap': {
            type: 'raster',
            tiles: ['/live/nlsc-tile/EMAP/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '通用電子地圖 © 內政部國土測繪中心 (NLSC)',
          },
        },
        layers: [
          {
            id: 'layer-photo2',
            type: 'raster',
            source: 'nlsc-photo2',
            layout: { visibility: 'visible' },
          },
          {
            id: 'layer-emap',
            type: 'raster',
            source: 'nlsc-emap',
            layout: { visibility: 'none' },
          },
        ],
      },
      center: [centerLon, centerLat],
      zoom: hasTargetPoint ? 17.5 : 7.5,
      pitch: 0,
      bearing: 0,
      maxPitch: 70,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      // OSM Buildings without height (outline only)
      map.addSource('osm-buildings-noheight', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'osm-buildings-noheight-line',
        type: 'line',
        source: 'osm-buildings-noheight',
        paint: {
          'line-color': '#94a3b8',
          'line-width': 1.2,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: 'osm-buildings-noheight-fill',
        type: 'fill',
        source: 'osm-buildings-noheight',
        paint: {
          'fill-color': '#cbd5e1',
          'fill-opacity': 0.14,
        },
      });

      // Ground-plane SunCalc shadows (placed BELOW 3D building extrusions)
      map.addSource('solar-shadows-ground', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'solar-shadows-ground-fill',
        type: 'fill',
        source: 'solar-shadows-ground',
        paint: {
          'fill-color': '#090d16',
          'fill-opacity': 0.46,
        },
      });

      // OSM Buildings with explicit `height` tag (3D extrusion)
      map.addSource('osm-buildings-3d', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'osm-buildings-3d-extrusion',
        type: 'fill-extrusion',
        source: 'osm-buildings-3d',
        paint: {
          'fill-extrusion-color': '#475569',
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.86,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // NLSC Official 3D Tiles Custom Three.js WebGL Layer (renderingMode: '3d')
      const nlscScene = new THREE.Scene();
      const nlscCamera = new THREE.Camera();
      const nlscHemi = new THREE.HemisphereLight('#e0f2fe', '#64748b', 0.82);
      const nlscSun = new THREE.DirectionalLight('#fffbeb', 1.65);
      nlscSun.position.set(80, 140, 220);
      const nlscTilesGroup = new THREE.Group();
      nlscScene.add(nlscHemi);
      nlscScene.add(nlscSun);
      nlscScene.add(nlscTilesGroup);

      threeOverlayRef.current = {
        scene: nlscScene,
        camera: nlscCamera,
        renderer: null,
        tilesGroup: nlscTilesGroup,
        sunLight: nlscSun,
        hemiLight: nlscHemi,
      };

      const modelScaleMat = new THREE.Matrix4();
      const projMat = new THREE.Matrix4();

      const nlscCustomLayer: maplibregl.CustomLayerInterface = {
        id: 'nlsc-3d-tiles-layer',
        type: 'custom',
        renderingMode: '3d',
        onAdd(m, gl) {
          const r = new THREE.WebGLRenderer({
            canvas: m.getCanvas(),
            context: gl,
            antialias: true,
          });
          r.autoClear = false;
          r.outputColorSpace = THREE.SRGBColorSpace;
          if (threeOverlayRef.current) {
            threeOverlayRef.current.renderer = r;
          }
        },
        render(_gl, options) {
          const overlay = threeOverlayRef.current;
          if (
            !overlay ||
            !overlay.renderer ||
            !showNlsc3dRef.current ||
            !is3DRef.current ||
            isDrawingRef.current ||
            overlay.tilesGroup.children.length === 0
          ) {
            return;
          }
          const [oLon, oLat] = siteOriginRef.current;
          const mc = maplibregl.MercatorCoordinate.fromLngLat([oLon, oLat], 0);
          const s = mc.meterInMercatorCoordinateUnits();
          modelScaleMat.makeTranslation(mc.x, mc.y, mc.z ?? 0).scale(new THREE.Vector3(s, s, s));
          projMat.fromArray(options.defaultProjectionData.mainMatrix).multiply(modelScaleMat);
          overlay.camera.projectionMatrix.copy(projMat);

          overlay.renderer.resetState();
          overlay.renderer.render(overlay.scene, overlay.camera);
        },
        onRemove() {
          if (threeOverlayRef.current?.renderer) {
            threeOverlayRef.current.renderer.dispose();
            threeOverlayRef.current.renderer = null;
          }
        },
      };
      map.addLayer(nlscCustomLayer);

      // User Target Roof Polygon (2D fill + 3D extrusion)
      map.addSource('user-roof', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'user-roof-3d',
        type: 'fill-extrusion',
        source: 'user-roof',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': [
            'case',
            ['boolean', ['get', 'hasPanels'], false],
            '#64748b',
            '#d97706',
          ],
          'fill-extrusion-height': ['get', 'heightM'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.addLayer({
        id: 'user-roof-fill',
        type: 'fill',
        source: 'user-roof',
        paint: {
          'fill-color': '#d97706',
          'fill-opacity': 0.35,
        },
      });

      // 2D solar panel array footprints (shown in 2D plan view)
      map.addSource('solar-panels-2d', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'solar-panels-2d-fill',
        type: 'fill',
        source: 'solar-panels-2d',
        filter: ['==', ['get', 'removed'], false],
        paint: {
          'fill-color': '#0f2d5e',
          'fill-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'solar-panels-2d-line',
        type: 'line',
        source: 'solar-panels-2d',
        filter: ['==', ['get', 'removed'], false],
        paint: {
          'line-color': '#93c5fd',
          'line-width': 0.8,
        },
      });

      map.addLayer({
        id: 'solar-panels-removed',
        type: 'line',
        source: 'solar-panels-2d',
        filter: ['==', ['get', 'removed'], true],
        paint: { 'line-color': '#fb923c', 'line-width': 2.5, 'line-dasharray': [2, 1] },
      });

      // 3D stepped tilted solar panels & aluminum mounting racks on top of factory roof
      map.addSource('solar-panels-3d', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'solar-panels-3d-rack',
        type: 'fill-extrusion',
        source: 'solar-panels-3d',
        filter: ['==', ['get', 'kind'], 'rack'],
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#cbd5e1',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'topM'],
          'fill-extrusion-opacity': 0.96,
        },
      });
      map.addLayer({
        id: 'solar-panels-3d-modules',
        type: 'fill-extrusion',
        source: 'solar-panels-3d',
        filter: ['==', ['get', 'kind'], 'panel'],
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#1e3a8a',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'topM'],
          'fill-extrusion-opacity': 0.98,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      // Elevated roof-level SunCalc shadows cast by taller neighbors onto target roof / panels
      map.addSource('solar-shadows-roof', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'solar-shadows-roof-2d',
        type: 'fill',
        source: 'solar-shadows-roof',
        paint: {
          'fill-color': '#090d16',
          'fill-opacity': 0.52,
        },
      });
      map.addLayer({
        id: 'solar-shadows-roof-3d',
        type: 'fill-extrusion',
        source: 'solar-shadows-roof',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#090d16',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'topM'],
          'fill-extrusion-opacity': 0.58,
        },
      });

      map.addLayer({
        id: 'user-roof-line',
        type: 'line',
        source: 'user-roof',
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.5,
        },
      });

      // Roof obstacle / exclusion cutouts (2D hatch fill + 3D rooftop mechanical block)
      map.addSource('roof-exclusions', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'roof-exclusions-3d',
        type: 'fill-extrusion',
        source: 'roof-exclusions',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#e11d48',
          'fill-extrusion-base': ['get', 'baseM'],
          'fill-extrusion-height': ['get', 'topM'],
          'fill-extrusion-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'roof-exclusions-fill',
        type: 'fill',
        source: 'roof-exclusions',
        paint: {
          'fill-color': '#e11d48',
          'fill-opacity': 0.38,
        },
      });
      map.addLayer({
        id: 'roof-exclusions-line',
        type: 'line',
        source: 'roof-exclusions',
        paint: {
          'line-color': '#be123c',
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        },
      });

      // Sun direction vector ray + marker
      map.addSource('sun-vector', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'sun-vector-line',
        type: 'line',
        source: 'sun-vector',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.5,
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'sun-vector-halo',
        type: 'circle',
        source: 'sun-vector',
        filter: ['==', ['get', 'kind'], 'sun'],
        paint: {
          'circle-radius': 11,
          'circle-color': '#fbbf24',
          'circle-opacity': 0.32,
        },
      });
      map.addLayer({
        id: 'sun-vector-dot',
        type: 'circle',
        source: 'sun-vector',
        filter: ['==', ['get', 'kind'], 'sun'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // Draft Drawing Polygon / Vertices
      map.addSource('draft-roof', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'draft-roof-line',
        type: 'line',
        source: 'draft-roof',
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.5,
          'line-dasharray': [3, 2],
        },
      });
      map.addLayer({
        id: 'draft-roof-pts',
        type: 'circle',
        source: 'draft-roof',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#d97706',
          'circle-stroke-width': 2,
        },
      });

      // Gate 1 Recommended Alternative Feeder Connection Lines
      map.addSource('alt-feeder-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'alt-feeder-lines-layer',
        type: 'line',
        source: 'alt-feeder-lines',
        paint: {
          'line-color': '#059669',
          'line-width': 2.5,
          'line-dasharray': [3, 2],
          'line-opacity': 0.9,
        },
      });

      // Nearby Taipower Feeders
      map.addSource('taipower-feeders', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'taipower-feeders-alt-halo',
        type: 'circle',
        source: 'taipower-feeders',
        filter: ['==', ['get', 'isRecommendedAlt'], true],
        paint: {
          'circle-radius': 13,
          'circle-color': '#10b981',
          'circle-opacity': 0.26,
          'circle-stroke-color': '#059669',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'taipower-feeders-circle',
        type: 'circle',
        source: 'taipower-feeders',
        paint: {
          'circle-radius': 7,
          'circle-color': [
            'case',
            ['>=', ['get', 'capacityKw'], 500],
            '#16a34a',
            ['>', ['get', 'capacityKw'], 0],
            '#d97706',
            '#dc2626',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      // Click popup on Taipower feeder markers
      map.on('click', 'taipower-feeders-circle', (e: maplibregl.MapLayerMouseEvent) => {
        if (isDrawingRef.current) return;
        const feat = e.features?.[0];
        if (!feat || feat.geometry.type !== 'Point') return;
        const props = feat.properties || {};
        new maplibregl.Popup({ offset: 12 })
          .setLngLat(feat.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font-size:12px;line-height:1.5;">
              <div style="font-weight:700;color:#0f172a;">饋線 ${props.feederId}</div>
              <div style="font-family:monospace;color:#334155;">剩餘容量：<strong>${Number(props.capacityKw).toLocaleString('zh-TW')} kW</strong></div>
              <div style="color:#64748b;">距廠址約 ${props.distanceM} m</div>
            </div>`,
          )
          .addTo(map);
      });

      const layersForInspection = ['solar-panels-3d-modules', 'solar-panels-2d-fill', 'solar-panels-removed'];
      const findPanel = (point: maplibregl.Point) =>
        map.queryRenderedFeatures(point, { layers: layersForInspection })[0];

      const buildingRaycaster = new THREE.Raycaster();
      const inverseProjection = new THREE.Matrix4();
      const findNlscBuilding = (point: maplibregl.Point) => {
        const overlay = threeOverlayRef.current;
        if (!is3DRef.current || !showNlsc3dRef.current || !overlay?.tilesGroup.children.length) return;
        const canvas = map.getCanvas();
        const x = (point.x / canvas.clientWidth) * 2 - 1;
        const y = 1 - (point.y / canvas.clientHeight) * 2;
        // The custom layer combines the map projection and local-meter transform.
        inverseProjection.copy(overlay.camera.projectionMatrix).invert();
        const near = new THREE.Vector3(x, y, -1).applyMatrix4(inverseProjection);
        const far = new THREE.Vector3(x, y, 1).applyMatrix4(inverseProjection);
        buildingRaycaster.set(near, far.sub(near).normalize());
        const hit = buildingRaycaster.intersectObjects(overlay.tilesGroup.children, false)[0];
        return hit && nlscBuildingsRef.current.find(({ mesh }) => mesh === hit.object)?.feature;
      };

      const showBuildingInfo = (b: OsmBuildingFeature, lngLat: maplibregl.LngLat, isNlsc: boolean) => {
        const popupEl = document.createElement('div');
        popupEl.className = 'space-y-1 text-xs leading-relaxed text-slate-600';
        const title = document.createElement('div');
        title.className = 'pr-3 font-semibold text-slate-900';
        title.textContent = b.name || '建物基本資訊';
        popupEl.append(title);

        const numberFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
        const { areaSqm } = computePolygonMetrics(b.coordinates);
        const fields = [
          ['資料來源', isNlsc ? '國土測繪中心 3D Tiles' : 'OpenStreetMap'],
          ['建物高度', b.heightM === null ? '未提供' : `${numberFormat.format(b.heightM)} m`],
          ['輪廓面積', areaSqm > 0 ? `約 ${numberFormat.format(areaSqm)} m²` : '未提供'],
        ];
        if (!isNlsc) fields.push(['樓層數', b.levelsTag || '未提供']);
        for (const [label, value] of fields) {
          const row = document.createElement('div');
          row.textContent = `${label}：${value}`;
          popupEl.append(row);
        }

        const popup = new maplibregl.Popup({ offset: 10 }).setLngLat(lngLat).setDOMContent(popupEl);
        if (!isNlsc) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'mt-2 cursor-pointer rounded bg-amber-700 px-2.5 py-1 font-semibold text-white hover:bg-amber-800';
          button.textContent = '套用此建物輪廓為評估屋頂';
          button.addEventListener('click', () => {
            onRoofPolygonChangeRef.current(b.coordinates);
            popup.remove();
          });
          popupEl.append(button);
        }
        popup.addTo(map);
      };

      // Give drawing, panel inspection, and feeder markers priority over building inspection.
      map.on('click', (e: maplibregl.MapMouseEvent) => {
        const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (isDrawingRef.current) {
          setDraftVertices((prev) => [...prev, pt]);
        } else {
          const feature = findPanel(e.point);
          if (feature) {
            const layout = panelLayoutRef.current;
            const index = Number(feature.properties.panelIndex);
            const removed = feature.properties.removed === true;
            const panel = removed ? layout.removedCenters[index - layout.selectedCenters.length] : layout.selectedCenters[index];
            if (panel) setPanelInspection({ layout, panel: { ...panel, removed } });
            return;
          }
          setPanelInspection(null);
          if (map.queryRenderedFeatures(e.point, { layers: ['taipower-feeders-circle'] }).length) return;
          const nlscBuilding = findNlscBuilding(e.point);
          if (nlscBuilding) {
            showBuildingInfo(nlscBuilding, e.lngLat, true);
            return;
          }
          const [osmFeature] = map.queryRenderedFeatures(e.point, {
            layers: ['osm-buildings-noheight-fill', 'osm-buildings-3d-extrusion'],
          });
          const osmBuilding = osmRef.current.find(({ id }) => id === osmFeature?.properties?.id);
          if (osmBuilding) {
            showBuildingInfo(osmBuilding, e.lngLat, false);
            return;
          }
          onMapPointClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
        }
      });

      map.on('dblclick', (e: maplibregl.MapMouseEvent) => {
        if (!isDrawingRef.current) return;
        e.preventDefault();
        if (draftRef.current.length >= 3) {
          if (drawModeRef.current === 'exclusion') {
            onAddExclusionRef.current?.(draftRef.current);
          } else {
            onRoofPolygonChangeRef.current(draftRef.current);
          }
          setDraftVertices([]);
          setDrawMode(null);
        }
      });

      setMapLoaded(true);
    });

    mapRef.current = map;
    return () => {
      setMapLoaded(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !hasTargetPoint) return;

    const pin = document.createElement('div');
    pin.className = 'site-location-pin';
    pin.setAttribute('role', 'img');
    pin.setAttribute('aria-label', siteLabel ? `定位點：${siteLabel}` : '案場定位點');
    pin.title = siteLabel || '案場定位點';
    const marker = new maplibregl.Marker({ element: pin, anchor: 'bottom' })
      .setLngLat([centerLon, centerLat])
      .addTo(map);
    return () => { marker.remove(); };
  }, [centerLat, centerLon, hasTargetPoint, mapLoaded, siteLabel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !hasTargetPoint) return;
    map.flyTo({ center: [centerLon, centerLat], zoom: 17.5, duration: 750 });
  }, [centerLat, centerLon, hasTargetPoint, mapLoaded, siteFocusRequest]);

  // Fly to focused alternative feeder or target when requested
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCoordinate) return;
    map.flyTo({
      center: [focusCoordinate.lon, focusCoordinate.lat],
      zoom: Math.max(16, Math.min(18, map.getZoom())),
      duration: 850,
    });
  }, [focusCoordinate]);

  // Base layer switcher
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setLayoutProperty('layer-photo2', 'visibility', baseLayer === 'PHOTO2' ? 'visible' : 'none');
    map.setLayoutProperty('layer-emap', 'visibility', baseLayer === 'EMAP' ? 'visible' : 'none');
  }, [baseLayer, mapLoaded]);

  // 2D / 3D pitch toggle (flattens temporarily while drawing vertices)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const show3D = is3D && !isDrawing;
    const showPanels3D = show3D && showPanelsOnMap;
    const showPanels2D = !show3D && showPanelsOnMap;

    map.setLayoutProperty('user-roof-3d', 'visibility', show3D ? 'visible' : 'none');
    map.setLayoutProperty('user-roof-fill', 'visibility', show3D ? 'none' : 'visible');
    map.setLayoutProperty('roof-exclusions-3d', 'visibility', show3D ? 'visible' : 'none');
    map.setLayoutProperty('roof-exclusions-fill', 'visibility', show3D ? 'none' : 'visible');
    map.setLayoutProperty('solar-panels-3d-rack', 'visibility', showPanels3D ? 'visible' : 'none');
    map.setLayoutProperty('solar-panels-3d-modules', 'visibility', showPanels3D ? 'visible' : 'none');
    map.setLayoutProperty('solar-panels-2d-fill', 'visibility', showPanels2D ? 'visible' : 'none');
    map.setLayoutProperty('solar-panels-2d-line', 'visibility', showPanels2D ? 'visible' : 'none');
    map.setLayoutProperty('solar-panels-removed', 'visibility', showPanels2D || showPanels3D ? 'visible' : 'none');
    map.setLayoutProperty('solar-shadows-roof-3d', 'visibility', show3D ? 'visible' : 'none');
    map.setLayoutProperty('solar-shadows-roof-2d', 'visibility', show3D ? 'none' : 'visible');

    map.easeTo({
      pitch: show3D ? 56 : 0,
      bearing: show3D ? -18 : 0,
      duration: 450,
    });
  }, [is3D, isDrawing, showPanelsOnMap, mapLoaded]);

  // Sync MapLibre 3D directional lighting + shadow opacity with SunCalc solar position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const polarDeg = Math.max(4, Math.min(88, 90 - Math.max(0, sunInfo.altDeg)));

    let lightColor = '#ffffff';
    let intensity = 0.8;
    if (sunInfo.altDeg <= 0) {
      lightColor = '#64748b';
      intensity = 0.18;
    } else if (sunInfo.altDeg < 15) {
      lightColor = '#fdba74';
      intensity = 0.68;
    } else if (sunInfo.altDeg < 35) {
      lightColor = '#fef3c7';
      intensity = 0.78;
    }

    map.setLight({
      anchor: 'map',
      color: lightColor,
      intensity,
      position: [1.5, sunInfo.azCompassDeg, polarDeg],
    });

    map.setPaintProperty(
      'solar-shadows-ground-fill',
      'fill-opacity',
      sunInfo.altDeg > 1 ? 0.46 : 0.08,
    );

    // Sync NLSC 3D Tiles Three.js SunCalc directional light
    const overlay = threeOverlayRef.current;
    if (overlay) {
      const cosAlt = Math.cos(sunInfo.pos.altitudeRad);
      const sx = -Math.sin(sunInfo.pos.southAzimuthRad) * cosAlt;
      const sy = Math.cos(sunInfo.pos.southAzimuthRad) * cosAlt; // +Y in MapLibre Mercator is South
      const sz = Math.sin(sunInfo.pos.altitudeRad);
      overlay.sunLight.position.set(sx * 260, sy * 260, Math.max(20, sz * 260));
      overlay.sunLight.color.set(lightColor);
      overlay.sunLight.intensity = sunInfo.altDeg > 0 ? intensity * 2.1 : 0.35;
      overlay.hemiLight.intensity = sunInfo.altDeg > 0 ? 0.85 : 0.35;
      map.triggerRepaint();
    }
  }, [sunInfo, mapLoaded]);

  // Sync NLSC 3D Tiles meshes & non-overlapping OSM extrusion visibility
  useEffect(() => {
    const map = mapRef.current;
    const overlay = threeOverlayRef.current;
    if (!map || !mapLoaded || !overlay) return;

    const hasNlsc = nlsc3dBuildings.length > 0;
    const showNlscActive = hasNlsc && showNlsc3d;
    map.setLayoutProperty('osm-buildings-3d-extrusion', 'visibility', 'visible');
    map.setFilter(
      'osm-buildings-3d-extrusion',
      showNlscActive ? ['!=', ['get', 'overlapsNlsc'], true] : null,
    );

    overlay.tilesGroup.clear();
    let excludeId: string | null = null;
    if (matchedTargetNlscBuilding && roofPolygon.length >= 3) {
      const roofArea = computePolygonMetrics(roofPolygon).areaSqm;
      const nlscArea = computePolygonMetrics(matchedTargetNlscBuilding.feature.coordinates).areaSqm;
      if (roofArea > 0 && nlscArea <= roofArea * 2.2) {
        excludeId = matchedTargetNlscBuilding.id;
      }
    }
    for (const b of nlsc3dBuildings) {
      if (excludeId && b.id === excludeId) continue;
      b.mesh.material = nlscStyle === 'textured' ? b.texturedMaterial : b.massingMaterial;
      if (b.edgeLines) {
        b.edgeLines.visible = nlscStyle === 'massing';
      }
      overlay.tilesGroup.add(b.mesh);
    }
    map.triggerRepaint();
  }, [nlsc3dBuildings, showNlsc3d, nlscStyle, matchedTargetNlscBuilding, roofPolygon, mapLoaded]);

  // Cursor style during drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = isDrawing ? 'crosshair' : '';
  }, [isDrawing]);

  // Sync OSM buildings, ground shadows, roof-level shadows, and SunCalc sun direction vector
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const withH = osmBuildings.filter((b) => b.heightM !== null);
    const noH = osmBuildings.filter((b) => b.heightM === null);

    const doesOverlapNlsc = (b: OsmBuildingFeature): boolean => {
      if (nlsc3dBuildings.length === 0 || b.coordinates.length < 3) return false;
      const [cLon, cLat] = getPolygonCentroid(b.coordinates);
      return nlsc3dBuildings.some((nlsc) => {
        if (nlsc.feature.coordinates.length < 3) return false;
        const local = nlsc.feature.coordinates.map(([lon, lat]) =>
          projectToLocalMeters(lon, lat, cLon, cLat),
        );
        return pointInPolygon2D(0, 0, local);
      });
    };

    const src3d = map.getSource('osm-buildings-3d') as maplibregl.GeoJSONSource | undefined;
    src3d?.setData({
      type: 'FeatureCollection',
      features: withH.map((b) => ({
        type: 'Feature',
        properties: {
          id: b.id,
          heightM: b.heightM ?? 0,
          overlapsNlsc: doesOverlapNlsc(b),
        },
        geometry: { type: 'Polygon', coordinates: [[...b.coordinates, b.coordinates[0]]] },
      })),
    });

    const srcNoH = map.getSource('osm-buildings-noheight') as maplibregl.GeoJSONSource | undefined;
    srcNoH?.setData({
      type: 'FeatureCollection',
      features: noH.map((b) => ({
        type: 'Feature',
        properties: { id: b.id },
        geometry: { type: 'Polygon', coordinates: [[...b.coordinates, b.coordinates[0]]] },
      })),
    });

    const [aLon, aLat] = anchorPoint;
    const hasRoof = roofPolygon.length >= 3;

    // Use merged NLSC + OSM height-tagged buildings for real SunCalc ground/roof shadow projection
    const shadowCastersWithH = effectiveShadingBuildings.filter((b) => b.heightM !== null);
    const neighborWithH = hasRoof
      ? shadowCastersWithH.filter((b) => {
          const bLocal = b.coordinates.map(([bLon, bLat]) =>
            projectToLocalMeters(bLon, bLat, aLon, aLat),
          );
          return !pointInPolygon2D(0, 0, bLocal);
        })
      : shadowCastersWithH;

    // 1. Ground-plane shadows (targetPlaneHeightM = 0) from ALL height-tagged OSM buildings + target factory building
    const groundShadowFeatures: Array<{
      type: 'Feature';
      properties: { kind: string };
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    }> = [];

    for (const b of neighborWithH) {
      if (b.heightM === null) continue;
      const ring = projectPolygonShadowGeoJson(b.coordinates, b.heightM, 0, sunInfo.date, aLat, aLon);
      if (ring) {
        groundShadowFeatures.push({
          type: 'Feature',
          properties: { kind: 'osm' },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    }

    if (hasRoof) {
      const targetGroundRing = projectPolygonShadowGeoJson(
        roofPolygon,
        targetRoofHeightM,
        0,
        sunInfo.date,
        aLat,
        aLon,
      );
      if (targetGroundRing) {
        groundShadowFeatures.push({
          type: 'Feature',
          properties: { kind: 'target' },
          geometry: { type: 'Polygon', coordinates: [targetGroundRing] },
        });
      }
    }

    const srcGroundShadow = map.getSource('solar-shadows-ground') as maplibregl.GeoJSONSource | undefined;
    srcGroundShadow?.setData({
      type: 'FeatureCollection',
      features: groundShadowFeatures,
    });

    // 2. Elevated roof-level shadows cast by taller neighbor OSM buildings onto target roof & 3D solar panels
    const panelOverlayOffset =
      showPanelsOnMap && panelLayout.panelCount > 0 ? panelLayout.maxRiseM + 0.05 : 0.05;
    const roofShadowFeatures = neighborWithH
      .map((b) =>
        b.heightM !== null
          ? projectPolygonShadowGeoJson(
              b.coordinates,
              b.heightM,
              targetRoofHeightM,
              sunInfo.date,
              aLat,
              aLon,
            )
          : null,
      )
      .filter((ring): ring is [number, number][] => ring !== null)
      .map((ring) => ({
        type: 'Feature' as const,
        properties: {
          baseM: targetRoofHeightM + panelOverlayOffset,
          topM: targetRoofHeightM + panelOverlayOffset + 0.18,
        },
        geometry: { type: 'Polygon' as const, coordinates: [ring] },
      }));

    const srcRoofShadow = map.getSource('solar-shadows-roof') as maplibregl.GeoJSONSource | undefined;
    srcRoofShadow?.setData({
      type: 'FeatureCollection',
      features: roofShadowFeatures,
    });

    // 3. Sun direction vector ray & sun marker
    const srcSun = map.getSource('sun-vector') as maplibregl.GeoJSONSource | undefined;
    if (srcSun) {
      const ray = hasTargetPoint || hasRoof ? createSunRayGeoJson(aLon, aLat, sunInfo.date, 95) : null;
      if (!ray) {
        srcSun.setData({ type: 'FeatureCollection', features: [] });
      } else {
        srcSun.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { kind: 'ray' },
              geometry: { type: 'LineString', coordinates: [ray.origin, ray.sunPoint] },
            },
            {
              type: 'Feature',
              properties: { kind: 'sun' },
              geometry: { type: 'Point', coordinates: ray.sunPoint },
            },
          ],
        });
      }
    }
  }, [
    osmBuildings,
    nlsc3dBuildings,
    effectiveShadingBuildings,
    sunInfo,
    anchorPoint,
    roofPolygon,
    targetRoofHeightM,
    hasTargetPoint,
    showPanelsOnMap,
    panelLayout.panelCount,
    panelLayout.maxRiseM,
    mapLoaded,
  ]);

  // Sync confirmed user roof polygon
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('user-roof') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (roofPolygon.length < 3) {
      src.setData({ type: 'FeatureCollection', features: [] });
    } else {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              heightM: targetRoofHeightM,
              hasPanels: showPanelsOnMap && panelLayout.panelCount > 0,
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[...roofPolygon, roofPolygon[0]]],
            },
          },
        ],
      });
    }
  }, [roofPolygon, targetRoofHeightM, showPanelsOnMap, panelLayout.panelCount, mapLoaded]);

  // Sync 2D & 3D solar panels placed on target roof
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src2d = map.getSource('solar-panels-2d') as maplibregl.GeoJSONSource | undefined;
    const src3d = map.getSource('solar-panels-3d') as maplibregl.GeoJSONSource | undefined;
    src2d?.setData({
      type: 'FeatureCollection',
      features: panelLayout.panel2dFeatures,
    });
    src3d?.setData({
      type: 'FeatureCollection',
      features: panelLayout.panel3dFeatures,
    });
  }, [panelLayout, mapLoaded]);

  // Toggle 2D/3D panel fill color between standard navy silicon & per-panel SunCalc shading heatmap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const heatmapExpr: maplibregl.ExpressionSpecification = [
      'step',
      ['coalesce', ['get', 'shadePct'], 0],
      '#1e40af',
      3,
      '#0284c7',
      10,
      '#eab308',
      15,
      '#f97316',
      25,
      '#dc2626',
    ];
    map.setPaintProperty(
      'solar-panels-2d-fill',
      'fill-color',
      showShadingHeatmap ? heatmapExpr : '#0f2d5e',
    );
    map.setPaintProperty(
      'solar-panels-2d-line',
      'line-color',
      showShadingHeatmap ? '#f8fafc' : '#93c5fd',
    );
    map.setPaintProperty(
      'solar-panels-3d-modules',
      'fill-extrusion-color',
      showShadingHeatmap ? heatmapExpr : '#1e3a8a',
    );
  }, [showShadingHeatmap, mapLoaded]);

  // Sync roof exclusion / obstacle polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('roof-exclusions') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: exclusionPolygons
        .filter((ex) => ex.coordinates.length >= 3)
        .map((ex) => ({
          type: 'Feature' as const,
          properties: {
            id: ex.id,
            label: ex.label,
            baseM: targetRoofHeightM,
            topM: targetRoofHeightM + 1.2,
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[...ex.coordinates, ex.coordinates[0]]],
          },
        })),
    });
  }, [exclusionPolygons, targetRoofHeightM, mapLoaded]);

  // Sync draft vertices (color-coded for roof vs obstacle cutout)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = map.getSource('draft-roof') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const lineColor = drawMode === 'exclusion' ? '#e11d48' : '#f59e0b';
    map.setPaintProperty('draft-roof-line', 'line-color', lineColor);
    map.setPaintProperty('draft-roof-pts', 'circle-stroke-color', lineColor);

    const features: Array<{
      type: 'Feature';
      properties: Record<string, unknown>;
      geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] };
    }> = draftVertices.map((pt) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: pt },
    }));

    if (draftVertices.length >= 2) {
      const lineCoords =
        draftVertices.length >= 3 ? [...draftVertices, draftVertices[0]] : draftVertices;
      features.push({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: lineCoords },
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }, [draftVertices, drawMode, mapLoaded]);

  // Sync nearby Taipower feeders & Gate 1 recommended alternative feeder connection lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const altSet = new Set(recommendedAltFeeders.map((f) => f.feederId));
    const src = map.getSource('taipower-feeders') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: nearbyFeeders.map((f) => ({
        type: 'Feature',
        properties: {
          feederId: f.feederId,
          capacityKw: f.capacityKw,
          distanceM: f.distanceM,
          isRecommendedAlt: altSet.has(f.feederId),
        },
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      })),
    });

    const lineSrc = map.getSource('alt-feeder-lines') as maplibregl.GeoJSONSource | undefined;
    lineSrc?.setData({
      type: 'FeatureCollection',
      features: recommendedAltFeeders.map((alt) => ({
        type: 'Feature' as const,
        properties: {
          feederId: alt.feederId,
          distanceM: alt.distanceM,
          capacityKw: alt.capacityKw,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [anchorPoint, [alt.lon, alt.lat]],
        },
      })),
    });
  }, [nearbyFeeders, recommendedAltFeeders, anchorPoint, mapLoaded]);

  const finishDrawing = () => {
    if (draftVertices.length >= 3) {
      if (drawMode === 'exclusion') {
        onAddExclusionPolygon?.(draftVertices);
      } else {
        onRoofPolygonChange(draftVertices);
      }
      setDraftVertices([]);
      setDrawMode(null);
    }
  };

  const cancelOrClearDrawing = () => {
    setDraftVertices([]);
    setDrawMode(null);
    onRoofPolygonChange([]);
    onClearExclusionPolygons?.();
  };

  const formatHour = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  const osmWithHeightCount = useMemo(
    () => osmBuildings.filter((b) => b.heightM !== null).length,
    [osmBuildings],
  );

  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

  return (
    <div className="relative w-full h-full min-h-[480px] bg-slate-200 overflow-hidden select-none">
      <div ref={containerRef} className="w-full h-full" />

      {/* Top-Left Map Toolbar Rail (Row 1: Primary Roof Actions · Row 2: Layer & Overlay Toggles) */}
      <div className="absolute top-3 left-3 right-12 z-10 flex flex-col items-start gap-1.5 pointer-events-none">
        {/* Row 1: Primary Roof Polygon & Obstacle Exclusion Actions (Anchored, never shifts) */}
        {!isDrawing ? (
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-1.5 bg-white/95 border border-slate-200 rounded-lg p-1 shadow-md shadow-slate-900/10">
            <button
              type="button"
              onClick={() => {
                setDraftVertices([]);
                setDrawMode('roof');
              }}
              className="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5" />
              <span>{roofPolygon.length >= 3 ? '重新框選屋頂' : '框選屋頂多邊形'}</span>
            </button>
            {roofPolygon.length >= 3 && onAddExclusionPolygon && (
              <button
                type="button"
                onClick={() => {
                  setDraftVertices([]);
                  setDrawMode('exclusion');
                }}
                className="h-7 inline-flex items-center gap-1.5 px-3 text-xs font-semibold bg-rose-700 hover:bg-rose-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="於屋頂內框選水塔、採光罩或空調主機，3D 光電板將自動避開"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>挖空障礙物</span>
              </button>
            )}
            {roofPolygon.length >= 3 && (
              <button
                type="button"
                onClick={cancelOrClearDrawing}
                className="h-7 inline-flex items-center gap-1 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-950 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>清除</span>
              </button>
            )}
          </div>
        ) : (
          <div
            className={`pointer-events-auto min-h-9 py-1 inline-flex flex-wrap items-center gap-2 bg-white/95 border rounded-lg px-3 shadow-md shadow-slate-900/15 ${
              drawMode === 'exclusion' ? 'border-rose-400' : 'border-amber-400'
            }`}
          >
            <span
              className={`text-xs font-semibold whitespace-nowrap ${
                drawMode === 'exclusion' ? 'text-rose-800' : 'text-amber-800'
              }`}
            >
              {drawMode === 'exclusion'
                ? `點選障礙物輪廓 (${draftVertices.length}) · 雙擊挖空`
                : `點選屋頂頂點 (${draftVertices.length}) · 雙擊結束`}
            </span>
            {draftVertices.length >= 3 && (
              <button
                type="button"
                onClick={finishDrawing}
                className="h-7 inline-flex items-center gap-1 px-2.5 text-xs font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <Check className="w-3 h-3" />
                <span>{drawMode === 'exclusion' ? '完成挖空' : '完成框選'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDraftVertices([]);
                setDrawMode(null);
              }}
              className="h-7 px-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              取消
            </button>
          </div>
        )}

        {/* Row 2: Compact Map Layer & Overlay Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Base Layer Switcher */}
          <div className="pointer-events-auto h-8 inline-flex items-center bg-white/95 border border-slate-200 rounded-lg p-0.5 shadow-sm shadow-slate-900/5">
            <button
              type="button"
              onClick={() => setBaseLayer('PHOTO2')}
              className={`h-7 inline-flex items-center gap-1 px-2 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                baseLayer === 'PHOTO2'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/70'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>正射影像</span>
            </button>
            <button
              type="button"
              onClick={() => setBaseLayer('EMAP')}
              className={`h-7 inline-flex items-center gap-1 px-2 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                baseLayer === 'EMAP'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/70'
              }`}
            >
              <MapIcon className="w-3 h-3" />
              <span>電子地圖</span>
            </button>
          </div>

          {/* 2D / 3D Map Pitch Toggle */}
          <button
            type="button"
            onClick={() => {
              userToggled3DRef.current = true;
              setIs3D((v) => !v);
            }}
            className={`pointer-events-auto h-8 inline-flex items-center gap-1.5 px-2.5 text-[11px] font-semibold border rounded-lg shadow-sm shadow-slate-900/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              is3D
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white/95 text-slate-800 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>{is3D ? '3D 視角' : '2D 俯視'}</span>
          </button>

          {/* NLSC Official 3D Tiles Toggle */}
          {(nlsc3dLoading || nlsc3dBuildings.length > 0) && (
            <div className="pointer-events-auto h-8 inline-flex items-center bg-white/95 border border-slate-200 rounded-lg p-0.5 shadow-sm shadow-slate-900/5">
              <button
                type="button"
                onClick={() => {
                  setShowNlsc3d((v) => !v);
                  if (!is3D && !isDrawing) setIs3D(true);
                }}
                className={`h-7 inline-flex items-center gap-1 px-2 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showNlsc3d
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-3 h-3" />
                <span className="tabular-nums">
                  {nlsc3dLoading
                    ? '3D Tiles...'
                    : `國土 3D (${nlsc3dBuildings.length})`}
                </span>
              </button>
              {showNlsc3d && nlsc3dBuildings.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNlscStyle((s) => (s === 'massing' ? 'textured' : 'massing'))}
                  className="h-7 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  title="切換 3D Tiles 白模量體 / 官方航照貼圖"
                >
                  {nlscStyle === 'massing' ? '白模' : '貼圖'}
                </button>
              )}
            </div>
          )}

          {roofPolygon.length >= 3 && (
            <button
              type="button"
              onClick={() => setShowPanelsOnMap((v) => !v)}
              className={`pointer-events-auto h-8 inline-flex items-center gap-1 px-2.5 text-[11px] font-semibold border rounded-lg shadow-sm shadow-slate-900/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showPanelsOnMap
                  ? 'bg-blue-950 text-blue-100 border-blue-900'
                  : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              <span className="tabular-nums">
                {showPanelsOnMap ? `光電板 (${panelLayout.panelCount})` : '顯示光電板'}
              </span>
            </button>
          )}

          {roofPolygon.length >= 3 && showPanelsOnMap && (
            <button
              type="button"
              onClick={() => setShowShadingHeatmap((v) => !v)}
              className={`pointer-events-auto h-8 inline-flex items-center gap-1 px-2.5 text-[11px] font-semibold border rounded-lg shadow-sm shadow-slate-900/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showShadingHeatmap
                  ? 'bg-orange-600 text-white border-orange-700'
                  : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title="切換每片模組之全年逐時 SunCalc 遮蔭熱圖"
            >
              <Flame className="w-3 h-3" />
              <span className="tabular-nums">
                {panelLayout.shadedOver15Count > 0
                  ? `遮蔭熱圖 (${panelLayout.shadedOver15Count}片>15%)`
                  : '遮蔭熱圖'}
              </span>
            </button>
          )}
        </div>

        {/* Drawn Exclusion Zones Floating Manager */}
        {exclusionPolygons.length > 0 && (
          <div className="pointer-events-auto max-w-sm bg-white/95 border border-rose-200 rounded-lg px-3 py-2 shadow-sm shadow-slate-900/5 space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-rose-900">
              <span>已挖空屋頂障礙區 ({exclusionPolygons.length})</span>
              {onClearExclusionPolygons && (
                <button
                  type="button"
                  onClick={onClearExclusionPolygons}
                  className="text-[11px] font-medium text-slate-500 hover:text-rose-700 cursor-pointer transition-colors"
                >
                  全部清除
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {exclusionPolygons.map((ex, idx) => (
                <span
                  key={ex.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] bg-rose-50 text-rose-900 border border-rose-200 rounded-md"
                >
                  <span>{ex.label || `障礙 #${idx + 1}`}</span>
                  {onRemoveExclusionPolygon && (
                    <button
                      type="button"
                      onClick={() => onRemoveExclusionPolygon(ex.id)}
                      className="text-rose-600 hover:text-rose-900 cursor-pointer"
                      aria-label={`移除 ${ex.label}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPanelsOnMap && panelInspection?.layout === panelLayout && !isDrawing && (
        <div className="absolute top-24 left-3 z-20 max-w-[calc(100%_-_24px)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <PanelShadeDetails panel={panelInspection.panel}>
            <button type="button" onClick={() => setPanelInspection(null)} aria-label="關閉遮蔭明細" className="cursor-pointer"><X size={16} /></button>
          </PanelShadeDetails>
        </div>
      )}

      {/* Bottom-Right MapLibre 3D + SunCalc Time Slider Panel */}
      <div className="absolute bottom-7 left-3 right-3 md:left-auto md:right-3 md:w-[min(440px,calc(100%_-_24px))] z-10 bg-white/96 border border-slate-200 rounded-xl px-4 py-3 shadow-lg shadow-slate-900/10">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-950 whitespace-nowrap">
            <Sun className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>SunCalc 遮蔭 · {simDate.month}/{simDate.day}（臺灣時間）</span>
          </div>
          <div className="flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-600 whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              <Compass className="w-3 h-3 text-amber-600" />
              {sunInfo.altDeg > 0
                ? `${sunInfo.azCompassDeg.toFixed(0)}°(${sunInfo.cardinal}) · 仰角 ${sunInfo.altDeg.toFixed(1)}°`
                : '太陽低於地平線'}
            </span>
            <button
              type="button"
              onClick={() => setTimelineCollapsed((v) => !v)}
              className="text-[11px] font-sans font-medium text-slate-500 hover:text-slate-900 underline decoration-slate-300 underline-offset-2 cursor-pointer transition-colors"
            >
              {timelineCollapsed ? '展開' : '收合'}
            </button>
          </div>
        </div>

        {!timelineCollapsed && (
          <div className="mt-2.5 space-y-2.5">
            {/* Solar Term Quick Presets + Monthly Selector */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1">
                {SOLAR_TERM_PRESETS.map((preset) => {
                  const active = simDate.month === preset.month && simDate.day === preset.day;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setSimDate({ month: preset.month, day: preset.day });
                        if (!is3D && !isDrawing) setIs3D(true);
                      }}
                      className={`h-7 px-2.5 text-[11px] font-mono rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <select
                value={simDate.month}
                onChange={(e) => {
                  setSimDate({ month: Number(e.target.value), day: 15 });
                  if (!is3D && !isDrawing) setIs3D(true);
                }}
                className="h-7 text-[11px] font-mono border border-slate-200 rounded-md px-2 bg-white text-slate-800 shrink-0"
                aria-label="選擇模擬月份"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}月15日
                  </option>
                ))}
              </select>
            </div>

            {/* Slider & Play Controls */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  if (!is3D && !isDrawing) setIs3D(true);
                  setIsPlayingSun((p) => !p);
                }}
                className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700 shrink-0 cursor-pointer transition-colors"
                title={isPlayingSun ? '暫停日照模擬' : '播放單日陰影變化'}
                aria-label={isPlayingSun ? '暫停日照模擬' : '播放單日陰影變化'}
              >
                {isPlayingSun ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>

              <input
                type="range"
                min={5.5}
                max={18.5}
                step={0.25}
                value={simHour}
                onChange={(e) => {
                  setSimHour(Number(e.target.value));
                  if (!is3D && !isDrawing) setIs3D(true);
                }}
                className="flex-1 solar-slider cursor-pointer"
                aria-label="拖動時間軸調整太陽方位與建物陰影"
              />

              <span className="text-xs font-mono tabular-nums font-bold text-slate-900 w-12 text-right shrink-0">
                {formatHour(simHour)}
              </span>
            </div>

            {/* Live Telemetry & Shadow Legend */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
              <div className="font-mono tabular-nums">
                日出 {sunInfo.sunriseStr} · 日落 {sunInfo.sunsetStr}
                {roofPolygon.length >= 3 && (
                  <span className="ml-1.5 text-slate-950 font-semibold">
                    · 屋頂遮蔭 {(instantShading.ratio * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-500 whitespace-nowrap">
                {roofPolygon.length >= 3 && showPanelsOnMap && !showShadingHeatmap && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#1e3a8a] inline-block" />
                    光電 ({panelLayout.panelCount})
                  </span>
                )}
                {roofPolygon.length >= 3 && showPanelsOnMap && showShadingHeatmap && (
                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
                    <span className="inline-flex items-center gap-0.5"><span className="w-2 h-2 rounded-xs bg-[#1e40af] inline-block" />&lt;3%</span>
                    <span className="inline-flex items-center gap-0.5"><span className="w-2 h-2 rounded-xs bg-[#eab308] inline-block" />10%</span>
                    <span className="inline-flex items-center gap-0.5"><span className="w-2 h-2 rounded-xs bg-[#f97316] inline-block" />15%</span>
                    <span className="inline-flex items-center gap-0.5"><span className="w-2 h-2 rounded-xs bg-[#dc2626] inline-block" />≥25%</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-slate-900/55 inline-block" />
                  遮蔭
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-600 inline-block" />
                  屋頂 ({targetRoofHeightM}m)
                </span>
              </div>
            </div>

            {matchedTargetNlscBuilding && matchedTargetNlscBuilding.feature.heightM && (
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-emerald-800">
                <span className="font-mono tabular-nums">
                  國土測繪 3D 建物實測高度：{matchedTargetNlscBuilding.feature.heightM} m
                </span>
                {onApplyTargetRoofHeight &&
                  Math.abs(matchedTargetNlscBuilding.feature.heightM - targetRoofHeightM) > 0.3 && (
                    <button
                      type="button"
                      onClick={() => onApplyTargetRoofHeight(matchedTargetNlscBuilding.feature.heightM!)}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-md cursor-pointer whitespace-nowrap transition-colors"
                    >
                      套用實測高度
                    </button>
                  )}
              </div>
            )}

            {hasTargetPoint && osmWithHeightCount === 0 && nlsc3dBuildings.length === 0 && !nlsc3dLoading && (
              <div className="text-[10px] text-slate-500">
                註：周圍無 OSM <code className="font-mono">height</code> 標籤建物且未檢出 3D Tiles，僅繪製目標廠房自身對地面之投影遮蔭。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
