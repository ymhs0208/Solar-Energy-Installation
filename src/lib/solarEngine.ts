import { getSolarPosition } from './solarPosition';
import type {
  AiRoofVisionResult,
  CapacitySummary,
  CashflowYear,
  EsgValuationSummary,
  FinancialScenarioResult,
  FitTier,
  Gate1AlternativeFeeder,
  Gate1Recommendation,
  GateCheckResult,
  GateStatus,
  InstallVerdict,
  InstallVerdictLevel,
  InstallVerdictReason,
  MonthlySimulationRow,
  NasaPowerResponse,
  OsmBuildingFeature,
  PanelHeatmapSummary,
  RoofExclusionPolygon,
  ShadingSummary,
  SolarEvaluationResult,
  TaipowerFeederResponse,
  TariffOption,
  UserEngineeringParams,
} from '../types/solar';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const EARTH_R = 6378137;

export const SOLAR_MODEL_VERSION = 3;

export const DEFAULT_USER_PARAMS: UserEngineeringParams = {
  factoryName: '',
  address: '',
  taxId: '',
  registeredAreaSqm: null,
  roofType: 'unset',
  targetRoofHeightM: 10,
  setbackM: 1.0,
  walkwayRatioPct: 15,
  moduleWatt: 450,
  moduleWidthM: 1.134,
  moduleLengthM: 1.908,
  dcAcRatio: 1.15,
  maxModuleCountOverride: null,
  excludeShadedThresholdPct: null,
  canopyHeightM: 3.2,
  tiltDeg: 10,
  azimuthDeg: 180,
  systemLossPct: 14,
  tempCoeffPctPerC: -0.34,
  noctC: 45,
  albedo: 0.2,
  capexPerKw: 42000,
  opexPerKwYear: 800,
  discountRatePct: 3.5,
  degradationPct: 0.5,
  fitRateNtd: null,
  tariffMode: 'flat',
  selfConsumptionTariffNtd: null,
  selfConsumptionSharePct: 75,
  bessEnabled: false,
  bessKwh: 100,
  bessKw: 50,
  bessCapexPerKwh: 14000,
  bessRoundTripEffPct: 88,
  contractCapacityChargePerKwMonth: 195,
  peakShavingKw: 35,
  roofLeaseSharePct: 12,
  roofLeaseMode: 'revenue_share',
  roofLeaseNtdPerSqmMonth: 35,
  emissionFactorKgPerKwh: 0.494,
  trecPriceNtdPerMwh: 3500,
  carbonFeeNtdPerTonne: 300,
  includeTrecInSelf: false,
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Local tangent plane projection (meters relative to origin lat0, lon0)
export function projectToLocalMeters(
  lon: number,
  lat: number,
  lon0: number,
  lat0: number,
): [number, number] {
  const x = toRad(lon - lon0) * EARTH_R * Math.cos(toRad(lat0));
  const y = toRad(lat - lat0) * EARTH_R;
  return [x, y];
}

export function unprojectFromLocalMeters(
  x: number,
  y: number,
  lon0: number,
  lat0: number,
): [number, number] {
  const lat = lat0 + toDeg(y / EARTH_R);
  const lon = lon0 + toDeg(x / (EARTH_R * Math.cos(toRad(lat0))));
  return [lon, lat];
}

export function getPolygonCentroid(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [120.6, 24.16];
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of coords) {
    sx += lon;
    sy += lat;
  }
  return [sx / coords.length, sy / coords.length];
}

export function computePolygonMetrics(coords: [number, number][]): {
  areaSqm: number;
  perimeterM: number;
} {
  if (coords.length < 3) return { areaSqm: 0, perimeterM: 0 };
  const [lon0, lat0] = getPolygonCentroid(coords);
  const pts = coords.map(([lon, lat]) => projectToLocalMeters(lon, lat, lon0, lat0));

  let area2 = 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area2 += x1 * y2 - x2 * y1;
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return {
    areaSqm: Math.abs(area2) / 2,
    perimeterM: perimeter,
  };
}

export function computeCapacity(
  roofPolygon: [number, number][],
  params: UserEngineeringParams,
  exclusionPolygons: RoofExclusionPolygon[] = [],
): CapacitySummary {
  const { areaSqm, perimeterM } = computePolygonMetrics(roofPolygon);
  let excludedAreaSqm = 0;
  let validExclusions = 0;
  for (const ex of exclusionPolygons) {
    if (ex.coordinates.length >= 3) {
      validExclusions++;
      excludedAreaSqm += computePolygonMetrics(ex.coordinates).areaSqm;
    }
  }
  excludedAreaSqm = Math.min(areaSqm, excludedAreaSqm);
  const netRoofAreaSqm = Math.max(0, areaSqm - excludedAreaSqm);

  const d = Math.max(0, params.setbackM);
  // Setback deduction: A_after = max(0, A - P*d + pi*d^2) minus excluded obstacle zones
  const grossAfterSetback =
    areaSqm <= 0
      ? 0
      : Math.max(0, Math.min(areaSqm, areaSqm - perimeterM * d + Math.PI * d * d));
  const afterSetback = Math.max(0, grossAfterSetback - excludedAreaSqm);
  const walkwayFactor = Math.max(0, Math.min(0.8, params.walkwayRatioPct / 100));
  const effectiveAreaSqm = afterSetback * (1 - walkwayFactor);
  const moduleAreaSqm = Math.max(0.2, params.moduleWidthM * params.moduleLengthM);
  const rawModuleCount = effectiveAreaSqm > 0 ? Math.floor(effectiveAreaSqm / moduleAreaSqm) : 0;
  const overrideCap =
    typeof params.maxModuleCountOverride === 'number' && params.maxModuleCountOverride > 0
      ? Math.floor(params.maxModuleCountOverride)
      : null;
  const isDeratedByOverride = overrideCap !== null && overrideCap < rawModuleCount;
  const moduleCount = isDeratedByOverride ? overrideCap : rawModuleCount;
  const pDcKw = (moduleCount * Math.max(100, params.moduleWatt)) / 1000;
  const dcAc = Math.max(0.8, params.dcAcRatio || 1.15);
  const pAcKw = pDcKw / dcAc;

  return {
    roofAreaSqm: areaSqm,
    excludedAreaSqm,
    exclusionCount: validExclusions,
    netRoofAreaSqm,
    perimeterM,
    afterSetbackAreaSqm: afterSetback,
    effectiveAreaSqm,
    moduleAreaSqm,
    rawModuleCount,
    moduleCount,
    isDeratedByOverride,
    pDcKw,
    pAcKw,
  };
}

export function pointInPolygon2D(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function minDistanceToPolygonEdge(px: number, py: number, poly: [number, number][]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (d < minD) minD = d;
  }
  return minD;
}

export interface RoofPanelGeoFeature {
  type: 'Feature';
  properties: {
    baseM: number;
    topM: number;
    kind: 'panel' | 'rack';
    panelIndex?: number;
    removed?: boolean;
    shadePct?: number;
  };
  geometry: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
}

interface ShadowStepEntry {
  monthIdx: number;
  weight: number;
  polys: Array<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    pts: [number, number][];
  }>;
}

export function buildAnnualRoofShadowSteps(
  roofPolygon: [number, number][],
  buildings: OsmBuildingFeature[],
  lat: number,
  lon: number,
  targetRoofHeightM: number,
): {
  steps: ShadowStepEntry[];
  monthTotalWeights: number[];
  neighborCount: number;
} {
  const monthTotalWeights = Array(12).fill(0);
  if (roofPolygon.length < 3) return { steps: [], monthTotalWeights, neighborCount: 0 };

  const [cLon, cLat] = getPolygonCentroid(roofPolygon);
  const validBuildings = buildings.filter((b) => b.heightM !== null && b.coordinates.length >= 3);
  const neighborLocal = validBuildings
    .filter((b) => {
      const bLocal = b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat));
      return !pointInPolygon2D(0, 0, bLocal);
    })
    .map((b) => ({
      relHeight: Math.max(0, (b.heightM ?? 0) - Math.max(0, targetRoofHeightM)),
      pts: b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat)),
    }))
    .filter((b) => b.relHeight > 0.1);

  if (neighborLocal.length === 0) {
    return { steps: [], monthTotalWeights, neighborCount: 0 };
  }

  const steps: ShadowStepEntry[] = [];
  for (let m = 0; m < 12; m++) {
    for (let localHour = 6; localHour <= 18; localHour += 1) {
      const date = new Date(Date.UTC(2026, m, 15, localHour - 8, 0, 0));
      const pos = getSolarPosition(date, lat, lon);
      if (pos.altitudeRad <= toRad(3)) continue;

      const weight = Math.sin(pos.altitudeRad);
      monthTotalWeights[m] += weight;

      const tanAlt = Math.tan(pos.altitudeRad);
      const sinAz = Math.sin(pos.southAzimuthRad);
      const cosAz = Math.cos(pos.southAzimuthRad);

      const polys = neighborLocal.map((nb) => {
        const len = Math.min(220, nb.relHeight / tanAlt);
        const dx = sinAz * len;
        const dy = cosAz * len;
        const shifted = nb.pts.map(([x, y]): [number, number] => [x + dx, y + dy]);
        const hull = convexHull2D([...nb.pts, ...shifted]);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [x, y] of hull) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return { minX, maxX, minY, maxY, pts: hull };
      });

      steps.push({ monthIdx: m, weight, polys });
    }
  }

  return { steps, monthTotalWeights, neighborCount: neighborLocal.length };
}

export function evaluatePointAnnualShading(
  px: number,
  py: number,
  steps: ShadowStepEntry[],
  monthTotalWeights: number[],
): { annualShadePct: number; monthlyShadeRatios: number[] } {
  if (steps.length === 0) {
    return { annualShadePct: 0, monthlyShadeRatios: Array(12).fill(0) };
  }
  const monthShaded = Array(12).fill(0);
  for (const step of steps) {
    for (const sp of step.polys) {
      if (px < sp.minX || px > sp.maxX || py < sp.minY || py > sp.maxY) continue;
      if (pointInPolygon2D(px, py, sp.pts)) {
        monthShaded[step.monthIdx] += step.weight;
        break;
      }
    }
  }
  const monthlyShadeRatios = monthShaded.map((s, m) =>
    monthTotalWeights[m] > 0 ? Math.min(0.95, s / monthTotalWeights[m]) : 0,
  );
  const annualShadePct = (monthlyShadeRatios.reduce((a, b) => a + b, 0) / 12) * 100;
  return { annualShadePct, monthlyShadeRatios };
}

/**
 * Generates physically-placed PV module footprints & stepped 3D tilted extrusions
 * inside the target roof polygon for MapLibre GL rendering, with optional per-panel shading heatmap.
 */
type LayoutParams = Pick<
    UserEngineeringParams,
    | 'targetRoofHeightM'
    | 'setbackM'
    | 'walkwayRatioPct'
    | 'moduleWidthM'
    | 'moduleLengthM'
    | 'tiltDeg'
    | 'azimuthDeg'
  > & { excludeShadedThresholdPct?: number | null; canopyHeightM?: number };

export interface RoofLayoutCache {
  inputs: readonly unknown[];
  prepared?: ReturnType<typeof prepareRoofLayout>;
  roofShading?: { inputs: readonly unknown[]; result: ShadingSummary };
}

