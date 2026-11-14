import * as THREE from 'three';
import type { OsmBuildingFeature, UserEngineeringParams } from '../types/solar';
import type { ParsedNlscBuildingMesh } from './nlsc3dTiles';
import { computePolygonMetrics, pointInPolygon2D, projectToLocalMeters } from './solarEngine';

export interface PanelPlacement3D {
  x: number;
  z: number;
  u: number;
  v: number;
  rowIndex: number;
  shadePct?: number;
}

export function shadePctToColorHex(shadePct: number): string {
  if (shadePct >= 25) return '#dc2626';
  if (shadePct >= 15) return '#f97316';
  if (shadePct >= 10) return '#eab308';
  if (shadePct >= 3) return '#0284c7';
  return '#1e40af';
}

export function createSolarPanelTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Dark-silver anodized aluminum frame border with inner dark gasket bevel
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const pad = 22;
  ctx.fillStyle = '#09162e';
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);

  // Half-cut 6 x 12 monocrystalline PERC / TOPCon cell grid
  const cols = 6;
  const rows = 12;
  const innerW = size - pad * 2;
  const innerH = size - pad * 2;
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  // Back-sheet subtle bright base visible at chamfered diamond corners
  ctx.fillStyle = '#d8e1ec';
  ctx.fillRect(pad + 3, pad + 3, innerW - 6, innerH - 6);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + c * cellW;
      const y = pad + r * cellH;
      const gap = 2.5;
      const cw = cellW - gap * 2;
      const ch = cellH - gap * 2;
      const cx = x + gap;
      const cy = y + gap;
      const chamfer = Math.min(cw, ch) * 0.14;

      // Subtle wafer-to-wafer crystal tone variation
      const shimmer = ((r * 7 + c * 13) % 5) * 3;
      const grad = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch);
      grad.addColorStop(0, `rgb(${15 + shimmer}, ${38 + shimmer}, ${76 + shimmer * 2})`);
      grad.addColorStop(0.5, `rgb(${10 + shimmer}, ${27 + shimmer}, ${58 + shimmer * 2})`);
      grad.addColorStop(1, `rgb(${19 + shimmer}, ${46 + shimmer}, ${90 + shimmer * 2})`);

      ctx.beginPath();
      ctx.moveTo(cx + chamfer, cy);
      ctx.lineTo(cx + cw - chamfer, cy);
      ctx.lineTo(cx + cw, cy + chamfer);
      ctx.lineTo(cx + cw, cy + ch - chamfer);
      ctx.lineTo(cx + cw - chamfer, cy + ch);
      ctx.lineTo(cx + chamfer, cy + ch);
      ctx.lineTo(cx, cy + ch - chamfer);
      ctx.lineTo(cx, cy + chamfer);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Multi-busbar (5 MBB) ultra-fine silver lines
      ctx.fillStyle = 'rgba(226, 232, 240, 0.36)';
      for (let b = 1; b <= 5; b++) {
        ctx.fillRect(cx + (cw * b) / 6, cy + 1, 1.3, ch - 2);
      }
    }
  }

  // Center module split busbar ribbon (characteristic of half-cut modules)
  const midY = pad + innerH / 2;
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(pad, midY - 3, innerW, 6);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createRoofTexture(
  roofType: UserEngineeringParams['roofType'],
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (roofType === 'metal') {
    ctx.fillStyle = '#738296';
    ctx.fillRect(0, 0, size, size);
    const ribW = 16;
    for (let x = 0; x < size; x += ribW) {
      const grad = ctx.createLinearGradient(x, 0, x + ribW, 0);
      grad.addColorStop(0, '#475569');
      grad.addColorStop(0.28, '#a3b1c2');
      grad.addColorStop(0.55, '#6d7d92');
      grad.addColorStop(0.85, '#475569');
      grad.addColorStop(1, '#334155');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, ribW, size);
    }
    // Purlin fastener lines & sheet overlap seams
    for (let y = 0; y < size; y += 128) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
      ctx.fillRect(0, y, size, 2);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.4)';
      for (let x = 8; x < size; x += ribW) {
        ctx.fillRect(x - 1, y + 6, 2, 2);
      }
    }
  } else {
    // Waterproof concrete / light PU roof coating with expansion joints
    ctx.fillStyle = '#a8b0ba';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4500; i++) {
      const rx = (i * 73) % size;
      const ry = (i * 137) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
      ctx.fillRect(rx, ry, 2.5, 2.5);
    }
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.32)';
    ctx.lineWidth = 2;
    for (let g = 0; g <= size; g += 128) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createFacadeTexture(
  roofType: UserEngineeringParams['roofType'],
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (roofType === 'metal') {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, size, size);
    // Vertical architectural insulated steel wall ribs
    for (let x = 0; x < size; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, '#94a3b8');
      g.addColorStop(0.35, '#e2e8f0');
      g.addColorStop(0.75, '#cbd5e1');
      g.addColorStop(1, '#94a3b8');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, size);
    }
    // Horizontal structural girt seams
    ctx.fillStyle = 'rgba(51, 65, 85, 0.25)';
    for (let y = 0; y < size; y += 128) {
      ctx.fillRect(0, y, size, 3);
    }
    // Industrial clerestory daylighting louver band
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.fillRect(0, 64, size, 38);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.35)';
    ctx.fillRect(0, 62, size, 2);
    ctx.fillRect(0, 102, size, 2);
  } else {
    // Precast concrete tilt-up panel pattern
    ctx.fillStyle = '#d6d3d1';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3000; i++) {
      const rx = (i * 97) % size;
      const ry = (i * 193) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(28,25,23,0.04)';
      ctx.fillRect(rx, ry, 2.5, 2.5);
    }
    ctx.strokeStyle = 'rgba(87, 83, 78, 0.3)';
    ctx.lineWidth = 3;
    for (let g = 0; g <= size; g += 128) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.12, 0.12);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createGroundApronTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d8dee6';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const rx = (i * 89) % size;
    const ry = (i * 151) % size;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.045)';
    ctx.fillRect(rx, ry, 2, 2);
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1.5;
  for (let g = 0; g <= size; g += 64) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(size, g);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createCompassRingTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.45;
  const innerR = size * 0.415;

  ctx.clearRect(0, 0, size, size);

  // Subtle compass ring circles
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(100, 116, 139, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.stroke();

  // Degree tick marks around circle (0° = North = -Z in Three.js -> top of texture)
  for (let deg = 0; deg < 360; deg += 15) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const isMajor = deg % 45 === 0;
    const r0 = isMajor ? innerR - 8 : innerR;
    const r1 = outerR;
    ctx.strokeStyle = deg === 0 ? 'rgba(220, 38, 38, 0.85)' : isMajor ? 'rgba(51, 65, 85, 0.65)' : 'rgba(100, 116, 139, 0.38)';
    ctx.lineWidth = isMajor ? 3.5 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
    ctx.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.stroke();
  }

  // Cardinal labels (N / E / S / W)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cardinals: Array<{ label: string; deg: number; color: string }> = [
    { label: 'N 北', deg: 0, color: '#dc2626' },
    { label: 'E 東', deg: 90, color: '#334155' },
    { label: 'S 南', deg: 180, color: '#334155' },
    { label: 'W 西', deg: 270, color: '#334155' },
  ];
  for (const c of cardinals) {
    const rad = ((c.deg - 90) * Math.PI) / 180;
    const lr = outerR + 28;
    ctx.font = c.deg === 0 ? '700 32px sans-serif' : '600 26px sans-serif';
    ctx.fillStyle = c.color;
    ctx.fillText(c.label, cx + Math.cos(rad) * lr, cy + Math.sin(rad) * lr);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function buildFactoryBuildingGroup(opts: {
  roofLocal: [number, number][];
  roofH: number;
  roofType: UserEngineeringParams['roofType'];
  walkwayRows: Array<{ uStart: number; uEnd: number; v: number }>;
  cosYaw: number;
  sinYaw: number;
  maxAniso: number;
  disposables: Array<{ dispose: () => void }>;
}): THREE.Group {
  const { roofLocal, roofH, roofType, walkwayRows, cosYaw, sinYaw, maxAniso, disposables } = opts;
  const factoryGroup = new THREE.Group();

  const buildingShape = new THREE.Shape();
  roofLocal.forEach(([x, y], idx) => {
    if (idx === 0) buildingShape.moveTo(x, y);
    else buildingShape.lineTo(x, y);
  });
  buildingShape.closePath();

  // 1. Concrete Foundation Plinth / Base Curb (y = 0 .. 0.45)
  const plinthShape = new THREE.Shape();
  const cx = roofLocal.reduce((s, p) => s + p[0], 0) / roofLocal.length;
  const cy = roofLocal.reduce((s, p) => s + p[1], 0) / roofLocal.length;
  roofLocal.forEach(([x, y], idx) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ox = x + (dx / len) * 0.35;
    const oy = y + (dy / len) * 0.35;
    if (idx === 0) plinthShape.moveTo(ox, oy);
    else plinthShape.lineTo(ox, oy);
  });
  plinthShape.closePath();
  const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, { depth: 0.42, bevelEnabled: false });
  plinthGeo.rotateX(-Math.PI / 2);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: '#64748b',
    roughness: 0.9,
    metalness: 0.05,
  });
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.castShadow = true;
  plinthMesh.receiveShadow = true;
  factoryGroup.add(plinthMesh);
  disposables.push(plinthGeo, plinthMat);

  // 2. Main Factory Structural Envelope with textured industrial facade
  const facadeTex = createFacadeTexture(roofType, maxAniso);
  const wallGeo = new THREE.ExtrudeGeometry(buildingShape, {
    depth: roofH,
    bevelEnabled: false,
  });
  wallGeo.rotateX(-Math.PI / 2);
  const wallMat = new THREE.MeshStandardMaterial({
    map: facadeTex,
    color: roofType === 'metal' ? '#e2e8f0' : '#e7e5e4',
    roughness: roofType === 'metal' ? 0.52 : 0.85,
    metalness: roofType === 'metal' ? 0.38 : 0.04,
  });
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  factoryGroup.add(wallMesh);
  disposables.push(facadeTex, wallGeo, wallMat);

  // 3. Architectural Corner Steel Columns / Pilasters at perimeter vertices
  const pilasterGeo = new THREE.BoxGeometry(0.36, roofH + 0.05, 0.36);
  const pilasterMat = new THREE.MeshStandardMaterial({
    color: roofType === 'metal' ? '#475569' : '#78716c',
    roughness: 0.48,
    metalness: roofType === 'metal' ? 0.65 : 0.1,
  });
  disposables.push(pilasterGeo, pilasterMat);

  const cornerStep = Math.max(1, Math.floor(roofLocal.length / 28));
  for (let i = 0; i < roofLocal.length; i += cornerStep) {
    const [vx, vy] = roofLocal[i];
    const pilaster = new THREE.Mesh(pilasterGeo, pilasterMat);
    pilaster.position.set(vx, (roofH + 0.05) / 2, -vy);
    pilaster.castShadow = true;
    pilaster.receiveShadow = true;
    factoryGroup.add(pilaster);
  }

  // 4. Roof Deck Surface Cap
  const roofTex = createRoofTexture(roofType, maxAniso);
  const roofCapGeo = new THREE.ShapeGeometry(buildingShape);
  roofCapGeo.rotateX(-Math.PI / 2);
  const uvAttr = roofCapGeo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setXY(i, uvAttr.getX(i) / 14, uvAttr.getY(i) / 14);
  }
  const roofCapMat = new THREE.MeshStandardMaterial({
    map: roofTex,
    roughness: roofType === 'metal' ? 0.4 : 0.82,
    metalness: roofType === 'metal' ? 0.55 : 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roofCapMesh = new THREE.Mesh(roofCapGeo, roofCapMat);
  roofCapMesh.position.y = roofH + 0.03;
  roofCapMesh.receiveShadow = true;
  factoryGroup.add(roofCapMesh);
  disposables.push(roofTex, roofCapGeo, roofCapMat);

  // 5. Perimeter Safety Parapet + Metallic Coping Flashing Trim
  const parapetHeight = roofType === 'metal' ? 0.28 : 0.78;
  const parapetMat = new THREE.MeshStandardMaterial({
    color: roofType === 'metal' ? '#475569' : '#94a3b8',
    roughness: 0.62,
    metalness: roofType === 'metal' ? 0.48 : 0.1,
  });
  const copingMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    roughness: 0.28,
    metalness: 0.8,
  });
  disposables.push(parapetMat, copingMat);

  for (let i = 0; i < roofLocal.length; i++) {
    const [x1, y1] = roofLocal[i];
    const [x2, y2] = roofLocal[(i + 1) % roofLocal.length];
    const segLen = Math.hypot(x2 - x1, y2 - y1);
    if (segLen < 0.25) continue;

    const midX = (x1 + x2) / 2;
    const midZ = -(y1 + y2) / 2;
    const angleY = Math.atan2(-(y2 - y1), x2 - x1);

    const wallSegGeo = new THREE.BoxGeometry(segLen, parapetHeight, 0.24);
    const wallSeg = new THREE.Mesh(wallSegGeo, parapetMat);
    wallSeg.position.set(midX, roofH + parapetHeight / 2, midZ);
    wallSeg.rotation.y = angleY;
    wallSeg.castShadow = true;
    wallSeg.receiveShadow = true;
    factoryGroup.add(wallSeg);

    const copingGeo = new THREE.BoxGeometry(segLen + 0.06, 0.06, 0.3);
    const copingSeg = new THREE.Mesh(copingGeo, copingMat);
    copingSeg.position.set(midX, roofH + parapetHeight + 0.03, midZ);
    copingSeg.rotation.y = angleY;
    copingSeg.castShadow = true;
    factoryGroup.add(copingSeg);

    disposables.push(wallSegGeo, copingGeo);
  }

  // 6. Maintenance Walkway Grating Strips along PV Aisle Rows
  if (walkwayRows.length > 0) {
    const walkwayMat = new THREE.MeshStandardMaterial({
      color: '#eab308',
      roughness: 0.55,
      metalness: 0.25,
    });
    const gratingMat = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.5,
      metalness: 0.65,
    });
    disposables.push(walkwayMat, gratingMat);

    for (const row of walkwayRows) {
      const len = row.uEnd - row.uStart;
      if (len < 1.2) continue;
      const uMid = (row.uStart + row.uEnd) / 2;
      const wx = uMid * cosYaw + row.v * sinYaw;
      const wz = -uMid * sinYaw + row.v * cosYaw;

      const stripGeo = new THREE.BoxGeometry(len, 0.03, 0.52);
      const stripMesh = new THREE.Mesh(stripGeo, gratingMat);
      stripMesh.position.set(wx, roofH + 0.045, wz);
      stripMesh.rotation.y = Math.atan2(sinYaw, cosYaw);
      stripMesh.receiveShadow = true;
      factoryGroup.add(stripMesh);

      const edgeStripGeo = new THREE.BoxGeometry(len, 0.034, 0.06);
      const edgeLeft = new THREE.Mesh(edgeStripGeo, walkwayMat);
      edgeLeft.position.set(wx - sinYaw * 0.27, roofH + 0.046, wz - cosYaw * 0.27);
      edgeLeft.rotation.y = Math.atan2(sinYaw, cosYaw);
      factoryGroup.add(edgeLeft);

      const edgeRight = new THREE.Mesh(edgeStripGeo, walkwayMat);
      edgeRight.position.set(wx + sinYaw * 0.27, roofH + 0.046, wz + cosYaw * 0.27);
      edgeRight.rotation.y = Math.atan2(sinYaw, cosYaw);
      factoryGroup.add(edgeRight);

      disposables.push(stripGeo, edgeStripGeo);
    }
  }

  // 7. Rooftop DC/AC Inverter & Combiner Station (placed inside safe corner of roof)
  const invCandidates = roofLocal.map(([x, y]) => [x * 0.72, y * 0.72] as [number, number]);
  const invPos = invCandidates[0];
  if (invPos && pointInPolygon2D(invPos[0], invPos[1], roofLocal)) {
    const ix = invPos[0];
    const iz = -invPos[1];
    const invGroup = new THREE.Group();
    invGroup.position.set(ix, roofH + 0.03, iz);

    const padGeo = new THREE.BoxGeometry(2.2, 0.14, 1.1);
    const padMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.88 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.07;
    pad.castShadow = true;
    pad.receiveShadow = true;

    const cabGeo = new THREE.BoxGeometry(0.75, 0.95, 0.42);
    const cabMat = new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.35,
      metalness: 0.35,
    });
    const cab1 = new THREE.Mesh(cabGeo, cabMat);
    cab1.position.set(-0.48, 0.64, 0);
    cab1.castShadow = true;
    const cab2 = new THREE.Mesh(cabGeo, cabMat);
    cab2.position.set(0.48, 0.64, 0);
    cab2.castShadow = true;

    const accentGeo = new THREE.BoxGeometry(0.76, 0.09, 0.43);
    const accentMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      roughness: 0.4,
      metalness: 0.2,
    });
    const accent1 = new THREE.Mesh(accentGeo, accentMat);
    accent1.position.set(-0.48, 0.96, 0);
    const accent2 = new THREE.Mesh(accentGeo, accentMat);
    accent2.position.set(0.48, 0.96, 0);

    const conduitGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.6, 8);
    conduitGeo.rotateZ(Math.PI / 2);
    const conduitMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      metalness: 0.82,
      roughness: 0.25,
    });
    const conduit = new THREE.Mesh(conduitGeo, conduitMat);
    conduit.position.set(0, 0.18, 0.32);

    invGroup.add(pad, cab1, cab2, accent1, accent2, conduit);
    factoryGroup.add(invGroup);
    disposables.push(padGeo, padMat, cabGeo, cabMat, accentGeo, accentMat, conduitGeo, conduitMat);
  }

  return factoryGroup;
}

