export type ProvenanceStatus = 'live' | 'no_data' | 'error' | 'user_input' | 'pending';

export interface DataProvenance {
  key: string;
  label: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string | null;
  status: ProvenanceStatus;
  summary: string;
  errorDetail?: string;
}

export interface NlscDistrictInfo {
  ctyCode: string;
  ctyName: string;
  townCode: string;
  townName: string;
  officeName: string;
  sectCode: string;
  sectName: string;
  provenance: DataProvenance;
}

export interface GeocodeCandidate {
  displayName: string;
  lat: number;
  lon: number;
  type: string;
}

export interface GeocodeResponse {
  query: string;
  candidates: GeocodeCandidate[];
  district: NlscDistrictInfo | null;
  provenance: DataProvenance;
}

export interface OsmBuildingFeature {
  id: string;
  name?: string;
  coordinates: [number, number][]; // [lon, lat][]
  rawHeightTag: string | null;
  heightM: number | null; // STRICT: only populated if OSM `height` tag parses to valid meters
  levelsTag: string | null; // informational only, NEVER used for shadow calculation
  includedInShading: boolean;
}

export interface OsmBuildingsResponse {
  buildings: OsmBuildingFeature[];
  totalCount: number;
  withHeightCount: number;
  withoutHeightCount: number;
  provenance: DataProvenance;
}

export interface Nlsc3dTileRef {
  uri: string;
  proxyUrl: string;
  distM: number;
  radiusM: number;
}

export interface Nlsc3dTilesNearbyResponse {
  countyName: string;
  tilesetId: string | null;
  tilesetUrl: string;
  tiles: Nlsc3dTileRef[];
  provenance: DataProvenance;
}

export interface NasaPowerResponse {
  lat: number;
  lon: number;
  elevationM: number | null;
  monthlyGhi: number[]; // length 12, kWh/m2/day
  monthlyDiff: (number | null)[]; // length 12, kWh/m2/day
  monthlyTempC: number[]; // length 12, deg C
  monthlyWindMs: (number | null)[]; // length 12, m/s
  annualGhiAvg: number;
  annualTempAvg: number;
  provenance: DataProvenance;
}

export interface TaipowerFeederItem {
  feederId: string;
  capacityKw: number;
  distanceM: number;
  x67: number;
  y67: number;
  lat: number;
  lon: number;
}

export interface TaipowerFeederResponse {
  county: string;
  countyCode: string;
  nearestFeeder: TaipowerFeederItem | null;
  nearbyFeeders: TaipowerFeederItem[];
  totalFeedersInCounty: number;
  provenance: DataProvenance;
}

export interface MoeaCompanyRecord {
  businessAccountingNo: string;
  companyName: string;
  statusDesc: string;
  location: string;
  capitalStock: number | null;
  responsibleName: string;
}

export interface MoeaFactoryResponse {
  query: string;
  records: MoeaCompanyRecord[];
  registeredAreaSqm: number | null; // Null when public API lacks factory floor area
  industryCategory: string | null;
  provenance: DataProvenance;
}

export interface FitTier {
  label: string;
  minKw: number;
  maxKw: number | null;
  phase1Rate: number;
  phase2Rate: number;
}

export interface FitRatesResponse {
  announcementCode: string;
  yearRoc: number;
  tiers: FitTier[];
  provenance: DataProvenance;
}

export interface TouPeriodRates {
  summerPeak: number;
  summerSemiPeak: number;
  summerOffPeak: number;
  nonSummerPeak: number;
  nonSummerSemiPeak: number;
  nonSummerOffPeak: number;
  demandChargeSummerPerKwMonth: number;
  demandChargeNonSummerPerKwMonth: number;
}

export interface TariffOption {
  id: string;
  label: string;
  avgRateNtdPerKwh: number;
  description: string;
  tariffMode?: 'flat' | 'hv_two_stage' | 'hv_three_stage';
  touRates?: TouPeriodRates;
}

export interface TaipowerTariffResponse {
  options: TariffOption[];
  provenance: DataProvenance;
}

export type RoofStructureType = 'unset' | 'rc' | 'metal';
export type TariffMode = 'flat' | 'hv_two_stage' | 'hv_three_stage';

export interface RoofExclusionPolygon {
  id: string;
  label: string;
  coordinates: [number, number][]; // [lon, lat][]
}

export interface AiRoofObstacleDetection {
  type: string;
  locationHint: string;
  impactNote: string;
  /** Normalized 0..1000 bounding box [ymin, xmin, ymax, xmax] within snapshot image */
  box2d?: [number, number, number, number] | null;
}

export interface AiRoofVisionResult {
  suspectedMaterial: 'metal' | 'rc' | 'asbestos' | 'mixed' | 'unknown';
  suspectedMaterialLabel: string;
  materialConfidence: 'high' | 'medium' | 'low';
  corrosionRisk: 'none' | 'mild' | 'moderate_or_severe' | 'uncertain';
  corrosionNotes: string;
  detectedObstacles: AiRoofObstacleDetection[];
  suspectedExtensionRisk: 'none_observed' | 'possible_extension' | 'uncertain';
  extensionNotes: string;
  summary: string;
  disclaimer: string;
  snapshotDataUrl?: string;
  provenance: DataProvenance;
}

