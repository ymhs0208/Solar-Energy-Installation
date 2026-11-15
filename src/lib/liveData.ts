import type {
  AiRoofVisionResult,
  FitRatesResponse,
  GeocodeResponse,
  MoeaFactoryResponse,
  NasaPowerResponse,
  Nlsc3dTilesNearbyResponse,
  NlscDistrictInfo,
  OsmBuildingFeature,
  OsmBuildingsResponse,
  RoofExclusionPolygon,
  TaipowerFeederResponse,
  TaipowerTariffResponse,
} from '../types/solar';

export async function geocodeTaiwanAddress(query: string): Promise<GeocodeResponse> {
  const resp = await fetch(`/live/geocode?q=${encodeURIComponent(query)}`);
  if (!resp.ok) {
    throw new Error(`地址定位代理錯誤 (HTTP ${resp.status})`);
  }
  return resp.json();
}

export async function fetchNlscDistrict(lat: number, lon: number): Promise<NlscDistrictInfo> {
  const resp = await fetch(`/live/district?lat=${lat}&lon=${lon}`);
  if (!resp.ok) {
    throw new Error(`國土測繪中心行政區查詢失敗 (HTTP ${resp.status})`);
  }
  return resp.json();
}

/**
 * Direct browser call to NASA POWER Climatology API (CORS enabled),
 * falling back to /live/nasa-power if blocked.
 */
export async function fetchNasaPowerLive(lat: number, lon: number): Promise<NasaPowerResponse> {
  const directUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
  const fetchedAt = new Date().toISOString();

  try {
    const resp = await fetch(directUrl, { signal: AbortSignal.timeout(9000) });
    if (resp.ok) {
      const json = await resp.json();
      const params = json?.properties?.parameter;
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const ghi = months.map((m) => Number(params?.ALLSKY_SFC_SW_DWN?.[m] ?? 0));
      const diff = months.map((m) => {
        const v = params?.ALLSKY_SFC_SW_DIFF?.[m];
        return typeof v === 'number' && v >= 0 ? v : null;
      });
      const temp = months.map((m) => Number(params?.T2M?.[m] ?? 24));
      const wind = months.map((m) => {
        const v = params?.WS10M?.[m];
        return typeof v === 'number' && v >= 0 ? v : null;
      });
      const elev = json?.geometry?.coordinates?.[2] ?? null;

      return {
        lat,
        lon,
        elevationM: typeof elev === 'number' ? elev : null,
        monthlyGhi: ghi,
        monthlyDiff: diff,
        monthlyTempC: temp,
        monthlyWindMs: wind,
        annualGhiAvg: Number(params?.ALLSKY_SFC_SW_DWN?.ANN ?? ghi.reduce((a, b) => a + b, 0) / 12),
        annualTempAvg: Number(params?.T2M?.ANN ?? temp.reduce((a, b) => a + b, 0) / 12),
        provenance: {
          key: 'nasa-power',
          label: 'NASA POWER 日照與氣溫',
          sourceName: 'NASA Langley POWER Project (瀏覽器直接呼叫)',
          sourceUrl: directUrl,
          fetchedAt,
          status: 'live',
          summary: `年均水平日照 ${Number(params?.ALLSKY_SFC_SW_DWN?.ANN ?? 0).toFixed(2)} kWh/m²/日 · 年均溫 ${Number(params?.T2M?.ANN ?? 0).toFixed(1)} °C`,
        },
      };
    }
  } catch {
    // Fall back to same-origin proxy
  }

  const proxyResp = await fetch(`/live/nasa-power?lat=${lat}&lon=${lon}`);
  return proxyResp.json();
}

/**
 * Direct browser call to OSM Overpass API (CORS enabled, Section 5: 直接呼叫),
 * falling back to /live/overpass-buildings if needed.
 * Strictly preserves ONLY OSM `height` tag for shading calculation.
 */