export function buildExclusionObstaclesGroup(opts: {
  exclusionLocals: [number, number][][];
  roofH: number;
  disposables: Array<{ dispose: () => void }>;
}): THREE.Group {
  const { exclusionLocals, roofH, disposables } = opts;
  const obsGroup = new THREE.Group();
  if (exclusionLocals.length === 0) return obsGroup;

  const curbMat = new THREE.MeshStandardMaterial({ color: '#78716c', roughness: 0.88, metalness: 0.05 });
  const housingMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.48, metalness: 0.45 });
  const louverMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.65, metalness: 0.4 });
  const fanBladeMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.6 });
  const skylightMat = new THREE.MeshPhysicalMaterial({
    color: '#bae6fd',
    roughness: 0.28,
    metalness: 0.05,
    transmission: 0.35,
    transparent: true,
    opacity: 0.85,
  });
  const hazardLineMat = new THREE.LineBasicMaterial({ color: '#e11d48', transparent: true, opacity: 0.9 });
  disposables.push(curbMat, housingMat, louverMat, fanBladeMat, skylightMat, hazardLineMat);

  for (const exPts of exclusionLocals) {
    if (exPts.length < 3) continue;

    // 1. Exact crimson perimeter warning outline on roof deck
    const outlinePts = exPts.map(([x, y]) => new THREE.Vector3(x, roofH + 0.055, -y));
    outlinePts.push(outlinePts[0].clone());
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePts);
    obsGroup.add(new THREE.Line(outlineGeo, hazardLineMat));
    disposables.push(outlineGeo);

    // Compute footprint centroid & bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of exPts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const bw = Math.max(0.8, maxX - minX);
    const bd = Math.max(0.8, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cz = -(minY + maxY) / 2;

    // 2. Concrete equipment curb matching actual exclusion polygon
    const obsShape = new THREE.Shape();
    exPts.forEach(([x, y], idx) => {
      if (idx === 0) obsShape.moveTo(x, y);
      else obsShape.lineTo(x, y);
    });
    obsShape.closePath();
    const curbGeo = new THREE.ExtrudeGeometry(obsShape, { depth: 0.18, bevelEnabled: false });
    curbGeo.rotateX(-Math.PI / 2);
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.position.y = roofH + 0.03;
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    obsGroup.add(curbMesh);
    disposables.push(curbGeo);

    const aspect = Math.max(bw, bd) / Math.min(bw, bd);
    const unitW = bw * 0.78;
    const unitD = bd * 0.78;

    if (aspect > 2.2) {
      // Elongated polygon -> Pitched Industrial Skylight / Ridge Vent Assembly
      const domeH = Math.min(0.85, Math.min(bw, bd) * 0.45);
      const domeGeo = new THREE.BoxGeometry(unitW, domeH, unitD);
      const domeMesh = new THREE.Mesh(domeGeo, skylightMat);
      domeMesh.position.set(cx, roofH + 0.21 + domeH / 2, cz);
      domeMesh.castShadow = true;
      obsGroup.add(domeMesh);

      const frameGeo = new THREE.BoxGeometry(unitW + 0.08, 0.08, unitD + 0.08);
      const frameMesh = new THREE.Mesh(frameGeo, housingMat);
      frameMesh.position.set(cx, roofH + 0.25, cz);
      obsGroup.add(frameMesh);
      disposables.push(domeGeo, frameGeo);
    } else {
      // Compact/square polygon -> Louvered Cooling Tower / HVAC Chiller Unit
      const bodyH = Math.min(2.1, Math.max(1.05, Math.min(unitW, unitD) * 0.55));
      const bodyGeo = new THREE.BoxGeometry(unitW, bodyH, unitD);
      const bodyMesh = new THREE.Mesh(bodyGeo, housingMat);
      bodyMesh.position.set(cx, roofH + 0.21 + bodyH / 2, cz);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      obsGroup.add(bodyMesh);

      const louverBandGeo = new THREE.BoxGeometry(unitW + 0.04, bodyH * 0.42, unitD + 0.04);
      const louverBand = new THREE.Mesh(louverBandGeo, louverMat);
      louverBand.position.set(cx, roofH + 0.21 + bodyH * 0.48, cz);
      obsGroup.add(louverBand);

      // Top circular exhaust fan shroud + 4-blade hub
      const shroudR = Math.min(unitW, unitD) * 0.34;
      const shroudGeo = new THREE.CylinderGeometry(shroudR, shroudR * 1.08, 0.28, 20, 1, true);
      const shroud = new THREE.Mesh(shroudGeo, housingMat);
      shroud.position.set(cx, roofH + 0.21 + bodyH + 0.14, cz);
      shroud.castShadow = true;
      obsGroup.add(shroud);

      const hubGeo = new THREE.CylinderGeometry(shroudR * 0.22, shroudR * 0.22, 0.14, 12);
      const hub = new THREE.Mesh(hubGeo, fanBladeMat);
      hub.position.set(cx, roofH + 0.21 + bodyH + 0.1, cz);
      obsGroup.add(hub);

      const bladeGeo = new THREE.BoxGeometry(shroudR * 1.72, 0.03, shroudR * 0.22);
      const bladeA = new THREE.Mesh(bladeGeo, fanBladeMat);
      bladeA.position.set(cx, roofH + 0.21 + bodyH + 0.1, cz);
      const bladeB = new THREE.Mesh(bladeGeo, fanBladeMat);
      bladeB.position.set(cx, roofH + 0.21 + bodyH + 0.1, cz);
      bladeB.rotation.y = Math.PI / 2;
      obsGroup.add(bladeA, bladeB);

      disposables.push(bodyGeo, louverBandGeo, shroudGeo, hubGeo, bladeGeo);
    }
  }

  return obsGroup;
}