function prepareRoofLayout(
  roofPolygon: [number, number][],
  params: LayoutParams,
  exclusionPolygons: RoofExclusionPolygon[],
  shadingContext?: {
    buildings: OsmBuildingFeature[];
    lat: number;
    lon: number;
  },
) {
  const [cLon, cLat] = getPolygonCentroid(roofPolygon);
  const roofLocal = roofPolygon.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat));
  const exclusionLocals = exclusionPolygons
    .filter((ex) => ex.coordinates.length >= 3)
    .map((ex) => ex.coordinates.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat)));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of roofLocal) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const modW = Math.max(0.6, params.moduleWidthM);
  const modL = Math.max(0.8, params.moduleLengthM);
  const tiltRad = toRad(Math.max(1, Math.min(45, params.tiltDeg)));
  const azRad = toRad(params.azimuthDeg);
  const roofH = Math.max(0, params.targetRoofHeightM);
  const setback = Math.max(0.3, params.setbackM);

  // Local East-North unit vectors:
  // `facing` points down-slope toward azimuthDeg (180 = South = (0, -1))
  // `right` is perpendicular across the row (180 -> East = (1, 0))
  const facingX = Math.sin(azRad);
  const facingY = Math.cos(azRad);
  const rightX = -Math.cos(azRad);
  const rightY = Math.sin(azRad);

  const projLen = modL * Math.cos(tiltRad);
  const hw = modW / 2;
  const hl = projLen / 2;

  const colStep = modW + 0.06;
  const rowStep = projLen + 0.45;
  const aisleEveryNRows =
    params.walkwayRatioPct >= 10
      ? Math.max(2, Math.round(100 / Math.max(10, params.walkwayRatioPct)))
      : 99;

  const isInsideExclusion = (px: number, py: number, bufferM = 0.25) => {
    for (const exLocal of exclusionLocals) {
      if (pointInPolygon2D(px, py, exLocal)) return true;
      if (minDistanceToPolygonEdge(px, py, exLocal) < bufferM) return true;
    }
    return false;
  };

  const cornersInside = (cx: number, cy: number, edgeClearance: number) => {
    if (isInsideExclusion(cx, cy, 0.25)) return false;
    const offsets: [number, number][] = [
      [-hw, -hl],
      [hw, -hl],
      [hw, hl],
      [-hw, hl],
    ];
    for (const [du, dv] of offsets) {
      const px = cx + du * rightX + dv * facingX;
      const py = cy + du * rightY + dv * facingY;
      if (!pointInPolygon2D(px, py, roofLocal)) return false;
      if (minDistanceToPolygonEdge(px, py, roofLocal) < edgeClearance) return false;
      if (isInsideExclusion(px, py, 0.25)) return false;
    }
    return true;
  };

  const centers: Array<{ cx: number; cy: number; rowIndex: number }> = [];
  const maxExtent = Math.hypot(maxX - minX, maxY - minY) * 0.65;
  let rowIdx = 0;

  for (let v = -maxExtent; v <= maxExtent; v += rowStep) {
    rowIdx++;
    if (rowIdx % aisleEveryNRows === 0) continue;
    for (let u = -maxExtent; u <= maxExtent; u += colStep) {
      const cx = u * rightX + v * facingX;
      const cy = u * rightY + v * facingY;
      if (
        pointInPolygon2D(cx, cy, roofLocal) &&
        cornersInside(cx, cy, Math.max(0.2, setback * 0.75))
      ) {
        centers.push({ cx, cy, rowIndex: rowIdx });
      }
    }
  }

  const shadowCache = shadingContext
    ? buildAnnualRoofShadowSteps(
        roofPolygon,
        shadingContext.buildings,
        shadingContext.lat,
        shadingContext.lon,
        params.targetRoofHeightM,
      )
    : null;

  const scoredCenters = centers.map(({ cx, cy, rowIndex }) => {
    const { annualShadePct, monthlyShadeRatios } = evaluatePointAnnualShading(
      cx, cy, shadowCache?.steps ?? [], shadowCache?.monthTotalWeights ?? [],
    );
    return { cx, cy, rowIndex, shadePct: annualShadePct, monthlyShadeRatios };
  });

  return { scoredCenters, cLon, cLat, roofH, modL, tiltRad, hw, hl, rightX, rightY, facingX, facingY };
}

export function getPanelHeightAboveRoof(lengthM: number, tiltRad: number, canopyHeightM = 3.2) {
  const rise = lengthM * Math.sin(tiltRad);
  const lowEdge = Math.max(0.15, canopyHeightM - rise - 0.025);
  return { rise, lowEdge, highEdge: lowEdge + rise };
}

export function generateRoofPanelLayoutGeoJson(
  roofPolygon: [number, number][],
  params: LayoutParams,
  maxCount?: number,
  exclusionPolygons: RoofExclusionPolygon[] = [],
  shadingContext?: {
    buildings: OsmBuildingFeature[];
    lat: number;
    lon: number;
  },
  includeGeometry = true,
  cache?: RoofLayoutCache,
): {
  panelCount: number;
  selectedCenters: Array<{ cx: number; cy: number; rowIndex: number; shadePct: number; monthlyShadeRatios: number[] }>;
  removedCenters: Array<{ cx: number; cy: number; rowIndex: number; shadePct: number; monthlyShadeRatios: number[] }>;
  monthlyShadingLossRatio: number[];
  candidateCount: number;
  shadedOver15Count: number;
  prunedCount: number;
  maxRiseM: number;
  panel2dFeatures: RoofPanelGeoFeature[];
  panel3dFeatures: RoofPanelGeoFeature[];
} {
  if (roofPolygon.length < 3) {
    return {
      panelCount: 0,
      selectedCenters: [],
      removedCenters: [],
      monthlyShadingLossRatio: Array(12).fill(0),
      candidateCount: 0,
      shadedOver15Count: 0,
      prunedCount: 0,
      maxRiseM: 0,
      panel2dFeatures: [],
      panel3dFeatures: [],
    };
  }

  const inputs = [
    roofPolygon, exclusionPolygons, shadingContext?.buildings, shadingContext?.lat, shadingContext?.lon,
    params.targetRoofHeightM, params.setbackM, params.walkwayRatioPct, params.moduleWidthM,
    params.moduleLengthM, params.tiltDeg, params.azimuthDeg,
  ];
  let prepared = cache?.prepared;
  if (!prepared || !inputs.every((input, index) => Object.is(input, cache?.inputs[index]))) {
    prepared = prepareRoofLayout(roofPolygon, params, exclusionPolygons, shadingContext);
    if (cache) {
      cache.inputs = inputs;
      cache.prepared = prepared;
    }
  }
  const { scoredCenters, cLon, cLat, roofH, modL, tiltRad, hw, hl, rightX, rightY, facingX, facingY } = prepared;

  const shadedOver15Count = scoredCenters.filter((c) => c.shadePct >= 15).length;
  const threshold = params.excludeShadedThresholdPct ?? null;
  const filteredCenters =
    threshold !== null && threshold > 0
      ? scoredCenters.filter((c) => c.shadePct < threshold)
      : scoredCenters;
  const prunedCount = scoredCenters.length - filteredCenters.length;

  const limit = maxCount === undefined ? filteredCenters.length : Math.max(0, Math.floor(maxCount));
  const selected = filteredCenters.slice(0, limit);
  const monthlyShadingLossRatio = Array.from({ length: 12 }, (_, month) =>
    selected.length === 0 ? 0
      : selected.reduce((sum, panel) => sum + panel.monthlyShadeRatios[month], 0) / selected.length,
  );

  const baselineCount = maxCount === undefined ? scoredCenters.length : limit;
  const removedCenters = threshold !== null && threshold > 0
    ? scoredCenters.slice(0, baselineCount).filter((panel) => panel.shadePct >= threshold)
    : [];
  const { rise, lowEdge: clearance, highEdge } = getPanelHeightAboveRoof(modL, tiltRad, params.canopyHeightM);
  const sliceCount = selected.length <= 550 ? 3 : selected.length <= 1400 ? 2 : 1;

  const toRing = (cx: number, cy: number, u0: number, u1: number, v0: number, v1: number): [number, number][] => {
    const pts: [number, number][] = [
      [cx + u0 * rightX + v0 * facingX, cy + u0 * rightY + v0 * facingY],
      [cx + u1 * rightX + v0 * facingX, cy + u1 * rightY + v0 * facingY],
      [cx + u1 * rightX + v1 * facingX, cy + u1 * rightY + v1 * facingY],
      [cx + u0 * rightX + v1 * facingX, cy + u0 * rightY + v1 * facingY],
    ];
    const ring = pts.map(([x, y]) => unprojectFromLocalMeters(x, y, cLon, cLat));
    ring.push(ring[0]);
    return ring;
  };

  const panel2dFeatures: RoofPanelGeoFeature[] = [];
  const panel3dFeatures: RoofPanelGeoFeature[] = [];

  const displayed = includeGeometry ? [...selected, ...removedCenters] : [];
  for (const [panelIndex, { cx, cy, shadePct }] of displayed.entries()) {
    const removed = panelIndex >= selected.length;
    const fullRing = toRing(cx, cy, -hw, hw, -hl, hl);
    panel2dFeatures.push({
      type: 'Feature',
      properties: {
        baseM: roofH + clearance,
        topM: roofH + highEdge + 0.025,
        panelIndex,
        removed,
        kind: 'panel',
        shadePct: Number(shadePct.toFixed(1)),
      },
      geometry: { type: 'Polygon', coordinates: [fullRing] },
    });

    if (removed) continue;

    // Rear mounting rack strut under the elevated back edge (-hl)
    const rackRing = toRing(cx, cy, -hw * 0.85, hw * 0.85, -hl, -hl + Math.min(0.22, hl * 0.35));
    panel3dFeatures.push({
      type: 'Feature',
      properties: {
        baseM: roofH,
        topM: roofH + clearance + rise,
        kind: 'rack',
      },
      geometry: { type: 'Polygon', coordinates: [rackRing] },
    });

    // Stepped 3D tilted module slices from back-high (v = -hl, t = 1) to front-low (v = +hl, t = 0)
    for (let s = 0; s < sliceCount; s++) {
      const f0 = s / sliceCount;
      const f1 = (s + 1) / sliceCount;
      const vFront = hl - f0 * (2 * hl);
      const vBack = hl - f1 * (2 * hl);
      const sliceRing = toRing(cx, cy, -hw, hw, vBack, vFront);
      panel3dFeatures.push({
        type: 'Feature',
        properties: {
          baseM: roofH + clearance + rise * f0,
          topM: roofH + clearance + rise * f1 + 0.025,
          panelIndex,
          kind: 'panel',
          shadePct: Number(shadePct.toFixed(1)),
        },
        geometry: { type: 'Polygon', coordinates: [sliceRing] },
      });
    }
  }

  return {
    panelCount: selected.length,
    selectedCenters: selected,
    removedCenters,
    monthlyShadingLossRatio,
    candidateCount: scoredCenters.length,
    shadedOver15Count,
    prunedCount,
    maxRiseM: highEdge + 0.025,
    panel2dFeatures,
    panel3dFeatures,
  };
}

// Compute convex hull of 2D points (Andrew's monotone chain) for projected shadow volume
function convexHull2D(points: [number, number][]): [number, number][] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Projects any building polygon shadow at `targetPlaneHeightM` for a given Date.
 * Returns GeoJSON ring `[lon, lat][]` or null if the caster is not taller than the target plane
 * or if the sun is below the horizon threshold.
 *
 * Internal azimuth is radians from South, positive Westward:
 *   North = pi (or -pi), East = -pi/2, South = 0, West = +pi/2.
 *   Vector TO sun:       dx_sun = -sin(azimuth), dy_sun = -cos(azimuth)
 *   Shadow casts AWAY:   dx_shadow = +sin(azimuth), dy_shadow = +cos(azimuth)
 */
