import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Nlsc3dTileRef, OsmBuildingFeature } from '../types/solar';
import { unprojectFromLocalMeters } from './solarEngine';

const gltfLoader = new GLTFLoader();

interface StructuralMetaRow {
  buildName?: string;
  buildType?: string;
  buildH: number | null;
}

export interface ParsedNlscBuildingMesh {
  id: string;
  mesh: THREE.Mesh;
  edgeLines?: THREE.LineSegments;
  texturedMaterial: THREE.Material;
  massingMaterial: THREE.MeshStandardMaterial;
  anchorLat: number;
  anchorLon: number;
  centroidLocal: [number, number]; // [eastM, northM]
  minRawUpM: number;
  maxRawUpM: number;
  feature: OsmBuildingFeature;
}

export interface LoadedNlsc3dSceneData {
  buildings: ParsedNlscBuildingMesh[];
  groundEllipsoidOffsetM: number;
}

function wgs84ToEcef(latDeg: number, lonDeg: number, h = 0): [number, number, number] {
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

function makeEnuFrame(latDeg: number, lonDeg: number) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  return {
    origin: wgs84ToEcef(latDeg, lonDeg, 0),
    east: [-sinLon, cosLon, 0] as [number, number, number],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat] as [number, number, number],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat] as [number, number, number],
  };
}

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