export interface UserEngineeringParams {
  factoryName: string;
  address: string;
  taxId: string;
  registeredAreaSqm: number | null; // User manual input when MOEA lacks data
  roofType: RoofStructureType; // Strictly user-selected, never silently defaulted
  targetRoofHeightM: number; // User-specified height of target factory building for relative shadow height
  setbackM: number; // Edge setback in meters
  walkwayRatioPct: number; // Maintenance aisle %
  moduleWatt: number; // Wp
  moduleWidthM: number;
  moduleLengthM: number;
  dcAcRatio: number;
  maxModuleCountOverride: number | null; // Optional Gate 1 derated capacity cap
  excludeShadedThresholdPct: number | null; // Optional: prune panels whose annual shading exceeds threshold %
  canopyHeightM: number; // Height of solar rack/canopy above roof surface (4.5m exemption limit in TW)
  tiltDeg: number;
  azimuthDeg: number; // 180 = South
  systemLossPct: number; // L_sys %
  tempCoeffPctPerC: number; // gamma %/C (negative, e.g. -0.34)
  noctC: number; // e.g. 45
  albedo: number; // e.g. 0.2
  capexPerKw: number; // NTD / kWp
  opexPerKwYear: number; // NTD / kWp / yr
  discountRatePct: number; // %
  degradationPct: number; // % / yr
  fitRateNtd: number | null; // User or live-fetched FIT rate (NTD/kWh)
  tariffMode: TariffMode; // Flat average vs Taipower TOU 2-stage / 3-stage
  selfConsumptionTariffNtd: number | null; // User or live-fetched Taipower rate (NTD/kWh)
  selfConsumptionSharePct: number; // % of generated energy consumed onsite
  bessEnabled: boolean; // PV + BESS peak shaving & demand optimization
  bessKwh: number; // Storage capacity (kWh)
  bessKw: number; // Inverter/PCS power (kW)
  bessCapexPerKwh: number; // NTD / kWh
  bessRoundTripEffPct: number; // %
  contractCapacityChargePerKwMonth: number; // Blended NTD / kW-month demand charge
  peakShavingKw: number; // Target contract capacity demand reduction (kW)
  roofLeaseSharePct: number; // Roof rent share of annual revenue (%) OR fixed rent
  roofLeaseMode: 'revenue_share' | 'area_rent';
  roofLeaseNtdPerSqmMonth: number;
  // ESG, T-REC & Carbon Fee valuation (Taiwan MOEA emission factor & EPA carbon fee)
  emissionFactorKgPerKwh: number; // MOEA Energy Admin official grid factor (e.g. 0.494 kgCO2e/kWh)
  trecPriceNtdPerMwh: number; // T-REC value per 1,000 kWh self-consumed (NTD)
  carbonFeeNtdPerTonne: number; // Carbon fee / CBAM shadow price (NTD/tCO2e)
  includeTrecInSelf: boolean; // Add T-REC revenue to self-consumption & BESS scenarios
}

export interface MonthlySimulationRow {
  month: number; // 1..12
  monthLabel: string;
  days: number;
  ghiDailyKwhM2: number;
  poaDailyKwhM2: number;
  poaMonthlyKwhM2: number;
  tAmbC: number;
  tCellC: number;
  etaTemp: number;
  shadingLossRatio: number; // 0..1
  genKwh: number;
}

export type GateStatus = 'pass' | 'warn' | 'fail' | 'pending';

export interface GateCheckResult {
  id: 'grid' | 'regulatory' | 'structure';
  title: string;
  status: GateStatus;
  statusLabel: string;
  headline: string;
  quantitativeBasis: string;
  reasons: string[];
  nextSteps: string[];
  provenanceKey: string;
}

export interface CashflowYear {
  year: number;
  generationKwh: number;
  revenueNtd: number;
  opexNtd: number;
  netCashflowNtd: number;
  discountedCashflowNtd: number;
  cumulativeCashflowNtd: number;
}

export interface FinancialScenarioResult {
  id: 'fit' | 'self' | 'bess' | 'lease';
  label: string;
  rateUsedNtd: number | null;
  capexNtd: number;
  year1RevenueNtd: number;
  year1OpexNtd: number;
  year1NetNtd: number;
  paybackYears: number | null;
  npv20Ntd: number | null;
  irrPct: number | null;
  sensitivity?: {
    selfConsumptionSharePct: number;
    peakShavingKw: number;
    npv20Ntd: number | null;
    irrPct: number | null;
  }[];
  demandSavingsYear1Ntd?: number;
  arbitrageSavingsYear1Ntd?: number;
  cashflows: CashflowYear[];
}

