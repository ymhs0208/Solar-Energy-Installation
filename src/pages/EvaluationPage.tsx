import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Leaf,
  MapPin,
  RefreshCw,
  ScanEye,
  Scissors,
  Search,
  Sun,
  Send,
  ShieldAlert,
  XCircle,
  Zap,
} from 'lucide-react';
import { BessSensitivity } from '../components/BessSensitivity';
import { CashflowComparisonChart } from '../components/CashflowComparisonChart';
import { InstallVerdictCard, InstallVerdictStrip } from '../components/InstallVerdictCard';
import { RoofMapCanvas } from '../components/RoofMapCanvas';
import { Solar3DSimulator } from '../components/Solar3DSimulator';
import { SourceTag } from '../components/SourceTag';
import {
  analyzeRoofWithGeminiVision,
  box2dToGeoPolygon,
  fetchFitRatesLive,
  fetchMoeaFactoryLive,
  fetchNasaPowerLive,
  fetchNlsc3dTilesNearby,
  fetchNlscDistrict,
  fetchOsmBuildingsLive,
  fetchTaipowerFeederLive,
  fetchTaipowerTariffLive,
  geocodeTaiwanAddress,
  type SnapshotGeoTransform,
} from '../lib/liveData';
import {
  loadNlsc3dTileBuildings,
  type ParsedNlscBuildingMesh,
} from '../lib/nlsc3dTiles';
import {
  DEFAULT_USER_PARAMS,
  computePolygonMetrics,
  evaluateFullSolarCase,
  getPolygonCentroid,
  matchFitTierRate,
  pointInPolygon2D,
  projectToLocalMeters,
} from '../lib/solarEngine';
import { loadActiveCase, saveActiveCase, upsertCaseToEpcPool } from '../lib/caseStorage';
import type {
  AiRoofVisionResult,
  DataProvenance,
  EvaluationCase,
  FitRatesResponse,
  GateStatus,
  MoeaFactoryResponse,
  NasaPowerResponse,
  NlscDistrictInfo,
  OsmBuildingFeature,
  RoofExclusionPolygon,
  TaipowerFeederResponse,
  TaipowerTariffResponse,
  TariffMode,
  UserEngineeringParams,
} from '../types/solar';

const QUICK_INDUSTRIAL_QUERIES = [
  { label: '臺中工業區', query: '臺中市西屯區工業區一路' },
  { label: '桃園華亞園區', query: '桃園市龜山區華亞一路' },
  { label: '臺南南科園區', query: '臺南市新市區南科三路' },
];