function readGlbStructuralMetadata(buf: ArrayBuffer): StructuralMetaRow[] {
  try {
    const dv = new DataView(buf);
    if (buf.byteLength < 28 || dv.getUint32(0, true) !== 0x46546c67) return [];
    const jsonLen = dv.getUint32(12, true);
    const jsonBytes = new Uint8Array(buf, 20, jsonLen);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes)) as {
      bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
      extensions?: {
        EXT_structural_metadata?: {
          propertyTables?: Array<{
            count: number;
            properties?: Record<string, { values: number; stringOffsets?: number }>;
          }>;
        };
      };
    };

    const binChunkHeaderOffset = 20 + jsonLen;
    if (buf.byteLength < binChunkHeaderOffset + 8) return [];
    const binOffset = binChunkHeaderOffset + 8;

    const pt = json.extensions?.EXT_structural_metadata?.propertyTables?.[0];
    if (!pt || !pt.count || !pt.properties || !json.bufferViews) return [];

    const decoder = new TextDecoder();
    const readStrCol = (propName: string): string[] => {
      const prop = pt.properties?.[propName];
      if (!prop || prop.stringOffsets === undefined) return [];
      const valBv = json.bufferViews?.[prop.values];
      const offBv = json.bufferViews?.[prop.stringOffsets];
      if (!valBv || !offBv) return [];
      const valStart = binOffset + (valBv.byteOffset ?? 0);
      const offStart = binOffset + (offBv.byteOffset ?? 0);
      const valBytes = new Uint8Array(buf, valStart, valBv.byteLength);
      const out: string[] = [];
      for (let i = 0; i < pt.count; i++) {
        const s0 = dv.getUint32(offStart + i * 4, true);
        const s1 = dv.getUint32(offStart + (i + 1) * 4, true);
        out.push(decoder.decode(valBytes.subarray(s0, s1)));
      }
      return out;
    };

    const names = readStrCol('BUILDNAME');
    const types = readStrCol('BUILDTYPE');
    const heights = readStrCol('BUILD_H');

    const rows: StructuralMetaRow[] = [];
    for (let i = 0; i < pt.count; i++) {
      const parsedH = heights[i] ? parseFloat(heights[i]) : NaN;
      rows.push({
        buildName: names[i] && names[i] !== 'NA' ? names[i] : undefined,
        buildType: types[i] && types[i] !== 'NA' ? types[i] : undefined,
        buildH: Number.isFinite(parsedH) && parsedH > 0.3 && parsedH < 600 ? parsedH : null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

async function parseSingleNlscGlb(
  tile: Nlsc3dTileRef,
  anchorLat: number,
  anchorLon: number,
  enu: ReturnType<typeof makeEnuFrame>,
  signal?: AbortSignal,
): Promise<ParsedNlscBuildingMesh[]> {
  const resp = await fetch(tile.proxyUrl, { signal });
  if (!resp.ok) return [];
  const buf = await resp.arrayBuffer();
  const metaRows = readGlbStructuralMetadata(buf);
  const gltf = await gltfLoader.parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);

  const sharedMassingMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });

  const results: ParsedNlscBuildingMesh[] = [];
  const tmpVec = new THREE.Vector3();
  const tmpNorm = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();

  let meshCounter = 0;
  gltf.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
    meshCounter++;
    const srcGeo = obj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.attributes.position;
    if (!posAttr) return;
    const normAttr = srcGeo.attributes.normal;
    const uvAttr = srcGeo.attributes.uv;
    const fidAttr = srcGeo.attributes._feature_id_0;
    const indexAttr = srcGeo.index;

    obj.updateWorldMatrix(true, false);
    normalMat.getNormalMatrix(obj.matrixWorld);

    // Clone source material cleanly so alphaTest / double-side / crisp texture filtering work reliably
    let texMat: THREE.Material;
    const rawMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (rawMat instanceof THREE.MeshStandardMaterial) {
      const cloned = rawMat.clone();
      cloned.transparent = false;
      cloned.alphaTest = 0;
      cloned.side = THREE.DoubleSide;
      cloned.roughness = 0.85;
      cloned.metalness = 0.04;
      if (cloned.map) {
        cloned.map.colorSpace = THREE.SRGBColorSpace;
        cloned.map.anisotropy = 8;
        cloned.map.needsUpdate = true;
      }
      texMat = cloned;
    } else {
      texMat = sharedMassingMat;
    }

    const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
    if (triCount <= 0) return;

    // Group triangles by feature ID so each individual building can be inspected/masked independently
    const byFid = new Map<number, number[]>();
    for (let t = 0; t < triCount; t++) {
      const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
      const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;
      const fid = fidAttr ? Math.round(fidAttr.getX(i0)) : 0;
      let list = byFid.get(fid);
      if (!list) {
        list = [];
        byFid.set(fid, list);
      }
      list.push(i0, i1, i2);
    }

    for (const [fid, indices] of byFid.entries()) {
      const vertCount = indices.length;
      const positions = new Float32Array(vertCount * 3);
      const normals = new Float32Array(vertCount * 3);
      const uvs = uvAttr ? new Float32Array(vertCount * 2) : null;
      const pts2d: [number, number][] = [];

      let minRawUp = Infinity;
      let maxRawUp = -Infinity;
      let sumEast = 0;
      let sumNorth = 0;

      for (let k = 0; k < vertCount; k++) {
        const idx = indices[k];
        tmpVec.fromBufferAttribute(posAttr, idx).applyMatrix4(obj.matrixWorld);
        // glTF Y-up -> ECEF Z-up: ex = x, ey = -z, ez = y
        const ex = tmpVec.x;
        const ey = -tmpVec.z;
        const ez = tmpVec.y;

        const dx = ex - enu.origin[0];
        const dy = ey - enu.origin[1];
        const dz = ez - enu.origin[2];

        const eastM = dx * enu.east[0] + dy * enu.east[1] + dz * enu.east[2];
        const northM = dx * enu.north[0] + dy * enu.north[1] + dz * enu.north[2];
        const upM = dx * enu.up[0] + dy * enu.up[1] + dz * enu.up[2];

        // MapLibre Mercator local axis: X = East, Y = South (-North), Z = Up
        positions[k * 3] = eastM;
        positions[k * 3 + 1] = -northM;
        positions[k * 3 + 2] = upM;

        if (upM < minRawUp) minRawUp = upM;
        if (upM > maxRawUp) maxRawUp = upM;
        sumEast += eastM;
        sumNorth += northM;
        pts2d.push([eastM, northM]);

        if (normAttr) {
          tmpNorm.fromBufferAttribute(normAttr, idx).applyMatrix3(normalMat).normalize();
          const nex = tmpNorm.x;
          const ney = -tmpNorm.z;
          const nez = tmpNorm.y;
          const nEast = nex * enu.east[0] + ney * enu.east[1] + nez * enu.east[2];
          const nNorth = nex * enu.north[0] + ney * enu.north[1] + nez * enu.north[2];
          const nUp = nex * enu.up[0] + ney * enu.up[1] + nez * enu.up[2];
          normals[k * 3] = nEast;
          normals[k * 3 + 1] = -nNorth;
          normals[k * 3 + 2] = nUp;
        }

        if (uvAttr && uvs) {
          uvs[k * 2] = uvAttr.getX(idx);
          uvs[k * 2 + 1] = uvAttr.getY(idx);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      if (normAttr) {
        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      } else {
        geo.computeVertexNormals();
      }
      if (uvs) {
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      }

      const mesh = new THREE.Mesh(geo, texMat);
      mesh.frustumCulled = false;

      const centroidE = sumEast / vertCount;
      const centroidN = sumNorth / vertCount;
      const deltaH = maxRawUp - minRawUp;

      // Reject dummy 2-micron origin placeholder meshes or out-of-range ECEF artifacts
      if (
        !Number.isFinite(minRawUp) ||
        !Number.isFinite(maxRawUp) ||
        Math.abs(minRawUp) > 5000 ||
        Math.hypot(centroidE, centroidN) > 3000 ||
        deltaH < 0.4
      ) {
        continue;
      }

      // Compute 2D footprint convex hull in WGS84 [lon, lat] for shadow projection
      const hullLocal = convexHull2D(pts2d);
      const hullLonLat = hullLocal.map(([eM, nM]) =>
        unprojectFromLocalMeters(eM, nM, anchorLon, anchorLat),
      );
      if (hullLonLat.length < 3) continue;

      const meta = metaRows[fid];
      const officialH = meta?.buildH ?? Number(deltaH.toFixed(2));
      const buildId = `nlsc-3d-${tile.uri}-${meshCounter}-${fid}`;

      results.push({
        id: buildId,
        mesh,
        texturedMaterial: texMat,
        massingMaterial: sharedMassingMat,
        anchorLat,
        anchorLon,
        centroidLocal: [centroidE, centroidN],
        minRawUpM: minRawUp,
        maxRawUpM: maxRawUp,
        feature: {
          id: buildId,
          name: meta?.buildName || (meta?.buildType ? `NLSC 建物 (${meta.buildType})` : '國土測繪中心 3D 建物'),
          coordinates: hullLonLat,
          rawHeightTag: meta?.buildH ? `${meta.buildH}m (NLSC 3D Tiles)` : `${deltaH.toFixed(2)}m (NLSC Mesh)`,
          heightM: officialH,
          levelsTag: null,
          includedInShading: hullLonLat.length >= 3 && officialH > 0.3,
        },
      });
    }
  });

  return results;
}

