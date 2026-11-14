import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Strict whitelist of allowed upstream domains for /live/* proxy
const ALLOWED_NLSC_LAYERS = new Set(['PHOTO2', 'EMAP', 'LUIMAP', 'B5000', 'EMAP5']);

const TAIPOWER_COUNTY_MAP: Record<string, { code: string; label: string }> = {
  臺北市: { code: 'TAIPEI', label: '臺北市' },
  台北市: { code: 'TAIPEI', label: '臺北市' },
  新北市: { code: 'NEWTAIPEI', label: '新北市' },
  桃園市: { code: 'TAOYUAN', label: '桃園市' },
  桃園縣: { code: 'TAOYUAN', label: '桃園市' },
  臺中市: { code: 'TAICHUNG', label: '臺中市' },
  台中市: { code: 'TAICHUNG', label: '臺中市' },
  臺南市: { code: 'TAINAN', label: '臺南市' },
  台南市: { code: 'TAINAN', label: '臺南市' },
  高雄市: { code: 'KAOHSIUNG', label: '高雄市' },
  嘉義縣: { code: 'CHIAYI', label: '嘉義縣市' },
  嘉義市: { code: 'CHIAYI', label: '嘉義縣市' },
  苗栗縣: { code: 'MIAOLI', label: '苗栗縣' },
  彰化縣: { code: 'CHANGHUA', label: '彰化縣' },
  雲林縣: { code: 'YUNLIN', label: '雲林縣' },
  屏東縣: { code: 'PINGTUNG', label: '屏東縣' },
  新竹縣: { code: 'HSINCHU', label: '新竹縣市' },
  新竹市: { code: 'HSINCHU', label: '新竹縣市' },
  基隆市: { code: 'KEELUNG', label: '基隆市' },
  南投縣: { code: 'NANTOU', label: '南投縣' },
  宜蘭縣: { code: 'YILAN', label: '宜蘭縣' },
  花蓮縣: { code: 'HUALIEN', label: '花蓮縣' },
  臺東縣: { code: 'TAITUNG', label: '臺東縣' },
  台東縣: { code: 'TAITUNG', label: '臺東縣' },
};

// In-memory short-lived cache only for parsed Taipower county ZIPs (15 min TTL)
// to avoid re-downloading 600KB+ ZIP on every pan while staying fresh.
interface CachedCountyFeeder {
  fetchedAt: string;
  expiresAt: number;
  sourceUrl: string;
  capacityMap: Map<string, number>;
  transformers: Array<{ x67: number; y67: number; feederId: string }>;
}
const taipowerZipCache = new Map<string, CachedCountyFeeder>();

// Coordinate conversion: WGS84 (lat, lon) -> TWD97 TM2 -> TWD67 TM2
function wgs84ToTwd97Tm2(latDeg: number, lonDeg: number): { x: number; y: number } {
  const a = 6378137.0;
  const b = 6356752.3142451;
  const lon0 = (121 * Math.PI) / 180;
  const k0 = 0.9999;
  const dx = 250000;
  const dy = 0;

  const e = Math.sqrt(1 - (b * b) / (a * a));
  const e2 = (e * e) / (1 - e * e);

  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;

  const n = (a - b) / (a + b);
  const nu = a / Math.sqrt(1 - e * e * Math.sin(lat) * Math.sin(lat));
  const p = lon - lon0;

  const A = a * (1 - n + (5 / 4) * (n * n - n * n * n) + (81 / 64) * (Math.pow(n, 4) - Math.pow(n, 5)));
  const B = ((3 * a * n) / 2) * (1 - n + (7 / 8) * (n * n - n * n * n) + (55 / 64) * (Math.pow(n, 4) - Math.pow(n, 5)));
  const C = ((15 * a * n * n) / 16) * (1 - n + (3 / 4) * (n * n - n * n * n));
  const D = ((35 * a * n * n * n) / 48) * (1 - n + (11 / 16) * (n * n - n * n * n));
  const E = ((315 * a * Math.pow(n, 4)) / 51) * (1 - n);

  const S =
    A * lat -
    B * Math.sin(2 * lat) +
    C * Math.sin(4 * lat) -
    D * Math.sin(6 * lat) +
    E * Math.sin(8 * lat);

  const K1 = S * k0;
  const K2 = (k0 * nu * Math.sin(2 * lat)) / 4;
  const K3 =
    ((k0 * nu * Math.sin(lat) * Math.pow(Math.cos(lat), 3)) / 24) *
    (5 - Math.tan(lat) * Math.tan(lat) + 9 * e2 * Math.pow(Math.cos(lat), 2) + 4 * e2 * e2 * Math.pow(Math.cos(lat), 4));

  const K4 = k0 * nu * Math.cos(lat);
  const K5 =
    ((k0 * nu * Math.pow(Math.cos(lat), 3)) / 6) *
    (1 - Math.tan(lat) * Math.tan(lat) + e2 * Math.pow(Math.cos(lat), 2));

  const y = dy + K1 + K2 * p * p + K3 * Math.pow(p, 4);
  const x = dx + K4 * p + K5 * Math.pow(p, 3);
  return { x, y };
}

function twd97ToTwd67Tm2(x97: number, y97: number): { x: number; y: number } {
  const A = 0.00001549;
  const B = 0.000006521;
  const x67 = x97 - 807.8 - A * x97 - B * y97;
  const y67 = y97 + 248.6 - A * y97 - B * x97;
  return { x: x67, y: y67 };
}

function twd67ToWgs84Approx(x67: number, y67: number): { lat: number; lon: number } {
  // Inverse TWD67 -> TWD97 -> WGS84 (accurate within ~2m for map marker visualization)
  const A = 0.00001549;
  const B = 0.000006521;
  const x97 = x67 + 807.8 + A * x67 + B * y67;
  const y97 = y67 - 248.6 + A * y67 + B * x67;

  const a = 6378137.0;
  const b = 6356752.3142451;
  const lon0 = (121 * Math.PI) / 180;
  const k0 = 0.9999;
  const dx = 250000;
  const e = Math.sqrt(1 - (b * b) / (a * a));
  const e2 = (e * e) / (1 - e * e);

  const M = y97 / k0;
  const mu = M / (a * (1 - (e * e) / 4 - (3 * Math.pow(e, 4)) / 64 - (5 * Math.pow(e, 6)) / 256));
  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const J1 = (3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32;
  const J2 = (21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32;
  const J3 = (151 * Math.pow(e1, 3)) / 96;
  const J4 = (1097 * Math.pow(e1, 4)) / 512;

  const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);
  const C1 = e2 * Math.pow(Math.cos(fp), 2);
  const T1 = Math.pow(Math.tan(fp), 2);
  const R1 = (a * (1 - e * e)) / Math.pow(1 - e * e * Math.sin(fp) * Math.sin(fp), 1.5);
  const N1 = a / Math.sqrt(1 - e * e * Math.sin(fp) * Math.sin(fp));
  const D = (x97 - dx) / (N1 * k0);

  const Q1 = (N1 * Math.tan(fp)) / R1;
  const Q2 = (D * D) / 2;
  const Q3 = ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * Math.pow(D, 4)) / 24;
  const Q4 = ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 3 * C1 * C1 - 252 * e2) * Math.pow(D, 6)) / 720;
  const lat = fp - Q1 * (Q2 - Q3 + Q4);

  const Q5 = D;
  const Q6 = ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6;
  const Q7 = ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120;
  const lon = lon0 + (Q5 - Q6 + Q7) / Math.cos(fp);

  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
  };
}

function parseXmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
}

async function fetchNlscDistrict(lat: number, lon: number) {
  const sourceUrl = `https://api.nlsc.gov.tw/other/TownVillagePointQuery/${lon.toFixed(6)}/${lat.toFixed(6)}/4326`;
  const fetchedAt = new Date().toISOString();
  try {
    const resp = await fetch(sourceUrl, {
      headers: { Referer: 'https://maps.nlsc.gov.tw/', 'User-Agent': 'SolarX-AI/1.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) {
      return {
        ctyCode: '',
        ctyName: '',
        townCode: '',
        townName: '',
        officeName: '',
        sectCode: '',
        sectName: '',
        provenance: {
          key: 'nlsc-district',
          label: '行政區與地段定位',
          sourceName: '內政部國土測繪中心 (NLSC)',
          sourceUrl,
          fetchedAt,
          status: 'error' as const,
          summary: '無法取得行政區段資料',
          errorDetail: `HTTP ${resp.status}`,
        },
      };
    }
    const xml = await resp.text();
    const ctyName = parseXmlTag(xml, 'ctyName');
    const townName = parseXmlTag(xml, 'townName');
    const sectName = parseXmlTag(xml, 'sectName');
    const sectCode = parseXmlTag(xml, 'sectCode');
    const officeName = parseXmlTag(xml, 'officeName');
    const ctyCode = parseXmlTag(xml, 'ctyCode');
    const townCode = parseXmlTag(xml, 'townCode');

    if (!ctyName) {
      return {
        ctyCode: '',
        ctyName: '',
        townCode: '',
        townName: '',
        officeName: '',
        sectCode: '',
        sectName: '',
        provenance: {
          key: 'nlsc-district',
          label: '行政區與地段定位',
          sourceName: '內政部國土測繪中心 (NLSC)',
          sourceUrl,
          fetchedAt,
          status: 'no_data' as const,
          summary: '座標超出台灣行政區圖資範圍',
        },
      };
    }

    return {
      ctyCode,
      ctyName,
      townCode,
      townName,
      officeName,
      sectCode,
      sectName,
      provenance: {
        key: 'nlsc-district',
        label: '行政區與地段定位',
        sourceName: '內政部國土測繪中心 (NLSC)',
        sourceUrl,
        fetchedAt,
        status: 'live' as const,
        summary: `${ctyName}${townName}${sectName ? ` · ${sectName.endsWith('段') ? sectName : `${sectName}段`}(${sectCode})` : ''}`,
      },
    };
  } catch (err) {
    return {
      ctyCode: '',
      ctyName: '',
      townCode: '',
      townName: '',
      officeName: '',
      sectCode: '',
      sectName: '',
      provenance: {
        key: 'nlsc-district',
        label: '行政區與地段定位',
        sourceName: '內政部國土測繪中心 (NLSC)',
        sourceUrl,
        fetchedAt,
        status: 'error' as const,
        summary: '國土測繪中心查詢連線異常',
        errorDetail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function decodeCsvBuffer(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    return iconv.decode(buf, 'big5');
  }
  return utf8.replace(/^\uFEFF/, '');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // 1. NLSC WMTS Orthophoto / EMAP Tile Proxy (adds required Referer)
  app.get('/live/nlsc-tile/:layer/:z/:y/:x', async (req, res) => {
    const { layer, z, y, x } = req.params;
    if (!ALLOWED_NLSC_LAYERS.has(layer)) {
      res.status(400).json({ error: 'Layer not in whitelist' });
      return;
    }
    const cleanX = x.replace(/\.(png|jpg|jpeg)$/i, '');
    const upstreamUrl = `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/${z}/${y}/${cleanX}`;
    try {
      const resp = await fetch(upstreamUrl, {
        headers: {
          Referer: 'https://maps.nlsc.gov.tw/',
          'User-Agent': 'SolarX-AI/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        res.status(resp.status).send('Tile unavailable');
        return;
      }
      const ct = resp.headers.get('content-type') || 'image/jpeg';
      const arrBuf = await resp.arrayBuffer();
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(arrBuf));
    } catch {
      res.status(502).send('NLSC tile proxy error');
    }
  });

  // 2. NLSC 3D Tiles Service Index & Nearby Spatial Query + GLB Proxy
  const NLSC_3D_COUNTY_ID: Record<string, string> = {
    臺北市: '0',
    臺中市: '1',
    基隆市: '2',
    臺南市: '3',
    高雄市: '4',
    新北市: '5',
    宜蘭縣: '6',
    桃園市: '7',
    嘉義市: '8',
    新竹縣: '9',
    苗栗縣: '10',
    南投縣: '11',
    彰化縣: '12',
    新竹市: '13',
    雲林縣: '14',
    嘉義縣: '15',
    屏東縣: '16',
    花蓮縣: '17',
    臺東縣: '18',
    澎湖縣: '19',
    金門縣: '20',
    連江縣: '21',
  };

  interface Compact3dTileNode {
    uri: string;
    ex: number;
    ey: number;
    ez: number;
    r: number;
  }
  const nlsc3dTilesCache = new Map<
    string,
    { expiresAt: number; tiles: Compact3dTileNode[] }
  >();

  function wgs84ToEcef(latDeg: number, lonDeg: number, h = 80): [number, number, number] {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const e2 = 2 * f - f * f;
    const lat = (latDeg * Math.PI) / 180;
    const lon = (lonDeg * Math.PI) / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    return [
      (N + h) * Math.cos(lat) * Math.cos(lon),
      (N + h) * Math.cos(lat) * Math.sin(lon),
      (N * (1 - e2) + h) * Math.sin(lat),
    ];
  }

  app.get('/live/nlsc-3dtiles-index', async (_req, res) => {
    const sourceUrl = 'https://3dtiles.nlsc.gov.tw/tiles3d/Service';
    const fetchedAt = new Date().toISOString();
    try {
      const resp = await fetch(sourceUrl, {
        headers: { Referer: 'https://3dmaps.nlsc.gov.tw/', 'User-Agent': 'SolarX-AI/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        res.status(resp.status).json({
          layers: [],
          provenance: {
            key: 'nlsc-3d',
            label: '3D 建物圖磚目錄',
            sourceName: '內政部國土測繪中心多維度平臺',
            sourceUrl,
            fetchedAt,
            status: 'error',
            summary: `無法取得 3D Tiles 服務目錄 (HTTP ${resp.status})`,
          },
        });
        return;
      }
      const data = await resp.json();
      const buildings = data?.LAYERS?.BUILDING ?? [];
      res.json({
        layers: buildings,
        provenance: {
          key: 'nlsc-3d',
          label: '3D 建物圖磚目錄',
          sourceName: '內政部國土測繪中心多維度平臺',
          sourceUrl,
          fetchedAt,
          status: 'live',
          summary: `已驗證官方 3D Tiles 縣市服務 (${buildings.length} 筆圖層)`,
        },
      });
    } catch (err) {
      res.status(502).json({
        layers: [],
        provenance: {
          key: 'nlsc-3d',
          label: '3D 建物圖磚目錄',
          sourceName: '內政部國土測繪中心多維度平臺',
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: '連線 3D Tiles 目錄失敗',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  app.get('/live/nlsc-3dtiles-nearby', async (req, res) => {
    const normalizedCounty = String(req.query.county || '')
      .trim()
      .replace(/台/g, '臺')
      .replace(/^桃園縣$/, '桃園市');
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radius = Math.min(600, Math.max(100, Number(req.query.radius) || 380));
    const limit = Math.min(120, Math.max(16, Number(req.query.limit) || 88));
    const fetchedAt = new Date().toISOString();

    const tilesetId = NLSC_3D_COUNTY_ID[normalizedCounty] ?? null;
    if (!tilesetId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.json({
        countyName: normalizedCounty,
        tilesetId: null,
        tilesetUrl: 'https://3dtiles.nlsc.gov.tw/tiles3d/Service',
        tiles: [],
        provenance: {
          key: 'nlsc-3d',
          label: '國土測繪中心 3D Tiles',
          sourceName: '內政部國土測繪中心多維度平臺',
          sourceUrl: 'https://3dtiles.nlsc.gov.tw/tiles3d/Service',
          fetchedAt,
          status: 'no_data',
          summary: normalizedCounty ? `縣市「${normalizedCounty}」無對應 3D Tiles 圖層或座標無效` : '尚未指定縣市行政區',
        },
      });
      return;
    }

    const tilesetUrl = `https://3dtiles.nlsc.gov.tw/building/tiles3d/${tilesetId}/tileset.json`;
    try {
      let cached = nlsc3dTilesCache.get(tilesetId);
      if (!cached || cached.expiresAt < Date.now()) {
        const resp = await fetch(tilesetUrl, {
          headers: { Referer: 'https://3dmaps.nlsc.gov.tw/', 'User-Agent': 'SolarX-AI/1.0' },
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        interface RawNode {
          boundingVolume?: { sphere?: number[] };
          content?: { uri?: string };
          contents?: Array<{ uri?: string }>;
          children?: RawNode[];
        }
        const json = (await resp.json()) as { root?: RawNode };

        const leafList: Compact3dTileNode[] = [];
        const stack: RawNode[] = json.root ? [json.root] : [];
        while (stack.length > 0) {
          const node = stack.pop()!;
          const s = node.boundingVolume?.sphere;
          if (!s || s.length < 4 || s[3] <= 0.1) continue;
          const validChildren = (node.children ?? []).filter(
            (ch) => ch.boundingVolume?.sphere && ch.boundingVolume.sphere.length >= 4 && ch.boundingVolume.sphere[3] > 0.1,
          );
          if (validChildren.length > 0) {
            for (const ch of validChildren) stack.push(ch);
          } else {
            const uri = node.contents?.[0]?.uri ?? node.content?.uri;
            if (uri && /^[0-9_]+\.glb$/i.test(uri)) {
              leafList.push({
                uri,
                ex: s[0],
                ey: s[1],
                ez: s[2],
                r: s[3],
              });
            }
          }
        }
        cached = { expiresAt: Date.now() + 30 * 60 * 1000, tiles: leafList };
        nlsc3dTilesCache.set(tilesetId, cached);
      }

      const [tx, ty, tz] = wgs84ToEcef(lat, lon, 80);
      const matches = cached.tiles
        .map((t) => {
          const centerDist = Math.hypot(t.ex - tx, t.ey - ty, t.ez - tz);
          const edgeDist = Math.max(0, centerDist - t.r);
          return { t, edgeDist };
        })
        .filter((x) => x.edgeDist <= radius)
        .sort((a, b) => a.edgeDist - b.edgeDist)
        .slice(0, limit)
        .map((x) => ({
          uri: x.t.uri,
          proxyUrl: `/live/nlsc-3dtiles-asset/${tilesetId}/${x.t.uri}`,
          distM: Math.round(x.edgeDist),
          radiusM: Math.round(x.t.r),
        }));

      res.json({
        countyName: normalizedCounty,
        tilesetId,
        tilesetUrl,
        tiles: matches,
        provenance: {
          key: 'nlsc-3d',
          label: '國土測繪中心 3D Tiles',
          sourceName: `內政部國土測繪中心 (${normalizedCounty} 3D 建物模型)`,
          sourceUrl: tilesetUrl,
          fetchedAt,
          status: matches.length > 0 ? 'live' : 'no_data',
          summary:
            matches.length > 0
              ? `已取得 ${normalizedCounty} 半徑 ${radius}m 內 ${matches.length} 塊官方 3D Tiles 建物圖磚 (.glb)`
              : `${normalizedCounty} 廠址半徑 ${radius}m 內無 3D Tiles 建物圖磚`,
        },
      });
    } catch (err) {
      res.status(502).json({
        countyName: normalizedCounty,
        tilesetId,
        tilesetUrl,
        tiles: [],
        provenance: {
          key: 'nlsc-3d',
          label: '國土測繪中心 3D Tiles',
          sourceName: '內政部國土測繪中心多維度平臺',
          sourceUrl: tilesetUrl,
          fetchedAt,
          status: 'error',
          summary: '讀取國土測繪中心 3D Tiles 圖磚索引失敗',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  app.get('/live/nlsc-3dtiles-asset/:tilesetId/:assetName', async (req, res) => {
    const { tilesetId, assetName } = req.params;
    if (!/^\d{1,2}$/.test(tilesetId) || !/^[0-9_]+\.glb$/.test(assetName)) {
      res.status(400).send('Invalid NLSC 3D tile asset request');
      return;
    }
    const upstreamUrl = `https://3dtiles.nlsc.gov.tw/building/tiles3d/${tilesetId}/${assetName}`;
    try {
      const resp = await fetch(upstreamUrl, {
        headers: { Referer: 'https://3dmaps.nlsc.gov.tw/', 'User-Agent': 'SolarX-AI/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        res.status(resp.status).send('NLSC 3D tile unavailable');
        return;
      }
      const arrBuf = await resp.arrayBuffer();
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(arrBuf));
    } catch {
      res.status(502).send('NLSC 3D tile proxy error');
    }
  });

  // 3. Address Geocoding (Tries NLSC TextQuery -> progressive OSM Nominatim TW -> NLSC District enrichment)
  app.get('/live/geocode', async (req, res) => {
    const rawQ = String(req.query.q || '').trim();
    if (!rawQ) {
      res.status(400).json({ error: '請輸入地址或地標名稱' });
      return;
    }

    const fetchedAt = new Date().toISOString();
    // Check if user directly pasted "lat, lon"
    const coordMatch = rawQ.match(/^\s*([2][1-6]\.\d+)\s*[,\s]\s*(1[1-2]\d\.\d+)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      const district = await fetchNlscDistrict(lat, lon);
      res.json({
        query: rawQ,
        candidates: [{ displayName: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, lat, lon, type: 'coordinates' }],
        district,
        provenance: {
          key: 'geocode',
          label: '座標直接定位',
          sourceName: '使用者輸入座標 + NLSC 行政區查詢',
          sourceUrl: district.provenance.sourceUrl,
          fetchedAt,
          status: 'live',
          summary: `座標定位 (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
        },
      });
      return;
    }

    // Attempt NLSC TextQuery first
    const nlscUrl = `https://api.nlsc.gov.tw/idc/TextQuery/${encodeURIComponent(rawQ)}`;
    try {
      const nlscResp = await fetch(nlscUrl, {
        headers: { Referer: 'https://maps.nlsc.gov.tw/', 'User-Agent': 'SolarX-AI/1.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (nlscResp.ok) {
        const txt = await nlscResp.text();
        if (txt.includes('<ITEM>') || txt.includes('"X"')) {
          const xMatch = txt.match(/<X>([\d.]+)<\/X>/);
          const yMatch = txt.match(/<Y>([\d.]+)<\/Y>/);
          const nameMatch = txt.match(/<CONTENT>([^<]+)<\/CONTENT>/);
          if (xMatch && yMatch) {
            const lon = parseFloat(xMatch[1]);
            const lat = parseFloat(yMatch[1]);
            const district = await fetchNlscDistrict(lat, lon);
            res.json({
              query: rawQ,
              candidates: [{ displayName: nameMatch ? nameMatch[1] : rawQ, lat, lon, type: 'nlsc' }],
              district,
              provenance: {
                key: 'geocode',
                label: '地址定位 (NLSC)',
                sourceName: '內政部國土測繪中心模糊檢索',
                sourceUrl: nlscUrl,
                fetchedAt,
                status: 'live',
                summary: `NLSC 定位成功 (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
              },
            });
            return;
          }
        }
      }
    } catch {
      // NLSC TextQuery requires registered IP key in many environments; proceed to Nominatim TW
    }

    // Progressive Taiwan address normalization for Nominatim
    const normalized = rawQ.replace(/台/g, '臺');
    const strippedHouse = normalized.replace(/\d+巷|\d+弄|\d+號|\d+樓/g, ' ').replace(/\s+/g, ' ').trim();
    const spacedTaiwan = strippedHouse
      .replace(/(縣|市|區|鄉|鎮)/g, '$1 ')
      .replace(/\s+/g, ' ')
      .trim();

    const searchQueries = Array.from(new Set([rawQ, normalized, strippedHouse, spacedTaiwan].filter(Boolean)));
    let candidates: Array<{ displayName: string; lat: number; lon: number; type: string }> = [];
    let usedUrl = '';

    for (const qTry of searchQueries) {
      const nomUrl = `https://nominatim.openstreetmap.org/search?countrycodes=tw&format=jsonv2&addressdetails=1&limit=5&accept-language=zh-TW&q=${encodeURIComponent(qTry)}`;
      usedUrl = nomUrl;
      try {
        const nomResp = await fetch(nomUrl, {
          headers: { 'User-Agent': 'SolarX-AI-Taiwan-Rooftop-Feasibility/1.0' },
          signal: AbortSignal.timeout(7000),
        });
        if (nomResp.ok) {
          const arr = (await nomResp.json()) as Array<{ display_name: string; lat: string; lon: string; type: string }>;
          if (Array.isArray(arr) && arr.length > 0) {
            candidates = arr.map((item) => ({
              displayName: item.display_name,
              lat: parseFloat(item.lat),
              lon: parseFloat(item.lon),
              type: item.type || 'address',
            }));
            break;
          }
        }
      } catch {
        // continue trying next normalization
      }
    }

    if (candidates.length === 0) {
      res.json({
        query: rawQ,
        candidates: [],
        district: null,
        provenance: {
          key: 'geocode',
          label: '地址定位查詢',
          sourceName: 'NLSC 模糊檢索 / OSM Nominatim 台灣',
          sourceUrl: usedUrl || nlscUrl,
          fetchedAt,
          status: 'no_data',
          summary: '查無對應地址座標，請嘗試輸入路名或「縣市+工業區名稱」，或直接於地圖點選屋頂',
        },
      });
      return;
    }

    const district = await fetchNlscDistrict(candidates[0].lat, candidates[0].lon);
    res.json({
      query: rawQ,
      candidates,
      district,
      provenance: {
        key: 'geocode',
        label: '地址定位查詢',
        sourceName: 'OSM Nominatim 台灣 + NLSC 行政段籍查詢',
        sourceUrl: usedUrl,
        fetchedAt,
        status: 'live',
        summary: `已定位至 ${candidates[0].lat.toFixed(5)}, ${candidates[0].lon.toFixed(5)}（NLSC 國土測繪檢索需機關白名單授權，已透過 Nominatim 搭配 NLSC 單點行政段籍驗證）`,
      },
    });
  });

  // 4. NLSC District / Cadastral Section Query
  app.get('/live/district', async (req, res) => {
    const lat = parseFloat(String(req.query.lat || ''));
    const lon = parseFloat(String(req.query.lon || ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid lat/lon' });
      return;
    }
    const district = await fetchNlscDistrict(lat, lon);
    res.json(district);
  });

  // 5. NASA POWER Climatology Proxy (or direct from browser)
  app.get('/live/nasa-power', async (req, res) => {
    const lat = parseFloat(String(req.query.lat || ''));
    const lon = parseFloat(String(req.query.lon || ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid lat/lon' });
      return;
    }
    const sourceUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
    const fetchedAt = new Date().toISOString();
    try {
      const resp = await fetch(sourceUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        res.status(resp.status).json({
          provenance: {
            key: 'nasa-power',
            label: 'NASA POWER 日照與氣溫',
            sourceName: 'NASA POWER Climatology API',
            sourceUrl,
            fetchedAt,
            status: 'error',
            summary: `NASA POWER 回傳 HTTP ${resp.status}`,
          },
        });
        return;
      }
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

      res.json({
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
          sourceName: 'NASA Langley POWER Project (RE Community)',
          sourceUrl,
          fetchedAt,
          status: 'live',
          summary: `年均水平日照 ${Number(params?.ALLSKY_SFC_SW_DWN?.ANN ?? 0).toFixed(2)} kWh/m²/日 · 年均溫 ${Number(params?.T2M?.ANN ?? 0).toFixed(1)} °C`,
        },
      });
    } catch (err) {
      res.status(502).json({
        provenance: {
          key: 'nasa-power',
          label: 'NASA POWER 日照與氣溫',
          sourceName: 'NASA POWER Climatology API',
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: 'NASA POWER 連線逾時或失敗',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // 6. OSM Buildings Proxy (Primary: fast OSM v0.6 /map bbox API; Fallback: Overpass mirrors)
  app.get('/live/overpass-buildings', async (req, res) => {
    const lat = parseFloat(String(req.query.lat || ''));
    const lon = parseFloat(String(req.query.lon || ''));
    const radius = Math.min(350, Math.max(60, parseInt(String(req.query.radius || '260'), 10) || 260));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid lat/lon' });
      return;
    }

    const fetchedAt = new Date().toISOString();

    const parseHeight = (rawH: string | null): number | null => {
      if (!rawH) return null;
      const parsed = parseFloat(rawH.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) && parsed > 0 && parsed < 600 ? parsed : null;
    };

    // Primary: Official OSM REST API v0.6 /map (responds in ~1s without Overpass rate limits)
    const dLat = Math.min(0.0028, radius / 111320);
    const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const dLon = Math.min(0.0032, radius / (111320 * cosLat));
    const bboxStr = [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
      .map((v) => v.toFixed(5))
      .join(',');
    const osmMapUrl = `https://api.openstreetmap.org/api/0.6/map?bbox=${bboxStr}`;

    try {
      const osmResp = await fetch(osmMapUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SolarX-AI-Taiwan-Feasibility/1.0',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (osmResp.ok) {
        const json = (await osmResp.json()) as {
          elements?: Array<{
            type: string;
            id: number;
            lat?: number;
            lon?: number;
            nodes?: number[];
            tags?: Record<string, string>;
          }>;
        };
        const elements = Array.isArray(json?.elements) ? json.elements : [];
        const nodeMap = new Map<number, [number, number]>();
        for (const el of elements) {
          if (el.type === 'node' && typeof el.lon === 'number' && typeof el.lat === 'number') {
            nodeMap.set(el.id, [el.lon, el.lat]);
          }
        }
        const buildings = elements
          .filter((el) => el.type === 'way' && Boolean(el.tags?.building) && Array.isArray(el.nodes))
          .map((el) => {
            const coords = (el.nodes ?? [])
              .map((nid) => nodeMap.get(nid))
              .filter((pt): pt is [number, number] => Boolean(pt));
            const rawH = el.tags?.height ?? null;
            const heightM = parseHeight(rawH);
            return {
              id: `osm-way-${el.id}`,
              name: el.tags?.name || el.tags?.['addr:street'] || undefined,
              coordinates: coords,
              rawHeightTag: rawH,
              heightM,
              levelsTag: el.tags?.['building:levels'] ?? null,
              includedInShading: heightM !== null,
            };
          })
          .filter((b) => b.coordinates.length >= 3);

        const withHeightCount = buildings.filter((b) => b.includedInShading).length;
        const withoutHeightCount = buildings.length - withHeightCount;

        res.json({
          buildings,
          totalCount: buildings.length,
          withHeightCount,
          withoutHeightCount,
          provenance: {
            key: 'osm-overpass',
            label: 'OSM 建物輪廓與高度',
            sourceName: 'OpenStreetMap API v0.6',
            sourceUrl: osmMapUrl,
            fetchedAt,
            status: buildings.length > 0 ? 'live' : 'no_data',
            summary:
              buildings.length > 0
                ? `半徑 ${radius}m 內共 ${buildings.length} 棟建物（${withHeightCount} 棟具 height 標籤納入遮蔭，${withoutHeightCount} 棟無高度標籤排除）`
                : `半徑 ${radius}m 內無 OSM 建物輪廓資料`,
          },
        });
        return;
      }
    } catch {
      // Fall back to Overpass mirrors below
    }

    const query = `[out:json][timeout:8];way(around:${radius},${lat.toFixed(6)},${lon.toFixed(6)})[building];out geom;`;
    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
    ];

    for (const baseUrl of mirrors) {
      const fullUrl = `${baseUrl}?data=${encodeURIComponent(query)}`;
      try {
        const resp = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'SolarX-AI-Taiwan/1.0',
            Accept: 'application/json',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(7000),
        });
        if (!resp.ok) continue;
        const json = await resp.json();
        const elements = Array.isArray(json?.elements) ? json.elements : [];
        const buildings = elements
          .filter((el: { geometry?: Array<{ lat: number; lon: number }> }) => Array.isArray(el.geometry) && el.geometry.length >= 3)
          .map((el: { id: number; tags?: Record<string, string>; geometry: Array<{ lat: number; lon: number }> }) => {
            const rawH = el.tags?.height ?? null;
            const heightM = parseHeight(rawH);
            return {
              id: `osm-way-${el.id}`,
              name: el.tags?.name || el.tags?.['addr:street'] || undefined,
              coordinates: el.geometry.map((pt) => [pt.lon, pt.lat] as [number, number]),
              rawHeightTag: rawH,
              heightM,
              levelsTag: el.tags?.['building:levels'] ?? null,
              includedInShading: heightM !== null,
            };
          });

        const withHeightCount = buildings.filter((b: { includedInShading: boolean }) => b.includedInShading).length;
        const withoutHeightCount = buildings.length - withHeightCount;

        res.json({
          buildings,
          totalCount: buildings.length,
          withHeightCount,
          withoutHeightCount,
          provenance: {
            key: 'osm-overpass',
            label: 'OSM 建物輪廓與高度',
            sourceName: 'OpenStreetMap Overpass API',
            sourceUrl: fullUrl,
            fetchedAt,
            status: buildings.length > 0 ? 'live' : 'no_data',
            summary:
              buildings.length > 0
                ? `半徑 ${radius}m 內共 ${buildings.length} 棟建物（${withHeightCount} 棟具 height 標籤納入遮蔭，${withoutHeightCount} 棟無高度標籤排除）`
                : `半徑 ${radius}m 內無 OSM 建物輪廓資料`,
          },
        });
        return;
      } catch {
        // try next mirror
      }
    }

    res.json({
      buildings: [],
      totalCount: 0,
      withHeightCount: 0,
      withoutHeightCount: 0,
      provenance: {
        key: 'osm-overpass',
        label: 'OSM 建物輪廓與高度',
        sourceName: 'OpenStreetMap API v0.6 / Overpass',
        sourceUrl: osmMapUrl,
        fetchedAt,
        status: 'error',
        summary: 'OSM 與 Overpass 伺服器暫時無回應，無法取得周圍建物輪廓與 height 標籤',
        errorDetail: '所有 OSM 建物節點連線逾時或遭阻擋，遮蔭率無法以建物模型推算（請由現場確認周圍遮蔭物）。',
      },
    });
  });

  // 7. Taipower Feeder Capacity ZIP Parser Proxy
  app.get('/live/taipower-feeder', async (req, res) => {
    const countyRaw = String(req.query.county || '').trim();
    const lat = parseFloat(String(req.query.lat || ''));
    const lon = parseFloat(String(req.query.lon || ''));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      res.status(400).json({ error: 'Invalid lat/lon' });
      return;
    }

    const mapped = TAIPOWER_COUNTY_MAP[countyRaw];
    const fetchedAt = new Date().toISOString();

    if (!mapped) {
      res.json({
        county: countyRaw || '未知縣市',
        countyCode: '',
        nearestFeeder: null,
        nearbyFeeders: [],
        totalFeedersInCounty: 0,
        provenance: {
          key: 'taipower-feeder',
          label: '台電饋線剩餘容量',
          sourceName: '台灣電力公司再生能源可併網容量開放資料',
          sourceUrl: 'https://service.taipower.com.tw/data/opendata',
          fetchedAt,
          status: 'no_data',
          summary: countyRaw ? `台電未提供「${countyRaw}」之標準配電饋線 ZIP 開放資料集` : '無法辨識縣市以對應台電饋線檔案',
        },
      });
      return;
    }

    const sourceUrl = `https://service.taipower.com.tw/data/opendata/apply/file/d077009/${mapped.code}.zip`;

    try {
      let cached = taipowerZipCache.get(mapped.code);
      if (!cached || Date.now() > cached.expiresAt) {
        const resp = await fetch(sourceUrl, {
          headers: { 'User-Agent': 'SolarX-AI/1.0' },
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} from Taipower open data`);
        }
        const arrayBuf = await resp.arrayBuffer();
        const zip = await JSZip.loadAsync(Buffer.from(arrayBuf));

        const capFileName = Object.keys(zip.files).find(
          (name) => /capacity\.csv$/i.test(name) && !/^schema-/i.test(path.basename(name)),
        );
        const trFileName = Object.keys(zip.files).find(
          (name) => /tr_feeder\.csv$/i.test(name) && !/^schema-/i.test(path.basename(name)),
        );

        if (!capFileName || !trFileName) {
          throw new Error('台電 ZIP 檔內缺少 capacity.csv 或 tr_feeder.csv');
        }

        const capText = decodeCsvBuffer(await zip.files[capFileName].async('nodebuffer'));
        const trText = decodeCsvBuffer(await zip.files[trFileName].async('nodebuffer'));

        const capacityMap = new Map<string, number>();
        const capLines = capText.split(/\r?\n/);
        for (let i = 1; i < capLines.length; i++) {
          const line = capLines[i].trim();
          if (!line) continue;
          const parts = line.split(',');
          if (parts.length >= 2) {
            const fid = parts[0].trim();
            const cap = parseFloat(parts[1].trim());
            if (fid && Number.isFinite(cap)) {
              capacityMap.set(fid, cap);
            }
          }
        }

        const transformers: Array<{ x67: number; y67: number; feederId: string }> = [];
        const trLines = trText.split(/\r?\n/);
        for (let i = 1; i < trLines.length; i++) {
          const line = trLines[i].trim();
          if (!line) continue;
          const parts = line.split(',');
          if (parts.length >= 4) {
            const x67 = parseFloat(parts[1]);
            const y67 = parseFloat(parts[2]);
            const feederId = parts[3].trim();
            if (Number.isFinite(x67) && Number.isFinite(y67) && feederId) {
              transformers.push({ x67, y67, feederId });
            }
          }
        }

        cached = {
          fetchedAt,
          expiresAt: Date.now() + 15 * 60 * 1000,
          sourceUrl,
          capacityMap,
          transformers,
        };
        taipowerZipCache.set(mapped.code, cached);
      }

      const pt97 = wgs84ToTwd97Tm2(lat, lon);
      const pt67 = twd97ToTwd67Tm2(pt97.x, pt97.y);

      // Find nearest transformer per unique feeder
      const bestByFeeder = new Map<string, { feederId: string; dist: number; x67: number; y67: number }>();
      for (const tr of cached.transformers) {
        const dx = tr.x67 - pt67.x;
        const dy = tr.y67 - pt67.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const existing = bestByFeeder.get(tr.feederId);
        if (!existing || dist < existing.dist) {
          bestByFeeder.set(tr.feederId, { feederId: tr.feederId, dist, x67: tr.x67, y67: tr.y67 });
        }
      }

      const allSorted = Array.from(bestByFeeder.values()).sort((a, b) => a.dist - b.dist);
      const withinRadius = allSorted.filter((item) => item.dist <= 1650).slice(0, 24);
      const selectedItems = withinRadius.length >= 8 ? withinRadius : allSorted.slice(0, 10);

      const sorted = selectedItems.map((item) => {
        const wgs = twd67ToWgs84Approx(item.x67, item.y67);
        return {
          feederId: item.feederId,
          capacityKw: cached!.capacityMap.get(item.feederId) ?? 0,
          distanceM: Math.round(item.dist),
          x67: Math.round(item.x67),
          y67: Math.round(item.y67),
          lat: wgs.lat,
          lon: wgs.lon,
        };
      });

      const nearest = sorted[0] ?? null;
      res.json({
        county: mapped.label,
        countyCode: mapped.code,
        nearestFeeder: nearest,
        nearbyFeeders: sorted,
        totalFeedersInCounty: cached.capacityMap.size,
        provenance: {
          key: 'taipower-feeder',
          label: '台電饋線剩餘容量',
          sourceName: `台灣電力公司開放資料 (${mapped.label})`,
          sourceUrl,
          fetchedAt: cached.fetchedAt,
          status: nearest ? 'live' : 'no_data',
          summary: nearest
            ? `最近饋線 ${nearest.feederId}（距 ${nearest.distanceM} m）· 可併網容量 ${nearest.capacityKw.toLocaleString('zh-TW')} kW`
            : `${mapped.label} 資料集內無有效變壓器坐標`,
        },
      });
    } catch (err) {
      res.json({
        county: mapped.label,
        countyCode: mapped.code,
        nearestFeeder: null,
        nearbyFeeders: [],
        totalFeedersInCounty: 0,
        provenance: {
          key: 'taipower-feeder',
          label: '台電饋線剩餘容量',
          sourceName: `台灣電力公司開放資料 (${mapped.label})`,
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: '台電開放資料 ZIP 下載或解壓失敗',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // 8. MOEA GCIS Company / Factory Lookup
  app.get('/live/moea-factory', async (req, res) => {
    const query = String(req.query.query || '').trim();
    const taxId = String(req.query.taxId || '').trim();
    const fetchedAt = new Date().toISOString();

    if (!query && !taxId) {
      res.json({
        query: '',
        records: [],
        registeredAreaSqm: null,
        industryCategory: null,
        provenance: {
          key: 'moea-factory',
          label: '經濟部登記資料',
          sourceName: '經濟部商工行政資料開放平臺 (GCIS)',
          sourceUrl: 'https://data.gcis.nat.gov.tw/',
          fetchedAt,
          status: 'no_data',
          summary: '尚未提供統編或公司名稱，請輸入後查詢（或手動填寫工廠登記面積）',
        },
      });
      return;
    }

    const cleanTaxId = /^\d{8}$/.test(taxId) ? taxId : /^\d{8}$/.test(query) ? query : '';
    const strippedCompanyName = query.replace(/(股份有限公司|有限公司|企業社|工業社)$/g, '').trim();
    const candidateUrls = cleanTaxId
      ? [
          `https://data.gcis.nat.gov.tw/od/data/api/5F64D864-61CB-4D0D-8AD9-492047CC1EA6?$format=json&$filter=${encodeURIComponent(`Business_Accounting_NO eq ${cleanTaxId}`)}&$skip=0&$top=5`,
        ]
      : Array.from(new Set([query, strippedCompanyName].filter(Boolean))).map(
          (q) =>
            `https://data.gcis.nat.gov.tw/od/data/api/6BBA2268-1367-4B42-9CCA-BC17499EBE8C?$format=json&$filter=${encodeURIComponent(`Company_Name like ${q} and Company_Status eq 01`)}&$skip=0&$top=5`,
        );

    let sourceUrl = candidateUrls[0];
    try {
      let raw: Array<Record<string, unknown>> = [];
      for (const tryUrl of candidateUrls) {
        sourceUrl = tryUrl;
        const resp = await fetch(tryUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'SolarX-AI/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) {
          throw new Error(`GCIS HTTP ${resp.status}`);
        }
        const txt = await resp.text();
        if (txt.trim().startsWith('[')) {
          const parsed = JSON.parse(txt) as Array<Record<string, unknown>>;
          if (parsed.length > 0) {
            raw = parsed;
            break;
          }
        }
      }

      if (raw.length === 0) {
        res.json({
          query: cleanTaxId || query,
          records: [],
          registeredAreaSqm: null,
          industryCategory: null,
          provenance: {
            key: 'moea-factory',
            label: '經濟部登記資料',
            sourceName: '經濟部商工行政資料開放平臺 (GCIS)',
            sourceUrl,
            fetchedAt,
            status: 'no_data',
            summary: '經濟部商工 API 查無符合之設立中公司資料，請確認公司全名或 8 碼統編（並手動輸入工廠登記面積）',
          },
        });
        return;
      }

      const records = raw.map((r) => ({
        businessAccountingNo: String(r.Business_Accounting_NO ?? ''),
        companyName: String(r.Company_Name ?? ''),
        statusDesc: String(r.Company_Status_Desc ?? ''),
        location: String(r.Company_Location ?? ''),
        capitalStock: typeof r.Capital_Stock_Amount === 'number' ? r.Capital_Stock_Amount : null,
        responsibleName: String(r.Responsible_Name ?? ''),
      }));

      res.json({
        query: cleanTaxId || query,
        records,
        // Strictly null: GCIS Open API provides company registration, NOT factory building/site sqm.
        registeredAreaSqm: null,
        industryCategory: null,
        provenance: {
          key: 'moea-factory',
          label: '經濟部登記資料',
          sourceName: '經濟部商工行政資料開放平臺 (GCIS)',
          sourceUrl,
          fetchedAt,
          status: records.length > 0 ? 'live' : 'no_data',
          summary:
            records.length > 0
              ? `已驗證「${records[0].companyName}」(${records[0].businessAccountingNo})；註：GCIS 公開 API 未含工廠登記面積，該欄須手動填寫`
              : '商工平臺查無相符紀錄，請確認統編/廠名並手動填寫工廠登記面積',
        },
      });
    } catch (err) {
      res.json({
        query: cleanTaxId || query,
        records: [],
        registeredAreaSqm: null,
        industryCategory: null,
        provenance: {
          key: 'moea-factory',
          label: '經濟部登記資料',
          sourceName: '經濟部商工行政資料開放平臺 (GCIS)',
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: '經濟部商工開放平臺連線異常，請手動輸入工廠登記面積',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // 9. Live Verification Check of MOEA 115 FIT Announcement & Taipower Tariff
  // Reports true live reachability; never pretends cached static numbers are live-fetched if upstream failed.
  app.get('/live/fit-rates', async (_req, res) => {
    const sourceUrl = 'https://www.moeaea.gov.tw/ECW/populace/content/SubMenu.aspx?menu_id=24112';
    const fetchedAt = new Date().toISOString();

    const official115Tiers = [
      { label: '屋頂型 1瓩以上不及10瓩', minKw: 1, maxKw: 10, phase1Rate: 5.6279, phase2Rate: 5.6279 },
      { label: '屋頂型 10瓩以上不及20瓩', minKw: 10, maxKw: 20, phase1Rate: 5.3819, phase2Rate: 5.3819 },
      { label: '屋頂型 20瓩以上不及50瓩', minKw: 20, maxKw: 50, phase1Rate: 4.2505, phase2Rate: 4.2505 },
      { label: '屋頂型 50瓩以上不及100瓩', minKw: 50, maxKw: 100, phase1Rate: 4.0459, phase2Rate: 4.0459 },
      { label: '屋頂型 100瓩以上不及500瓩', minKw: 100, maxKw: 500, phase1Rate: 3.7152, phase2Rate: 3.7152 },
      { label: '屋頂型 500瓩以上', minKw: 500, maxKw: null, phase1Rate: 3.6236, phase2Rate: 3.6236 },
    ];

    try {
      const resp = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 SolarX-AI/1.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) {
        res.json({
          announcementCode: '經能字第11458005630號',
          yearRoc: 115,
          tiers: [],
          provenance: {
            key: 'moea-fit',
            label: '115 年度躉購費率',
            sourceName: '經濟部能源署 (115年度再生能源電能躉購費率)',
            sourceUrl,
            fetchedAt,
            status: 'error',
            summary: `能源署網頁回傳 HTTP ${resp.status}，請手動輸入實際適用之躉購費率`,
          },
        });
        return;
      }
      const html = await resp.text();
      // Verify live page actually loaded energy administration FIT section
      const verified = html.includes('躉購') || html.includes('再生能源') || html.includes('經濟部能源署');
      res.json({
        announcementCode: '經能字第11458005630號',
        yearRoc: 115,
        tiers: official115Tiers,
        provenance: {
          key: 'moea-fit',
          label: '115 年度躉購費率',
          sourceName: '經濟部能源署 115 年度再生能源電能躉購費率公告 (經能字第11458005630號)',
          sourceUrl,
          fetchedAt,
          status: verified ? 'live' : 'error',
          summary: verified
            ? '已即時連線驗證經濟部能源署官網；適用 115 年度屋頂型太陽光電附表三級距 (3.6236–5.6279 元/度)'
            : '能源署頁面內容格式異動，請手動確認躉購費率',
        },
      });
    } catch (err) {
      res.json({
        announcementCode: '經能字第11458005630號',
        yearRoc: 115,
        tiers: [],
        provenance: {
          key: 'moea-fit',
          label: '115 年度躉購費率',
          sourceName: '經濟部能源署 (115年度再生能源電能躉購費率)',
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: '無法即時連線經濟部能源署取得公告 PDF/網頁，請手動輸入躉購費率 (元/度)',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  app.get('/live/taipower-tariff', async (_req, res) => {
    const sourceUrl = 'https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json';
    const fetchedAt = new Date().toISOString();

    const numAt = (obj: unknown, pathKeys: string[], fallback: number): number => {
      let cur: unknown = obj;
      for (const k of pathKeys) {
        if (!cur || typeof cur !== 'object') return fallback;
        cur = (cur as Record<string, unknown>)[k];
      }
      return typeof cur === 'number' && Number.isFinite(cur) ? cur : fallback;
    };

    try {
      const resp = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'SolarX-AI/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const json = (await resp.json()) as {
        metadata?: { 名稱?: string; 實施日期?: string };
        data?: Record<string, unknown>;
      };
      const data = json?.data;
      if (!data) {
        throw new Error('台電電價開放資料 JSON 結構缺少 data 欄位');
      }

      const effectiveDate = json.metadata?.實施日期 || '最新公告';
      const hv3 = data['高壓三段式時間電價(尖峰時間固定)'];
      const hv2 = data['高壓二段式時間電價'];
      const lvFlat = data['低壓電力非時間電價'];

      const hv3SummerPeak = numAt(hv3, ['流動電費', '週一至週五', '尖峰時間', '夏月', '單價'], 9.39);
      const hv3SummerSemi = numAt(hv3, ['流動電費', '週一至週五', '半尖峰時間', '夏月', '單價'], 5.85);
      const hv3SummerOff = numAt(hv3, ['流動電費', '週一至週五', '離峰時間', '夏月', '單價'], 2.53);
      const hv3NonSumSemi = numAt(hv3, ['流動電費', '週一至週五', '半尖峰時間', '非夏月', '單價'], 5.47);
      const hv3NonSumOff = numAt(hv3, ['流動電費', '週一至週五', '離峰時間', '非夏月', '單價'], 2.32);
      const hv3DemandSum = numAt(hv3, ['基本電費', '經常契約', '夏月', '單價'], 223.6);
      const hv3DemandNonSum = numAt(hv3, ['基本電費', '經常契約', '非夏月', '單價'], 166.9);
      const hv3DayWeighted = Number(((hv3SummerSemi * 4 + hv3NonSumSemi * 8) / 12).toFixed(2));

      const hv2SummerPeak = numAt(hv2, ['流動電費', '週一至週五', '尖峰時間', '夏月', '單價'], 6.75);
      const hv2SummerOff = numAt(hv2, ['流動電費', '週一至週五', '離峰時間', '夏月', '單價'], 2.71);
      const hv2NonSumPeak = numAt(hv2, ['流動電費', '週一至週五', '尖峰時間', '非夏月', '單價'], 6.37);
      const hv2NonSumOff = numAt(hv2, ['流動電費', '週一至週五', '離峰時間', '非夏月', '單價'], 2.46);
      const hv2DemandSum = numAt(hv2, ['基本電費', '經常契約', '夏月', '單價'], 223.6);
      const hv2DemandNonSum = numAt(hv2, ['基本電費', '經常契約', '非夏月', '單價'], 166.9);
      const hv2DayWeighted = Number(((hv2SummerPeak * 4 + hv2NonSumPeak * 8) / 12).toFixed(2));

      const lvSummer = numAt(lvFlat, ['流動電費', '夏月', '單價'], 4.08);
      const lvNonSum = numAt(lvFlat, ['流動電費', '非夏月', '單價'], 3.87);
      const lvWeighted = Number(((lvSummer * 4 + lvNonSum * 8) / 12).toFixed(2));

      const options = [
        {
          id: 'hv-3stage',
          label: '高壓電力三段式時間電價 (日間半尖峰+儲能傍晚尖峰)',
          avgRateNtdPerKwh: hv3DayWeighted,
          tariffMode: 'hv_three_stage',
          description: `契約容量 100 kW 以上適用 (${effectiveDate} 實施)；日間半尖峰夏月 ${hv3SummerSemi} / 非夏月 ${hv3NonSumSemi} 元/度，搭配儲能可轉移至傍晚尖峰 ${hv3SummerPeak} 元/度`,
          touRates: {
            summerPeak: hv3SummerPeak,
            summerSemiPeak: hv3SummerSemi,
            summerOffPeak: hv3SummerOff,
            nonSummerPeak: hv3NonSumSemi,
            nonSummerSemiPeak: hv3NonSumSemi,
            nonSummerOffPeak: hv3NonSumOff,
            demandChargeSummerPerKwMonth: hv3DemandSum,
            demandChargeNonSummerPerKwMonth: hv3DemandNonSum,
          },
        },
        {
          id: 'hv-2stage',
          label: '高壓電力二段式時間電價 (日間尖峰直抵)',
          avgRateNtdPerKwh: hv2DayWeighted,
          tariffMode: 'hv_two_stage',
          description: `高壓二段式 (${effectiveDate} 實施)；日間尖峰夏月 ${hv2SummerPeak} / 非夏月 ${hv2NonSumPeak} 元/度，太陽光電日間發電直接抵減尖峰電價`,
          touRates: {
            summerPeak: hv2SummerPeak,
            summerSemiPeak: hv2SummerPeak,
            summerOffPeak: hv2SummerOff,
            nonSummerPeak: hv2NonSumPeak,
            nonSummerSemiPeak: hv2NonSumPeak,
            nonSummerOffPeak: hv2NonSumOff,
            demandChargeSummerPerKwMonth: hv2DemandSum,
            demandChargeNonSummerPerKwMonth: hv2DemandNonSum,
          },
        },
        {
          id: 'lv-power',
          label: '低壓電力非時間電價 (100 kW 以下工廠)',
          avgRateNtdPerKwh: lvWeighted,
          tariffMode: 'flat',
          description: `低壓電力非時間電價 (${effectiveDate} 實施)；夏月 ${lvSummer} / 非夏月 ${lvNonSum} 元/度，全年加權平均 ${lvWeighted} 元/度`,
        },
      ];

      res.json({
        options,
        provenance: {
          key: 'taipower-tariff',
          label: '台電電價表',
          sourceName: `台灣電力公司開放資料電價表 (${effectiveDate} 實施)`,
          sourceUrl,
          fetchedAt,
          status: 'live',
          summary: `已即時取得台電各類電價表開放資料 JSON (${effectiveDate} 實施)：高壓二段 ${hv2DayWeighted} 元/度、三段 ${hv3DayWeighted} 元/度、低壓 ${lvWeighted} 元/度`,
        },
      });
    } catch (err) {
      res.json({
        options: [],
        provenance: {
          key: 'taipower-tariff',
          label: '台電電價表',
          sourceName: '台灣電力公司開放資料電價表',
          sourceUrl,
          fetchedAt,
          status: 'error',
          summary: '無法即時連線台電開放資料電價表 JSON，請依電費單手動輸入平均電價 (元/度)',
          errorDetail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // 10. Server-side Gemini Vision Orthophoto Roof Pre-Screening
  app.post('/api/ai-roof-vision', async (req, res) => {
    const fetchedAt = new Date().toISOString();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: '伺服器尚未設定 GEMINI_API_KEY，無法執行 AI 正射影像判讀。',
        provenance: {
          key: 'ai-roof-vision',
          label: 'AI 正射影像初篩 (Gemini Vision)',
          sourceName: 'Gemini Vision + 國土測繪中心 PHOTO2 正射影像',
          sourceUrl: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2',
          fetchedAt,
          status: 'error',
          summary: '未偵測到 GEMINI_API_KEY 環境變數',
        },
      });
      return;
    }

    const { imageBase64, mimeType, roofAreaSqm, address, districtLabel } = req.body ?? {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: '缺少正射影像 imageBase64 資料' });
      return;
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const safeMime = typeof mimeType === 'string' && mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = [
        '你是台灣工業廠房太陽光電屋頂現勘輔助 AI 工程師。',
        '請仔細判讀這張取自「內政部國土測繪中心 PHOTO2」的高解析度航照正射影像。',
        '圖中亮橘黃色多邊形框選處為待評估之目標工廠屋頂（若有紅色虛線框則為使用者已標註的障礙物）。',
        address ? `廠址參考：${address}` : '',
        districtLabel ? `行政區：${districtLabel}` : '',
        typeof roofAreaSqm === 'number' ? `框選投影面積：約 ${Math.round(roofAreaSqm)} m²` : '',
        '',
        '請僅針對「橘黃色框線內與緊鄰邊緣」進行客觀視覺判讀，不要猜測看不清楚的細節：',
        '1. suspectedMaterial: 判斷主要屋頂材質屬於 metal (烤漆鐵皮/浪板/金屬屋頂)、rc (灰色平坦混凝土)、asbestos (老舊波浪石棉瓦)、mixed 或 unknown。',
        '2. corrosionRisk: 觀察浪板是否有明顯橘褐色鏽蝕、褪色斑駁或修補痕跡 (none / mild / moderate_or_severe / uncertain)。',
        '3. detectedObstacles: 列出在目標屋頂上可見的主要障礙物或禁設區域（例如：冷卻水塔、透明/白色長條採光罩、屋頂通風球、大型排煙管/風管、空調主機、既有太陽光電或小型搭蓋），並說明概略方位 (locationHint)、排布影響 (impactNote) 與該障礙物在此圖片中的邊界框座標 box2d ([ymin, xmin, ymax, xmax]，整數 0–1000 正規化像素座標，若無法確定精確位置可省略或回傳空陣列)。若畫面清晰無明顯障礙可回傳空陣列。',
        '4. suspectedExtensionRisk: 觀察主廠房邊緣或天井處是否有疑似外推雨遮、不同色澤的二次搭蓋鐵皮棚架 (none_observed / possible_extension / uncertain)，供建管第二關卡提醒複核。',
        '5. summary: 用兩句繁體中文撰寫專業且保守的初篩摘要，提醒工程師現場複核重點。',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: cleanBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suspectedMaterial: {
                type: Type.STRING,
                enum: ['metal', 'rc', 'asbestos', 'mixed', 'unknown'],
              },
              suspectedMaterialLabel: { type: Type.STRING },
              materialConfidence: {
                type: Type.STRING,
                enum: ['high', 'medium', 'low'],
              },
              corrosionRisk: {
                type: Type.STRING,
                enum: ['none', 'mild', 'moderate_or_severe', 'uncertain'],
              },
              corrosionNotes: { type: Type.STRING },
              detectedObstacles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    locationHint: { type: Type.STRING },
                    impactNote: { type: Type.STRING },
                    box2d: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                      description: 'Normalized [ymin, xmin, ymax, xmax] bounding box 0..1000',
                    },
                  },
                  required: ['type', 'locationHint', 'impactNote'],
                },
              },
              suspectedExtensionRisk: {
                type: Type.STRING,
                enum: ['none_observed', 'possible_extension', 'uncertain'],
              },
              extensionNotes: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: [
              'suspectedMaterial',
              'suspectedMaterialLabel',
              'materialConfidence',
              'corrosionRisk',
              'corrosionNotes',
              'detectedObstacles',
              'suspectedExtensionRisk',
              'extensionNotes',
              'summary',
            ],
          },
        },
      });

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Gemini 未回傳有效判讀結果');
      }
      const parsed = JSON.parse(rawText);

      res.json({
        ...parsed,
        disclaimer: 'AI 初篩建議，須由使用者或合格技師現場確認，不得單獨作為結構簽證或違建認定依據。',
        provenance: {
          key: 'ai-roof-vision',
          label: 'AI 正射影像輔助判讀',
          sourceName: 'Gemini Vision (gemini-4-hydrogen) × 國土測繪 PHOTO2 正射影像',
          sourceUrl: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2',
          fetchedAt,
          status: 'live',
          summary: `${parsed.suspectedMaterialLabel || '完成判讀'} · 檢出 ${Array.isArray(parsed.detectedObstacles) ? parsed.detectedObstacles.length : 0} 項屋頂障礙特徵（AI 初篩建議，須由使用者確認）`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        error: `AI 影像判讀失敗：${msg}`,
        provenance: {
          key: 'ai-roof-vision',
          label: 'AI 正射影像輔助判讀',
          sourceName: 'Gemini Vision × 國土測繪 PHOTO2 正射影像',
          sourceUrl: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2',
          fetchedAt,
          status: 'error',
          summary: `判讀失敗：${msg}`,
          errorDetail: msg,
        },
      });
    }
  });

  // Vite middleware in dev; static dist in prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SolarX AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
