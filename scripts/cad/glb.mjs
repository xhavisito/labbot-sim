// STEP → GLB con la forma real del robot (triangula con occt-import-js, WASM de OpenCascade).
// Lo que sale ya está en el sistema del robot (m, x al frente, y arriba desde el piso, z lateral) y en dos
// nodos: "estatico" y "brazo" (este último con origen en el eje del pivote, para girarlo ahí).
import { readFileSync } from 'node:fs';
import occtimport from 'occt-import-js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Reduce una malla por agrupación de vértices en una rejilla; normales suaves recalculadas. */
function cluster(pos, idx, cell) {
  const key = new Map();
  const outPos = [];
  const counts = [];
  const map = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] / cell)},${Math.round(pos[i * 3 + 1] / cell)},${Math.round(pos[i * 3 + 2] / cell)}`;
    let j = key.get(k);
    if (j === undefined) {
      j = outPos.length / 3;
      key.set(k, j);
      outPos.push(0, 0, 0);
      counts.push(0);
    }
    for (let a = 0; a < 3; a++) outPos[j * 3 + a] += pos[i * 3 + a];
    counts[j]++;
    map[i] = j;
  }
  for (let j = 0; j < counts.length; j++) for (let a = 0; a < 3; a++) outPos[j * 3 + a] /= counts[j];
  const outIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
  }
  return { pos: outPos, idx: outIdx };
}

function normals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] += f[k];
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    for (let k = 0; k < 3; k++) n[i + k] /= l;
  }
  return n;
}

/**
 * @param {string} stepPath
 * @param {{frame:{ex:number[],ey:number[],ez:number[],origin:number[]}, pivot:[number,number], armPattern:RegExp, minDiag?:number, maxTrisPerPart?:number, log?:(s:string)=>void}} o
 * `frame` y `pivot` en metros (como en el JSON del robot).
 */
export async function stepToGlb(stepPath, o) {
  const log = o.log ?? (() => {});
  const occt = await occtimport();
  const r = occt.ReadStepFile(new Uint8Array(readFileSync(stepPath)), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.5 });
  if (!r.success) throw new Error('occt-import-js no pudo leer el STEP');
  const names = [];
  (function walk(n) {
    for (const m of n.meshes ?? []) names[m] = n.name;
    for (const c of n.children ?? []) walk(c);
  })(r.root);

  const { ex, ey, ez, origin } = o.frame;
  const minDiag = o.minDiag ?? 0.035;
  const maxTris = o.maxTrisPerPart ?? 2500;
  const mats = new Map();
  const matOf = (c) => {
    // El gris azulado por defecto de SolidWorks (0.59, 0.64, 0.85) se vuelve gris claro neutro
    const isDefault = c && Math.abs(c[0] - 0.59) < 0.02 && Math.abs(c[1] - 0.64) < 0.02 && Math.abs(c[2] - 0.855) < 0.02;
    const col = c && !isDefault ? c.map((v) => Math.round(v * 255) / 255) : [0.78, 0.79, 0.8];
    const k = col.join(',');
    if (!mats.has(k)) mats.set(k, mats.size);
    return mats.get(k);
  };
  const parts = [];
  r.meshes.forEach((m, i) => {
    const src = m.attributes.position.array;
    const pos = new Float32Array(src.length);
    // mm del CAD → m del robot
    for (let v = 0; v < src.length; v += 3) {
      const p = [src[v] / 1000 - origin[0], src[v + 1] / 1000 - origin[1], src[v + 2] / 1000 - origin[2]];
      pos[v] = dot(p, ex);
      pos[v + 1] = dot(p, ey);
      pos[v + 2] = dot(p, ez);
    }
    let idx = Array.from(m.index.array);
    let posA = Array.from(pos);
    // Normales de OpenCascade (por cara, sin mezclar caras vecinas), giradas al sistema del robot
    let nrmA = null;
    if (m.attributes.normal) {
      const sn = m.attributes.normal.array;
      nrmA = new Float32Array(sn.length);
      for (let v = 0; v < sn.length; v += 3) {
        const q = [sn[v], sn[v + 1], sn[v + 2]];
        nrmA[v] = dot(q, ex);
        nrmA[v + 1] = dot(q, ey);
        nrmA[v + 2] = dot(q, ez);
      }
    }
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let v = 0; v < pos.length; v += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[v + a]); mx[a] = Math.max(mx[a], pos[v + a]); }
    const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    const isArm = o.armPattern.test(names[i]);
    if (diag < minDiag && !isArm) return; // tornillos, rondanas…
    // Las placas (estructura) no se simplifican: con huecos se deforman; solo motores, engranes y demás
    const structural = /^(chasis|pivote|brazo|garra|soporte|flecha)/i.test(names[i]);
    if (!structural && idx.length / 3 > maxTris) {
      let cell = diag / 40;
      for (let k = 0; k < 12; k++) {
        const c = cluster(posA, idx, cell);
        if (c.idx.length / 3 <= maxTris) { posA = c.pos; idx = c.idx; nrmA = null; break; }
        cell *= 1.35;
      }
    }
    parts.push({ name: names[i], arm: isArm, nrm: nrmA, pos: Float32Array.from(posA), idx, mat: matOf(m.color), tris: idx.length / 3, mn, mx });
  });

  // El brazo se guarda con el origen en el pivote
  const [px, py] = o.pivot;
  for (const p of parts) if (p.arm) for (let v = 0; v < p.pos.length; v += 3) { p.pos[v] -= px; p.pos[v + 1] -= py; }

  // --- glTF binario ---
  const chunks = [];
  let off = 0;
  const views = [], accessors = [], meshes = [], nodes = [];
  const push = (typed, target) => {
    const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (b.length % 4)) % 4;
    chunks.push(b, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
    off += b.length + pad;
    return views.length - 1;
  };
  const roots = { estatico: [], brazo: [] };
  for (const p of parts) {
    const nrm = p.nrm ?? normals(p.pos, p.idx);
    const vmn = [1e9, 1e9, 1e9], vmx = [-1e9, -1e9, -1e9];
    for (let v = 0; v < p.pos.length; v += 3) for (let a = 0; a < 3; a++) { vmn[a] = Math.min(vmn[a], p.pos[v + a]); vmx[a] = Math.max(vmx[a], p.pos[v + a]); }
    const big = p.pos.length / 3 > 65535;
    const ia = accessors.length;
    accessors.push({ bufferView: push(big ? Uint32Array.from(p.idx) : Uint16Array.from(p.idx), 34963), componentType: big ? 5125 : 5123, count: p.idx.length, type: 'SCALAR' });
    const pa = accessors.length;
    accessors.push({ bufferView: push(p.pos, 34962), componentType: 5126, count: p.pos.length / 3, type: 'VEC3', min: vmn, max: vmx });
    const na = accessors.length;
    accessors.push({ bufferView: push(nrm, 34962), componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: pa, NORMAL: na }, indices: ia, material: p.mat }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
    roots[p.arm ? 'brazo' : 'estatico'].push(nodes.length - 1);
  }
  const nStatic = nodes.length;
  nodes.push({ name: 'estatico', children: roots.estatico });
  nodes.push({ name: 'brazo', translation: [px, py, 0], children: roots.brazo });
  const materials = [...mats.keys()].map((k) => ({ pbrMetallicRoughness: { baseColorFactor: [...k.split(',').map(Number), 1], metallicFactor: 0.1, roughnessFactor: 0.6 }, doubleSided: true }));
  const json = { asset: { version: '2.0', generator: 'labbot-sim cad import' }, scene: 0, scenes: [{ nodes: [nStatic, nStatic + 1] }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: off }] };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('glTF', 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const h1 = Buffer.alloc(8); h1.writeUInt32LE(js.length, 0); h1.write('JSON', 4);
  const h2 = Buffer.alloc(8); h2.writeUInt32LE(bin.length, 0); h2.write('BIN\0', 4);
  const tris = parts.reduce((a, p) => a + p.tris, 0);
  log(`GLB: ${parts.length} piezas, ${tris} triángulos, ${((12 + 16 + js.length + bin.length) / 1e6).toFixed(1)} MB`);
  return { glb: Buffer.concat([head, h1, js, h2, bin]), parts: parts.map((p) => ({ name: p.name, arm: p.arm, tris: p.tris })), tris };
}