export function projectPolygonShadowGeoJson(
  coordinates: [number, number][],
  casterHeightM: number,
  targetPlaneHeightM: number,
  date: Date,
  lat: number,
  lon: number,
): [number, number][] | null {
  if (coordinates.length < 3) return null;
  const relHeight = casterHeightM - Math.max(0, targetPlaneHeightM);
  if (relHeight <= 0.1) return null;

  const pos = getSolarPosition(date, lat, lon);
  if (pos.altitudeRad <= toRad(1)) return null;

  const shadowLen = Math.min(260, relHeight / Math.tan(pos.altitudeRad));
  const dx = Math.sin(pos.southAzimuthRad) * shadowLen;
  const dy = Math.cos(pos.southAzimuthRad) * shadowLen;

  const localBase = coordinates.map(([bLon, bLat]) =>
    projectToLocalMeters(bLon, bLat, lon, lat),
  );
  const shifted = localBase.map(([x, y]): [number, number] => [x + dx, y + dy]);
  const hull = convexHull2D([...localBase, ...shifted]);
  if (hull.length < 3) return null;
  const ring = hull.map(([x, y]) => unprojectFromLocalMeters(x, y, lon, lat));
  ring.push(ring[0]);
  return ring;
}

export function projectBuildingShadowGeoJson(
  building: OsmBuildingFeature,
  date: Date,
  lat: number,
  lon: number,
  targetRoofHeightM: number,
): [number, number][] | null {
  if (building.heightM === null) return null;
  return projectPolygonShadowGeoJson(
    building.coordinates,
    building.heightM,
    targetRoofHeightM,
    date,
    lat,
    lon,
  );
}

/**
 * Computes the instantaneous shaded area ratio (0..1) on the target roof polygon
 * at a specific timestamp `date`, considering only OSM buildings with explicit `height` tags
 * taller than `targetRoofHeightM` (excluding the target building footprint itself).
 */
export function computeInstantRoofShadingRatio(
  roofPolygon: [number, number][],
  buildings: OsmBuildingFeature[],
  date: Date,
  lat: number,
  lon: number,
  targetRoofHeightM: number,
): { ratio: number; shadingBuildingsCount: number; isSunAboveHorizon: boolean } {
  const pos = getSolarPosition(date, lat, lon);
  if (pos.altitudeRad <= toRad(1)) {
    return { ratio: 0, shadingBuildingsCount: 0, isSunAboveHorizon: false };
  }
  if (roofPolygon.length < 3) {
    return { ratio: 0, shadingBuildingsCount: 0, isSunAboveHorizon: true };
  }

  const [cLon, cLat] = getPolygonCentroid(roofPolygon);
  const roofLocal = roofPolygon.map(([pLon, pLat]) => projectToLocalMeters(pLon, pLat, cLon, cLat));

  const validNeighbors = buildings
    .filter((b) => b.heightM !== null && b.coordinates.length >= 3)
    .filter((b) => {
      const bLocal = b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat));
      return !pointInPolygon2D(0, 0, bLocal);
    })
    .map((b) => ({
      relHeight: Math.max(0, (b.heightM ?? 0) - Math.max(0, targetRoofHeightM)),
      pts: b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat)),
    }))
    .filter((b) => b.relHeight > 0.1);

  if (validNeighbors.length === 0) {
    return { ratio: 0, shadingBuildingsCount: 0, isSunAboveHorizon: true };
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of roofLocal) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const samplePoints: [number, number][] = [];
  const N = 8;
  for (let ix = 0; ix < N; ix++) {
    for (let iy = 0; iy < N; iy++) {
      const px = minX + ((ix + 0.5) / N) * (maxX - minX);
      const py = minY + ((iy + 0.5) / N) * (maxY - minY);
      if (pointInPolygon2D(px, py, roofLocal)) {
        samplePoints.push([px, py]);
      }
    }
  }
  if (samplePoints.length === 0) samplePoints.push([0, 0]);

  const tanAlt = Math.tan(pos.altitudeRad);
  const sinAz = Math.sin(pos.southAzimuthRad);
  const cosAz = Math.cos(pos.southAzimuthRad);

  const shadowPolys = validNeighbors.map((nb) => {
    const len = Math.min(260, nb.relHeight / tanAlt);
    const dx = sinAz * len;
    const dy = cosAz * len;
    const shifted = nb.pts.map(([x, y]): [number, number] => [x + dx, y + dy]);
    return convexHull2D([...nb.pts, ...shifted]);
  });

  let shadedCount = 0;
  for (const [px, py] of samplePoints) {
    for (const sp of shadowPolys) {
      if (pointInPolygon2D(px, py, sp)) {
        shadedCount++;
        break;
      }
    }
  }

  return {
    ratio: shadedCount / samplePoints.length,
    shadingBuildingsCount: validNeighbors.length,
    isSunAboveHorizon: true,
  };
}

/**
 * Generates a GeoJSON ray from (centerLon, centerLat) pointing toward the incoming SunCalc sun direction.
 */
export function createSunRayGeoJson(
  centerLon: number,
  centerLat: number,
  date: Date,
  lengthM = 95,
): { origin: [number, number]; sunPoint: [number, number] } | null {
  const pos = getSolarPosition(date, centerLat, centerLon);
  if (pos.altitudeRad <= 0) return null;
  // Shrink horizontal ray slightly at high noon so direction stays intuitive without collapsing to zero
  const horizLen = Math.max(28, lengthM * Math.cos(pos.altitudeRad));
  const dxSun = -Math.sin(pos.southAzimuthRad) * horizLen;
  const dySun = -Math.cos(pos.southAzimuthRad) * horizLen;
  const sunPoint = unprojectFromLocalMeters(dxSun, dySun, centerLon, centerLat);
  return {
    origin: [centerLon, centerLat],
    sunPoint,
  };
}

/**
 * Computes monthly shading loss S_m (0..1) using SunCalc solar angles and ONLY OSM buildings
 * with explicit `height` tags. Excludes the target roof building itself by checking centroid overlap.
 */
export function computeMonthlyShading(
  roofPolygon: [number, number][],
  buildings: OsmBuildingFeature[],
  lat: number,
  lon: number,
  targetRoofHeightM: number,
): ShadingSummary {
  const validBuildings = buildings.filter((b) => b.heightM !== null && b.coordinates.length >= 3);
  const excludedNoHeightCount = buildings.length - validBuildings.length;

  if (roofPolygon.length < 3) {
    return {
      annualWeightedShadingLossPct: 0,
      monthlyShadingLossRatio: Array(12).fill(0),
      buildingsEvaluatedCount: 0,
      buildingsExcludedNoHeightCount: excludedNoHeightCount,
      note: '尚未框選屋頂多邊形，無法計算遮蔭損失。',
    };
  }

  const [cLon, cLat] = getPolygonCentroid(roofPolygon);
  const roofLocal = roofPolygon.map(([pLon, pLat]) => projectToLocalMeters(pLon, pLat, cLon, cLat));

  // Filter out the target building itself if an OSM polygon encloses the roof centroid
  const neighborBuildings = validBuildings.filter((b) => {
    const bLocal = b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat));
    return !pointInPolygon2D(0, 0, bLocal);
  });

  if (neighborBuildings.length === 0) {
    return {
      annualWeightedShadingLossPct: 0,
      monthlyShadingLossRatio: Array(12).fill(0),
      buildingsEvaluatedCount: 0,
      buildingsExcludedNoHeightCount: excludedNoHeightCount,
      note:
        excludedNoHeightCount > 0
          ? `周圍 ${buildings.length} 棟 OSM 建物皆無 height 標籤或高度未高於本棟屋頂，依規則不進行高度估算（遮蔭納入 0 棟）。`
          : '周圍未檢出高於本棟屋頂且具 OSM height 標籤之遮蔭建物。',
    };
  }

  // Generate 7x7 sampling grid inside roof bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of roofLocal) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const samplePoints: [number, number][] = [];
  const N = 8;
  for (let ix = 0; ix < N; ix++) {
    for (let iy = 0; iy < N; iy++) {
      const px = minX + ((ix + 0.5) / N) * (maxX - minX);
      const py = minY + ((iy + 0.5) / N) * (maxY - minY);
      if (pointInPolygon2D(px, py, roofLocal)) {
        samplePoints.push([px, py]);
      }
    }
  }
  if (samplePoints.length === 0) {
    samplePoints.push([0, 0]);
  }

  // Pre-project neighbor polygons to local meters
  const neighborLocal = neighborBuildings.map((b) => ({
    relHeight: Math.max(0, (b.heightM ?? 0) - Math.max(0, targetRoofHeightM)),
    pts: b.coordinates.map(([bLon, bLat]) => projectToLocalMeters(bLon, bLat, cLon, cLat)),
  })).filter((b) => b.relHeight > 0.1);

  if (neighborLocal.length === 0) {
    return {
      annualWeightedShadingLossPct: 0,
      monthlyShadingLossRatio: Array(12).fill(0),
      buildingsEvaluatedCount: 0,
      buildingsExcludedNoHeightCount: excludedNoHeightCount,
      note: `周圍具 OSM height 標籤之 ${validBuildings.length} 棟建物高度均未超過目標屋頂 (${targetRoofHeightM} m)，無投影遮蔭。`,
    };
  }

  const monthlyRatios: number[] = [];
  for (let m = 0; m < 12; m++) {
    let weightedShadowSum = 0;
    let totalSinAltWeight = 0;

    // Taiwan UTC+8: evaluate 06:00 to 18:00 local time on the 15th of each month
    for (let localHour = 6; localHour <= 18; localHour += 1) {
      const utcHour = localHour - 8;
      const date = new Date(Date.UTC(2026, m, 15, utcHour, 0, 0));
      const pos = getSolarPosition(date, lat, lon);
      if (pos.altitudeRad <= toRad(3)) continue;

      const weight = Math.sin(pos.altitudeRad);
      totalSinAltWeight += weight;

      const tanAlt = Math.tan(pos.altitudeRad);
      const sinAz = Math.sin(pos.southAzimuthRad);
      const cosAz = Math.cos(pos.southAzimuthRad);

      const shadowPolys = neighborLocal.map((nb) => {
        const len = Math.min(220, nb.relHeight / tanAlt);
        const dx = sinAz * len;
        const dy = cosAz * len;
        const shifted = nb.pts.map(([x, y]): [number, number] => [x + dx, y + dy]);
        return convexHull2D([...nb.pts, ...shifted]);
      });

      let shadedCount = 0;
      for (const [px, py] of samplePoints) {
        for (const sp of shadowPolys) {
          if (pointInPolygon2D(px, py, sp)) {
            shadedCount++;
            break;
          }
        }
      }
      const frac = shadedCount / samplePoints.length;
      weightedShadowSum += frac * weight;
    }

    const ratio = totalSinAltWeight > 0 ? Math.min(0.95, weightedShadowSum / totalSinAltWeight) : 0;
    monthlyRatios.push(ratio);
  }

  const annualAvg = monthlyRatios.reduce((a, b) => a + b, 0) / 12;
  return {
    annualWeightedShadingLossPct: annualAvg * 100,
    monthlyShadingLossRatio: monthlyRatios,
    buildingsEvaluatedCount: neighborLocal.length,
    buildingsExcludedNoHeightCount: excludedNoHeightCount,
    note: `納入 ${neighborLocal.length} 棟高於目標屋頂且具 OSM height 標籤之建物；另有 ${excludedNoHeightCount} 棟無 height 標籤建物未納入計算。`,
  };
}