export function buildSolarArrayGroup(opts: {
  panelPositions: PanelPlacement3D[];
  modW: number;
  modL: number;
  tiltRad: number;
  yawRad: number;
  roofH: number;
  maxAniso: number;
  showShadingHeatmap?: boolean;
  disposables: Array<{ dispose: () => void }>;
}): { group: THREE.Group; setHeatmapMode: (enabled: boolean) => void } {
  const {
    panelPositions,
    modW,
    modL,
    tiltRad,
    yawRad,
    roofH,
    maxAniso,
    showShadingHeatmap = false,
    disposables,
  } = opts;
  const arrayGroup = new THREE.Group();
  const count = panelPositions.length;
  if (count === 0) {
    return { group: arrayGroup, setHeatmapMode: () => {} };
  }

  const frontClearance = 0.22;
  const mountY = roofH + frontClearance + (modL / 2) * Math.sin(tiltRad);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  const cosTilt = Math.cos(tiltRad);
  const sinTilt = Math.sin(tiltRad);

  // 1. Monocrystalline Silicon Laminate Face + Shading Heatmap Material
  const panelTex = createSolarPanelTexture(maxAniso);
  const glassGeo = new THREE.BoxGeometry(modW - 0.04, 0.022, modL - 0.04);
  const glassMat = new THREE.MeshPhysicalMaterial({
    map: panelTex,
    roughness: 0.14,
    metalness: 0.18,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
  });
  const heatmapMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.36,
    metalness: 0.08,
  });
  const glassInstanced = new THREE.InstancedMesh(
    glassGeo,
    showShadingHeatmap ? heatmapMat : glassMat,
    count,
  );
  glassInstanced.castShadow = true;
  glassInstanced.receiveShadow = true;

  // 2. Anodized Aluminum Perimeter Frame Backing
  const frameGeo = new THREE.BoxGeometry(modW, 0.04, modL);
  const frameMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    metalness: 0.82,
    roughness: 0.26,
  });
  const frameInstanced = new THREE.InstancedMesh(frameGeo, frameMat, count);
  frameInstanced.castShadow = true;
  frameInstanced.receiveShadow = true;

  // 3. Dual Front/Rear Aluminum Mounting Legs + Horizontal C-Channel Purlins
  const railMat = new THREE.MeshStandardMaterial({
    color: '#94a3b8',
    metalness: 0.8,
    roughness: 0.28,
  });

  const vArm = modL * 0.34;
  const frontLegH = Math.max(0.12, mountY - vArm * sinTilt - roofH - 0.02);
  const rearLegH = Math.max(0.16, mountY + vArm * sinTilt - roofH - 0.02);

  const frontLegGeo = new THREE.BoxGeometry(0.055, frontLegH, 0.055);
  const rearLegGeo = new THREE.BoxGeometry(0.055, rearLegH, 0.055);
  const purlinGeo = new THREE.BoxGeometry(modW + 0.05, 0.045, 0.055);

  const frontLegInst = new THREE.InstancedMesh(frontLegGeo, railMat, count);
  const rearLegInst = new THREE.InstancedMesh(rearLegGeo, railMat, count);
  const purlinInst = new THREE.InstancedMesh(purlinGeo, railMat, count * 2);
  frontLegInst.castShadow = true;
  rearLegInst.castShadow = true;
  purlinInst.castShadow = true;

  const dummy = new THREE.Object3D();
  const legDummy = new THREE.Object3D();
  const purlinDummy = new THREE.Object3D();
  const cellTint = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const p = panelPositions[i];

    // Laminate glass slightly proud of frame backing
    dummy.position.set(p.x, mountY + 0.012, p.z);
    dummy.rotation.set(0, yawRad, 0);
    dummy.rotateX(tiltRad);
    dummy.updateMatrix();
    glassInstanced.setMatrixAt(i, dummy.matrix);

    // Subtle realistic wafer batch tint variation OR heatmap color
    if (showShadingHeatmap) {
      cellTint.set(shadePctToColorHex(p.shadePct ?? 0));
    } else {
      const tone = 0.95 + ((i * 17 + p.rowIndex * 31) % 7) * 0.01;
      cellTint.setRGB(tone * 0.97, tone * 0.99, tone);
    }
    glassInstanced.setColorAt(i, cellTint);

    // Frame backing flush below glass
    dummy.position.set(p.x, mountY - 0.008, p.z);
    dummy.updateMatrix();
    frameInstanced.setMatrixAt(i, dummy.matrix);

    // Front short support post (+vArm along local Z)
    const vFootFront = vArm * cosTilt;
    legDummy.position.set(
      p.x + vFootFront * sinYaw,
      roofH + frontLegH / 2,
      p.z + vFootFront * cosYaw,
    );
    legDummy.rotation.set(0, yawRad, 0);
    legDummy.updateMatrix();
    frontLegInst.setMatrixAt(i, legDummy.matrix);

    // Rear tall support post (-vArm along local Z)
    const vFootRear = -vArm * cosTilt;
    legDummy.position.set(
      p.x + vFootRear * sinYaw,
      roofH + rearLegH / 2,
      p.z + vFootRear * cosYaw,
    );
    legDummy.updateMatrix();
    rearLegInst.setMatrixAt(i, legDummy.matrix);

    // Two continuous horizontal C-channel rails right beneath panel clamping zones
    const yFrontRail = mountY - vArm * sinTilt - 0.04;
    purlinDummy.position.set(p.x + vFootFront * sinYaw, yFrontRail, p.z + vFootFront * cosYaw);
    purlinDummy.rotation.set(0, yawRad, 0);
    purlinDummy.rotateX(tiltRad);
    purlinDummy.updateMatrix();
    purlinInst.setMatrixAt(i * 2, purlinDummy.matrix);

    const yRearRail = mountY + vArm * sinTilt - 0.04;
    purlinDummy.position.set(p.x + vFootRear * sinYaw, yRearRail, p.z + vFootRear * cosYaw);
    purlinDummy.updateMatrix();
    purlinInst.setMatrixAt(i * 2 + 1, purlinDummy.matrix);
  }

  glassInstanced.instanceMatrix.needsUpdate = true;
  if (glassInstanced.instanceColor) glassInstanced.instanceColor.needsUpdate = true;
  glassInstanced.computeBoundingSphere();

  frameInstanced.instanceMatrix.needsUpdate = true;
  frameInstanced.computeBoundingSphere();

  frontLegInst.instanceMatrix.needsUpdate = true;
  frontLegInst.computeBoundingSphere();
  rearLegInst.instanceMatrix.needsUpdate = true;
  rearLegInst.computeBoundingSphere();
  purlinInst.instanceMatrix.needsUpdate = true;
  purlinInst.computeBoundingSphere();

  arrayGroup.add(glassInstanced, frameInstanced, frontLegInst, rearLegInst, purlinInst);
  disposables.push(
    panelTex,
    glassGeo,
    glassMat,
    heatmapMat,
    frameGeo,
    frameMat,
    frontLegGeo,
    rearLegGeo,
    purlinGeo,
    railMat,
  );

  const setHeatmapMode = (enabled: boolean) => {
    glassInstanced.material = enabled ? heatmapMat : glassMat;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const p = panelPositions[i];
      if (enabled) {
        c.set(shadePctToColorHex(p.shadePct ?? 0));
      } else {
        const tone = 0.95 + ((i * 17 + p.rowIndex * 31) % 7) * 0.01;
        c.setRGB(tone * 0.97, tone * 0.99, tone);
      }
      glassInstanced.setColorAt(i, c);
    }
    if (glassInstanced.instanceColor) glassInstanced.instanceColor.needsUpdate = true;
  };

  return { group: arrayGroup, setHeatmapMode };
}

