import { PanelShadeDetails, type PanelInspection } from './PanelShadeDetails';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getSolarPosition, taiwanSimulationDate } from '../lib/solarPosition';
import { Building2, ChevronDown, ChevronUp, Compass, Flame, Pause, Play, Sun, Video } from 'lucide-react';
import type { OsmBuildingFeature, RoofExclusionPolygon, UserEngineeringParams } from '../types/solar';
import type { ParsedNlscBuildingMesh } from '../lib/nlsc3dTiles';
import {
  buildExclusionObstaclesGroup,
  buildFactoryBuildingGroup,
  buildNlscContextGroup,
  buildOsmFallbackGroup,
  buildSolarArrayGroup,
  createCompassRingTexture,
  createGroundApronTexture,
  type NlscContextMeshEntry,
} from '../lib/solar3dBuilders';
import {
  generateRoofPanelLayoutGeoJson,
  getPolygonCentroid,
  pointInPolygon2D,
  projectToLocalMeters,
} from '../lib/solarEngine';

interface Solar3DSimulatorProps {
  centerLat: number;
  centerLon: number;
  roofPolygon: [number, number][];
  exclusionPolygons?: RoofExclusionPolygon[];
  osmBuildings: OsmBuildingFeature[];
  nlsc3dBuildings?: ParsedNlscBuildingMesh[];
  params: UserEngineeringParams;
  annualGenKwh: number;
  annualShadingLossPct: number;
  onSwitchTo2D: () => void;
  onToggleShadedPanels: () => void;
}

type CameraPreset = 'iso' | 'top' | 'side' | 'detail' | 'sun';

// Reusable module-scope math helpers (zero GC in render loop)
const _vTarget = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

// Compute solar position in Three.js world coordinates (X=East, Y=Up, Z=South)
function sunDirectionVector(date: Date, lat: number, lon: number): {
  dir: THREE.Vector3;
  altDeg: number;
  azCompassDeg: number;
} {
  const pos = getSolarPosition(date, lat, lon);
  const alt = pos.altitudeRad;
  const az = pos.southAzimuthRad; // radians from South, positive Westward
  const cosAlt = Math.cos(alt);
  const x = -Math.sin(az) * cosAlt; // East = +X, West = -X
  const y = Math.sin(alt); // Up = +Y
  const z = Math.cos(az) * cosAlt; // South = +Z, North = -Z
  return {
    dir: new THREE.Vector3(x, y, z).normalize(),
    altDeg: pos.altitudeDeg,
    azCompassDeg: pos.compassAzimuthDeg,
  };
}