/**
 * pvlib-style horizontal-to-POA transposition & cell temperature model (Section 6.2)
 */
export function runMonthlySolarSimulation(
  pDcKw: number,
  lat: number,
  nasa: NasaPowerResponse,
  params: UserEngineeringParams,
  monthlyShadingLossRatio: number[],
): MonthlySimulationRow[] {
  const tiltRad = toRad(Math.max(0, Math.min(60, params.tiltDeg)));
  // Convert compass azimuth (180 = South, 90 = East) to surface azimuth from South (0 = South)
  const surfAzFromSouthRad = toRad(params.azimuthDeg - 180);
  const latRad = toRad(lat);
  const gamma = params.tempCoeffPctPerC / 100; // e.g. -0.0034 / C
  const sysLoss = Math.max(0, Math.min(0.6, params.systemLossPct / 100));
  const albedo = Math.max(0.05, Math.min(0.6, params.albedo));

  const rows: MonthlySimulationRow[] = [];

  for (let m = 0; m < 12; m++) {
    const days = MONTH_DAYS[m];
    const doy = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344][m];
    const decl = toRad(23.45 * Math.sin(toRad((360 / 365) * (284 + doy))));

    const ghiDaily = Math.max(0, nasa.monthlyGhi[m] ?? 0);
    const tAmbC = nasa.monthlyTempC[m] ?? 24;

    // Extraterrestrial daily horizontal irradiation H0 (kWh/m2/day)
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(decl))));
    const ecc = 1 + 0.033 * Math.cos(toRad((360 * doy) / 365));
    const h0 =
      ((24 * 1.367) / Math.PI) *
      ecc *
      (ws * Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.sin(ws));

    const kt = h0 > 0 ? Math.min(0.85, ghiDaily / h0) : 0.5;
    // Use NASA diffuse if available, else Erbs daily diffuse correlation
    let dhiDaily = nasa.monthlyDiff[m];
    if (dhiDaily === null || dhiDaily === undefined || dhiDaily > ghiDaily) {
      const kd =
        kt <= 0.22
          ? 1 - 0.09 * kt
          : kt <= 0.8
          ? 0.9511 - 0.1604 * kt + 4.388 * kt * kt - 16.638 * Math.pow(kt, 3) + 12.336 * Math.pow(kt, 4)
          : 0.165;
      dhiDaily = ghiDaily * kd;
    }
    const bhiDaily = Math.max(0, ghiDaily - dhiDaily);

    // Representative solar noon / mid-day beam transposition factor Rb
    // Using Liu-Jordan daily-integrated Rb approximation adjusted for azimuth
    const cosLatMinusTilt = Math.cos(latRad - tiltRad * Math.cos(surfAzFromSouthRad));
    const sinLatMinusTilt = Math.sin(latRad - tiltRad * Math.cos(surfAzFromSouthRad));
    const wsTilt = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latRad - tiltRad * Math.cos(surfAzFromSouthRad)) * Math.tan(decl))));
    const wsEff = Math.min(ws, wsTilt);

    const num =
      wsEff * sinLatMinusTilt * Math.sin(decl) + cosLatMinusTilt * Math.cos(decl) * Math.sin(wsEff);
    const den = ws * Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.sin(ws);
    const rb = den > 0.01 ? Math.max(0.5, Math.min(1.6, num / den)) : 1.0;

    const poaDaily =
      bhiDaily * rb +
      dhiDaily * ((1 + Math.cos(tiltRad)) / 2) +
      ghiDaily * albedo * ((1 - Math.cos(tiltRad)) / 2);

    const poaMonthlyKwhM2 = poaDaily * days;

    // Effective average daytime irradiance (W/m2) over ~8.5 peak-equivalent daylight hours for NOCT cell temp
    const gPoaEffectiveWm2 = (poaDaily * 1000) / 8.5;
    const tCellC = tAmbC + ((params.noctC - 20) / 800) * gPoaEffectiveWm2;
    const etaTemp = Math.max(0.75, Math.min(1.08, 1 + gamma * (tCellC - 25)));

    const shadeLoss = monthlyShadingLossRatio[m] ?? 0;
    const genKwh = pDcKw * poaMonthlyKwhM2 * etaTemp * (1 - sysLoss) * (1 - shadeLoss);

    rows.push({
      month: m + 1,
      monthLabel: MONTH_LABELS[m],
      days,
      ghiDailyKwhM2: ghiDaily,
      poaDailyKwhM2: poaDaily,
      poaMonthlyKwhM2,
      tAmbC,
      tCellC,
      etaTemp,
      shadingLossRatio: shadeLoss,
      genKwh,
    });
  }

  return rows;
}

export function matchFitTierRate(pDcKw: number, tiers: FitTier[]): number | null {
  if (!tiers || tiers.length === 0 || pDcKw < 1) return null;
  for (const t of tiers) {
    if (pDcKw >= t.minKw && (t.maxKw === null || pDcKw < t.maxKw)) {
      return t.phase1Rate;
    }
  }
  return tiers[tiers.length - 1]?.phase1Rate ?? null;
}

function solveIrr(cashflows: number[]): number | null {
  // cashflows[0] = -capex, cashflows[1..20] = net annual cashflows
  const npvAt = (r: number) =>
    cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + r, t), 0);

  if (cashflows[0] >= 0) return null;
  const totalPositive = cashflows.slice(1).reduce((a, b) => a + b, 0);
  if (totalPositive <= 0) return null;

  let low = -0.5;
  let high = 1.5;
  if (npvAt(low) * npvAt(high) > 0) return null;

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (npvAt(mid) > 0) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 100;
}

export function computeFinancialScenario(
  id: 'fit' | 'self' | 'lease',
  label: string,
  annualGenKwh: number,
  pDcKw: number,
  effectiveAreaSqm: number,
  rateNtd: number | null,
  params: UserEngineeringParams,
  fallbackFitRateForLease: number | null,
): FinancialScenarioResult | null {
  if (id !== 'lease' && (rateNtd === null || rateNtd <= 0)) {
    return null;
  }

  const r = Math.max(0.001, params.discountRatePct / 100);
  const d = Math.max(0, Math.min(0.05, params.degradationPct / 100));
  const capexNtd = id === 'lease' ? 0 : pDcKw * params.capexPerKw;
  const annualOpexBase = id === 'lease' ? 0 : pDcKw * params.opexPerKwYear;

  const cashflows: CashflowYear[] = [];
  let cumulative = -capexNtd;
  let npv20 = -capexNtd;
  let paybackYears: number | null = null;
  const irrSeries = [-capexNtd];

  for (let t = 1; t <= 20; t++) {
    const genT = annualGenKwh * Math.pow(1 - d, t - 1);
    const netT_calc = (() => {
      let revT = 0;
      if (id === 'fit') {
        revT = genT * (rateNtd ?? 0);
      } else if (id === 'self') {
        const selfShare = Math.max(0, Math.min(1, params.selfConsumptionSharePct / 100));
        const selfSaved = genT * selfShare * (rateNtd ?? 0);
        const surplusSold = genT * (1 - selfShare) * (params.fitRateNtd ?? 0);
        // Under Taiwan Renewable Energy Dev. Act, self-consumed energy (not sold to FIT) is eligible for T-REC
        const trecRev = params.includeTrecInSelf
          ? ((genT * selfShare) / 1000) * Math.max(0, params.trecPriceNtdPerMwh ?? 0)
          : 0;
        revT = selfSaved + surplusSold + trecRev;
      } else {
        // Roof Lease scenario
        if (params.roofLeaseMode === 'area_rent') {
          revT = effectiveAreaSqm * params.roofLeaseNtdPerSqmMonth * 12;
        } else {
          const refRate = fallbackFitRateForLease ?? rateNtd ?? 0;
          revT = genT * refRate * (params.roofLeaseSharePct / 100);
        }
      }
      return revT;
    })();
    const revT = netT_calc;

    const netT = revT - annualOpexBase;
    const prevCum = cumulative;
    cumulative += netT;
    if (paybackYears === null && capexNtd > 0 && cumulative >= 0 && netT > 0) {
      paybackYears = t - 1 + Math.abs(prevCum) / netT;
    }
    const discT = netT / Math.pow(1 + r, t);
    npv20 += discT;
    irrSeries.push(netT);

    cashflows.push({
      year: t,
      generationKwh: genT,
      revenueNtd: revT,
      opexNtd: annualOpexBase,
      netCashflowNtd: netT,
      discountedCashflowNtd: discT,
      cumulativeCashflowNtd: cumulative,
    });
  }

  return {
    id,
    label,
    rateUsedNtd: rateNtd,
    capexNtd,
    year1RevenueNtd: cashflows[0]?.revenueNtd ?? 0,
    year1OpexNtd: annualOpexBase,
    year1NetNtd: cashflows[0]?.netCashflowNtd ?? 0,
    paybackYears,
    npv20Ntd: id === 'lease' ? npv20 : npv20,
    irrPct: id === 'lease' ? null : solveIrr(irrSeries),
    cashflows,
  };
}