export interface NlscContextMeshEntry {
  mesh: THREE.Mesh;
  texturedMaterial: THREE.Material;
  massingMaterial: THREE.Material;
  edgeLines: THREE.LineSegments;
}

export function buildNlscContextGroup(opts: {
  nlsc3dBuildings: ParsedNlscBuildingMesh[];
  roofPolygon: [number, number][];
  cLon: number;
  cLat: number;
  contextStyle: 'massing' | 'textured';
  disposables: Array<{ dispose: () => void }>;
}): { group: THREE.Group; renderedIds: Set<string>; entries: NlscContextMeshEntry[] } {
  const { nlsc3dBuildings, roofPolygon, cLon, cLat, contextStyle, disposables } = opts;
  const group = new THREE.Group();
  const renderedIds = new Set<string>();
  const entries: NlscContextMeshEntry[] = [];
  if (nlsc3dBuildings.length === 0) return { group, renderedIds, entries };

  const roofArea = roofPolygon.length >= 3 ? computePolygonMetrics(roofPolygon).areaSqm : 0;
  const massingMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: '#64748b',
    transparent: true,
    opacity: 0.42,
  });
  disposables.push(massingMat, edgeMat);

  // Cache anchor offsets by anchor coordinate
  const anchorOffsetCache = new Map<string, [number, number]>();

  for (const b of nlsc3dBuildings) {
    // Skip target factory building itself so it doesn't overlap our detailed rooftop PV building
    if (roofPolygon.length >= 3 && b.feature.coordinates.length >= 3) {
      const bLocal = b.feature.coordinates.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat));
      if (pointInPolygon2D(0, 0, bLocal)) {
        const nlscArea = computePolygonMetrics(b.feature.coordinates).areaSqm;
        if (roofArea > 0 && nlscArea <= roofArea * 2.2) {
          continue;
        }
      }
    }

    const aKey = `${b.anchorLon.toFixed(6)},${b.anchorLat.toFixed(6)}`;
    let offset = anchorOffsetCache.get(aKey);
    if (!offset) {
      offset = projectToLocalMeters(cLon, cLat, b.anchorLon, b.anchorLat);
      anchorOffsetCache.set(aKey, offset);
    }
    const [offsetE, offsetN] = offset;

    // Clone geometry & map from MapLibre (X=East, Y=-North, Z=Up) to Three.js (X=East, Y=Up, Z=-North)
    // Swapping Y<->Z restores original right-handed glTF triangle winding order!
    const geo = b.mesh.geometry.clone();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const xMl = pos.getX(i);
      const yMl = pos.getY(i);
      const zMl = pos.getZ(i);
      pos.setXYZ(i, xMl - offsetE, zMl, yMl + offsetN);
    }
    pos.needsUpdate = true;

    const norm = geo.attributes.normal;
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        const nx = norm.getX(i);
        const ny = norm.getY(i);
        const nz = norm.getZ(i);
        norm.setXYZ(i, nx, nz, ny);
      }
      norm.needsUpdate = true;
    } else {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = contextStyle === 'textured' ? b.texturedMaterial : massingMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const eGeo = new THREE.EdgesGeometry(geo, 26);
    const eLines = new THREE.LineSegments(eGeo, edgeMat);
    eLines.visible = contextStyle === 'massing';
    group.add(eLines);

    disposables.push(geo, eGeo);
    renderedIds.add(b.id);
    entries.push({
      mesh,
      texturedMaterial: b.texturedMaterial,
      massingMaterial: massingMat,
      edgeLines: eLines,
    });
  }

  return { group, renderedIds, entries };
}