export async function loadNlsc3dTileBuildings(
  tiles: Nlsc3dTileRef[],
  anchorLat: number,
  anchorLon: number,
  signal?: AbortSignal,
): Promise<LoadedNlsc3dSceneData> {
  if (tiles.length === 0) {
    return { buildings: [], groundEllipsoidOffsetM: 0 };
  }

  const enu = makeEnuFrame(anchorLat, anchorLon);
  const buildings: ParsedNlscBuildingMesh[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const slice = tiles.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      slice.map((tile) => parseSingleNlscGlb(tile, anchorLat, anchorLon, enu, signal)),
    );
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        buildings.push(...res.value);
      }
    }
  }

  if (buildings.length === 0) {
    return { buildings: [], groundEllipsoidOffsetM: 0 };
  }

  // Ground all NLSC 3D buildings cleanly to the local site terrain plane (z = 0 in MapLibre)
  // Use 5th-percentile of near-site bases (<= 140m) to avoid outlier dips skewing the whole block
  const nearBases = buildings
    .filter((b) => Math.hypot(b.centroidLocal[0], b.centroidLocal[1]) <= 140)
    .map((b) => b.minRawUpM);
  const baseCandidates = (nearBases.length > 0 ? nearBases : buildings.map((b) => b.minRawUpM)).sort(
    (a, b) => a - b,
  );
  const p5Idx = Math.min(baseCandidates.length - 1, Math.floor(baseCandidates.length * 0.05));
  const groundEllipsoidOffsetM = baseCandidates[p5Idx];

  const sharedEdgeMat = new THREE.LineBasicMaterial({
    color: '#64748b',
    transparent: true,
    opacity: 0.55,
  });

  for (const b of buildings) {
    const posAttr = b.mesh.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      // Both viewers use a flat ground plane. Preserve the mesh shape while seating its base on that plane.
      posAttr.setZ(i, posAttr.getZ(i) - b.minRawUpM);
    }
    posAttr.needsUpdate = true;
    b.mesh.geometry.computeBoundingSphere();
    b.mesh.geometry.computeBoundingBox();

    // Attach crisp architectural edge contours for white-massing mode
    const edgesGeo = new THREE.EdgesGeometry(b.mesh.geometry, 26);
    const edgeLines = new THREE.LineSegments(edgesGeo, sharedEdgeMat);
    edgeLines.frustumCulled = false;
    b.mesh.add(edgeLines);
    b.edgeLines = edgeLines;

    const relTopM = Math.max(0.5, b.maxRawUpM - b.minRawUpM);
    b.feature.heightM = Number(relTopM.toFixed(2));
  }

  return { buildings, groundEllipsoidOffsetM };
}