export function evaluateThreeGates(
  capacity: CapacitySummary,
  params: UserEngineeringParams,
  taipower: TaipowerFeederResponse | null,
  aiVision?: AiRoofVisionResult | null,
): GateCheckResult[] {
  const pAc = capacity.pAcKw;
  const gridTierNote =
    pAc <= 0
      ? ''
      : pAc < 100
      ? '併網級別：低壓併網（<100 kW，免設高壓受電室，審查流程較快）。'
      : pAc < 500
      ? '併網級別：高壓 11.4/22.8 kV 併網（100–500 kW，須設置責任分界點 MOF 計量箱與保護電驛）。'
      : '併網級別：高壓大型案場（≥500 kW，須辦理台電系統衝擊檢討與專屬保護協調）。';

  // Gate 1: Grid Interconnection
  let gate1: GateCheckResult;
  if (!taipower || !taipower.nearestFeeder) {
    gate1 = {
      id: 'grid',
      title: '第一道關卡：併網容量檢核',
      status: 'pending',
      statusLabel: '無法判定（待查證）',
      headline: '尚未取得台電鄰近饋線剩餘容量資料',
      quantitativeBasis: `預計併網 AC 容量 ${pAc.toFixed(1)} kW vs. 饋線剩餘容量：無資料`,
      reasons: [
        taipower?.provenance.summary || '尚未定位或未能取得該縣市台電公開饋線容量檔案。',
        ...(gridTierNote ? [gridTierNote] : []),
      ],
      nextSteps: [
        '確認廠址座標是否位於台灣本島台電開放資料覆蓋縣市，或點擊「重新擷取」。',
        '正式申請前須向台電當地營業處規劃課申請「併網審查意見書」。',
      ],
      provenanceKey: 'taipower-feeder',
    };
  } else {
    const remKw = taipower.nearestFeeder.capacityKw;
    if (pAc <= 0) {
      gate1 = {
        id: 'grid',
        title: '第一道關卡：併網容量檢核',
        status: 'pending',
        statusLabel: '待框選屋頂',
        headline: `最近饋線 ${taipower.nearestFeeder.feederId} 剩餘 ${remKw.toLocaleString('zh-TW')} kW`,
        quantitativeBasis: `請先框選屋頂面積以計算預計 AC 容量`,
        reasons: ['尚未框選廠房屋頂多邊形。'],
        nextSteps: ['於左側正射影像地圖繪製屋頂多邊形。'],
        provenanceKey: 'taipower-feeder',
      };
    } else if (remKw >= pAc * 1.5) {
      gate1 = {
        id: 'grid',
        title: '第一道關卡：併網容量檢核',
        status: 'pass',
        statusLabel: '通過',
        headline: `饋線 ${taipower.nearestFeeder.feederId} 容量充裕`,
        quantitativeBasis: `預計 P_AC ${pAc.toFixed(1)} kW ≤ 剩餘容量 ${remKw.toLocaleString('zh-TW')} kW（餘裕 ${(remKw / pAc).toFixed(1)} 倍，距變壓器 ${taipower.nearestFeeder.distanceM} m）`,
        reasons: [
          `最近饋線（${taipower.nearestFeeder.feederId}）公開可併網剩餘容量高於本案 AC 容量 1.5 倍以上。`,
          gridTierNote,
        ],
        nextSteps: ['由 EPC 廠商向台電區處送出正式併網審查申請，鎖定饋線容量。'],
        provenanceKey: 'taipower-feeder',
      };
    } else if (remKw >= pAc) {
      gate1 = {
        id: 'grid',
        title: '第一道關卡：併網容量檢核',
        status: 'warn',
        statusLabel: '需要評估',
        headline: `饋線 ${taipower.nearestFeeder.feederId} 餘裕偏緊`,
        quantitativeBasis: `預計 P_AC ${pAc.toFixed(1)} kW vs. 剩餘容量 ${remKw.toLocaleString('zh-TW')} kW（餘裕 ${(remKw - pAc).toFixed(1)} kW）`,
        reasons: [
          '台電開放資料為定期更新，目前剩餘容量雖大於本案需求，但未達 1.5 倍安全緩衝，可能受同期排隊案件影響。',
          gridTierNote,
        ],
        nextSteps: [
          '儘速向台電區處規劃課確認該饋線最新在途併網審查案件數。',
          '同時評估鄰近 1.5 km 替代饋線轉供或採行「自發自用＋逆電力電驛（RPR）不逆送」設計。',
        ],
        provenanceKey: 'taipower-feeder',
      };
    } else {
      gate1 = {
        id: 'grid',
        title: '第一道關卡：併網容量檢核',
        status: 'fail',
        statusLabel: '容量不足',
        headline: `最近饋線 ${taipower.nearestFeeder.feederId} 剩餘容量不足`,
        quantitativeBasis: `預計 P_AC ${pAc.toFixed(1)} kW > 剩餘容量 ${remKw.toLocaleString('zh-TW')} kW（缺口 ${(pAc - remKw).toFixed(1)} kW）`,
        reasons: [
          `最近饋線 ${taipower.nearestFeeder.feederId} 公開剩餘容量低於本案預估併網容量，直接採全額躉售可能遭台電退件或要求負擔龐大補強費用。`,
          gridTierNote,
        ],
        nextSteps: [
          `若欲立即併網，可依下方建議降載至 ${Math.floor(remKw * 0.95)} kW AC 以下，或改併 1.5 km 內具餘裕之替代饋線。`,
          '若廠內日間負載高，亦可採「自發自用＋逆電力電驛（RPR）零逆送」配置突破饋線限制。',
        ],
        provenanceKey: 'taipower-feeder',
      };
    }
  }

  // Gate 2: Regulatory (MOEA / Manual Registered Area + 4.5m Canopy Exemption + Fire Setback + AI Extension)
  const canopyHeight = Math.max(0.5, params.canopyHeightM || 3.2);
  const canopyExceeds45 = canopyHeight > 4.5;
  const setbackLow = params.setbackM < 1.5;
  const aiExtensionFlag = aiVision?.suspectedExtensionRisk === 'possible_extension';

  let gate2: GateCheckResult;
  if (params.registeredAreaSqm === null || params.registeredAreaSqm <= 0) {
    gate2 = {
      id: 'regulatory',
      title: '第二道關卡：法規與建管檢核',
      status: 'pending',
      statusLabel: '待補登記面積',
      headline: '無公開登記面積資料，須手動填寫後檢核',
      quantitativeBasis: `框選屋頂面積 ${capacity.roofAreaSqm.toFixed(1)} m² vs. 登記面積：無資料 · 棚架高 ${canopyHeight.toFixed(1)} m`,
      reasons: [
        '經濟部商工行政開放平臺未公開廠房建物登記面積，系統不採預設推估。',
        canopyExceeds45
          ? `支架/棚架高度 ${canopyHeight.toFixed(1)} m 超過《免請領雜項執照標準》4.5 m 上限，須申請雜項執照。`
          : `支架/棚架高度 ${canopyHeight.toFixed(1)} m ≤ 4.5 m，符合免請領雜項執照高度標準。`,
        ...(aiExtensionFlag
          ? ['AI 衛星影像初篩標示廠房邊緣疑似存在外推雨遮或二次搭蓋，建議複核使照竣工圖。']
          : []),
      ],
      nextSteps: [
        '請依「工廠登記證」或「建物使用執照」填寫合法登記面積 (m²)，以檢核是否存在違章增建風險。',
      ],
      provenanceKey: 'moea-factory',
    };
  } else if (capacity.roofAreaSqm <= 0) {
    gate2 = {
      id: 'regulatory',
      title: '第二道關卡：法規與建管檢核',
      status: 'pending',
      statusLabel: '待框選屋頂',
      headline: `已登錄登記面積 ${params.registeredAreaSqm.toLocaleString('zh-TW')} m²`,
      quantitativeBasis: `請框選屋頂多邊形進行比對`,
      reasons: ['尚未框選屋頂輪廓。'],
      nextSteps: ['於正射影像上框選實際屋頂範圍。'],
      provenanceKey: 'moea-factory',
    };
  } else {
    const ratio = capacity.roofAreaSqm / params.registeredAreaSqm;
    const areaOver = ratio > 1.05;
    const hasRegWarn = areaOver || canopyExceeds45 || aiExtensionFlag;
    const extraReasons: string[] = [];

    if (canopyExceeds45) {
      extraReasons.push(
        `光電棚架高度 ${canopyHeight.toFixed(1)} m > 4.5 m，超過《設置再生能源設施免請領雜項執照標準》免照上限，須委託建築師向地方建管處申請雜項執照。`,
      );
    } else {
      extraReasons.push(
        `光電支架/棚架高度 ${canopyHeight.toFixed(1)} m ≤ 4.5 m，符合免請領雜項執照高度上限。`,
      );
    }
    if (setbackLow) {
      extraReasons.push(
        `目前屋緣退縮 ${params.setbackM.toFixed(1)} m，低於建議之消防搶救及屋頂防墜動線 1.5 m，送審前請依各縣市消防／建管退縮細則微調。`,
      );
    }
    if (aiExtensionFlag) {
      extraReasons.push(
        `AI 衛星正射影像初篩偵測疑似外推雨遮或二次搭蓋（${aiVision?.extensionNotes || '請比對竣工圖'}）。`,
      );
    }

    if (!hasRegWarn) {
      gate2 = {
        id: 'regulatory',
        title: '第二道關卡：法規與建管檢核',
        status: 'pass',
        statusLabel: '通過',
        headline: '面積符合登記範圍且符合 4.5m 免雜照規範',
        quantitativeBasis: `框選 ${capacity.roofAreaSqm.toFixed(1)} m² / 登記 ${params.registeredAreaSqm.toLocaleString('zh-TW')} m²（${(ratio * 100).toFixed(1)}%）· 棚架 ${canopyHeight.toFixed(1)} m`,
        reasons: [
          '正射影像框選屋頂面積未超出建物/工廠登記面積（誤差容許 ±5% 內），無明顯大面積違章棚架徵兆。',
          ...extraReasons,
        ],
        nextSteps: [
          '備妥建物所有權狀與使用執照影本，辦理能源署同意備案及免雜項執照備查程序。',
        ],
        provenanceKey: 'moea-factory',
      };
    } else {
      gate2 = {
        id: 'regulatory',
        title: '第二道關卡：法規與建管檢核',
        status: 'warn',
        statusLabel: areaOver ? '警示增建' : canopyExceeds45 ? '超 4.5m 免照上限' : '疑似外推需複核',
        headline: areaOver
          ? `框選面積超出登記面積 ${((ratio - 1) * 100).toFixed(1)}%`
          : canopyExceeds45
          ? `棚架高度 ${canopyHeight.toFixed(1)} m 超出 4.5 m 免雜照上限`
          : 'AI 初篩提示邊緣疑似外推棚架，須核對使照',
        quantitativeBasis: `框選 ${capacity.roofAreaSqm.toFixed(1)} m² vs. 登記 ${params.registeredAreaSqm.toLocaleString('zh-TW')} m² · 棚架 ${canopyHeight.toFixed(1)} m · 退縮 ${params.setbackM.toFixed(1)} m`,
        reasons: [
          ...(areaOver
            ? [
                '屋頂實測投影面積明顯大於登記面積，可能包含既有違章增建、未登記雨遮或外推鋼棚；未合法建物上方設置光電無法取得能源署備案。',
              ]
            : []),
          ...extraReasons,
        ],
        nextSteps: [
          '請建築師或 EPC 核對使用執照竣工圖，將太陽能板框選範圍縮減至「合法建物屋頂投影內」或使用地圖「挖空禁設區」工具剔除增建區。',
          canopyExceeds45
            ? '將支架/棚架高度調整至 4.5 m 以下以適用免雜項執照，或委託建築師補申請雜項執照。'
            : '確認屋頂消防搶救空間與維運通道符合地方建管抽查規範。',
        ],
        provenanceKey: 'moea-factory',
      };
    }
  }

  // Gate 3: Structural Safety
  let gate3: GateCheckResult;
  if (params.roofType === 'unset') {
    gate3 = {
      id: 'structure',
      title: '第三道關卡：屋頂結構承重',
      status: 'pending',
      statusLabel: '待選擇屋頂型式',
      headline: '尚未指定屋頂材質（鐵皮 / RC 混凝土）',
      quantitativeBasis: '公開圖資無建物屋頂材質屬性，須由使用者確認',
      reasons: ['未選取屋頂型式，無法評估鋼構風壓與靜載重風險。'],
      nextSteps: ['請於「場址與圖資」欄位選擇工廠屋頂為「鐵皮浪板」或「RC 混凝土」。'],
      provenanceKey: 'user-roof-type',
    };
  } else if (params.roofType === 'metal') {
    gate3 = {
      id: 'structure',
      title: '第三道關卡：屋頂結構承重',
      status: 'warn',
      statusLabel: '高風險（需技師評估）',
      headline: '鐵皮屋頂需結構安全鑑定與防風補強評估',
      quantitativeBasis: `屋頂型式：鐵皮浪板 / 鋼構 · 新增均布載重約 15–18 kg/m²（含支架）`,
      reasons: [
        '台灣工廠老舊鐵皮屋頂之 C 型鋼桁條間距過大、浪板鏽蝕或基礎拉拔力不足，是案場後段遭結構技師退件或颱風掀頂之主因。',
        ...(aiVision?.corrosionRisk === 'moderate_or_severe'
          ? ['AI 正射影像初篩觀察到疑似中重度浪板鏽蝕跡象，強烈建議將浪板補強/翻修納入 EPC 報價。']
          : ['若須整棟浪板翻修（含無穿孔夾具或浪板換新），將額外增加建置成本。']),
      ],
      nextSteps: [
        '委託合格結構技師或土木技師現場查驗主鋼架、C 型鋼間距與鏽蝕狀況。',
        '要求 EPC 廠商報價單明確列示「免穿孔夾具」及是否含「浪板補強 / 更換費用」。',
      ],
      provenanceKey: 'user-roof-type',
    };
  } else {
    gate3 = {
      id: 'structure',
      title: '第三道關卡：屋頂結構承重',
      status: 'pass',
      statusLabel: '風險較低',
      headline: 'RC 鋼筋混凝土平屋頂結構裕度較佳',
      quantitativeBasis: `屋頂型式：RC 鋼筋混凝土 · 模組支架系統靜載重約 20–25 kg/m²`,
      reasons: [
        'RC 屋頂設計活載重通常較鋼構鐵皮充裕，適合配重式或植筋防水支架配置。',
      ],
      nextSteps: [
        '申請再生能源設備同意備案時，仍須依法取得結構技師簽證之屋頂承重與耐風壓計算書。',
        '施工須要求 EPC 廠商做好化學錨栓防水封膠或採無穿孔水泥配重工法，避免屋頂滲漏。',
      ],
      provenanceKey: 'user-roof-type',
    };
  }

  return [gate1, gate2, gate3];
}