export interface CapacitySummary {
  roofAreaSqm: number;
  excludedAreaSqm: number;
  exclusionCount: number;
  netRoofAreaSqm: number;
  perimeterM: number;
  afterSetbackAreaSqm: number;
  effectiveAreaSqm: number;
  moduleAreaSqm: number;
  rawModuleCount: number;
  moduleCount: number;
  isDeratedByOverride: boolean;
  pDcKw: number;
  pAcKw: number;
}

export interface PanelHeatmapSummary {
  totalCandidatePanels: number;
  activePanels: number;
  prunedShadedPanels: number;
  shadedOver15Count: number;
  maxPanelShadePct: number;
  avgActivePanelShadePct: number;
}

export interface ShadingSummary {
  annualWeightedShadingLossPct: number;
  monthlyShadingLossRatio: number[]; // length 12
  buildingsEvaluatedCount: number;
  buildingsExcludedNoHeightCount: number;
  note: string;
  panelHeatmap?: PanelHeatmapSummary;
}

export interface EsgValuationSummary {
  emissionFactorKgPerKwh: number;
  annualCo2ReductionKg: number;
  lifetime20YrCo2ReductionKg: number;
  annualCo2ReductionTonnes: number;
  lifetime20YrCo2ReductionTonnes: number;
  equivalentTreesPlanted: number; // Based on 12 kg CO2e absorbed per tree per year
  annualTrecCertificates: number; // 1 T-REC = 1,000 kWh self-consumed (FIT ineligible)
  annualTrecValueNtd: number;
  annualCarbonFeeAvoidedNtd: number;
  lifetimeCarbonFeeAvoidedNtd: number;
}

export interface Gate1AlternativeFeeder {
  feederId: string;
  capacityKw: number;
  distanceM: number;
  lat: number;
  lon: number;
  surplusAfterConnectionKw: number;
}

export interface Gate1Recommendation {
  isConstrained: boolean;
  nearestFeederId: string;
  nearestCapacityKw: number;
  recommendedMaxAcKw: number;
  recommendedMaxDcKw: number;
  recommendedModuleCount: number;
  alternativeFeeders: Gate1AlternativeFeeder[];
  bestPartialAlternative: Gate1AlternativeFeeder | null;
}

export type InstallVerdictLevel =
  | 'recommended'
  | 'conditional'
  | 'not_recommended'
  | 'incomplete';

export interface InstallVerdictReason {
  dimension: 'grid' | 'regulatory' | 'structure' | 'shading_finance';
  label: string;
  status: GateStatus;
  detail: string;
}

export interface InstallVerdict {
  level: InstallVerdictLevel;
  headline: string;
  summary: string;
  recommendedModeLabel: string;
  reasons: InstallVerdictReason[];
  missingChecklist: string[];
  topActions: string[];
}

export interface SolarEvaluationResult {
  modelVersion?: number;
  capacity: CapacitySummary;
  shading: ShadingSummary;
  monthly: MonthlySimulationRow[];
  annualGenKwh: number;
  specificYieldKwhPerKwp: number;
  effectiveSelfRateNtd: number | null;
  gates: GateCheckResult[];
  gate1Recommendation: Gate1Recommendation | null;
  overallPass: boolean;
  hasBlocker: boolean;
  verdict: InstallVerdict;
  esg: EsgValuationSummary;
  financials: {
    fit: FinancialScenarioResult | null;
    self: FinancialScenarioResult | null;
    bess: FinancialScenarioResult | null;
    lease: FinancialScenarioResult;
  };
}

export interface EpcQuoteItem {
  id: string;
  epcCompany: string;
  contactName: string;
  quotedCapexPerKw: number;
  moduleSpec: string;
  inverterSpec: string;
  warrantyYears: number;
  estimatedWeeks: number;
  notes: string;
  submittedAt: string;
}

export interface LayoutComparisonRow {
  moduleCount: number;
  annualGenKwh: number | null;
  specificYieldKwhPerKwp: number | null;
  npv20Ntd: number | null;
}

export interface EvaluationCase {
  id: string;
  locationPoint?: { lat: number; lon: number };
  createdAt: string;
  updatedAt: string;
  lat: number;
  lon: number;
  roofPolygon: [number, number][]; // [lon, lat][]
  exclusionPolygons?: RoofExclusionPolygon[];
  aiVision?: AiRoofVisionResult | null;
  params: UserEngineeringParams;
  district: NlscDistrictInfo | null;
  nasa: NasaPowerResponse | null;
  taipower: TaipowerFeederResponse | null;
  moea: MoeaFactoryResponse | null;
  osmSummary: {
    totalCount: number;
    withHeightCount: number;
    withoutHeightCount: number;
    provenance: DataProvenance;
  } | null;
  provenances: DataProvenance[];
  reportEvidence?: {
    fitRateSource: DataProvenance | null;
    selfRateSource: DataProvenance | null;
    tariffOptions: TariffOption[];
    shadowBuildings: OsmBuildingFeature[];
    layoutComparison: {
      thresholdPct: number;
      financialScenario: 'self' | 'fit' | null;
      full: LayoutComparisonRow;
      filtered: LayoutComparisonRow;
    } | null;
  };
  result: SolarEvaluationResult;
  quotes: EpcQuoteItem[];
}