export async function fetchOsmBuildingsLive(
  lat: number,
  lon: number,
  radius = 260,
): Promise<OsmBuildingsResponse> {
  try {
    const proxyResp = await fetch(`/live/overpass-buildings?lat=${lat}&lon=${lon}&radius=${radius}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (proxyResp.ok) {
      const data = (await proxyResp.json()) as OsmBuildingsResponse;
      if (data.provenance?.status !== 'error') {
        return data;
      }
    }
  } catch {
    // Fall back to direct browser Overpass query below
  }

  const query = `[out:json][timeout:8];way(around:${radius},${lat.toFixed(6)},${lon.toFixed(6)})[building];out geom;`;
  const directEndpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  const fetchedAt = new Date().toISOString();

  for (const endpoint of directEndpoints) {
    const fullUrl = `${endpoint}?data=${encodeURIComponent(query)}`;
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      const elements = Array.isArray(json?.elements) ? json.elements : [];
      const buildings: OsmBuildingFeature[] = elements
        .filter(
          (el: { geometry?: Array<{ lat: number; lon: number }> }) =>
            Array.isArray(el.geometry) && el.geometry.length >= 3,
        )
        .map(
          (el: {
            id: number;
            tags?: Record<string, string>;
            geometry: Array<{ lat: number; lon: number }>;
          }) => {
            const rawH = el.tags?.height ?? null;
            let heightM: number | null = null;
            if (rawH) {
              const parsed = parseFloat(rawH.replace(/[^\d.]/g, ''));
              if (Number.isFinite(parsed) && parsed > 0 && parsed < 600) {
                heightM = parsed;
              }
            }
            return {
              id: `osm-way-${el.id}`,
              name: el.tags?.name || el.tags?.['addr:street'] || undefined,
              coordinates: el.geometry.map((pt) => [pt.lon, pt.lat] as [number, number]),
              rawHeightTag: rawH,
              heightM,
              levelsTag: el.tags?.['building:levels'] ?? null,
              includedInShading: heightM !== null,
            };
          },
        );

      const withHeightCount = buildings.filter((b) => b.includedInShading).length;
      const withoutHeightCount = buildings.length - withHeightCount;

      return {
        buildings,
        totalCount: buildings.length,
        withHeightCount,
        withoutHeightCount,
        provenance: {
          key: 'osm-overpass',
          label: 'OSM 建物輪廓與高度',
          sourceName: 'OpenStreetMap Overpass API (瀏覽器直接呼叫)',
          sourceUrl: fullUrl,
          fetchedAt,
          status: buildings.length > 0 ? 'live' : 'no_data',
          summary:
            buildings.length > 0
              ? `半徑 ${radius}m 內共 ${buildings.length} 棟建物（${withHeightCount} 棟具 height 標籤納入遮蔭，${withoutHeightCount} 棟無高度標籤排除）`
              : `半徑 ${radius}m 內無 OSM 建物輪廓資料`,
        },
      };
    } catch {
      // Try next mirror
    }
  }

  return {
    buildings: [],
    totalCount: 0,
    withHeightCount: 0,
    withoutHeightCount: 0,
    provenance: {
      key: 'osm-overpass',
      label: 'OSM 建物輪廓與高度',
      sourceName: 'OpenStreetMap API v0.6 / Overpass',
      sourceUrl: 'https://api.openstreetmap.org/',
      fetchedAt,
      status: 'error',
      summary: 'OSM 建物資料連線失敗或逾時',
    },
  };
}

export async function fetchTaipowerFeederLive(
  county: string,
  lat: number,
  lon: number,
): Promise<TaipowerFeederResponse> {
  const resp = await fetch(
    `/live/taipower-feeder?county=${encodeURIComponent(county)}&lat=${lat}&lon=${lon}`,
  );
  return resp.json();
}

export async function fetchMoeaFactoryLive(
  query: string,
  taxId: string,
): Promise<MoeaFactoryResponse> {
  const resp = await fetch(
    `/live/moea-factory?query=${encodeURIComponent(query)}&taxId=${encodeURIComponent(taxId)}`,
  );
  return resp.json();
}

export async function fetchFitRatesLive(): Promise<FitRatesResponse> {
  const resp = await fetch('/live/fit-rates');
  return resp.json();
}

export async function fetchTaipowerTariffLive(): Promise<TaipowerTariffResponse> {
  const resp = await fetch('/live/taipower-tariff');
  return resp.json();
}

export async function fetchNlsc3dTilesNearby(
  county: string,
  lat: number,
  lon: number,
  radius = 380,
  limit = 88,
): Promise<Nlsc3dTilesNearbyResponse> {
  const resp = await fetch(
    `/live/nlsc-3dtiles-nearby?county=${encodeURIComponent(county)}&lat=${lat}&lon=${lon}&radius=${radius}&limit=${limit}`,
  );
  return resp.json();
}

function lonLatToWorldPixel(lon: number, lat: number, zoom: number): { px: number; py: number } {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sinLat));
  const y = (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale;
  return { px: x, py: y };
}

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function worldPixelToLonLat(px: number, py: number, zoom: number): [number, number] {
  const scale = 256 * Math.pow(2, zoom);
  const lon = (px / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * py) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lon, lat];
}

export interface SnapshotGeoTransform {
  zoom: number;
  cropX0: number;
  cropY0: number;
  side: number;
  outSize: number;
}

export function box2dToGeoPolygon(
  box2d: number[],
  geo: SnapshotGeoTransform,
): [number, number][] | null {
  if (!Array.isArray(box2d) || box2d.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box2d.map((v) => Math.max(0, Math.min(1000, Number(v))));
  if (!Number.isFinite(ymin) || !Number.isFinite(xmin) || !Number.isFinite(ymax) || !Number.isFinite(xmax)) {
    return null;
  }
  if (ymax - ymin < 8 || xmax - xmin < 8) return null; // too tiny / noise

  const toWorldLonLat = (normX: number, normY: number): [number, number] => {
    const px = geo.cropX0 + (normX / 1000) * geo.side;
    const py = geo.cropY0 + (normY / 1000) * geo.side;
    return worldPixelToLonLat(px, py, geo.zoom);
  };

  return [
    toWorldLonLat(xmin, ymin),
    toWorldLonLat(xmax, ymin),
    toWorldLonLat(xmax, ymax),
    toWorldLonLat(xmin, ymax),
  ];
}

export async function captureNlscOrthoSnapshot(
  roofPolygon: [number, number][],
  exclusionPolygons: RoofExclusionPolygon[] = [],
): Promise<{ dataUrl: string; base64: string; mimeType: string; geo: SnapshotGeoTransform }> {
  if (roofPolygon.length < 3) {
    throw new Error('請先框選屋頂多邊形後再執行 AI 影像初篩');
  }

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of roofPolygon) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const dLon = Math.max(0.00025, (maxLon - minLon) * 0.25);
  const dLat = Math.max(0.00025, (maxLat - minLat) * 0.25);
  const padMinLon = minLon - dLon;
  const padMaxLon = maxLon + dLon;
  const padMinLat = minLat - dLat;
  const padMaxLat = maxLat + dLat;

  // Choose highest NLSC PHOTO2 zoom where tile grid is at most 4x4
  let zoom = 19;
  for (const z of [19, 18, 17]) {
    const tl = lonLatToWorldPixel(padMinLon, padMaxLat, z);
    const br = lonLatToWorldPixel(padMaxLon, padMinLat, z);
    const txSpan = Math.floor(br.px / 256) - Math.floor(tl.px / 256) + 1;
    const tySpan = Math.floor(br.py / 256) - Math.floor(tl.py / 256) + 1;
    if (txSpan <= 4 && tySpan <= 4) {
      zoom = z;
      break;
    }
    zoom = z;
  }

  const tlPx = lonLatToWorldPixel(padMinLon, padMaxLat, zoom);
  const brPx = lonLatToWorldPixel(padMaxLon, padMinLat, zoom);
  const spanW = Math.max(64, brPx.px - tlPx.px);
  const spanH = Math.max(64, brPx.py - tlPx.py);
  // Make square framing around center
  const side = Math.max(spanW, spanH);
  const cx = (tlPx.px + brPx.px) / 2;
  const cy = (tlPx.py + brPx.py) / 2;
  const cropX0 = cx - side / 2;
  const cropY0 = cy - side / 2;
  const cropX1 = cx + side / 2;
  const cropY1 = cy + side / 2;

  const tx0 = Math.floor(cropX0 / 256);
  const ty0 = Math.floor(cropY0 / 256);
  const tx1 = Math.floor(cropX1 / 256);
  const ty1 = Math.floor(cropY1 / 256);

  const outSize = 576;
  const canvas = document.createElement('canvas');
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立畫布進行正射影像拼接');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, outSize, outSize);

  const tilePromises: Array<Promise<{ tx: number; ty: number; img: HTMLImageElement | null }>> = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const url = `/live/nlsc-tile/PHOTO2/${zoom}/${ty}/${tx}`;
      tilePromises.push(loadTileImage(url).then((img) => ({ tx, ty, img })));
    }
  }

  const tiles = await Promise.all(tilePromises);
  let loadedAny = false;
  const scaleToCanvas = outSize / side;

  for (const { tx, ty, img } of tiles) {
    if (!img) continue;
    loadedAny = true;
    const tileWorldX = tx * 256;
    const tileWorldY = ty * 256;
    const dx = (tileWorldX - cropX0) * scaleToCanvas;
    const dy = (tileWorldY - cropY0) * scaleToCanvas;
    const dw = 256 * scaleToCanvas;
    ctx.drawImage(img, dx, dy, dw, dw);
  }

  if (!loadedAny) {
    throw new Error('國土測繪中心 PHOTO2 圖磚載入失敗，請稍後重試');
  }

  const toCanvasPt = ([lon, lat]: [number, number]): [number, number] => {
    const wp = lonLatToWorldPixel(lon, lat, zoom);
    return [(wp.px - cropX0) * scaleToCanvas, (wp.py - cropY0) * scaleToCanvas];
  };

  // Draw crisp amber boundary of the target roof so Gemini Vision inspects the exact building
  ctx.save();
  ctx.beginPath();
  roofPolygon.forEach((pt, idx) => {
    const [x, y] = toCanvasPt(pt);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  // Draw any existing exclusion polygons in dashed rose
  for (const ex of exclusionPolygons) {
    if (ex.coordinates.length < 3) continue;
    ctx.beginPath();
    ex.coordinates.forEach((pt, idx) => {
      const [x, y] = toCanvasPt(pt);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fb7185';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = dataUrl.split(',')[1] || '';
  return {
    dataUrl,
    base64,
    mimeType: 'image/jpeg',
    geo: { zoom, cropX0, cropY0, side, outSize },
  };
}

export async function analyzeRoofWithGeminiVision(
  roofPolygon: [number, number][],
  exclusionPolygons: RoofExclusionPolygon[],
  meta: { roofAreaSqm: number; address: string; districtLabel: string },
): Promise<AiRoofVisionResult & { snapshotGeo: SnapshotGeoTransform }> {
  const snapshot = await captureNlscOrthoSnapshot(roofPolygon, exclusionPolygons);
  const resp = await fetch('/api/ai-roof-vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64: snapshot.base64,
      mimeType: snapshot.mimeType,
      roofAreaSqm: meta.roofAreaSqm,
      address: meta.address,
      districtLabel: meta.districtLabel,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(json?.error || `AI 影像分析失敗 (HTTP ${resp.status})`);
  }
  return {
    ...(json as AiRoofVisionResult),
    snapshotDataUrl: snapshot.dataUrl,
    snapshotGeo: snapshot.geo,
  };
}