export function computeEffectiveTouRateNtd(
  monthly: MonthlySimulationRow[],
  params: UserEngineeringParams,
  liveTouOptions: TariffOption[] = [],
): number | null {
  if (params.tariffMode === 'flat') {
    return params.selfConsumptionTariffNtd;
  }

  const matched = liveTouOptions.find((o) => o.tariffMode === params.tariffMode)?.touRates;
  // Official Taiwan Power Co. 2025-10-01 High-Voltage daytime TOU schedules (Jun-Sep Summer vs Oct-May Non-Summer)
  const summerDayRate =
    params.tariffMode === 'hv_two_stage'
      ? matched?.summerPeak ?? 6.75
      : matched?.summerSemiPeak ?? 5.85;
  const nonSummerDayRate =
    params.tariffMode === 'hv_two_stage'
      ? matched?.nonSummerPeak ?? 6.37
      : matched?.nonSummerSemiPeak ?? 5.47;

  const totalGen = monthly.reduce((s, r) => s + r.genKwh, 0);
  if (totalGen <= 0) {
    return (summerDayRate * 4 + nonSummerDayRate * 8) / 12;
  }

  let weightedRev = 0;
  for (const row of monthly) {
    const isSummer = row.month >= 6 && row.month <= 9;
    weightedRev += row.genKwh * (isSummer ? summerDayRate : nonSummerDayRate);
  }
  return weightedRev / totalGen;
}

export function computeBessScenario(
  monthly: MonthlySimulationRow[],
  annualGenKwh: number,
  pDcKw: number,
  effectiveSelfRateNtd: number | null,
  params: UserEngineeringParams,
  liveTouOptions: TariffOption[] = [],
): FinancialScenarioResult | null {
  if (!params.bessEnabled || params.bessKwh <= 0 || pDcKw <= 0) {
    return null;
  }
  const baseDayRate = effectiveSelfRateNtd ?? params.selfConsumptionTariffNtd;
  if (baseDayRate === null || baseDayRate <= 0) {
    return null;
  }

  const r = Math.max(0.001, params.discountRatePct / 100);
  const pvDeg = Math.max(0, Math.min(0.05, params.degradationPct / 100));
  const bessCapex = params.bessKwh * Math.max(0, params.bessCapexPerKwh);
  const pvCapex = pDcKw * params.capexPerKw;
  const capexNtd = pvCapex + bessCapex;
  const annualOpexBase = pDcKw * params.opexPerKwYear + params.bessKwh * 180;

  const rte = Math.max(0.65, Math.min(0.98, params.bessRoundTripEffPct / 100));
  const usableCycleKwh = params.bessKwh * 0.85; // 85% DoD usable window
  const operatingDaysPerYear = 285;
  const effectiveShavedKw = Math.max(0, Math.min(params.bessKw, params.peakShavingKw));
  const annualDemandSavingsNtd = effectiveShavedKw * Math.max(0, params.contractCapacityChargePerKwMonth) * 12;

  const hv3Rates = liveTouOptions.find((o) => o.tariffMode === 'hv_three_stage')?.touRates;
  const hv3SummerPeak = hv3Rates?.summerPeak ?? 9.39;
  const hv3NonSumPeak = hv3Rates?.nonSummerPeak ?? 5.47;

  // Evening peak discharge tariff: in 3-stage TOU summer evening 16-22h is 9.39 NT$/kWh; non-summer 5.47 NT$/kWh
  const eveningPeakRate =
    params.tariffMode === 'hv_three_stage'
      ? (hv3SummerPeak * 4 + hv3NonSumPeak * 8) / 12
      : Math.max(baseDayRate * 1.15, baseDayRate);

  const summerShare =
    annualGenKwh > 0
      ? monthly.filter((m) => m.month >= 6 && m.month <= 9).reduce((s, m) => s + m.genKwh, 0) /
        annualGenKwh
      : 0.4;
  const eveningPeakWeighted =
    params.tariffMode === 'hv_three_stage'
      ? hv3SummerPeak * summerShare + hv3NonSumPeak * (1 - summerShare)
      : eveningPeakRate;

  const cashflows: CashflowYear[] = [];
  let cumulative = -capexNtd;
  let npv20 = -capexNtd;
  let paybackYears: number | null = null;
  const irrSeries = [-capexNtd];
  let demandSavingsYear1Ntd = 0;
  let arbitrageSavingsYear1Ntd = 0;

  for (let t = 1; t <= 20; t++) {
    const genT = annualGenKwh * Math.pow(1 - pvDeg, t - 1);
    const bessHealth = t <= 10 ? Math.pow(0.985, t - 1) : Math.pow(0.985, t - 11);
    const maxAnnualChargeKwh = usableCycleKwh * bessHealth * operatingDaysPerYear;

    const directShare = Math.max(0, Math.min(1, params.selfConsumptionSharePct / 100));
    const directSelfKwh = genT * directShare;
    const surplusPvKwh = Math.max(0, genT - directSelfKwh);

    // BESS absorbs surplus PV first; remaining battery capacity can charge from daytime solar/off-peak
    const shiftedPvKwh = Math.min(maxAnnualChargeKwh, surplusPvKwh + directSelfKwh * 0.25);
    const remainingDirectKwh = Math.max(0, directSelfKwh - Math.max(0, shiftedPvKwh - surplusPvKwh));
    const gridExportKwh = Math.max(0, genT - remainingDirectKwh - shiftedPvKwh);

    const directValue = remainingDirectKwh * baseDayRate;
    const shiftedDischargeValue = shiftedPvKwh * rte * eveningPeakWeighted;
    const exportValue = gridExportKwh * (params.fitRateNtd ?? 0);
    const demandValue = annualDemandSavingsNtd * bessHealth;

    if (t === 1) {
      demandSavingsYear1Ntd = demandValue;
      const pvOnlyYear1Rev =
        genT * directShare * baseDayRate + genT * (1 - directShare) * (params.fitRateNtd ?? 0);
      arbitrageSavingsYear1Ntd = Math.max(0, directValue + shiftedDischargeValue + exportValue - pvOnlyYear1Rev);
    }

    const trecRev = params.includeTrecInSelf
      ? (((remainingDirectKwh + shiftedPvKwh * rte) / 1000) * Math.max(0, params.trecPriceNtdPerMwh ?? 0))
      : 0;
    const revT = directValue + shiftedDischargeValue + exportValue + demandValue + trecRev;
    // Year-11 cell module refurbishment allowance (40% of initial BESS pack cost)
    const opexT = annualOpexBase + (t === 11 ? bessCapex * 0.4 : 0);
    const netT = revT - opexT;

    const prevCum = cumulative;
    cumulative += netT;
    if (paybackYears === null && capexNtd > 0 && cumulative >= 0 && netT > 0) {
      paybackYears = t - 1 + Math.abs(prevCum) / netT;
    }
    const discT = netT / Math.pow(1 + r, t);
    npv20 += discT;
    irrSeries.push(netT);

    cashflows.push({
      year: t,
      generationKwh: genT,
      revenueNtd: revT,
      opexNtd: opexT,
      netCashflowNtd: netT,
      discountedCashflowNtd: discT,
      cumulativeCashflowNtd: cumulative,
    });
  }

  return {
    id: 'bess',
    label: `光儲合一 (${params.bessKwh} kWh 儲能削峰)`,
    rateUsedNtd: baseDayRate,
    capexNtd,
    year1RevenueNtd: cashflows[0]?.revenueNtd ?? 0,
    year1OpexNtd: cashflows[0]?.opexNtd ?? annualOpexBase,
    year1NetNtd: cashflows[0]?.netCashflowNtd ?? 0,
    paybackYears,
    npv20Ntd: npv20,
    irrPct: solveIrr(irrSeries),
    demandSavingsYear1Ntd,
    arbitrageSavingsYear1Ntd,
    cashflows,
  };
}

export function evaluateGate1Recommendation(
  capacity: CapacitySummary,
  params: UserEngineeringParams,
  taipower: TaipowerFeederResponse | null,
): Gate1Recommendation | null {
  if (!taipower?.nearestFeeder || capacity.pAcKw <= 0) return null;
  const nearest = taipower.nearestFeeder;
  const pAc = capacity.pAcKw;
  const isConstrained = nearest.capacityKw < pAc * 1.5;

  // Safe derated capacity: 95% of remaining feeder capacity (min 1 kW if feeder > 0)
  const recommendedMaxAcKw =
    nearest.capacityKw <= 0
      ? 0
      : nearest.capacityKw >= 20
      ? Math.floor(nearest.capacityKw * 0.95)
      : Math.floor(nearest.capacityKw);
  const dcAc = Math.max(0.8, params.dcAcRatio || 1.15);
  const recommendedMaxDcKw = recommendedMaxAcKw * dcAc;
  const recommendedModuleCount = Math.floor((recommendedMaxDcKw * 1000) / Math.max(100, params.moduleWatt));

  const withinRadius = (taipower.nearbyFeeders || []).filter(
    (f) => f.feederId !== nearest.feederId && f.distanceM <= 1500,
  );

  const alternativeFeeders: Gate1AlternativeFeeder[] = withinRadius
    .filter((f) => f.capacityKw >= pAc)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 5)
    .map((f) => ({
      feederId: f.feederId,
      capacityKw: f.capacityKw,
      distanceM: f.distanceM,
      lat: f.lat,
      lon: f.lon,
      surplusAfterConnectionKw: f.capacityKw - pAc,
    }));

  let bestPartialAlternative: Gate1AlternativeFeeder | null = null;
  if (alternativeFeeders.length === 0) {
    const partial = withinRadius
      .filter((f) => f.capacityKw > nearest.capacityKw)
      .sort((a, b) => b.capacityKw - a.capacityKw)[0];
    if (partial) {
      bestPartialAlternative = {
        feederId: partial.feederId,
        capacityKw: partial.capacityKw,
        distanceM: partial.distanceM,
        lat: partial.lat,
        lon: partial.lon,
        surplusAfterConnectionKw: partial.capacityKw - pAc,
      };
    }
  }

  return {
    isConstrained,
    nearestFeederId: nearest.feederId,
    nearestCapacityKw: nearest.capacityKw,
    recommendedMaxAcKw,
    recommendedMaxDcKw,
    recommendedModuleCount,
    alternativeFeeders,
    bestPartialAlternative,
  };
}