export function Solar3DSimulator({
  centerLat,
  centerLon,
  roofPolygon,
  exclusionPolygons = [],
  osmBuildings,
  nlsc3dBuildings = [],
  params,
  annualGenKwh,
  annualShadingLossPct,
  onSwitchTo2D,
  onToggleShadedPanels,
}: Solar3DSimulatorProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [panelInspection, setPanelInspection] = useState<PanelInspection | null>(null);
  const [simMonth, setSimMonth] = useState<number>(6);
  const [simHour, setSimHour] = useState<number>(15);
  const [isPlayingSun, setIsPlayingSun] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [contextLost, setContextLost] = useState<boolean>(false);
  const [placed3DPanels, setPlaced3DPanels] = useState<number>(0);
  const [renderedNlscCount, setRenderedNlscCount] = useState<number>(0);
  const [nlscStyle, setNlscStyle] = useState<'massing' | 'textured'>('textured');
  const [showShadingHeatmap, setShowShadingHeatmap] = useState<boolean>(false);
  const [heatmapStats, setHeatmapStats] = useState<{ shadedOver15: number; maxShadePct: number }>({
    shadedOver15: 0,
    maxShadePct: 0,
  });
  const [activePreset, setActivePreset] = useState<CameraPreset | null>('iso');

  const camTransitionRef = useRef<{
    active: boolean;
    targetPos: THREE.Vector3;
    targetLook: THREE.Vector3;
  }>({
    active: false,
    targetPos: new THREE.Vector3(48, 38, 52),
    targetLook: new THREE.Vector3(0, 6, 0),
  });

  const sceneSpanRef = useRef<number>(40);
  const nlscEntriesRef = useRef<NlscContextMeshEntry[]>([]);
  const nlscStyleRef = useRef(nlscStyle);
  nlscStyleRef.current = nlscStyle;
  const showHeatmapRef = useRef(showShadingHeatmap);
  showHeatmapRef.current = showShadingHeatmap;
  const setArrayHeatmapRef = useRef<((enabled: boolean) => void) | null>(null);

  const updateSunRef = useRef<((m: number, h: number) => void) | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);

  const [cLon, cLat] = useMemo(
    () => (roofPolygon.length >= 3 ? getPolygonCentroid(roofPolygon) : [centerLon, centerLat]),
    [roofPolygon, centerLon, centerLat],
  );

  const currentSunInfo = useMemo(() => {
    const date = taiwanSimulationDate(2026, simMonth, 15, simHour);
    return sunDirectionVector(date, cLat, cLon);
  }, [simMonth, simHour, cLat, cLon]);

  // Sun sweep animation timer
  useEffect(() => {
    if (!isPlayingSun) return;
    const id = window.setInterval(() => {
      setSimHour((h) => (h >= 17.5 ? 6.5 : Number((h + 0.25).toFixed(2))));
    }, 120);
    return () => window.clearInterval(id);
  }, [isPlayingSun]);

  // Update sun light & sky whenever slider moves
  useEffect(() => {
    updateSunRef.current?.(simMonth, simHour);
    requestRenderRef.current?.();
  }, [simMonth, simHour]);

  // Toggle NLSC 3D surrounding buildings between textured aerial meshes & white architectural massing
  useEffect(() => {
    for (const entry of nlscEntriesRef.current) {
      entry.mesh.material = nlscStyle === 'textured' ? entry.texturedMaterial : entry.massingMaterial;
      entry.edgeLines.visible = nlscStyle === 'massing';
    }
    requestRenderRef.current?.();
  }, [nlscStyle]);

  // Toggle 3D PV array between realistic silicon laminate and per-panel annual shading heatmap
  useEffect(() => {
    setArrayHeatmapRef.current?.(showShadingHeatmap);
    requestRenderRef.current?.();
  }, [showShadingHeatmap]);

  // Build & manage Three.js 3D scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container || roofPolygon.length < 3) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = Math.max(300, container.clientWidth);
    const height = Math.max(300, container.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color('#dbeafe');
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(skyColor.getHex(), 0.0018);

    // Studio Environment Map (PMREM RoomEnvironment) for metallic racking & glass clearcoat reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 1400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.minDistance = 8;
    controls.maxDistance = 380;

    controls.addEventListener('start', () => {
      camTransitionRef.current.active = false;
      setActivePreset(null);
    });

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const disposables: Array<{ dispose: () => void }> = [envTex];

    // Project target roof polygon to local meters (X=East, Y_local=North -> Z=-Y_local)
    const roofLocal = roofPolygon.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of roofLocal) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(22, maxX - minX, maxY - minY);
    sceneSpanRef.current = span;
    const roofH = Math.max(2.5, params.targetRoofHeightM);

    // 1. Industrial Park Ground Apron + Grid + Architectural Compass Ring
    const apronTex = createGroundApronTexture(maxAniso);
    const groundGeo = new THREE.PlaneGeometry(960, 960);
    const groundMat = new THREE.MeshStandardMaterial({
      map: apronTex,
      color: '#e2e8f0',
      roughness: 0.92,
      metalness: 0.02,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
    disposables.push(apronTex, groundGeo, groundMat);

    const gridHelper = new THREE.GridHelper(360, 36, '#94a3b8', '#cbd5e1');
    gridHelper.position.y = 0.015;
    scene.add(gridHelper);

    const compassTex = createCompassRingTexture(maxAniso);
    const compassSize = Math.max(68, span * 1.48);
    const compassGeo = new THREE.PlaneGeometry(compassSize, compassSize);
    const compassMat = new THREE.MeshBasicMaterial({
      map: compassTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const compassMesh = new THREE.Mesh(compassGeo, compassMat);
    compassMesh.rotation.x = -Math.PI / 2;
    compassMesh.position.y = 0.03;
    scene.add(compassMesh);
    disposables.push(compassTex, compassGeo, compassMat);

    // Position initial camera proportional to building span
    const initDist = Math.max(40, span * 1.32);
    camera.position.set(initDist * 0.72, roofH + initDist * 0.56, initDist * 0.84);
    controls.target.set(0, roofH * 0.65, 0);
    controls.update();

    // 2. Compute Solar Panel Grid & Maintenance Walkway Rows
    const modW = Math.max(0.6, params.moduleWidthM);
    const modL = Math.max(0.8, params.moduleLengthM);
    const tiltRad = THREE.MathUtils.degToRad(Math.max(1, Math.min(45, params.tiltDeg)));
    const yawRad = THREE.MathUtils.degToRad(180 - params.azimuthDeg);

    const rowStep = modL * Math.cos(tiltRad) + 0.45;
    const aisleEveryNRows =
      params.walkwayRatioPct >= 10 ? Math.max(2, Math.round(100 / Math.max(10, params.walkwayRatioPct))) : 99;

    const setback = Math.max(0.3, params.setbackM);
    const cosYaw = Math.cos(yawRad);
    const sinYaw = Math.sin(yawRad);

    const minDistToEdge = (px: number, py: number) => {
      let minD = Infinity;
      for (let i = 0; i < roofLocal.length; i++) {
        const [x1, y1] = roofLocal[i];
        const [x2, y2] = roofLocal[(i + 1) % roofLocal.length];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
        const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        if (d < minD) minD = d;
      }
      return minD;
    };

    const exclusionLocals = exclusionPolygons
      .filter((ex) => ex.coordinates.length >= 3)
      .map((ex) => ex.coordinates.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat)));

    const isInsideAnyExclusion = (px: number, py: number) => {
      for (const exPts of exclusionLocals) {
        if (pointInPolygon2D(px, py, exPts)) return true;
      }
      return false;
    };

    const walkwayRows: Array<{ uStart: number; uEnd: number; v: number }> = [];
    const maxExtent = Math.hypot(maxX - minX, maxY - minY) * 0.65;

    let rowIdx = 0;
    for (let v = -maxExtent; v <= maxExtent; v += rowStep) {
      rowIdx++;
      if (rowIdx % aisleEveryNRows === 0) {
        let uMin = Infinity;
        let uMax = -Infinity;
        for (let u = -maxExtent; u <= maxExtent; u += 1.0) {
          const wx = u * cosYaw + v * sinYaw;
          const wz = -u * sinYaw + v * cosYaw;
          const px = wx;
          const py = -wz;
          if (pointInPolygon2D(px, py, roofLocal) && minDistToEdge(px, py) >= setback && !isInsideAnyExclusion(px, py)) {
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
          }
        }
        if (Number.isFinite(uMin) && uMax - uMin > 1.2) {
          walkwayRows.push({ uStart: uMin, uEnd: uMax, v });
        }
        continue;
      }

    }

    const layout = generateRoofPanelLayoutGeoJson(
      roofPolygon,
      params,
      params.maxModuleCountOverride && params.maxModuleCountOverride > 0 ? params.maxModuleCountOverride : undefined,
      exclusionPolygons,
      { buildings: osmBuildings, lat: centerLat, lon: centerLon },
    );
    const selectedPanels = layout.selectedCenters.map(({ cx, cy, rowIndex, shadePct }) => ({
      x: cx,
      z: -cy,
      u: cx * cosYaw + cy * sinYaw,
      v: cx * sinYaw - cy * cosYaw,
      rowIndex,
      shadePct,
    }));
    setHeatmapStats({
      shadedOver15: layout.shadedOver15Count,
      maxShadePct: selectedPanels.reduce((max, panel) => Math.max(max, panel.shadePct), 0),
    });
    setPlaced3DPanels(selectedPanels.length);

    // 3. Composite Multi-Part Factory Building + Mechanical Obstacles + Multi-Part PV Array
    const factoryGroup = buildFactoryBuildingGroup({
      roofLocal,
      roofH,
      roofType: params.roofType,
      walkwayRows,
      cosYaw,
      sinYaw,
      maxAniso,
      disposables,
    });
    scene.add(factoryGroup);

    if (exclusionLocals.length > 0) {
      const obsGroup = buildExclusionObstaclesGroup({
        exclusionLocals,
        roofH,
        disposables,
      });
      scene.add(obsGroup);
    }

    setPanelInspection(null);
    let panelMesh: THREE.InstancedMesh | null = null;
    setArrayHeatmapRef.current = null;
    if (selectedPanels.length > 0) {
      const arrayRes = buildSolarArrayGroup({
        panelPositions: selectedPanels,
        modW,
        modL,
        tiltRad,
        yawRad,
        roofH,
        canopyHeightM: params.canopyHeightM ?? 3.2,
        maxAniso,
        showShadingHeatmap: showHeatmapRef.current,
        disposables,
      });
      panelMesh = arrayRes.panelMesh;
      setArrayHeatmapRef.current = arrayRes.setHeatmapMode;
      scene.add(arrayRes.group);
    }

    const removedMarkers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(modW, 0.03, modL * Math.cos(tiltRad)),
      new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0.55, depthWrite: false }),
      layout.removedCenters.length,
    );
    const markerMatrix = new THREE.Matrix4();
    for (const [index, panel] of layout.removedCenters.entries()) {
      markerMatrix.makeRotationY(yawRad);
      markerMatrix.setPosition(panel.cx, roofH + 0.075, -panel.cy);
      removedMarkers.setMatrixAt(index, markerMatrix);
    }
    if (layout.removedCenters.length > 0) scene.add(removedMarkers);
    disposables.push(removedMarkers, removedMarkers.geometry, removedMarkers.material as THREE.Material);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerStart = new THREE.Vector2();
    const rememberPointer = (event: PointerEvent) => pointerStart.set(event.clientX, event.clientY);
    const inspectPanel = (event: PointerEvent) => {
      if (!event.isPrimary || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
      raycaster.setFromCamera(pointer, camera);
      const objects: THREE.Object3D[] = [];
      if (panelMesh) objects.push(panelMesh);
      if (layout.removedCenters.length > 0) objects.push(removedMarkers);
      const hit = raycaster.intersectObjects(objects, false)[0];
      const removed = hit?.object === removedMarkers;
      const panel = hit?.instanceId === undefined ? undefined
        : (removed ? layout.removedCenters : layout.selectedCenters)[hit.instanceId];
      setPanelInspection(panel ? { ...panel, removed } : null);
    };
    renderer.domElement.addEventListener('pointerdown', rememberPointer);
    renderer.domElement.addEventListener('pointerup', inspectPanel);

    // 4. Surrounding Real NLSC 3D Tiles Meshes + Non-Overlapping OSM Height Buildings
    const nlscContext = buildNlscContextGroup({
      nlsc3dBuildings,
      roofPolygon,
      cLon,
      cLat,
      contextStyle: nlscStyleRef.current,
      disposables,
    });
    nlscEntriesRef.current = nlscContext.entries;
    setRenderedNlscCount(nlscContext.renderedIds.size);
    scene.add(nlscContext.group);

    const osmGroup = buildOsmFallbackGroup({
      osmBuildings,
      skipIds: nlscContext.renderedIds,
      cLon,
      cLat,
      disposables,
    });
    scene.add(osmGroup);

    // Direct sunlight and diffuse sky light
    const hemiLight = new THREE.HemisphereLight('#bae6fd', '#64748b', 0.65);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#fffbeb', 2.25);
    sunLight.castShadow = true;
    const shadowExtent = Math.max(80, span * 1.65);
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.left = -shadowExtent;
    sunLight.shadow.camera.right = shadowExtent;
    sunLight.shadow.camera.top = shadowExtent;
    sunLight.shadow.camera.bottom = -shadowExtent;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = Math.max(480, shadowExtent * 3);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.018;
    sunLight.shadow.radius = 1.5;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Visible 3D Sun Disc + Glow Halo + Monthly Solar Path Arc
    const sunOrbGeo = new THREE.SphereGeometry(2.6, 20, 20);
    const sunOrbMat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
    const sunOrb = new THREE.Mesh(sunOrbGeo, sunOrbMat);
    const sunHaloGeo = new THREE.SphereGeometry(4.4, 20, 20);
    const sunHaloMat = new THREE.MeshBasicMaterial({
      color: '#fde68a',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const sunHalo = new THREE.Mesh(sunHaloGeo, sunHaloMat);
    sunOrb.add(sunHalo);
    scene.add(sunOrb);
    disposables.push(sunOrbGeo, sunOrbMat, sunHaloGeo, sunHaloMat);

    const arcRadius = Math.max(95, span * 1.68);
    const arcMat = new THREE.LineBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.5 });
    const arcGeo = new THREE.BufferGeometry();
    const sunArcLine = new THREE.Line(arcGeo, arcMat);
    scene.add(sunArcLine);
    disposables.push(arcMat, arcGeo);

    const applySunState = (m: number, h: number) => {
      const date = taiwanSimulationDate(2026, m, 15, h);
      const { dir, altDeg } = sunDirectionVector(date, cLat, cLon);

      const lightDist = Math.max(190, shadowExtent * 1.35);
      sunLight.position.copy(dir).multiplyScalar(lightDist);
      sunOrb.position.copy(dir).multiplyScalar(arcRadius);
      sunOrb.visible = altDeg > -2;

      if (altDeg <= 0) {
        skyColor.set('#1e293b');
        sunLight.intensity = 0;
        sunLight.castShadow = false;
        hemiLight.intensity = 0.35;
      } else if (altDeg < 18) {
        const t = altDeg / 18;
        skyColor.set('#fed7aa').lerp(new THREE.Color('#dbeafe'), t);
        sunLight.color.set('#fb923c').lerp(new THREE.Color('#fffbeb'), t);
        sunLight.intensity = t * 2.15;
        sunLight.castShadow = true;
        hemiLight.intensity = 0.45 + t * 0.25;
      } else {
        skyColor.set('#dbeafe');
        sunLight.color.set('#fffbeb');
        sunLight.intensity = 2.15;
        sunLight.castShadow = true;
        hemiLight.intensity = 0.72;
      }
      scene.background = skyColor;
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.copy(skyColor);
      }

      const arcPts: THREE.Vector3[] = [];
      for (let hr = 5.5; hr <= 18.5; hr += 0.5) {
        const dArc = taiwanSimulationDate(2026, m, 15, hr);
        const sArc = sunDirectionVector(dArc, cLat, cLon);
        if (sArc.altDeg > 0) {
          arcPts.push(sArc.dir.clone().multiplyScalar(arcRadius));
        }
      }
      arcGeo.setFromPoints(arcPts);
    };

    updateSunRef.current = applySunState;
    applySunState(simMonth, simHour);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // On-demand render scheduler with smooth damping & software-WebGL pacing
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTs = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const requestRender = () => {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const dt = Math.min(0.1, (now - lastTs) / 1000);
        lastTs = now;

        let needsMoreFrames = false;
        if (camTransitionRef.current.active) {
          const lambda = 7.5;
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            camTransitionRef.current.targetPos.x,
            lambda,
            dt,
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            camTransitionRef.current.targetPos.y,
            lambda,
            dt,
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            camTransitionRef.current.targetPos.z,
            lambda,
            dt,
          );
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            camTransitionRef.current.targetLook.x,
            lambda,
            dt,
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            camTransitionRef.current.targetLook.y,
            lambda,
            dt,
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            camTransitionRef.current.targetLook.z,
            lambda,
            dt,
          );

          const distPos = camera.position.distanceTo(camTransitionRef.current.targetPos);
          const distLook = controls.target.distanceTo(camTransitionRef.current.targetLook);
          if (distPos < 0.15 && distLook < 0.15) {
            camTransitionRef.current.active = false;
          } else {
            needsMoreFrames = true;
          }
        }

        const ctrlMoving = controls.update();
        if (ctrlMoving) needsMoreFrames = true;

        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);
    requestRender();

    const handleResize = () => {
      if (!container) return;
      const w = Math.max(300, container.clientWidth);
      const h = Math.max(300, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', rememberPointer);
      renderer.domElement.removeEventListener('pointerup', inspectPanel);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      for (const d of disposables) d.dispose();
      nlscEntriesRef.current = [];
      setArrayHeatmapRef.current = null;
      renderer.dispose();
      updateSunRef.current = null;
      requestRenderRef.current = null;
    };
  }, [
    roofPolygon,
    exclusionPolygons,
    osmBuildings,
    nlsc3dBuildings,
    cLon,
    cLat,
    params.targetRoofHeightM,
    params.canopyHeightM,
    params.roofType,
    params.moduleWidthM,
    params.moduleLengthM,
    params.tiltDeg,
    params.azimuthDeg,
    params.setbackM,
    params.walkwayRatioPct,
    params.excludeShadedThresholdPct,
    params.maxModuleCountOverride,
    centerLat,
    centerLon,
  ]);

  // Span-proportional smooth camera preset triggers
  const moveCameraPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    const roofH = Math.max(2.5, params.targetRoofHeightM);
    const span = sceneSpanRef.current;
    const dist = Math.max(38, span * 1.32);

    if (preset === 'iso') {
      _vTarget.set(0, roofH * 0.65, 0);
      _vCamPos.set(dist * 0.72, roofH + dist * 0.56, dist * 0.84);
    } else if (preset === 'top') {
      _vTarget.set(0, roofH * 0.85, 0);
      _vCamPos.set(0.01, roofH + dist * 1.45, 0.01);
    } else if (preset === 'side') {
      _vTarget.set(0, roofH * 0.75, 0);
      _vCamPos.set(dist * 1.15, roofH + Math.max(8, dist * 0.2), dist * 0.16);
    } else if (preset === 'detail') {
      const rackHeight = params.canopyHeightM ?? 3.2;
      _vTarget.set(0, roofH + rackHeight * 0.55, 0);
      _vCamPos.set(11, roofH + rackHeight + 4, 13);
    } else {
      _vTarget.set(0, roofH * 0.8, 0);
      const sunPos = currentSunInfo.dir.clone().multiplyScalar(dist * 1.2);
      _vCamPos.set(sunPos.x, Math.max(roofH + 10, sunPos.y), sunPos.z);
    }
    camTransitionRef.current = {
      active: true,
      targetPos: _vCamPos.clone(),
      targetLook: _vTarget.clone(),
    };
    requestRenderRef.current?.();
  };

  const formatHour = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  if (roofPolygon.length < 3) {
    return (
      <div className="w-full h-full min-h-[480px] bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-7 max-w-md text-center space-y-3 shadow-xs">
          <h3 className="text-base font-bold text-slate-950">尚未框選廠房屋頂多邊形</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            3D 實景日照與光電陣列模擬需依據實際屋頂多邊形、國土測繪 3D 建物與太陽方位建構 1:1 比例模型。請先於「2D 正射影像」框選屋頂或點選 OSM 建物。
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={onSwitchTo2D}
              className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer transition-colors"
            >
              切換回 2D 正射影像框選
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[480px] bg-slate-200 overflow-hidden select-none">
      {/* Isolated WebGL Container */}
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="absolute inset-0 z-20 bg-slate-900/85 flex items-center justify-center p-6 text-white text-sm">
          WebGL 3D 繪圖環境暫時中斷，請重新切換視角或重新整理頁面。
        </div>
      )}

      {/* Minimal Top-Left Spec Readout (no backdrop-filter over WebGL) */}
      <div className="absolute top-3 left-3 z-10 bg-slate-950/90 border border-slate-700/80 rounded-lg px-3.5 py-2.5 text-white shadow-lg pointer-events-auto">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-amber-400">3D 光電配置示意</span>
          <span className="font-mono tabular-nums text-slate-200">
            點選模組查看遮蔭 · {placed3DPanels} 片 · 年發電 {Math.round(annualGenKwh).toLocaleString('zh-TW')} 度
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-300">
          <span>
            目標屋頂（依輪廓與輸入高度建模） {params.roofType === 'metal' ? '鐵皮浪板' : params.roofType === 'rc' ? 'RC 混凝土' : '未指定材質'} ({params.targetRoofHeightM}m)
          </span>
          <span className="text-slate-600">·</span>
          <span>傾角 {params.tiltDeg}° / 方位 {params.azimuthDeg}°</span>
          <span className="text-slate-600">·</span>
          <span>棚架設定 {(params.canopyHeightM ?? 3.2).toFixed(1)} m</span>
          <span className="text-slate-600">·</span>
          <span>年遮蔭損失 {annualShadingLossPct.toFixed(1)}%</span>
          {renderedNlscCount > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-300">鄰棟 · 國土測繪 3D Tiles {renderedNlscCount} 棟（平地基準）</span>
            </>
          )}
        </div>
        {showShadingHeatmap && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-mono tabular-nums text-slate-200">
            <span className="text-amber-300 font-semibold">年遮蔭熱圖</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-[#1e40af] inline-block" />&lt;3%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-[#0284c7] inline-block" />3–10%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-[#eab308] inline-block" />10–15%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-[#f97316] inline-block" />15–25%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-[#dc2626] inline-block" />≥25%</span>
            <span className="text-slate-400">
              (最大 {heatmapStats.maxShadePct.toFixed(1)}% · &gt;15% 共 {heatmapStats.shadedOver15} 片)
            </span>
          </div>
        )}
      <button
        type="button"
        onClick={onToggleShadedPanels}
        aria-pressed={params.excludeShadedThresholdPct != null}
        className="mt-2 cursor-pointer rounded-md bg-slate-950/90 px-3 py-2 text-xs font-semibold text-orange-200"
      >
        {params.excludeShadedThresholdPct != null ? '恢復全排布 · 橘色為剔除板位' : '剔除年遮蔭率 ≥15% 的板位'}
      </button>

      </div>

      {/* Collapsible Bottom Control Dock (Zero Viewport Center Occlusion, no backdrop-filter) */}
      {panelInspection && (
        <div className="absolute left-3 top-32 z-20 max-w-[calc(100%_-_24px)] rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-white shadow-lg">
          <PanelShadeDetails panel={panelInspection}>
            <button type="button" onClick={() => setPanelInspection(null)} className="cursor-pointer underline">關閉</button>
          </PanelShadeDetails>
        </div>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(820px,94vw)] flex flex-col items-center pointer-events-none">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-slate-950/92 text-slate-200 border border-b-0 border-slate-700 rounded-t-lg hover:text-white cursor-pointer"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>展開日照與視角控制</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>收合控制列</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto w-full bg-slate-950/92 border border-slate-700/85 rounded-xl px-4 py-3 text-white shadow-xl space-y-2.5">
            {/* Row 1: Camera Presets | Overlay Toggles & Sun Azimuth/Alt */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 flex-wrap">
                <Video className="w-3.5 h-3.5 text-slate-400 mr-1 shrink-0" />
                {(
                  [
                    { id: 'iso', label: '立體鳥瞰' },
                    { id: 'top', label: '正射俯視' },
                    { id: 'side', label: '側面遮蔭' },
                    { id: 'detail', label: '支架特寫' },
                    { id: 'sun', label: '太陽入射' },
                  ] as Array<{ id: CameraPreset; label: string }>
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => moveCameraPreset(preset.id)}
                    className={`h-7 px-2.5 text-xs font-medium border rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activePreset === preset.id
                        ? 'bg-amber-600 text-white border-amber-500'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}

                <span className="hidden sm:inline-block h-4 w-px bg-slate-700 mx-1.5" aria-hidden="true" />

                <button
                  type="button"
                  onClick={() => setShowShadingHeatmap((v) => !v)}
                  className={`h-7 inline-flex items-center gap-1 px-2.5 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    showShadingHeatmap
                      ? 'bg-orange-600 hover:bg-orange-700 text-white border-orange-500'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                  title="依 SunCalc 全年逐時遮蔭計算顯示每片模組熱圖顏色"
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>{showShadingHeatmap ? '熱圖：年遮蔭率' : '面板：年遮蔭熱圖'}</span>
                </button>

                {renderedNlscCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setNlscStyle((s) => (s === 'textured' ? 'massing' : 'textured'))}
                    className="h-7 inline-flex items-center gap-1 px-2.5 text-xs font-medium bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/70 rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    title="切換國土測繪 3D 建物實測貼圖 / 建築白模輪廓"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>{nlscStyle === 'textured' ? '鄰棟：航照貼圖' : '鄰棟：白模輪廓'}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-amber-300 whitespace-nowrap">
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>仰角 {currentSunInfo.altDeg.toFixed(1)}°</span>
                <span className="text-slate-500">·</span>
                <span>方位 {currentSunInfo.azCompassDeg.toFixed(0)}°</span>
              </div>
            </div>

            {/* Row 2: Sun Timeline Slider */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlayingSun((p) => !p)}
                className="p-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white shrink-0 cursor-pointer transition-colors"
                title={isPlayingSun ? '暫停日照掃描' : '播放單日太陽軌跡'}
                aria-label={isPlayingSun ? '暫停日照掃描' : '播放單日太陽軌跡'}
              >
                {isPlayingSun ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>

              <select
                value={simMonth}
                onChange={(e) => setSimMonth(Number(e.target.value))}
                className="text-xs font-mono bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-white shrink-0"
                aria-label="選擇模擬月份"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}月15日
                  </option>
                ))}
              </select>

              <Sun className="w-4 h-4 text-amber-400 shrink-0" />
              <input
                type="range"
                min={6}
                max={18}
                step={0.25}
                value={simHour}
                onChange={(e) => setSimHour(Number(e.target.value))}
                className="flex-1 solar-slider-dark cursor-pointer"
                aria-label="拖動太陽時間軸"
              />

              <span className="text-xs font-mono tabular-nums font-bold text-white w-12 text-right shrink-0">
                {simMonth}/15 · {formatHour(simHour)}（臺灣時間）
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