function GateStatusBadge({ status, label }: { status: GateStatus; label: string }) {
  if (status === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 whitespace-nowrap">
        <XCircle className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 whitespace-nowrap">
      <Clock className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function EvaluationPage({ onCaseUpdated }: { onCaseUpdated?: () => void }) {
  const navigate = useNavigate();

  const [viewportMode, setViewportMode] = useState<'map' | '3d-sim'>('map');
  const [activeTab, setActiveTab] = useState<'site' | 'params' | 'results'>('site');
  const [searchInput, setSearchInput] = useState('');
  const [locatedPlace, setLocatedPlace] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [siteFocusRequest, setSiteFocusRequest] = useState(0);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const siteRequestRef = useRef(0);
  const nlscRequestRef = useRef(0);
  const visionRequestRef = useRef(0);
  const [isFetchingSite, setIsFetchingSite] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [geocodeCandidates, setGeocodeCandidates] = useState<
    Array<{ displayName: string; lat: number; lon: number; type: string }>
  >([]);

  const [targetLat, setTargetLat] = useState<number>(23.9738);
  const [targetLon, setTargetLon] = useState<number>(120.982);
  const [hasTargetPoint, setHasTargetPoint] = useState<boolean>(false);
  const [roofPolygon, setRoofPolygon] = useState<[number, number][]>([]);
  const [exclusionPolygons, setExclusionPolygons] = useState<RoofExclusionPolygon[]>([]);
  const [aiVision, setAiVision] = useState<AiRoofVisionResult | null>(null);
  const [aiSnapshotGeo, setAiSnapshotGeo] = useState<SnapshotGeoTransform | null>(null);
  const [isRunningAiVision, setIsRunningAiVision] = useState<boolean>(false);
  const [aiVisionError, setAiVisionError] = useState<string | null>(null);
  const [focusCoordinate, setFocusCoordinate] = useState<{
    lat: number;
    lon: number;
    nonce: number;
  } | null>(null);

  const [params, setParams] = useState<UserEngineeringParams>(DEFAULT_USER_PARAMS);
  const [district, setDistrict] = useState<NlscDistrictInfo | null>(null);
  const [nasa, setNasa] = useState<NasaPowerResponse | null>(null);
  const [osmBuildings, setOsmBuildings] = useState<OsmBuildingFeature[]>([]);
  const [osmProvenance, setOsmProvenance] = useState<DataProvenance | null>(null);
  const [osmCounts, setOsmCounts] = useState({ total: 0, withH: 0, withoutH: 0 });
  const [nlsc3dBuildings, setNlsc3dBuildings] = useState<ParsedNlscBuildingMesh[]>([]);
  const [nlsc3dProvenance, setNlsc3dProvenance] = useState<DataProvenance | null>(null);
  const [nlsc3dLoading, setNlsc3dLoading] = useState(false);
  const [taipower, setTaipower] = useState<TaipowerFeederResponse | null>(null);
  const [moea, setMoea] = useState<MoeaFactoryResponse | null>(null);
  const [fitRateSource, setFitRateSource] = useState<DataProvenance | null>(null);
  const [selfRateSource, setSelfRateSource] = useState<DataProvenance | null>(null);
  const [fitSchedule, setFitSchedule] = useState<FitRatesResponse | null>(null);
  const [tariffSchedule, setTariffSchedule] = useState<TaipowerTariffResponse | null>(null);
  const [geocodeProvenance, setGeocodeProvenance] = useState<DataProvenance | null>(null);

  const [caseId, setCaseId] = useState<string>(`case-${Date.now()}`);
  const [epcSubmittedMsg, setEpcSubmittedMsg] = useState<string | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const loadNlsc3dForSite = async (countyName: string, lat: number, lon: number) => {
    const request = ++nlscRequestRef.current;
    if (!countyName) {
      setNlsc3dLoading(false);
      setNlsc3dBuildings([]);
      setNlsc3dProvenance(null);
      return;
    }
    setNlsc3dLoading(true);
    try {
      const nearby = await fetchNlsc3dTilesNearby(countyName, lat, lon, 380, 88);
      if (request !== nlscRequestRef.current) return;
      setNlsc3dProvenance(nearby.provenance);
      if (nearby.tiles.length > 0) {
        const sceneData = await loadNlsc3dTileBuildings(nearby.tiles, lat, lon);
        if (request === nlscRequestRef.current) setNlsc3dBuildings(sceneData.buildings);
      } else {
        setNlsc3dBuildings([]);
      }
    } catch (err) {
      if (request !== nlscRequestRef.current) return;
      setNlsc3dBuildings([]);
      setNlsc3dProvenance({
        key: 'nlsc-3d',
        label: '國土測繪中心 3D Tiles',
        sourceName: '內政部國土測繪中心多維度平臺',
        sourceUrl: 'https://3dtiles.nlsc.gov.tw/tiles3d/Service',
        fetchedAt: new Date().toISOString(),
        status: 'error',
        summary: '載入 3D Tiles 建物模型失敗',
        errorDetail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (request === nlscRequestRef.current) setNlsc3dLoading(false);
    }
  };

  // Restore active case from localStorage if user navigated back from /report or /epc
  useEffect(() => {
    const saved = loadActiveCase();
    if (saved) {
      setCaseId(saved.id);
      setFitRateSource(saved.reportEvidence?.fitRateSource ?? null);
      setSelfRateSource(saved.params.tariffMode === 'flat' ? saved.reportEvidence?.selfRateSource ?? null : null);
      if (saved.reportEvidence?.shadowBuildings) {
        setOsmBuildings(saved.reportEvidence.shadowBuildings);
      }
      setTargetLat(saved.locationPoint?.lat ?? saved.lat);
      setTargetLon(saved.locationPoint?.lon ?? saved.lon);
      setHasTargetPoint(true);
      setRoofPolygon(saved.roofPolygon);
      setExclusionPolygons(saved.exclusionPolygons ?? []);
      setAiVision(saved.aiVision ?? null);
      setParams({ ...DEFAULT_USER_PARAMS, ...saved.params });
      setDistrict(saved.district);
      setNasa(saved.nasa);
      setTaipower(saved.taipower);
      setMoea(saved.moea);
      if (saved.osmSummary) {
        setOsmCounts({
          total: saved.osmSummary.totalCount,
          withH: saved.osmSummary.withHeightCount,
          withoutH: saved.osmSummary.withoutHeightCount,
        });
        setOsmProvenance(saved.osmSummary.provenance);
      }
      setSearchInput(saved.params.address || '');
      setLocatedPlace(saved.params.address || '');
      if (saved.district?.ctyName) {
        void loadNlsc3dForSite(saved.district.ctyName, saved.lat, saved.lon);
      }
    }

    // Check live FIT & Tariff schedules once on mount
    fetchFitRatesLive().then(setFitSchedule).catch(() => {});
    fetchTaipowerTariffLive().then(setTariffSchedule).catch(() => {});
  }, []);

  // Load all live site data for a coordinate
  const loadLiveSiteData = async (lat: number, lon: number, addressLabel?: string) => {
    const request = ++siteRequestRef.current;
    setIsFetchingSite(true);
    setSearchError(null);
    setTargetLat(lat);
    setTargetLon(lon);
    setHasTargetPoint(true);

    try {
      const distRes = await fetchNlscDistrict(lat, lon);
      if (request !== siteRequestRef.current) return;
      setDistrict(distRes);

      const countyName = distRes.ctyName || '';
      const nlsc3dPromise = loadNlsc3dForSite(countyName, lat, lon);

      const [nasaRes, osmRes, tpRes] = await Promise.all([
        fetchNasaPowerLive(lat, lon),
        fetchOsmBuildingsLive(lat, lon, 260),
        fetchTaipowerFeederLive(countyName, lat, lon),
      ]);

      if (request !== siteRequestRef.current) return;
      setNasa(nasaRes);
      setOsmBuildings(osmRes.buildings);
      setOsmProvenance(osmRes.provenance);
      setOsmCounts({
        total: osmRes.totalCount,
        withH: osmRes.withHeightCount,
        withoutH: osmRes.withoutHeightCount,
      });
      setTaipower(tpRes);

      if (addressLabel) {
        setParams((prev) => ({
          ...prev,
          address: addressLabel,
          factoryName: prev.factoryName || `${distRes.ctyName}${distRes.townName}廠區評估案`,
        }));
      }
      await nlsc3dPromise;
    } catch (err) {
      if (request === siteRequestRef.current) setSearchError(err instanceof Error ? err.message : '即時公開資料擷取失敗');
    } finally {
      if (request === siteRequestRef.current) setIsFetchingSite(false);
    }
  };

  useEffect(() => {
    if (!siteFocusRequest || viewportMode !== 'map') return;
    const panel = mapPanelRef.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    if (bounds.top < 100 || bounds.top + bounds.height / 2 > window.innerHeight - 40) {
      panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [siteFocusRequest, viewportMode]);

  const revealLocatedSite = () => {
    setViewportMode('map');
    setSiteFocusRequest((request) => request + 1);
  };

  const selectSearchLocation = (candidate: (typeof geocodeCandidates)[number], index: number, query: string) => {
    const address = candidate.displayName || query;
    const changesSite = hasTargetPoint &&
      (Math.abs(candidate.lat - targetLat) > 1e-6 || Math.abs(candidate.lon - targetLon) > 1e-6);
    if (changesSite) {
      ++nlscRequestRef.current;
      ++visionRequestRef.current;
      setCaseId(`case-${crypto.randomUUID()}`);
      setRoofPolygon([]);
      setExclusionPolygons([]);
      setAiVision(null);
      setAiSnapshotGeo(null);
      setAiVisionError(null);
      setIsRunningAiVision(false);
      setFocusCoordinate(null);
      setDistrict(null);
      setNasa(null);
      setOsmBuildings([]);
      setOsmProvenance(null);
      setOsmCounts({ total: 0, withH: 0, withoutH: 0 });
      setNlsc3dBuildings([]);
      setNlsc3dProvenance(null);
      setNlsc3dLoading(false);
      setTaipower(null);
      setMoea(null);
      setEpcSubmittedMsg(null);
      setFitRateSource(null);
      setSelfRateSource(null);
      setParams({ ...DEFAULT_USER_PARAMS, address });
      setActiveTab('site');
    }
    setSelectedCandidate(index);
    setLocatedPlace(address);
    revealLocatedSite();
    return loadLiveSiteData(candidate.lat, candidate.lon, address);
  };

  const handleAddressSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchInput).trim();
    if (!q || isFetchingSite) return;
    if (overrideQuery) setSearchInput(overrideQuery);
    setIsFetchingSite(true);
    setSearchError(null);
    setGeocodeCandidates([]);

    try {
      const geo = await geocodeTaiwanAddress(q);
      setGeocodeProvenance(geo.provenance);
      if (geo.candidates.length === 0) {
        setSearchError(geo.provenance.summary);
        setIsFetchingSite(false);
        return;
      }
      setGeocodeCandidates(geo.candidates);
      await selectSearchLocation(geo.candidates[0], 0, q);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '地址定位失敗');
      setIsFetchingSite(false);
    }
  };

  const handleMoeaLookup = async () => {
    const q = params.factoryName.trim();
    const tid = params.taxId.trim();
    if (!q && !tid) return;
    const request = siteRequestRef.current;
    const res = await fetchMoeaFactoryLive(q, tid);
    if (request !== siteRequestRef.current) return;
    setMoea(res);
    if (res.records.length > 0) {
      setParams((prev) => ({
        ...prev,
        factoryName: prev.factoryName || res.records[0].companyName,
        taxId: prev.taxId || res.records[0].businessAccountingNo,
      }));
    }
  };

  // When user draws a roof polygon, re-center site centroid for shading/district if needed
  const handleRoofPolygonChange = (coords: [number, number][]) => {
    ++visionRequestRef.current;
    setIsRunningAiVision(false);
    setRoofPolygon(coords);
    setAiVision(null);
    setAiSnapshotGeo(null);
    setAiVisionError(null);
    if (coords.length < 3) {
      setExclusionPolygons([]);
    }
    if (coords.length >= 3) {
      const [cLon, cLat] = getPolygonCentroid(coords);
      if (!hasTargetPoint) {
        loadLiveSiteData(cLat, cLon, params.address || `${cLat.toFixed(5)}, ${cLon.toFixed(5)}`);
      }
    }
  };

  const handleAddExclusionPolygon = (coords: [number, number][]) => {
    if (coords.length < 3) return;
    const areaSqm = computePolygonMetrics(coords).areaSqm;
    setExclusionPolygons((prev) => [
      ...prev,
      {
        id: `ex-${Date.now()}-${prev.length + 1}`,
        label: `障礙區 #${prev.length + 1} (${areaSqm.toFixed(0)}m²)`,
        coordinates: coords,
      },
    ]);
  };

  const handleRunAiRoofVision = async () => {
    if (roofPolygon.length < 3) return;
    const request = ++visionRequestRef.current;
    setIsRunningAiVision(true);
    setAiVisionError(null);
    try {
      const res = await analyzeRoofWithGeminiVision(roofPolygon, exclusionPolygons, {
        roofAreaSqm: evaluation.capacity.roofAreaSqm,
        address: params.address,
        districtLabel: district?.ctyName ? `${district.ctyName}${district.townName}` : '',
      });
      if (request !== visionRequestRef.current) return;
      setAiVision(res);
      setAiSnapshotGeo(res.snapshotGeo);
    } catch (err) {
      if (request === visionRequestRef.current) setAiVisionError(err instanceof Error ? err.message : 'AI 正射影像判讀失敗');
    } finally {
      if (request === visionRequestRef.current) setIsRunningAiVision(false);
    }
  };

  // Convert Gemini Vision normalized [ymin, xmin, ymax, xmax] bounding boxes into verified inside-roof geo polygons
  const aiConvertedObstacles = useMemo(() => {
    if (!aiVision || !aiSnapshotGeo || roofPolygon.length < 3) return [];
    const [rLon, rLat] = getPolygonCentroid(roofPolygon);
    const roofLocal = roofPolygon.map(([lon, lat]) => projectToLocalMeters(lon, lat, rLon, rLat));

    return aiVision.detectedObstacles
      .map((obs, idx) => {
        if (!obs.box2d) return null;
        const coords = box2dToGeoPolygon(obs.box2d, aiSnapshotGeo);
        if (!coords) return null;
        const [oLon, oLat] = getPolygonCentroid(coords);
        const [ox, oy] = projectToLocalMeters(oLon, oLat, rLon, rLat);
        if (!pointInPolygon2D(ox, oy, roofLocal)) return null;
        const areaSqm = computePolygonMetrics(coords).areaSqm;
        if (areaSqm < 0.8) return null;
        return { obs, idx, coords, areaSqm };
      })
      .filter(
        (
          item,
        ): item is {
          obs: AiRoofVisionResult['detectedObstacles'][number];
          idx: number;
          coords: [number, number][];
          areaSqm: number;
        } => item !== null,
      );
  }, [aiVision, aiSnapshotGeo, roofPolygon]);

  const handleAutoExcludeAllAiObstacles = () => {
    if (aiConvertedObstacles.length === 0) return;
    const baseTs = Date.now();
    setExclusionPolygons((prev) => {
      const existingLabels = new Set(prev.map((e) => e.label));
      const additions: RoofExclusionPolygon[] = [];
      for (const item of aiConvertedObstacles) {
        const label = `AI:${item.obs.type} (${item.areaSqm.toFixed(0)}m²)`;
        if (existingLabels.has(label)) continue;
        additions.push({
          id: `ex-ai-${baseTs}-${item.idx}`,
          label,
          coordinates: item.coords,
        });
      }
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  // Run full deterministic evaluation in browser
  const evalLat = roofPolygon.length >= 3 ? getPolygonCentroid(roofPolygon)[1] : targetLat;
  const evalLon = roofPolygon.length >= 3 ? getPolygonCentroid(roofPolygon)[0] : targetLon;

  // Merge NLSC 3D Tiles buildings (official BUILD_H / LiDAR mesh height) + non-overlapping OSM buildings
  const mergedShadingBuildings = useMemo<OsmBuildingFeature[]>(() => {
    const nlscFeatures = nlsc3dBuildings.map((b) => b.feature);
    if (nlscFeatures.length === 0) return osmBuildings;

    const nonOverlappingOsm = osmBuildings.filter((osmB) => {
      if (osmB.heightM === null || osmB.coordinates.length < 3) return false;
      const [cLon, cLat] = getPolygonCentroid(osmB.coordinates);
      return !nlscFeatures.some((nlscB) => {
        const local = nlscB.coordinates.map(([lon, lat]) =>
          projectToLocalMeters(lon, lat, cLon, cLat),
        );
        return pointInPolygon2D(0, 0, local);
      });
    });
    return [...nlscFeatures, ...nonOverlappingOsm];
  }, [nlsc3dBuildings, osmBuildings]);

  const evaluation = useMemo(
    () =>
      evaluateFullSolarCase(
        roofPolygon,
        evalLat,
        evalLon,
        params,
        nasa,
        mergedShadingBuildings,
        taipower,
        exclusionPolygons,
        tariffSchedule?.options ?? [],
        aiVision,
      ),
    [
      roofPolygon,
      evalLat,
      evalLon,
      params,
      nasa,
      mergedShadingBuildings,
      taipower,
      exclusionPolygons,
      tariffSchedule,
      aiVision,
    ],
  );

  // Build provenance list for audit & report
  const provenances = useMemo<DataProvenance[]>(() => {
    const list: DataProvenance[] = [];
    if (geocodeProvenance) list.push(geocodeProvenance);
    if (district?.provenance) list.push(district.provenance);
    if (nlsc3dProvenance) list.push(nlsc3dProvenance);
    if (nasa?.provenance) list.push(nasa.provenance);
    if (osmProvenance) list.push(osmProvenance);
    if (taipower?.provenance) list.push(taipower.provenance);
    if (moea?.provenance) list.push(moea.provenance);
    if (fitSchedule?.provenance) list.push(fitSchedule.provenance);
    if (tariffSchedule?.provenance) list.push(tariffSchedule.provenance);
    if (aiVision?.provenance) list.push(aiVision.provenance);

    list.push({
      key: 'user-roof-type',
      label: '屋頂型式與建物高度',
      sourceName: '使用者現場確認輸入',
      sourceUrl: '',
      fetchedAt: new Date().toISOString(),
      status: params.roofType === 'unset' ? 'pending' : 'user_input',
      summary:
        params.roofType === 'unset'
          ? '尚未選擇屋頂型式'
          : `屋頂型式：${params.roofType === 'metal' ? '鐵皮浪板 / 鋼構' : 'RC 鋼筋混凝土'} · 目標屋頂高度 ${params.targetRoofHeightM} m`,
    });

    list.push({
      key: 'user-reg-area',
      label: '合法登記面積',
      sourceName: '使用者依工廠登記證/使照輸入',
      sourceUrl: '',
      fetchedAt: new Date().toISOString(),
      status: params.registeredAreaSqm ? 'user_input' : 'pending',
      summary: params.registeredAreaSqm
        ? `使用者登錄登記面積 ${params.registeredAreaSqm.toLocaleString('zh-TW')} m²`
        : '尚未輸入工廠/建物登記面積',
    });

    return list;
  }, [
    geocodeProvenance,
    district,
    nlsc3dProvenance,
    nasa,
    osmProvenance,
    taipower,
    moea,
    fitSchedule,
    tariffSchedule,
    aiVision,
    params.roofType,
    params.targetRoofHeightM,
    params.registeredAreaSqm,
  ]);

  const reportEvidence = useMemo<NonNullable<EvaluationCase['reportEvidence']>>(() => {
    const tariffOptions = tariffSchedule?.options ?? [];
    const touRates = tariffOptions.find((option) => option.tariffMode === params.tariffMode)?.touRates;
    const evidence = {
      fitRateSource,
      selfRateSource: params.tariffMode === 'flat'
        ? selfRateSource
        : touRates ? tariffSchedule?.provenance ?? null : null,
      tariffOptions,
      shadowBuildings: mergedShadingBuildings,
    };
    if (roofPolygon.length < 3) return { ...evidence, layoutComparison: null };

    const thresholdPct = 15;
    const compareAtThreshold = (threshold: number | null) =>
      params.excludeShadedThresholdPct === threshold
        ? evaluation
        : evaluateFullSolarCase(
            roofPolygon, evalLat, evalLon, { ...params, excludeShadedThresholdPct: threshold },
            nasa, mergedShadingBuildings, taipower, exclusionPolygons, tariffOptions, aiVision,
          );
    const full = compareAtThreshold(null);
    const filtered = compareAtThreshold(thresholdPct);
    const financialScenario = full.financials.self && filtered.financials.self
      ? 'self'
      : full.financials.fit && filtered.financials.fit ? 'fit' : null;
    const summarize = (result: typeof full) => ({
      moduleCount: result.capacity.moduleCount,
      annualGenKwh: nasa ? result.annualGenKwh : null,
      specificYieldKwhPerKwp: nasa && result.capacity.moduleCount > 0
        ? result.specificYieldKwhPerKwp : null,
      npv20Ntd: nasa && financialScenario
        ? result.financials[financialScenario]?.npv20Ntd ?? null : null,
    });
    return {
      ...evidence,
      layoutComparison: { thresholdPct, financialScenario, full: summarize(full), filtered: summarize(filtered) },
    };
  }, [
    aiVision, evalLat, evalLon, evaluation, exclusionPolygons, fitRateSource, mergedShadingBuildings,
    nasa, params, roofPolygon, selfRateSource, taipower, tariffSchedule,
  ]);

  // Persist active case to localStorage whenever meaningful state changes
  useEffect(() => {
    if (isFetchingSite || (!hasTargetPoint && roofPolygon.length < 3)) return;
    const currentCase: EvaluationCase = {
      id: caseId,
      locationPoint: { lat: targetLat, lon: targetLon },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lat: evalLat,
      lon: evalLon,
      roofPolygon,
      exclusionPolygons,
      aiVision,
      params,
      district,
      nasa,
      taipower,
      moea,
      osmSummary: osmProvenance
        ? {
            totalCount: osmCounts.total,
            withHeightCount: osmCounts.withH,
            withoutHeightCount: osmCounts.withoutH,
            provenance: osmProvenance,
          }
        : null,
      provenances,
      reportEvidence,
      result: evaluation,
      quotes: [],
    };
    saveActiveCase(currentCase);
    onCaseUpdated?.();
  }, [
    caseId,
    hasTargetPoint,
    isFetchingSite,
    targetLat,
    targetLon,
    evalLat,
    evalLon,
    roofPolygon,
    exclusionPolygons,
    aiVision,
    params,
    district,
    nasa,
    taipower,
    moea,
    osmProvenance,
    osmCounts,
    provenances,
    reportEvidence,
    evaluation,
    onCaseUpdated,
  ]);

  const handleSubmitToEpc = () => {
    const activeCase: EvaluationCase = {
      id: caseId,
      locationPoint: { lat: targetLat, lon: targetLon },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lat: evalLat,
      lon: evalLon,
      roofPolygon,
      exclusionPolygons,
      aiVision,
      params: {
        ...params,
        factoryName:
          params.factoryName ||
          (district ? `${district.ctyName}${district.townName}廠房案場` : '未命名廠房評估案'),
      },
      district,
      nasa,
      taipower,
      moea,
      osmSummary: osmProvenance
        ? {
            totalCount: osmCounts.total,
            withHeightCount: osmCounts.withH,
            withoutHeightCount: osmCounts.withoutH,
            provenance: osmProvenance,
          }
        : null,
      provenances,
      reportEvidence,
      result: evaluation,
      quotes: [],
    };
    saveActiveCase(activeCase);
    upsertCaseToEpcPool(activeCase);
    setEpcSubmittedMsg('已將標準化評估規格送出至 EPC 媒合頁');
    window.setTimeout(() => setEpcSubmittedMsg(null), 4000);
  };

  const suggestedFitRate =
    fitSchedule && fitSchedule.tiers.length > 0
      ? matchFitTierRate(evaluation.capacity.pDcKw, fitSchedule.tiers)
      : null;

  const maxMonthlyGen = Math.max(1, ...evaluation.monthly.map((m) => m.genKwh));
  const hoveredMonthRow =
    hoveredMonth !== null ? evaluation.monthly.find((m) => m.month === hoveredMonth) ?? null : null;

  return (
    <main className="evaluation-page">
      <header className="page-banner evaluation-banner">
        <div>
          <h1>屋頂太陽能案場評估</h1>
          <p>定位工廠與框選屋頂，試算可裝容量、發電量與投資回報。</p>
        </div>
        <Sun className="evaluation-sun" aria-hidden="true" />
      </header>
      <div className="evaluation-workspace">
        {/* Left: 2D/3D Geospatial Map Canvas OR True 3D Three.js Rooftop Simulator */}
        <div ref={mapPanelRef} className="evaluation-map surface scroll-mt-28">
          {/* Viewport Mode Switcher Bar */}
          <div className="viewport-toolbar">
            <div className="viewport-tabs">
              <button
                type="button"
                aria-pressed={viewportMode === 'map'}
                onClick={() => setViewportMode('map')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewportMode === 'map'
                    ? 'bg-white text-slate-950 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                地圖與屋頂框選
              </button>
              <button
                type="button"
                aria-pressed={viewportMode === '3d-sim'}
                onClick={() => setViewportMode('3d-sim')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewportMode === '3d-sim'
                    ? 'bg-slate-950 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                3D 光電模擬
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500 truncate">
              {hasTargetPoint ? (
                <span>
                  {district?.ctyName ? `${district.ctyName}${district.townName} · ` : ''}
                  {evalLat.toFixed(5)}, {evalLon.toFixed(5)}
                </span>
              ) : (
                <span>
                  {viewportMode === 'map'
                    ? '點選屋頂頂點框選 · 或直接點擊 OSM 建物輪廓套用'
                    : '滑鼠拖曳旋轉視角 · 滾輪縮放 · 即時 SunCalc 物理陰影'}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 relative min-h-0">
            {viewportMode === 'map' ? (
              <RoofMapCanvas
                key={caseId}
                centerLat={targetLat}
                centerLon={targetLon}
                hasTargetPoint={hasTargetPoint}
                siteFocusRequest={siteFocusRequest}
                siteLabel={locatedPlace || params.address}
                roofPolygon={roofPolygon}
                onRoofPolygonChange={handleRoofPolygonChange}
                exclusionPolygons={exclusionPolygons}
                onAddExclusionPolygon={handleAddExclusionPolygon}
                onRemoveExclusionPolygon={(id) =>
                  setExclusionPolygons((prev) => prev.filter((ex) => ex.id !== id))
                }
                onClearExclusionPolygons={() => setExclusionPolygons([])}
                onMapPointClick={(lat, lon) => {
                  if (!hasTargetPoint) {
                    const label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
                    setLocatedPlace(label);
                    loadLiveSiteData(lat, lon, label);
                  }
                }}
                osmBuildings={osmBuildings}
                nlsc3dBuildings={nlsc3dBuildings}
                nlsc3dLoading={nlsc3dLoading}
                shadingBuildings={mergedShadingBuildings}
                nearbyFeeders={taipower?.nearbyFeeders ?? []}
                recommendedAltFeeders={
                  evaluation.gate1Recommendation?.isConstrained
                    ? evaluation.gate1Recommendation.alternativeFeeders
                    : []
                }
                focusCoordinate={focusCoordinate}
                targetRoofHeightM={params.targetRoofHeightM}
                onApplyTargetRoofHeight={(h) =>
                  setParams((prev) => ({ ...prev, targetRoofHeightM: h }))
                }
                engineeringParams={params}
                moduleCount={evaluation.capacity.moduleCount}
                onOpen3DSimulator={() => setViewportMode('3d-sim')}
              />
            ) : (
              <Solar3DSimulator
                centerLat={evalLat}
                centerLon={evalLon}
                roofPolygon={roofPolygon}
                exclusionPolygons={exclusionPolygons}
                osmBuildings={mergedShadingBuildings}
                nlsc3dBuildings={nlsc3dBuildings}
                params={params}
                moduleCount={evaluation.capacity.moduleCount}
                annualGenKwh={evaluation.annualGenKwh}
                annualShadingLossPct={evaluation.shading.annualWeightedShadingLossPct}
                onSwitchTo2D={() => setViewportMode('map')}
              />
            )}
          </div>
        </div>

        {/* Right: Engineering Assessment & Parameter Panel */}
        <aside className="assessment-panel surface">
          {/* Address Search Header */}
          <div className="assessment-search">
            <h2 className="assessment-heading"><MapPin size={18} aria-hidden="true" /> 案場定位</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddressSearch();
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  aria-label="工廠地址、工業區或座標"
                  placeholder="輸入工廠地址、工業區或座標"
                  className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-600/15 transition-shadow"
                />
              </div>
              <button
                type="submit"
                disabled={isFetchingSite}
                className="h-9 px-4 text-xs font-semibold text-white bg-slate-950 hover:bg-slate-800 disabled:bg-slate-400 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isFetchingSite ? '查詢中...' : '定位查詢'}
              </button>
            </form>

            {/* Industrial Park Quick Query Triggers (Live Query, NOT Demo Data) */}
            <div className="mt-2.5 flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
              <span>快速定位</span>
              {QUICK_INDUSTRIAL_QUERIES.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddressSearch(item.query)}
                    disabled={isFetchingSite}
                    className="quick-location disabled:opacity-50"
                  >
                    {item.label}
                  </button>
                </span>
              ))}
            </div>

            {roofPolygon.length >= 3 && (
              <p className="mt-2 text-[11px] text-slate-600">
                定位到不同地點會開始新評估。請先匯出目前報告以保留屋頂配置。
              </p>
            )}

            {geocodeCandidates.length > 1 && (
              <div className="mt-2.5">
                <select
                  value={selectedCandidate}
                  disabled={isFetchingSite}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const chosen = geocodeCandidates[idx];
                    if (chosen) void selectSearchLocation(chosen, idx, searchInput);
                  }}
                  className="w-full h-8 text-xs border border-slate-300 rounded-md px-2.5 bg-white text-slate-700 focus:outline-none focus:border-amber-600"
                  aria-label="選擇定位候選結果"
                >
                  {geocodeCandidates.map((c, idx) => (
                    <option key={`${c.lat}-${c.lon}-${idx}`} value={idx}>
                      候選位置 {idx + 1}：{c.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {hasTargetPoint && (
              <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-950">
                <MapPin size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1" role="status">
                  <div className="font-semibold break-words">{locatedPlace || params.address || '已定位案場'}</div>
                  <div className="mt-0.5 font-mono">{targetLat.toFixed(5)}, {targetLon.toFixed(5)}</div>
                </div>
                <button type="button" onClick={revealLocatedSite} className="shrink-0 cursor-pointer font-semibold underline underline-offset-2">
                  在地圖查看
                </button>
              </div>
            )}

            {searchError && (
              <div className="mt-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {searchError}
              </div>
            )}
          </div>

          {/* Architectural Underline Navigation Tabs */}
          <div className="assessment-tabs px-4 sm:px-5 shrink-0">
            <div className="grid grid-cols-3">
              <button
                type="button"
                aria-pressed={activeTab === 'site'}
                onClick={() => setActiveTab('site')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'site'
                    ? 'border-amber-600 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                1. 場址與圖資
              </button>
              <button
                type="button"
                aria-pressed={activeTab === 'params'}
                onClick={() => setActiveTab('params')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'params'
                    ? 'border-amber-600 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                2. 工程與電價
              </button>
              <button
                type="button"
                aria-pressed={activeTab === 'results'}
                onClick={() => setActiveTab('results')}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'results'
                    ? 'border-amber-600 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                3. 關卡與試算
              </button>
            </div>
          </div>

          {/* Pinned KPI Snapshot Strip (Always visible while tweaking params) */}
          <div className="assessment-metrics shrink-0">
            <div className="metric-grid">
              <div className="sm:pr-3">
                <div className="text-[11px] font-medium text-slate-500">有效屋頂面積</div>
                <div className="text-[16px] font-bold font-mono tabular-nums text-slate-950 mt-0.5 leading-tight">
                  {evaluation.capacity.roofAreaSqm > 0
                    ? `${evaluation.capacity.netRoofAreaSqm.toFixed(0)} m²`
                    : '未框選'}
                </div>
                {evaluation.capacity.excludedAreaSqm > 0 && (
                  <div className="text-[10px] font-mono tabular-nums text-rose-700 mt-0.5">
                    挖除 {evaluation.capacity.excludedAreaSqm.toFixed(0)} m²
                  </div>
                )}
              </div>
              <div className="sm:px-3">
                <div className="text-[11px] font-medium text-slate-500">可裝容量 P_DC</div>
                <div className="text-[16px] font-bold font-mono tabular-nums text-amber-700 mt-0.5 leading-tight">
                  {evaluation.capacity.pDcKw > 0
                    ? `${evaluation.capacity.pDcKw.toFixed(1)} kWp`
                    : roofPolygon.length >= 3 ? '0 kWp' : '—'}
                </div>
                {evaluation.capacity.pAcKw > 0 && (
                  <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                    AC {evaluation.capacity.pAcKw.toFixed(1)} kW
                  </div>
                )}
              </div>
              <div className="sm:px-3">
                <div className="text-[11px] font-medium text-slate-500">預估年發電量</div>
                <div className="text-[16px] font-bold font-mono tabular-nums text-slate-950 mt-0.5 leading-tight">
                  {evaluation.annualGenKwh > 0
                    ? `${Math.round(evaluation.annualGenKwh).toLocaleString('zh-TW')} 度`
                    : '—'}
                </div>
              </div>
              <div className="sm:pl-3">
                <div className="text-[11px] font-medium text-slate-500">年均遮蔭損失</div>
                <div className="text-[16px] font-bold font-mono tabular-nums text-slate-950 mt-0.5 leading-tight">
                  {evaluation.shading.buildingsEvaluatedCount > 0
                    ? `${evaluation.shading.annualWeightedShadingLossPct.toFixed(1)}%`
                    : '0.0%'}
                </div>
              </div>
            </div>
          </div>

          {roofPolygon.length >= 3 && evaluation.capacity.moduleCount === 0 && (
            <p className="px-4 py-2 text-xs text-amber-900 bg-amber-50">
              目前配置可排 0 片模組。請檢查屋頂邊界、退縮距離、障礙區及遮蔭剔除設定。
            </p>
          )}

          {/* Always-Visible Install Verdict Strip */}
          <InstallVerdictStrip
            verdict={evaluation.verdict}
            onInspectDetails={() => setActiveTab('results')}
          />

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {/* TAB 1: Site & Live Open Data */}
            {activeTab === 'site' && (
              <div className="space-y-6">
                {/* Live Data Sources Matrix */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-950">即時公開資料擷取狀態</h2>
                    {hasTargetPoint && (
                      <button
                        type="button"
                        onClick={() => loadLiveSiteData(targetLat, targetLon)}
                        disabled={isFetchingSite}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-amber-700 cursor-pointer transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isFetchingSite ? 'animate-spin' : ''}`} />
                        <span>{isFetchingSite ? '擷取中...' : '重新擷取'}</span>
                      </button>
                    )}
                  </div>

                  {!hasTargetPoint ? (
                    <div className="border border-slate-200 rounded-lg p-4 text-xs text-slate-600 leading-relaxed bg-[#F8FAFC]">
                      <div className="font-semibold text-slate-950 mb-1.5 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>請先輸入地址或於左側正射影像點選廠區位置</span>
                      </div>
                      系統堅持即時連線政府與科學開放資料，不預載示範假數字。定位後將即時查詢國土測繪中心行政段籍與 3D Tiles、NASA POWER 日照氣溫、OSM 建物高度、台電饋線剩餘容量及經濟部登記資料。
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
                      <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900">行政區與段籍</div>
                          {isFetchingSite && !district ? (
                            <div className="h-3.5 w-44 bg-slate-200/75 rounded animate-pulse mt-1.5" />
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5">
                              {district?.ctyName
                                ? `${district.ctyName}${district.townName} · ${district.sectName || '無段名'} (${district.sectCode || '—'})`
                                : '無資料'}
                            </div>
                          )}
                        </div>
                        <SourceTag provenance={district?.provenance} shortLabel="NLSC" />
                      </div>

                      <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900">日照與氣溫 Climatology</div>
                          {isFetchingSite && !nasa ? (
                            <div className="h-3.5 w-52 bg-slate-200/75 rounded animate-pulse mt-1.5" />
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                              {nasa
                                ? `年均日照 ${nasa.annualGhiAvg.toFixed(2)} kWh/m²/日 · 年均溫 ${nasa.annualTempAvg.toFixed(1)} °C`
                                : '擷取失敗或逾時'}
                            </div>
                          )}
                        </div>
                        <SourceTag provenance={nasa?.provenance} shortLabel="NASA POWER" />
                      </div>

                      <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900">國土測繪中心 3D Tiles 建物</div>
                          {nlsc3dLoading ? (
                            <div className="h-3.5 w-48 bg-slate-200/75 rounded animate-pulse mt-1.5" />
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5 tabular-nums">
                              {nlsc3dBuildings.length > 0
                                ? `已載入 ${nlsc3dBuildings.length} 棟實測 3D 建物模型與屋高`
                                : nlsc3dProvenance?.summary || '等待查詢'}
                            </div>
                          )}
                        </div>
                        <SourceTag provenance={nlsc3dProvenance} shortLabel="NLSC 3D Tiles" />
                      </div>

                      <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900">周圍建物輪廓與 height 標籤</div>
                          {isFetchingSite && !osmProvenance ? (
                            <div className="h-3.5 w-56 bg-slate-200/75 rounded animate-pulse mt-1.5" />
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5">
                              {osmCounts.total > 0
                                ? `共 ${osmCounts.total} 棟（${osmCounts.withH} 棟含 height 納入遮蔭，${osmCounts.withoutH} 棟無高度排除）`
                                : osmProvenance?.summary || '尚未取得 OSM 建物資料'}
                            </div>
                          )}
                        </div>
                        <SourceTag provenance={osmProvenance} shortLabel="OSM" />
                      </div>

                      <div className="px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-slate-900">最近台電饋線剩餘容量</div>
                          {isFetchingSite && !taipower ? (
                            <div className="h-3.5 w-52 bg-slate-200/75 rounded animate-pulse mt-1.5" />
                          ) : (
                            <div className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                              {taipower?.nearestFeeder
                                ? `饋線 ${taipower.nearestFeeder.feederId} · ${taipower.nearestFeeder.capacityKw.toLocaleString('zh-TW')} kW（距 ${taipower.nearestFeeder.distanceM} m）`
                                : taipower?.provenance.summary || '無資料'}
                            </div>
                          )}
                        </div>
                        <SourceTag provenance={taipower?.provenance} shortLabel="台電公開資料" />
                      </div>
                    </div>
                  )}
                </section>

                {/* MOEA Lookup & Mandatory User Manual Inputs */}
                <section className="space-y-3.5 pt-5 border-t border-slate-200">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950">工廠基本資料與待補充欄位</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      無公開資料可查的欄位由使用者自行確認填寫，系統絕不預設猜測。
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        公司 / 工廠名稱
                      </label>
                      <input
                        type="text"
                        value={params.factoryName}
                        onChange={(e) => setParams({ ...params, factoryName: e.target.value })}
                        placeholder="例：大立精密工業股份有限公司"
                        className="w-full h-9 px-2.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        統一編號 (查詢經濟部 GCIS)
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={params.taxId}
                          onChange={(e) => setParams({ ...params, taxId: e.target.value })}
                          placeholder="8 碼統編"
                          className="w-full h-9 px-2.5 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <button
                          type="button"
                          onClick={handleMoeaLookup}
                          className="h-9 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                        >
                          查詢
                        </button>
                      </div>
                    </div>
                  </div>

                  {moea && (
                    <div className="text-xs border-t border-b border-slate-100 py-2.5 flex items-start justify-between gap-2 text-slate-700">
                      <div>
                        <Building2 className="w-3.5 h-3.5 inline mr-1.5 text-slate-500" />
                        {moea.records.length > 0 ? (
                          <span>
                            {moea.records[0].companyName}（{moea.records[0].statusDesc}）· 資本額{' '}
                            {moea.records[0].capitalStock
                              ? `${(moea.records[0].capitalStock / 10000).toLocaleString('zh-TW')} 萬`
                              : '—'}
                          </span>
                        ) : (
                          <span>{moea.provenance.summary}</span>
                        )}
                      </div>
                      <SourceTag provenance={moea.provenance} shortLabel="經濟部 GCIS" />
                    </div>
                  )}

                  {/* Registered Area & Roof Type */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-700">
                          合法登記面積
                        </label>
                        <span
                          className={`text-[11px] font-medium ${
                            params.registeredAreaSqm === null ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {params.registeredAreaSqm === null ? '須手動填' : '已輸入'}
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={params.registeredAreaSqm ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setParams({
                              ...params,
                              registeredAreaSqm: v === '' ? null : Math.max(0, parseFloat(v)),
                            });
                          }}
                          placeholder="依使照/工廠登記"
                          className="w-full h-9 pl-2.5 pr-9 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                          m²
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-700">屋頂結構型式</label>
                        <span
                          className={`text-[11px] font-medium ${
                            params.roofType === 'unset' ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {params.roofType === 'unset' ? '請選擇' : '已確認'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 p-1 h-9 bg-slate-100 border border-slate-200/80 rounded-md">
                        <button
                          type="button"
                          onClick={() =>
                            setParams({
                              ...params,
                              roofType: params.roofType === 'metal' ? 'unset' : 'metal',
                            })
                          }
                          className={`text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                            params.roofType === 'metal'
                              ? 'bg-white text-slate-950 shadow-xs'
                              : 'text-slate-600 hover:text-slate-950'
                          }`}
                        >
                          鐵皮浪板
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setParams({
                              ...params,
                              roofType: params.roofType === 'rc' ? 'unset' : 'rc',
                            })
                          }
                          className={`text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                            params.roofType === 'rc'
                              ? 'bg-white text-slate-950 shadow-xs'
                              : 'text-slate-600 hover:text-slate-950'
                          }`}
                        >
                          RC 混凝土
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <label className="text-xs font-medium text-slate-700">
                      目標廠房屋頂高度 <span className="text-slate-400 font-normal">（計算遮蔭與 3D 投射差）</span>
                    </label>
                    <div className="relative w-32 shrink-0">
                      <input
                        type="number"
                        min={2}
                        max={80}
                        step={0.5}
                        value={params.targetRoofHeightM}
                        onChange={(e) =>
                          setParams({
                            ...params,
                            targetRoofHeightM: Math.max(2, parseFloat(e.target.value) || 10),
                          })
                        }
                        className="w-full h-9 pl-2.5 pr-8 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                        m
                      </span>
                    </div>
                  </div>
                </section>

                {/* Gemini Vision Orthophoto AI Pre-Screening */}
                <section className="space-y-3 pt-5 border-t border-slate-200">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-950 flex items-center gap-1.5">
                      <ScanEye className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>AI 正射影像輔助判讀</span>
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      擷取框選處之國土測繪中心 PHOTO2 正射影像，自動檢視材質、鏽蝕、屋頂障礙與疑似外推棚架。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunAiRoofVision}
                    disabled={roofPolygon.length < 3 || isRunningAiVision}
                    className="w-full h-9 inline-flex items-center justify-center gap-2 px-3 text-xs font-semibold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-md transition-colors cursor-pointer"
                  >
                    <ScanEye className="w-4 h-4" />
                    <span>
                      {roofPolygon.length < 3
                        ? '請先於地圖框選屋頂多邊形'
                        : isRunningAiVision
                        ? '正在拼接 PHOTO2 影像並執行 AI 判讀...'
                        : aiVision
                        ? '重新執行 AI 衛星正射影像判讀'
                        : '擷取 PHOTO2 衛星影像並 AI 初篩'}
                    </span>
                  </button>

                  {aiVisionError && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                      {aiVisionError}
                    </div>
                  )}

                  {aiVision && (
                    <div className="border border-slate-200 rounded-lg bg-white divide-y divide-slate-100 overflow-hidden">
                      <div className="p-3.5 flex items-start gap-3">
                        {aiVision.snapshotDataUrl && (
                          <img
                            src={aiVision.snapshotDataUrl}
                            alt="國土測繪 PHOTO2 屋頂框選影像"
                            referrerPolicy="no-referrer"
                            className="w-24 h-24 rounded-md border border-slate-200 object-cover shrink-0 bg-slate-900"
                          />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-xs font-semibold text-slate-950">
                            {aiVision.suspectedMaterialLabel}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            信心度 {aiVision.materialConfidence === 'high' ? '高' : aiVision.materialConfidence === 'medium' ? '中' : '低'} · 鏽蝕風險：
                            {aiVision.corrosionRisk === 'none'
                              ? '未見明顯鏽蝕'
                              : aiVision.corrosionRisk === 'mild'
                              ? '輕微褪色/局部鏽斑'
                              : aiVision.corrosionRisk === 'moderate_or_severe'
                              ? '疑似中重度鏽蝕'
                              : '影像解析度受限'}
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">{aiVision.summary}</p>
                          {(aiVision.suspectedMaterial === 'metal' || aiVision.suspectedMaterial === 'rc') && (
                            <button
                              type="button"
                              onClick={() =>
                                setParams((prev) => ({
                                  ...prev,
                                  roofType: aiVision.suspectedMaterial === 'metal' ? 'metal' : 'rc',
                                }))
                              }
                              className="mt-1 px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer transition-colors"
                            >
                              確認並套用「{aiVision.suspectedMaterial === 'metal' ? '鐵皮屋頂' : 'RC 混凝土'}」
                            </button>
                          )}
                        </div>
                      </div>

                      {aiVision.detectedObstacles.length > 0 && (
                        <div className="p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-800">
                              疑似屋頂障礙物 ({aiVision.detectedObstacles.length} 項)
                            </span>
                            {aiConvertedObstacles.length > 0 && (
                              <button
                                type="button"
                                onClick={handleAutoExcludeAllAiObstacles}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-rose-700 hover:bg-rose-800 text-white rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                              >
                                <Scissors className="w-3 h-3" />
                                <span>一鍵自動挖空 AI 檢出區 ({aiConvertedObstacles.length})</span>
                              </button>
                            )}
                          </div>
                          <ul className="divide-y divide-slate-100 text-[11px] text-slate-700">
                            {aiVision.detectedObstacles.map((obs, idx) => {
                              const matched = aiConvertedObstacles.find((c) => c.idx === idx);
                              return (
                                <li key={idx} className="py-1.5 flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <span className="font-semibold text-slate-900">{obs.type}</span>
                                    <span className="text-slate-500">（{obs.locationHint}）</span>
                                    <span>：{obs.impactNote}</span>
                                  </div>
                                  {matched && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const label = `AI:${matched.obs.type} (${matched.areaSqm.toFixed(0)}m²)`;
                                        setExclusionPolygons((prev) =>
                                          prev.some((e) => e.label === label)
                                            ? prev
                                            : [
                                                ...prev,
                                                {
                                                  id: `ex-ai-${Date.now()}-${idx}`,
                                                  label,
                                                  coordinates: matched.coords,
                                                },
                                              ],
                                        );
                                      }}
                                      className="px-2 py-0.5 text-[10px] font-semibold border border-rose-300 text-rose-800 hover:bg-rose-50 rounded whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                                    >
                                      + 挖空
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      <div className="px-3.5 py-2.5 text-[11px] text-slate-700">
                        <span className="font-semibold text-slate-900">外推違建雨遮篩檢：</span>
                        {aiVision.suspectedExtensionRisk === 'possible_extension'
                          ? '疑似存在外推棚架或二次搭蓋 — '
                          : aiVision.suspectedExtensionRisk === 'none_observed'
                          ? '未見明顯外推雨遮 — '
                          : '尚須現場比對使照 — '}
                        {aiVision.extensionNotes}
                      </div>

                      <div className="px-3.5 py-2.5 bg-amber-50/40 text-[11px] text-amber-900 font-medium leading-relaxed">
                        {aiVision.disclaimer}
                      </div>
                    </div>
                  )}
                </section>

                <div className="pt-4 border-t border-slate-200 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setActiveTab('params')}
                    className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>下一步：設定工程與電價</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Engineering & Financial / Tariff Inputs */}
            {activeTab === 'params' && (
              <div className="space-y-6">
                {/* Module & Geometry */}
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-slate-950">模組規格與屋頂配置</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">單片瓦數</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={params.moduleWatt}
                          onChange={(e) =>
                            setParams({ ...params, moduleWatt: Math.max(100, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-9 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          Wp
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">模組寬度</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.01}
                          value={params.moduleWidthM}
                          onChange={(e) =>
                            setParams({ ...params, moduleWidthM: Math.max(0.5, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          m
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">模組長度</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.01}
                          value={params.moduleLengthM}
                          onChange={(e) =>
                            setParams({ ...params, moduleLengthM: Math.max(0.5, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          m
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">屋緣退縮</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.1}
                          value={params.setbackM}
                          onChange={(e) =>
                            setParams({ ...params, setbackM: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          m
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">通道預留</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={1}
                          value={params.walkwayRatioPct}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              walkwayRatioPct: Math.max(0, Math.min(60, Number(e.target.value))),
                            })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">DC / AC 超配比</label>
                      <input
                        type="number"
                        step={0.05}
                        value={params.dcAcRatio}
                        onChange={(e) =>
                          setParams({ ...params, dcAcRatio: Math.max(0.9, Number(e.target.value)) })
                        }
                        className="w-full h-9 px-2.5 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-3 flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                      <label className="text-[11px] font-medium text-slate-700">
                        光電棚架總高{' '}
                        <span
                          className={`font-normal ${
                            params.canopyHeightM > 4.5 ? 'text-amber-700 font-semibold' : 'text-slate-400'
                          }`}
                        >
                          （≤4.5 m 免申請雜項執照）
                        </span>
                      </label>
                      <div className="relative w-28 shrink-0">
                        <input
                          type="number"
                          min={0.5}
                          max={12}
                          step={0.1}
                          value={params.canopyHeightM}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              canopyHeightM: Math.max(0.5, Number(e.target.value) || 3.2),
                            })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          m
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Physics Model */}
                <section className="space-y-3 pt-5 border-t border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-950">日照物理與系統損失參數</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">傾角 Tilt</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={params.tiltDeg}
                          onChange={(e) =>
                            setParams({ ...params, tiltDeg: Math.max(0, Math.min(45, Number(e.target.value))) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          °
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">方位角 (180°南)</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={params.azimuthDeg}
                          onChange={(e) =>
                            setParams({ ...params, azimuthDeg: Math.max(0, Math.min(360, Number(e.target.value))) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          °
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">系統損失 L_sys</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.5}
                          value={params.systemLossPct}
                          onChange={(e) =>
                            setParams({ ...params, systemLossPct: Math.max(0, Math.min(40, Number(e.target.value))) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">溫度係數 γ</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.01}
                          value={params.tempCoeffPctPerC}
                          onChange={(e) =>
                            setParams({ ...params, tempCoeffPctPerC: Number(e.target.value) })
                          }
                          className="w-full h-9 pl-2.5 pr-11 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          %/°C
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">NOCT 溫度</label>
                      <div className="relative">
                        <input
                          type="number"
                          value={params.noctC}
                          onChange={(e) => setParams({ ...params, noctC: Number(e.target.value) })}
                          className="w-full h-9 pl-2.5 pr-8 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          °C
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">年衰減率</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.1}
                          value={params.degradationPct}
                          onChange={(e) =>
                            setParams({ ...params, degradationPct: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Financial & Tariffs */}
                <section className="space-y-4 pt-5 border-t border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-950">成本、躉購費率、電價與租金</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">建置成本</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={500}
                          value={params.capexPerKw}
                          onChange={(e) =>
                            setParams({ ...params, capexPerKw: Math.max(10000, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-12 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          元/kW
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">年維運費</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={50}
                          value={params.opexPerKwYear}
                          onChange={(e) =>
                            setParams({ ...params, opexPerKwYear: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-12 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          元/kW
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">折現率</label>
                      <div className="relative">
                        <input
                          type="number"
                          step={0.1}
                          value={params.discountRatePct}
                          onChange={(e) =>
                            setParams({ ...params, discountRatePct: Math.max(0.1, Number(e.target.value)) })
                          }
                          className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* FIT Rate input + live MOEA check */}
                  <div className="pt-3.5 border-t border-slate-100 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        全額售電 — 115 年度躉購費率
                      </span>
                      <SourceTag provenance={fitSchedule?.provenance} shortLabel="能源署公告" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          step={0.0001}
                          value={params.fitRateNtd ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setFitRateSource(null);
                            setParams({ ...params, fitRateNtd: v === '' ? null : parseFloat(v) });
                          }}
                          placeholder="輸入費率 (例 3.7152)"
                          className="w-full h-9 pl-2.5 pr-12 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          元/度
                        </span>
                      </div>
                      {suggestedFitRate !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setFitRateSource(fitSchedule?.provenance ?? null);
                            setParams({ ...params, fitRateNtd: suggestedFitRate });
                          }}
                          className="h-9 px-3 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                        >
                          套用公告級距 {suggestedFitRate}
                        </button>
                      )}
                    </div>
                    {fitSchedule?.provenance.status === 'error' && (
                      <div className="text-[11px] text-red-700">
                        {fitSchedule.provenance.summary}
                      </div>
                    )}
                  </div>

                  {/* Taipower Self-Consumption & TOU Tariff */}
                  <div className="pt-3.5 border-t border-slate-100 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        自發自用 — 台電時間電價 (TOU) 與自用率
                      </span>
                      <SourceTag provenance={tariffSchedule?.provenance} shortLabel="台電電價表" />
                    </div>

                    {/* TOU Mode Selector */}
                    <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200/70 text-[11px]">
                      {[
                        { id: 'flat' as TariffMode, label: '自填單一均價' },
                        { id: 'hv_two_stage' as TariffMode, label: '高壓二段式 TOU' },
                        { id: 'hv_three_stage' as TariffMode, label: '高壓三段式 TOU' },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setParams({ ...params, tariffMode: mode.id })}
                          className={`py-1.5 px-1.5 rounded-md font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            params.tariffMode === mode.id
                              ? 'bg-white text-slate-950 font-semibold shadow-xs'
                              : 'text-slate-600 hover:text-slate-950'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {params.tariffMode === 'flat' ? (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            日間電費均價
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              step={0.01}
                              value={params.selfConsumptionTariffNtd ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                setSelfRateSource(null);
                                setParams({
                                  ...params,
                                  selfConsumptionTariffNtd: v === '' ? null : parseFloat(v),
                                });
                              }}
                              placeholder="電費單日間均價"
                              className="w-full h-9 pl-2.5 pr-12 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              元/度
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            依逐月發電加權單價
                          </label>
                          <div className="h-9 px-2.5 flex items-center text-xs font-mono tabular-nums bg-emerald-50/75 border border-emerald-200 text-emerald-900 rounded-md font-semibold">
                            {evaluation.effectiveSelfRateNtd?.toFixed(2) ?? '—'} 元/度
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          廠內自用比例
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={params.selfConsumptionSharePct}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                selfConsumptionSharePct: Math.max(0, Math.min(100, Number(e.target.value))),
                              })
                            }
                            placeholder="自用率"
                            className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/15"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                            %
                          </span>
                        </div>
                      </div>
                    </div>

                    {params.tariffMode !== 'flat' && (
                      <div className="text-[11px] text-slate-600 border-t border-slate-100 pt-2 leading-relaxed">
                        {tariffSchedule?.options.find((o) => o.tariffMode === params.tariffMode)
                          ?.description ||
                          (params.tariffMode === 'hv_three_stage'
                            ? '高壓三段式：日間 09–16h 半尖峰（夏月 5.85 / 非夏月 5.47 元）；傍晚 16–22h 尖峰夏月達 9.39 元/度，適合搭配儲能削峰套利。'
                            : '高壓二段式：日間 09–24h 全段尖峰（夏月 6.75 / 非夏月 6.37 元/度），日間太陽光電發電完全抵減尖峰電價。')}
                      </div>
                    )}

                    {tariffSchedule?.options && tariffSchedule.options.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tariffSchedule.options.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSelfRateSource(tariffSchedule.provenance);
                              setParams({
                                ...params,
                                tariffMode: opt.tariffMode ?? 'flat',
                                selfConsumptionTariffNtd: opt.avgRateNtdPerKwh,
                              });
                            }}
                            className="text-[11px] px-2.5 py-1 bg-white border border-slate-300 hover:border-amber-600 hover:text-amber-800 rounded-md text-slate-700 cursor-pointer transition-colors"
                          >
                            {opt.label.split(' ')[0]} {opt.avgRateNtdPerKwh}元
                          </button>
                        ))}
                      </div>
                    )}
                    {tariffSchedule?.provenance.status === 'error' && params.tariffMode === 'flat' && (
                      <div className="text-[11px] text-amber-800">
                        {tariffSchedule.provenance.summary}（可改選上方「高壓二段式/三段式 TOU」公開費率模型）
                      </div>
                    )}
                  </div>

                  {/* PV + BESS Storage Peak Shaving & Contract Capacity */}
                  <div className="pt-3.5 border-t border-slate-100 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={params.bessEnabled}
                          onChange={(e) => setParams({ ...params, bessEnabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer"
                        />
                        <BatteryCharging className="w-4 h-4 text-emerald-700" />
                        <span>光儲合一 (PV + BESS) 削峰與契約優化</span>
                      </label>
                      {evaluation.capacity.pAcKw > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const suggestedKw = Math.max(20, Math.round(evaluation.capacity.pAcKw * 0.5));
                            setParams({
                              ...params,
                              bessEnabled: true,
                              tariffMode: params.tariffMode === 'flat' ? 'hv_three_stage' : params.tariffMode,
                              bessKw: suggestedKw,
                              bessKwh: suggestedKw * 2,
                              peakShavingKw: Math.round(suggestedKw * 0.7),
                            });
                          }}
                          className="h-7 px-2.5 text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                        >
                          依容量建議配置
                        </button>
                      )}
                    </div>

                    {params.bessEnabled && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">儲能容量</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={10}
                              step={10}
                              value={params.bessKwh}
                              onChange={(e) =>
                                setParams({ ...params, bessKwh: Math.max(10, Number(e.target.value)) })
                              }
                              className="w-full h-9 pl-2 pr-9 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              kWh
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">PCS 功率</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={5}
                              step={5}
                              value={params.bessKw}
                              onChange={(e) =>
                                setParams({ ...params, bessKw: Math.max(5, Number(e.target.value)) })
                              }
                              className="w-full h-9 pl-2 pr-8 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              kW
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">削峰降約</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={params.peakShavingKw}
                              onChange={(e) =>
                                setParams({ ...params, peakShavingKw: Math.max(0, Number(e.target.value)) })
                              }
                              className="w-full h-9 pl-2 pr-8 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              kW
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">儲能單價</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={5000}
                              step={500}
                              value={params.bessCapexPerKwh}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  bessCapexPerKwh: Math.max(5000, Number(e.target.value)),
                                })
                              }
                              className="w-full h-9 pl-2 pr-13 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              元/kWh
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">契約基本電費</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={params.contractCapacityChargePerKwMonth}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  contractCapacityChargePerKwMonth: Math.max(0, Number(e.target.value)),
                                })
                              }
                              className="w-full h-9 pl-2 pr-12 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              元/kW
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-0.5">往返效率 RTE</label>
                          <div className="relative">
                            <input
                              type="number"
                              min={70}
                              max={96}
                              value={params.bessRoundTripEffPct}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  bessRoundTripEffPct: Math.max(70, Math.min(96, Number(e.target.value))),
                                })
                              }
                              className="w-full h-9 pl-2 pr-7 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                              %
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Roof Lease */}
                  <div className="pt-3.5 border-t border-slate-100 space-y-2">
                    <div className="text-xs font-semibold text-slate-900">屋頂出租情境參數</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <select
                        value={params.roofLeaseMode}
                        onChange={(e) =>
                          setParams({
                            ...params,
                            roofLeaseMode: e.target.value as 'revenue_share' | 'area_rent',
                          })
                        }
                        className="h-9 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                      >
                        <option value="revenue_share">售電收入分潤 (%)</option>
                        <option value="area_rent">依有效面積月租 (元/m²/月)</option>
                      </select>
                      {params.roofLeaseMode === 'revenue_share' ? (
                        <div className="relative">
                          <input
                            type="number"
                            step={0.5}
                            value={params.roofLeaseSharePct}
                            onChange={(e) =>
                              setParams({ ...params, roofLeaseSharePct: Math.max(0, Number(e.target.value)) })
                            }
                            className="w-full h-9 pl-2.5 pr-7 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                          />
                          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                            %
                          </span>
                        </div>
                      ) : (
                        <div className="relative">
                          <input
                            type="number"
                            step={5}
                            value={params.roofLeaseNtdPerSqmMonth}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                roofLeaseNtdPerSqmMonth: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full h-9 pl-2.5 pr-16 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                            元/m²/月
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ESG Carbon, T-REC & Carbon Fee Valuation Params */}
                  <div className="pt-3.5 border-t border-slate-100 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                        <Leaf className="w-3.5 h-3.5 text-emerald-700" />
                        <span>ESG 減碳、T-REC 綠電憑證與碳費參數</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">能源署 0.494 kg/度</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                          電力排碳係數
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step={0.001}
                            min={0}
                            value={params.emissionFactorKgPerKwh}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                emissionFactorKgPerKwh: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full h-9 pl-2 pr-10 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-400 pointer-events-none">
                            kg/度
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                          T-REC 憑證價
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step={100}
                            min={0}
                            value={params.trecPriceNtdPerMwh}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                trecPriceNtdPerMwh: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full h-9 pl-2 pr-10 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-400 pointer-events-none">
                            元/張
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-0.5">
                          碳費 / CBAM
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step={50}
                            min={0}
                            value={params.carbonFeeNtdPerTonne}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                carbonFeeNtdPerTonne: Math.max(0, Number(e.target.value)),
                              })
                            }
                            className="w-full h-9 pl-2 pr-9 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md focus:outline-none focus:border-emerald-600"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-mono text-slate-400 pointer-events-none">
                            元/t
                          </span>
                        </div>
                      </div>
                    </div>
                    <label className="inline-flex items-start gap-2 text-[11px] text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={params.includeTrecInSelf}
                        onChange={(e) =>
                          setParams({ ...params, includeTrecInSelf: e.target.checked })
                        }
                        className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer"
                      />
                      <span>
                        自發自用／光儲財務試算計入 T-REC 憑證收益（依規全額躉購 FIT 不得重複領取憑證，1 張 = 1,000 度）
                      </span>
                    </label>
                  </div>
                </section>

                <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('site')}
                    className="h-9 inline-flex items-center gap-1.5 px-3.5 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>← 上一步：場址與圖資</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('results')}
                    className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>下一步：查看結論與試算</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: Three Gates, Monthly Yield & Financial Scenarios */}
            {activeTab === 'results' && (
              <div className="space-y-6">
                {/* Executive Install Verdict & Reasons */}
                <InstallVerdictCard
                  verdict={evaluation.verdict}
                  compact
                  onJumpToMissing={() => setActiveTab('site')}
                  onJumpToParams={() => setActiveTab('params')}
                />

                {/* Three Gates */}
                <section className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-950">三道關卡前期審查明細</h2>
                    <span className="text-xs font-medium text-slate-600">
                      {evaluation.overallPass
                        ? '三關全數通過'
                        : evaluation.hasBlocker
                        ? '存在阻擋項目'
                        : '尚有待評估/補件項目'}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                    {evaluation.gates.map((gate) => {
                      const prov = provenances.find((p) => p.key === gate.provenanceKey);
                      const g1Rec = gate.id === 'grid' ? evaluation.gate1Recommendation : null;
                      return (
                        <div key={gate.id} className="p-3.5 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-950">{gate.title}</span>
                            <GateStatusBadge status={gate.status} label={gate.statusLabel} />
                          </div>
                          <div className="text-xs font-medium text-slate-800">{gate.headline}</div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-600 pt-1.5 border-t border-slate-100">
                            {gate.quantitativeBasis}
                          </div>
                          <ul className="text-xs text-slate-600 list-disc pl-4 space-y-0.5">
                            {gate.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>

                          {/* Gate 1 Smart Solutions: Optimal Derating + 1.5km Alternative Feeders */}
                          {g1Rec && (g1Rec.isConstrained || params.maxModuleCountOverride !== null) && (
                            <div className="mt-2 pt-2.5 border-t border-slate-100 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-slate-900 flex items-center gap-1">
                                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Gate 1 免補強併網解方</span>
                                </span>
                                {params.maxModuleCountOverride !== null && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setParams((prev) => ({
                                        ...prev,
                                        maxModuleCountOverride: null,
                                      }))
                                    }
                                    className="text-[11px] font-semibold text-amber-700 hover:underline cursor-pointer"
                                  >
                                    恢復滿額排布 ({evaluation.capacity.rawModuleCount} 片)
                                  </button>
                                )}
                              </div>

                              {g1Rec.recommendedMaxAcKw > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                                  <div className="text-[11px] text-slate-700 font-mono tabular-nums">
                                    建議降載上限：
                                    <strong className="text-slate-950">
                                      {g1Rec.recommendedMaxAcKw} kW AC
                                    </strong>{' '}
                                    ({g1Rec.recommendedMaxDcKw.toFixed(1)} kWp / {g1Rec.recommendedModuleCount} 片)
                                  </div>
                                  {params.maxModuleCountOverride !== g1Rec.recommendedModuleCount &&
                                    g1Rec.recommendedModuleCount < evaluation.capacity.rawModuleCount && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setParams((prev) => ({
                                            ...prev,
                                            maxModuleCountOverride: g1Rec.recommendedModuleCount,
                                          }))
                                        }
                                        className="px-2.5 py-1 text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                                      >
                                        套用降載預覽
                                      </button>
                                    )}
                                </div>
                              )}

                              {g1Rec.alternativeFeeders.length > 0 ? (
                                <div className="space-y-1 pt-1.5 border-t border-slate-100">
                                  <div className="text-[11px] font-medium text-emerald-800">
                                    半徑 1.5 km 內尚有餘裕之替代饋線（地圖已繪出綠色虛線）：
                                  </div>
                                  <div className="divide-y divide-slate-100">
                                    {g1Rec.alternativeFeeders.slice(0, 3).map((alt) => (
                                      <div
                                        key={alt.feederId}
                                        className="flex items-center justify-between gap-2 py-1.5 text-[11px] font-mono tabular-nums"
                                      >
                                        <span className="text-slate-800">
                                          {alt.feederId} · 距 {alt.distanceM}m · 餘{' '}
                                          <strong className="text-emerald-700">
                                            {alt.capacityKw.toLocaleString('zh-TW')} kW
                                          </strong>
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setViewportMode('map');
                                            setFocusCoordinate({
                                              lat: alt.lat,
                                              lon: alt.lon,
                                              nonce: Date.now(),
                                            });
                                          }}
                                          className="font-sans text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer shrink-0"
                                        >
                                          地圖聚焦
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : g1Rec.bestPartialAlternative ? (
                                <div className="text-[11px] text-slate-600 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                                  <span>
                                    1.5 km 內最高餘裕饋線：{g1Rec.bestPartialAlternative.feederId}（
                                    {g1Rec.bestPartialAlternative.capacityKw} kW，距{' '}
                                    {g1Rec.bestPartialAlternative.distanceM}m）
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setViewportMode('map');
                                      setFocusCoordinate({
                                        lat: g1Rec.bestPartialAlternative!.lat,
                                        lon: g1Rec.bestPartialAlternative!.lon,
                                        nonce: Date.now(),
                                      });
                                    }}
                                    className="text-[11px] font-semibold text-amber-700 hover:underline cursor-pointer shrink-0"
                                  >
                                    地圖聚焦
                                  </button>
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-600">
                                  半徑 1.5 km 內無更高餘裕之替代饋線，建議採降載併網或「自發自用不逆送」設計。
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] text-amber-800 font-medium">
                              下一步：{gate.nextSteps[0]}
                            </span>
                            <SourceTag provenance={prov} shortLabel="資料出處" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Monthly Generation & Shading Bar Chart */}
                <section className="pt-5 border-t border-slate-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-950">逐月發電量與遮蔭損失</h2>
                    <SourceTag provenance={nasa?.provenance} shortLabel="NASA + SunCalc" />
                  </div>
                  {evaluation.capacity.pDcKw <= 0 || !nasa ? (
                    <div className="text-xs text-slate-500 bg-[#F8FAFC] border border-slate-200 rounded-lg p-3.5">
                      請先定位廠址（取得 NASA 日照）並於左側地圖框選屋頂多邊形，即可即時產出 12 個月物理發電模擬。
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg p-3.5 bg-white">
                      <div
                        className="relative grid grid-cols-12 gap-1.5 items-end h-28 pt-2"
                        onMouseLeave={() => setHoveredMonth(null)}
                      >
                        {/* Subtle baseline reference gridlines */}
                        <div className="pointer-events-none absolute inset-x-0 top-2 bottom-0 flex flex-col justify-between">
                          <div className="border-t border-dashed border-slate-100" />
                          <div className="border-t border-dashed border-slate-100" />
                          <div className="border-t border-slate-200/80" />
                        </div>
                        {evaluation.monthly.map((m) => {
                          const heightPct = Math.max(4, Math.round((m.genKwh / maxMonthlyGen) * 100));
                          const isHovered = hoveredMonth === m.month;
                          return (
                            <div
                              key={m.month}
                              className="relative z-10 flex flex-col items-center h-full justify-end cursor-pointer"
                              onMouseEnter={() => setHoveredMonth(m.month)}
                            >
                              <div
                                className={`w-full rounded-t transition-colors ${
                                  isHovered ? 'bg-amber-500' : 'bg-amber-600/90'
                                }`}
                                style={{ height: `${heightPct}%` }}
                                title={`${m.monthLabel}: ${Math.round(m.genKwh).toLocaleString('zh-TW')} kWh · 遮蔭 ${(m.shadingLossRatio * 100).toFixed(1)}%`}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-12 gap-1.5 mt-1.5 text-center text-[10px] font-mono text-slate-500">
                        {evaluation.monthly.map((m) => (
                          <div
                            key={m.month}
                            className={hoveredMonth === m.month ? 'text-amber-700 font-bold' : ''}
                          >
                            {m.month}月
                          </div>
                        ))}
                      </div>
                      <div className="mt-2.5 pt-2 border-t border-slate-100 text-[11px] font-mono tabular-nums text-slate-600 flex items-center justify-between gap-2">
                        {hoveredMonthRow ? (
                          <>
                            <span className="font-semibold text-slate-900">
                              {hoveredMonthRow.monthLabel}：{Math.round(hoveredMonthRow.genKwh).toLocaleString('zh-TW')} kWh
                            </span>
                            <span>
                              遮蔭 {(hoveredMonthRow.shadingLossRatio * 100).toFixed(1)}% · 氣溫 {hoveredMonthRow.tAmbC.toFixed(1)}°C
                            </span>
                          </>
                        ) : (
                          <>
                            <span>單位發電：{evaluation.specificYieldKwhPerKwp.toFixed(0)} kWh/kWp/年</span>
                            <span>有效板數：{evaluation.capacity.moduleCount.toLocaleString('zh-TW')} 片</span>
                          </>
                        )}
                      </div>

                      {/* Per-panel shading heatmap pruning action */}
                      {evaluation.shading.panelHeatmap && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 text-slate-700 font-mono tabular-nums">
                            <Flame className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                            <span>
                              最大單板遮蔭 {evaluation.shading.panelHeatmap.maxPanelShadePct.toFixed(1)}% · &gt;15% 共{' '}
                              {evaluation.shading.panelHeatmap.shadedOver15Count} 片
                            </span>
                          </div>
                          {(evaluation.shading.panelHeatmap.shadedOver15Count > 0 ||
                            params.excludeShadedThresholdPct !== null) && (
                            <button
                              type="button"
                              onClick={() =>
                                setParams((prev) => ({
                                  ...prev,
                                  excludeShadedThresholdPct:
                                    prev.excludeShadedThresholdPct !== null ? null : 15,
                                }))
                              }
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                                params.excludeShadedThresholdPct !== null
                                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                                  : 'bg-orange-600 text-white hover:bg-orange-700'
                              }`}
                            >
                              {params.excludeShadedThresholdPct !== null
                                ? `已剔除 ${evaluation.shading.panelHeatmap.prunedShadedPanels} 片陰影板 · 恢復全排布`
                                : '一鍵剔除 >15% 遮蔭板'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Financial Scenarios Table + 20-Year Cashflow Curve */}
                <section className="pt-5 border-t border-slate-200 space-y-3">
                  <h2 className="text-sm font-semibold text-slate-950">投資財務情境比較 (20 年)</h2>
                  {evaluation.financials.bess && <BessSensitivity scenario={evaluation.financials.bess} />}
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-[#F8FAFC] text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="text-left py-2.5 px-3 font-semibold">情境</th>
                          <th className="text-right py-2.5 px-3 font-semibold">年收益</th>
                          <th className="text-right py-2.5 px-3 font-semibold">回本</th>
                          <th className="text-right py-2.5 px-3 font-semibold">IRR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                            全額售電 (FIT)
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-800">
                            {evaluation.financials.fit
                              ? `${Math.round(evaluation.financials.fit.year1RevenueNtd / 10000).toLocaleString('zh-TW')} 萬`
                              : '未設費率'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-800">
                            {evaluation.financials.fit?.paybackYears
                              ? `${evaluation.financials.fit.paybackYears.toFixed(1)} 年`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                            {evaluation.financials.fit?.irrPct != null
                              ? `${evaluation.financials.fit.irrPct.toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                            {evaluation.financials.self?.label || '自發自用'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-800">
                            {evaluation.financials.self
                              ? `${Math.round(evaluation.financials.self.year1RevenueNtd / 10000).toLocaleString('zh-TW')} 萬`
                              : '未設電價'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-800">
                            {evaluation.financials.self?.paybackYears
                              ? `${evaluation.financials.self.paybackYears.toFixed(1)} 年`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                            {evaluation.financials.self?.irrPct != null
                              ? `${evaluation.financials.self.irrPct.toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                        {evaluation.financials.bess && (
                          <tr className="bg-emerald-50/40 hover:bg-emerald-50/70 transition-colors">
                            <td className="py-2.5 px-3 font-sans font-medium text-emerald-950">
                              <div>{evaluation.financials.bess.label}</div>
                              <div className="text-[10px] font-mono text-emerald-700 mt-0.5">
                                含契約調降省{' '}
                                {Math.round(
                                  (evaluation.financials.bess.demandSavingsYear1Ntd ?? 0) / 10000,
                                )}
                                萬/年
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-900 font-semibold">
                              {Math.round(
                                evaluation.financials.bess.year1RevenueNtd / 10000,
                              ).toLocaleString('zh-TW')}{' '}
                              萬
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-800">
                              {evaluation.financials.bess.paybackYears
                                ? `${evaluation.financials.bess.paybackYears.toFixed(1)} 年`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                              {evaluation.financials.bess.irrPct != null
                                ? `${evaluation.financials.bess.irrPct.toFixed(1)}%`
                                : '—'}
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-900">
                            屋頂出租收租
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-800">
                            {evaluation.financials.lease.year1RevenueNtd > 0
                              ? `${Math.round(evaluation.financials.lease.year1RevenueNtd / 10000).toLocaleString('zh-TW')} 萬`
                              : '依模式計算'}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-500">零出資</td>
                          <td className="py-2.5 px-3 text-right text-slate-500">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <CashflowComparisonChart
                    fit={evaluation.financials.fit}
                    self={evaluation.financials.self}
                    bess={evaluation.financials.bess}
                  />

                  {(!evaluation.financials.fit || !evaluation.financials.self) && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>請於「2. 工程與電價」輸入或套用躉購費率 / 台電時間電價以顯示完整曲線與 IRR。</span>
                    </div>
                  )}
                </section>

                {/* ESG Carbon Reduction, T-REC & Carbon Fee Valuation */}
                {evaluation.annualGenKwh > 0 && (
                  <section className="pt-5 border-t border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-950 flex items-center gap-1.5">
                        <Leaf className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>ESG 減碳效益、T-REC 與碳費避險</span>
                      </h2>
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                        係數 {evaluation.esg.emissionFactorKgPerKwh.toFixed(3)} kg/度
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-white py-3">
                      <div className="px-3 pb-2 sm:pb-0">
                        <div className="text-[10px] text-slate-500">年減碳公斤數</div>
                        <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                          {Math.round(evaluation.esg.annualCo2ReductionKg).toLocaleString('zh-TW')} kg
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                          {evaluation.esg.annualCo2ReductionTonnes.toFixed(1)} t/年
                        </div>
                      </div>
                      <div className="px-3 pb-2 sm:pb-0">
                        <div className="text-[10px] text-slate-500">相當於種植樹木</div>
                        <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                          {evaluation.esg.equivalentTreesPlanted.toLocaleString('zh-TW')} 棵
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                          12 kg/棵·年
                        </div>
                      </div>
                      <div className="px-3 pt-2 sm:pt-0">
                        <div className="text-[10px] text-slate-500">年可申領 T-REC</div>
                        <div className="text-sm font-bold font-mono tabular-nums text-slate-950 mt-0.5">
                          {evaluation.esg.annualTrecCertificates.toFixed(1)} 張
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                          約 {(evaluation.esg.annualTrecValueNtd / 10000).toFixed(1)} 萬/年
                        </div>
                      </div>
                      <div className="px-3 pt-2 sm:pt-0">
                        <div className="text-[10px] text-slate-500">CBAM / 碳費減免</div>
                        <div className="text-sm font-bold font-mono tabular-nums text-slate-950 mt-0.5">
                          {Math.round(evaluation.esg.annualCarbonFeeAvoidedNtd).toLocaleString('zh-TW')} 元
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
                          20年 {(evaluation.esg.lifetimeCarbonFeeAvoidedNtd / 10000).toFixed(1)} 萬
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* Sticky Bottom Action Strip */}
          <div className="assessment-actions space-y-2">
            {epcSubmittedMsg && (
              <div className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5">
                {epcSubmittedMsg}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleSubmitToEpc}
                disabled={isFetchingSite || evaluation.capacity.pDcKw <= 0}
                className="h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-45 text-slate-900 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>送出 EPC 媒合池</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/report')}
                disabled={isFetchingSite}
                className="h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>檢視完整報告</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