export function computeEsgValuation(
  annualGenKwh: number,
  params: UserEngineeringParams,
): EsgValuationSummary {
  const ef = Math.max(0, params.emissionFactorKgPerKwh ?? 0.494);
  const deg = Math.max(0, Math.min(0.05, params.degradationPct / 100));
  const annualCo2ReductionKg = annualGenKwh * ef;
  const annualCo2ReductionTonnes = annualCo2ReductionKg / 1000;

  let lifetimeGen = 0;
  for (let t = 1; t <= 20; t++) {
    lifetimeGen += annualGenKwh * Math.pow(1 - deg, t - 1);
  }
  const lifetime20YrCo2ReductionKg = lifetimeGen * ef;
  const lifetime20YrCo2ReductionTonnes = lifetime20YrCo2ReductionKg / 1000;
  // Standard Taiwan forestry / EPA benchmark: 1 mature tree absorbs ~12 kg CO2e/year
  const equivalentTreesPlanted = Math.round(annualCo2ReductionKg / 12);

  // Under Taiwan rules, only self-consumed generation (non-FIT) is eligible for T-REC certificates (1 cert / 1,000 kWh)
  const selfShare = Math.max(0, Math.min(1, params.selfConsumptionSharePct / 100));
  const annualTrecCertificates = (annualGenKwh * selfShare) / 1000;
  const annualTrecValueNtd = annualTrecCertificates * Math.max(0, params.trecPriceNtdPerMwh ?? 0);

  const feeRate = Math.max(0, params.carbonFeeNtdPerTonne ?? 300);
  const annualCarbonFeeAvoidedNtd = annualCo2ReductionTonnes * feeRate;
  const lifetimeCarbonFeeAvoidedNtd = lifetime20YrCo2ReductionTonnes * feeRate;

  return {
    emissionFactorKgPerKwh: ef,
    annualCo2ReductionKg,
    lifetime20YrCo2ReductionKg,
    annualCo2ReductionTonnes,
    lifetime20YrCo2ReductionTonnes,
    equivalentTreesPlanted,
    annualTrecCertificates,
    annualTrecValueNtd,
    annualCarbonFeeAvoidedNtd,
    lifetimeCarbonFeeAvoidedNtd,
  };
}

export function computeInstallVerdict(input: {
  capacity: CapacitySummary;
  shading: ShadingSummary;
  annualGenKwh: number;
  specificYieldKwhPerKwp: number;
  gates: GateCheckResult[];
  gate1Recommendation: Gate1Recommendation | null;
  params: UserEngineeringParams;
  nasa: NasaPowerResponse | null;
  taipower: TaipowerFeederResponse | null;
  aiVision?: AiRoofVisionResult | null;
  financials: {
    fit: FinancialScenarioResult | null;
    self: FinancialScenarioResult | null;
    bess: FinancialScenarioResult | null;
    lease: FinancialScenarioResult;
  };
}): InstallVerdict {
  const {
    capacity,
    shading,
    annualGenKwh,
    specificYieldKwhPerKwp,
    gates,
    gate1Recommendation,
    params,
    nasa,
    taipower,
    aiVision,
    financials,
  } = input;

  const gate1 = gates.find((g) => g.id === 'grid');
  const gate2 = gates.find((g) => g.id === 'regulatory');
  const gate3 = gates.find((g) => g.id === 'structure');

  const missingChecklist: string[] = [];
  if (capacity.roofAreaSqm <= 0) missingChecklist.push('於左側正射影像框選屋頂多邊形');
  if (!nasa) missingChecklist.push('定位廠址以擷取 NASA 日照氣象');
  if (!taipower?.nearestFeeder) missingChecklist.push('取得鄰近台電饋線剩餘容量');
  if (params.registeredAreaSqm === null || params.registeredAreaSqm <= 0) {
    missingChecklist.push('填寫合法建物／工廠登記面積 (m²)');
  }
  if (params.roofType === 'unset') missingChecklist.push('確認屋頂結構型式（鐵皮浪板 / RC）');

  const activeScenarios = [financials.bess, financials.self, financials.fit].filter(
    (s): s is FinancialScenarioResult => Boolean(s && s.irrPct !== null),
  );
  const bestFin =
    activeScenarios.length > 0
      ? [...activeScenarios].sort((a, b) => (b.npv20Ntd ?? -Infinity) - (a.npv20Ntd ?? -Infinity))[0]
      : null;

  if (capacity.roofAreaSqm > 0 && !bestFin) {
    missingChecklist.push('設定躉購費率 (FIT) 或台電時間電價以試算報酬率');
  }

  // 4-Dimension Reasons
  const reasons: InstallVerdictReason[] = [];

  // 1. Grid
  if (gate1) {
    let gridDetail = gate1.headline;
    if (gate1.status === 'pass' && taipower?.nearestFeeder) {
      gridDetail = `最近饋線 ${taipower.nearestFeeder.feederId} 剩餘 ${taipower.nearestFeeder.capacityKw.toLocaleString('zh-TW')} kW，遠高於本案 ${capacity.pAcKw.toFixed(1)} kW AC 需求。`;
    } else if (gate1.status === 'fail' && gate1Recommendation) {
      const altText =
        gate1Recommendation.alternativeFeeders.length > 0
          ? `；但 1.5 km 內有替代饋線 ${gate1Recommendation.alternativeFeeders[0].feederId}（餘 ${gate1Recommendation.alternativeFeeders[0].capacityKw.toLocaleString('zh-TW')} kW）可評估轉供`
          : '';
      gridDetail = `最近饋線僅剩 ${gate1Recommendation.nearestCapacityKw.toLocaleString('zh-TW')} kW（不足 ${capacity.pAcKw.toFixed(1)} kW），建議降載至 ${gate1Recommendation.recommendedMaxAcKw} kW AC 或採零逆送${altText}。`;
    } else if (gate1.status === 'warn' && taipower?.nearestFeeder) {
      gridDetail = `最近饋線剩餘 ${taipower.nearestFeeder.capacityKw.toLocaleString('zh-TW')} kW（餘裕未達 1.5 倍安全緩衝），須先向台電區處確認排隊審查進度。`;
    }
    reasons.push({
      dimension: 'grid',
      label: '電網併網 (Gate 1)',
      status: gate1.status,
      detail: gridDetail,
    });
  }

  // 2. Regulatory
  if (gate2) {
    let regDetail = gate2.headline;
    if (gate2.status === 'pass' && params.registeredAreaSqm) {
      regDetail = `框選 ${capacity.roofAreaSqm.toFixed(0)} m² 未超過登記面積 ${params.registeredAreaSqm.toLocaleString('zh-TW')} m²，棚架高度 ${(params.canopyHeightM || 3.2).toFixed(1)} m 符合 4.5 m 免雜照規定。`;
    } else if (gate2.status === 'warn') {
      regDetail = `${gate2.headline}；須核對使用執照竣工圖並以「挖空禁設區」剔除疑慮範圍後再送審。`;
    }
    reasons.push({
      dimension: 'regulatory',
      label: '建管法規 (Gate 2)',
      status: gate2.status,
      detail: regDetail,
    });
  }

  // 3. Structure
  if (gate3) {
    let strDetail = gate3.headline;
    if (params.roofType === 'rc') {
      strDetail = 'RC 鋼筋混凝土平屋頂結構載重裕度佳，依規取得結構技師簽證並做好防水施工即可。';
    } else if (params.roofType === 'metal') {
      strDetail =
        aiVision?.corrosionRisk === 'moderate_or_severe'
          ? '鐵皮浪板經 AI 初篩疑似有中重度鏽蝕，建議將浪板換新／結構補強一併計入工程報價。'
          : '鐵皮浪板須由結構技師查驗 C 型鋼跨距與抗風拉拔力，並指定免穿孔夾具施工。';
    }
    reasons.push({
      dimension: 'structure',
      label: '屋頂結構 (Gate 3)',
      status: gate3.status,
      detail: strDetail,
    });
  }

  // 4. Shading & Economics
  const shadePct = shading.annualWeightedShadingLossPct;
  let econStatus: GateStatus = 'pending';
  let econDetail = '尚未取得足夠日照或費率參數，無法評估年發電與投報表現。';

  if (capacity.pDcKw > 0 && nasa) {
    const shadeText =
      shadePct > 15
        ? `年均遮蔭偏高 (${shadePct.toFixed(1)}%)`
        : `年均遮蔭僅 ${shadePct.toFixed(1)}%`;
    const yieldText = `預估年發電 ${Math.round(annualGenKwh).toLocaleString('zh-TW')} 度（${specificYieldKwhPerKwp.toFixed(0)} kWh/kWp）`;

    if (bestFin && bestFin.irrPct !== null) {
      const irr = bestFin.irrPct;
      const npvWan = Math.round((bestFin.npv20Ntd ?? 0) / 10000);
      const paybackStr = bestFin.paybackYears ? `約 ${bestFin.paybackYears.toFixed(1)} 年回本` : '無須自備本金';
      const isGoodReturn = irr >= Math.max(5, params.discountRatePct + 1.5) && (bestFin.npv20Ntd ?? 0) > 0;
      const isNegative = (bestFin.npv20Ntd ?? 0) <= 0 || irr < params.discountRatePct;

      econStatus = isNegative ? 'fail' : isGoodReturn && shadePct <= 15 ? 'pass' : 'warn';
      econDetail = `${yieldText}、${shadeText}；最佳方案「${bestFin.label}」IRR ${irr.toFixed(1)}%（${paybackStr}，20年淨現值 ${npvWan >= 0 ? '+' : ''}${npvWan.toLocaleString('zh-TW')} 萬）。`;
    } else {
      econStatus = shadePct > 18 ? 'warn' : 'pending';
      econDetail = `${yieldText}、${shadeText}；請填入躉購費率或台電時間電價以完成投報判斷。`;
    }
  }

  reasons.push({
    dimension: 'shading_finance',
    label: '日照與投資報酬',
    status: econStatus,
    detail: econDetail,
  });

  // Top Recommended Mode
  let recommendedModeLabel = '待設定費率後判定最佳模式';
  if (bestFin) {
    if (financials.lease.year1RevenueNtd > 0 && (bestFin.irrPct ?? 0) < params.discountRatePct + 1.5) {
      recommendedModeLabel = `建議改採「屋頂出租收租（零出資）」年收約 ${Math.round(financials.lease.year1RevenueNtd / 10000)} 萬，規避自建風險`;
    } else {
      recommendedModeLabel = `推薦採「${bestFin.label}」（IRR ${bestFin.irrPct?.toFixed(1)}%）`;
    }
  } else if (financials.lease.year1RevenueNtd > 0) {
    recommendedModeLabel = `目前可估算「屋頂出租收租」約 ${Math.round(financials.lease.year1RevenueNtd / 10000)} 萬/年`;
  }

  // Final Verdict Determination (Strict Zero-Fabrication)
  const hasPendingCore =
    capacity.roofAreaSqm <= 0 ||
    !nasa ||
    gates.some((g) => g.status === 'pending');

  const topActions: string[] = [];
  if (missingChecklist.length > 0) {
    topActions.push(`先補齊：${missingChecklist.slice(0, 2).join('、')}`);
  }
  if (gate1?.status === 'fail' && gate1Recommendation) {
    if (gate1Recommendation.alternativeFeeders.length > 0) {
      topActions.push(
        `轉併 1.5 km 替代饋線 ${gate1Recommendation.alternativeFeeders[0].feederId}，或降載至 ${gate1Recommendation.recommendedMaxAcKw} kW AC 免補強併網`,
      );
    } else if (gate1Recommendation.recommendedMaxAcKw >= 5) {
      topActions.push(
        `降載至 ${gate1Recommendation.recommendedMaxAcKw} kW AC 或改採「自發自用＋RPR 逆電力電驛零逆送」`,
      );
    } else {
      topActions.push('饋線近滿載，改評估「廠內自發自用零逆送」');
    }
  }
  if (shading.panelHeatmap && shading.panelHeatmap.shadedOver15Count > 0 && params.excludeShadedThresholdPct === null) {
    topActions.push(`點擊「一鍵剔除 >15% 遮蔭板」移除 ${shading.panelHeatmap.shadedOver15Count} 片低效板以拉高單位發電`);
  }
  if (gate2?.status === 'warn') {
    topActions.push('核對建物使用執照並利用「挖空禁設區」剔除疑似外推雨遮／增建');
  }
  if (params.roofType === 'metal') {
    topActions.push('請 EPC 報價列明免穿孔夾具及浪板承重／防鏽檢核費用');
  }

  let level: InstallVerdictLevel;
  let headline: string;
  let summary: string;

  const isFeederDeadEnd =
    gate1?.status === 'fail' &&
    (!gate1Recommendation ||
      (gate1Recommendation.recommendedMaxAcKw < 5 && gate1Recommendation.alternativeFeeders.length === 0));
  const isTooSmall = capacity.roofAreaSqm > 0 && capacity.pDcKw < 3;
  const isFinanciallyNegative =
    bestFin !== null && ((bestFin.npv20Ntd ?? 0) <= 0 || (bestFin.irrPct ?? 0) < params.discountRatePct);

  if (hasPendingCore) {
    level = 'incomplete';
    headline = '尚待補齊關鍵資料，暫無法給出最終裝設結論';
    summary = `目前仍有 ${missingChecklist.length} 項關鍵現場／圖資欄位未完成，系統嚴格不採猜測值，請補齊後立即自動產出建議結論。`;
  } else if (isFeederDeadEnd || isTooSmall || (isFinanciallyNegative && shadePct > 20)) {
    level = 'not_recommended';
    headline = '現階段不建議直接滿額自建安裝';
    summary = isTooSmall
      ? `有效可排容量僅 ${capacity.pDcKw.toFixed(1)} kWp，規模過小不易攤提併網與簽證成本。`
      : isFeederDeadEnd
      ? '最近饋線已無併網餘裕且 1.5 km 內無可轉併替代饋線，直接自建售電恐無法併網；僅建議廠內高耗能用戶改評估純自發自用零逆送。'
      : `高遮蔭損失 (${shadePct.toFixed(1)}%) 導致自建案 20 年淨現值為負，經濟效益不足。`;
  } else if (
    gate1?.status === 'fail' ||
    gate1?.status === 'warn' ||
    gate2?.status === 'warn' ||
    (gate3?.status === 'warn' && aiVision?.corrosionRisk === 'moderate_or_severe') ||
    shadePct > 15 ||
    isFinanciallyNegative
  ) {
    level = 'conditional';
    const blockers: string[] = [];
    if (gate1?.status === 'fail' || gate1?.status === 'warn') blockers.push('饋線容量須調整');
    if (gate2?.status === 'warn') blockers.push('建管面積／棚高須複核');
    if (aiVision?.corrosionRisk === 'moderate_or_severe') blockers.push('鐵皮疑似鏽蝕須補強');
    if (shadePct > 15) blockers.push('高遮蔭板須剔除');
    if (isFinanciallyNegative) blockers.push('建議改評估出租收租');
    headline = '具裝設條件，建議「調整後」再行安裝';
    summary = `案場發電與屋頂基底可行，但偵測到 ${blockers.join('、')}，依下方建議修正即可大幅降低退件與投資風險。`;
  } else {
    level = 'recommended';
    headline =
      gate3?.status === 'pass'
        ? '條件優良，建議規劃安裝太陽光電'
        : '綜合效益明確，建議安裝（須完成鐵皮結構簽證）';
    summary = bestFin
      ? `饋線、法規與遮蔭條件皆達標，${recommendedModeLabel}，同時年減碳約 ${((annualGenKwh * (params.emissionFactorKgPerKwh ?? 0.494)) / 1000).toFixed(1)} 公噸 CO₂e。`
      : '饋線容量與建管法規初步檢核均無阻擋，遮蔭損失低，具備立即推進 EPC 報價條件。';
  }

  return {
    level,
    headline,
    summary,
    recommendedModeLabel,
    reasons,
    missingChecklist,
    topActions: topActions.slice(0, 4),
  };
}