export function buildOsmFallbackGroup(opts: {
  osmBuildings: OsmBuildingFeature[];
  skipIds: Set<string>;
  cLon: number;
  cLat: number;
  disposables: Array<{ dispose: () => void }>;
}): THREE.Group {
  const { osmBuildings, skipIds, cLon, cLat, disposables } = opts;
  const group = new THREE.Group();

  const neighborMat = new THREE.MeshStandardMaterial({
    color: '#94a3b8',
    roughness: 0.76,
    metalness: 0.1,
  });
  const outlineMat = new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.65 });
  disposables.push(neighborMat, outlineMat);

  for (const b of osmBuildings) {
    if (skipIds.has(b.id) || b.coordinates.length < 3) continue;
    const bLocal = b.coordinates.map(([lon, lat]) => projectToLocalMeters(lon, lat, cLon, cLat));
    if (pointInPolygon2D(0, 0, bLocal)) continue;

    if (b.heightM !== null && b.heightM > 0) {
      const bShape = new THREE.Shape();
      bLocal.forEach(([x, y], idx) => {
        if (idx === 0) bShape.moveTo(x, y);
        else bShape.lineTo(x, y);
      });
      bShape.closePath();
      const bGeo = new THREE.ExtrudeGeometry(bShape, { depth: b.heightM, bevelEnabled: false });
      bGeo.rotateX(-Math.PI / 2);
      const bMesh = new THREE.Mesh(bGeo, neighborMat);
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;
      group.add(bMesh);
      disposables.push(bGeo);
    } else {
      // Zero-fabrication: unheighted OSM footprints remain flat outlines
      const pts = bLocal.map(([x, y]) => new THREE.Vector3(x, 0.08, -y));
      pts.push(pts[0].clone());
      const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(lineGeo, outlineMat));
      disposables.push(lineGeo);
    }
  }

  return group;
}