export function evaluateFullSolarCase(
  roofPolygon: [number, number][],
  lat: number,
  lon: number,
  params: UserEngineeringParams,
  nasa: NasaPowerResponse | null,
  buildings: OsmBuildingFeature[],
  taipower: TaipowerFeederResponse | null,
  exclusionPolygons: RoofExclusionPolygon[] = [],
  liveTouOptions: TariffOption[] = [],
  aiVision?: AiRoofVisionResult | null,
  layoutCache?: RoofLayoutCache,
): SolarEvaluationResult {
  const baseCapacity = computeCapacity(roofPolygon, params, exclusionPolygons);
  const shadingInputs = [roofPolygon, buildings, lat, lon, params.targetRoofHeightM];
  let roofShading = layoutCache?.roofShading;
  if (!roofShading || !shadingInputs.every((input, index) => Object.is(input, roofShading?.inputs[index]))) {
    roofShading = {
      inputs: shadingInputs,
      result: computeMonthlyShading(roofPolygon, buildings, lat, lon, params.targetRoofHeightM),
    };
    if (layoutCache) layoutCache.roofShading = roofShading;
  }
  const baseShading = roofShading.result;

  // Per-panel SunCalc heatmap & optional pruning of high-shading panels
  const layoutEval =
    roofPolygon.length >= 3
      ? generateRoofPanelLayoutGeoJson(
          roofPolygon,
          params,
          params.maxModuleCountOverride && params.maxModuleCountOverride > 0 ? params.maxModuleCountOverride : undefined,
          exclusionPolygons,
          { buildings, lat, lon },
          false,
          layoutCache,
        )
      : null;

  let capacity = baseCapacity;
  let shading = baseShading;

  if (layoutEval) {
    const moduleCount = layoutEval.panelCount;
    const pDcKw = moduleCount * Math.max(100, params.moduleWatt) / 1000;
    capacity = {
      ...baseCapacity,
      rawModuleCount: layoutEval.candidateCount,
      moduleCount,
      pDcKw,
      pAcKw: pDcKw / Math.max(0.8, params.dcAcRatio || 1.15),
      isDeratedByOverride: moduleCount < layoutEval.candidateCount - layoutEval.prunedCount,
    };
    const monthlyShadingLossRatio = layoutEval.monthlyShadingLossRatio;
    const annualWeightedShadingLossPct = monthlyShadingLossRatio.reduce((sum, ratio) => sum + ratio, 0) / 12 * 100;
    shading = {
      ...baseShading,
      annualWeightedShadingLossPct,
      monthlyShadingLossRatio,
      panelHeatmap: {
        totalCandidatePanels: layoutEval.candidateCount,
        activePanels: layoutEval.panelCount,
        prunedShadedPanels: layoutEval.prunedCount,
        shadedOver15Count: layoutEval.shadedOver15Count,
        maxPanelShadePct: layoutEval.selectedCenters.reduce((max, panel) => Math.max(max, panel.shadePct), 0),
        avgActivePanelShadePct: annualWeightedShadingLossPct,
      },
    };
  }

  const monthly: MonthlySimulationRow[] = nasa
    ? runMonthlySolarSimulation(capacity.pDcKw, lat, nasa, params, shading.monthlyShadingLossRatio)
    : MONTH_LABELS.map((label, i) => ({
        month: i + 1,
        monthLabel: label,
        days: MONTH_DAYS[i],
        ghiDailyKwhM2: 0,
        poaDailyKwhM2: 0,
        poaMonthlyKwhM2: 0,
        tAmbC: 0,
        tCellC: 0,
        etaTemp: 1,
        shadingLossRatio: shading.monthlyShadingLossRatio[i] ?? 0,
        genKwh: 0,
      }));

  const annualGenKwh = monthly.reduce((s, r) => s + r.genKwh, 0);
  const specificYieldKwhPerKwp = capacity.pDcKw > 0 ? annualGenKwh / capacity.pDcKw : 0;

  const gates = evaluateThreeGates(capacity, params, taipower, aiVision);
  const gate1Recommendation = evaluateGate1Recommendation(capacity, params, taipower);
  const overallPass = gates.every((g) => g.status === 'pass');
  const hasBlocker = gates.some((g) => g.status === 'fail');

  const esg = computeEsgValuation(annualGenKwh, params);
  const effectiveSelfRateNtd = computeEffectiveTouRateNtd(monthly, params, liveTouOptions);

  const fit = computeFinancialScenario(
    'fit',
    '全額售電 (躉購 FIT)',
    annualGenKwh,
    capacity.pDcKw,
    capacity.effectiveAreaSqm,
    params.fitRateNtd,
    params,
    params.fitRateNtd,
  );
  const self = computeFinancialScenario(
    'self',
    params.tariffMode === 'hv_three_stage'
      ? '自發自用 (高壓三段式 TOU)'
      : params.tariffMode === 'hv_two_stage'
      ? '自發自用 (高壓二段式 TOU)'
      : '自發自用 (節省電費)',
    annualGenKwh,
    capacity.pDcKw,
    capacity.effectiveAreaSqm,
    effectiveSelfRateNtd,
    params,
    params.fitRateNtd,
  );
  const bess = computeBessScenario(
    monthly,
    annualGenKwh,
    capacity.pDcKw,
    effectiveSelfRateNtd,
    params,
    liveTouOptions,
  );
  if (bess) {
    const assumptions = [
      { selfConsumptionSharePct: params.selfConsumptionSharePct, peakShavingKw: params.peakShavingKw },
      {
        selfConsumptionSharePct: params.selfConsumptionSharePct >= 10
          ? params.selfConsumptionSharePct - 10
          : Math.min(100, params.selfConsumptionSharePct + 10),
        peakShavingKw: params.peakShavingKw,
      },
      { selfConsumptionSharePct: params.selfConsumptionSharePct, peakShavingKw: 0 },
    ];
    bess.sensitivity = assumptions.map((assumption) => {
      const scenario = computeBessScenario(
        monthly, annualGenKwh, capacity.pDcKw, effectiveSelfRateNtd,
        { ...params, ...assumption }, liveTouOptions,
      );
      return {
        ...assumption,
        peakShavingKw: Math.max(0, Math.min(params.bessKw, assumption.peakShavingKw)),
        npv20Ntd: scenario?.npv20Ntd ?? null,
        irrPct: scenario?.irrPct ?? null,
      };
    });
  }
  const lease = computeFinancialScenario(
    'lease',
    '屋頂出租 (零出資收租)',
    annualGenKwh,
    capacity.pDcKw,
    capacity.effectiveAreaSqm,
    params.fitRateNtd,
    params,
    params.fitRateNtd,
  )!;

  const financials = {
    fit,
    self,
    bess,
    lease,
  };

  const verdict = computeInstallVerdict({
    capacity,
    shading,
    annualGenKwh,
    specificYieldKwhPerKwp,
    gates,
    gate1Recommendation,
    params,
    nasa,
    taipower,
    aiVision,
    financials,
  });

  return {
    modelVersion: SOLAR_MODEL_VERSION,
    capacity,
    shading,
    monthly,
    annualGenKwh,
    specificYieldKwhPerKwp,
    effectiveSelfRateNtd,
    gates,
    gate1Recommendation,
    overallPass,
    hasBlocker,
    verdict,
    esg,
    financials,
  };
}
