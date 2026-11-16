// Axiom: modelo 3D APROXIMADO hecho a mano con cajas y cilindros (SUPUESTO).
// Sale de 4 capturas de SolidWorks y de las medidas que dio Xhavi (16-nov), no del CAD: se reemplaza
// con `npm run robot:import` cuando llegue el STEP de Axiom.
// Uso: node scripts/axiom/approx-model.mjs   → public/robots/axiom.glb
// Unidades en m, x al frente, y arriba desde el piso. Nodos `estatico` y `brazo` (origen en el pivote, pose de guardado).
import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../../robots/axiom.robot.json', import.meta.url), 'utf8')).spec;
const { pivotX: PX, pivotY: PY, length: L } = spec.arm;
const S = (131 * Math.PI) / 180; // pose de guardado del preset de pivote (stowAngle del JSON)
const W = spec.width, HL = spec.length / 2;

const GREY = [0.62, 0.64, 0.67], DARK = [0.12, 0.12, 0.13], AL = [0.78, 0.8, 0.82], BLACK = [0.05, 0.05, 0.06], GOLD = [0.75, 0.62, 0.2];
const parts = [];
const mats = [];
const matOf = (c) => { let i = mats.findIndex((m) => m.join() === c.join()); if (i < 0) { mats.push(c); i = mats.length - 1; } return i; };

function addMesh(name, arm, color, pos, idx) { parts.push({ name, arm, mat: matOf(color), pos: Float32Array.from(pos), idx: Uint32Array.from(idx) }); }

/** Caja con centro c y medidas d; `xf` transforma cada vértice (para el brazo, que va girado). */
function box(name, arm, color, c, d, xf = (p) => p) {
  const [hx, hy, hz] = d.map((v) => v / 2);
  const pos = [], idx = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map((k) => c[k] + (n[k] * [hx, hy, hz][k]) + u[k] * a * [hx, hy, hz][k] + v[k] * b * [hx, hy, hz][k]);
      pos.push(...xf(p));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  addMesh(name, arm, color, pos, idx);
}

/** Cilindro de radio r y largo len con centro c y eje 'x' | 'y' | 'z'. */
function cyl(name, arm, color, c, r, len, axis, xf = (p) => p, seg = 20) {
  const pos = [], idx = [];
  const map = (a, b, h) => (axis === 'x' ? [h, a, b] : axis === 'y' ? [a, h, b] : [a, b, h]);
  const ring = (h) => Array.from({ length: seg }, (_, i) => map(Math.cos((2 * Math.PI * i) / seg) * r, Math.sin((2 * Math.PI * i) / seg) * r, h));
  for (const s of [-1, 1]) { pos.push(...[...ring(s * len / 2)].flat()); }
  // lados
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; idx.push(i, j, seg + i, j, seg + j, seg + i); }
  // tapas
  const cA = pos.length / 3; pos.push(...map(0, 0, -len / 2)); const cB = cA + 1; pos.push(...map(0, 0, len / 2));
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; idx.push(cA, j, i, cB, seg + i, seg + j); }
  const out = [];
  for (let v = 0; v < pos.length; v += 3) out.push(...xf([pos[v] + c[0], pos[v + 1] + c[1], pos[v + 2] + c[2]]));
  addMesh(name, arm, color, out, idx);
}

// ---------- Chasis (estático) ----------
// SUPUESTO (fotos): dos placas por lado, la de atrás alta (ahí va el eje del brazo) y la de adelante baja; el perfil real es inclinado
for (const s of [1, -1]) {
  for (const [tag, z] of [['Ext', 0.318], ['Int', 0.252]]) {
    box(`Placa-${tag}-Trasera-${s}`, false, GREY, [-0.16, 0.34, s * z], [0.24, 0.58, 0.007]);
    box(`Placa-${tag}-Frontal-${s}`, false, GREY, [0.14, 0.17, s * z], [0.28, 0.24, 0.007]);
  }
  for (const y of [0.1, 0.45]) box(`Separador-${s}-${y}`, false, AL, [-0.16, y, s * 0.285], [0.05, 0.03, 0.06]);
  // dos motores grandes por costado, al frente (fotos); SUPUESTO: cilindros de 6.6 cm × 15 cm
  for (const z of [0.115, 0.185]) cyl(`Motor-${s}-${z}`, false, BLACK, [0.14, 0.115, s * z], 0.033, 0.16, 'x');
  // engranes del eje del brazo, afuera de las placas
  cyl(`Engrane-${s}`, false, AL, [PX, PY, s * 0.33], 0.05, 0.008, 'z', (p) => p, 28);
}
box('Chasis-Frontal', false, GREY, [HL - 0.01, 0.13, 0], [0.02, 0.14, W - 0.06]);
box('Chasis-Trasero', false, GREY, [-HL + 0.01, 0.13, 0], [0.02, 0.14, W - 0.06]);
box('Bellypan', false, DARK, [0, 0.045, 0], [2 * HL - 0.04, 0.008, W - 0.14]);
box('Control', false, DARK, [-0.02, 0.12, 0], [0.16, 0.05, 0.13]); // SUPUESTO: controlador al centro (foto frontal)
box('Bateria', false, DARK, [-0.19, 0.1, 0], [0.09, 0.07, 0.17]); // SUPUESTO: posición
cyl('Eje-Pivote', false, AL, [PX, PY, 0], 0.009, W - 0.04, 'z');
for (const s of [1, -1]) box(`Soporte-Pivote-${s}`, false, GREY, [PX, PY - 0.05, s * 0.27], [0.1, 0.1, 0.012]);

// ---------- Brazo (origen en el pivote, girado a la pose de guardado S) ----------
const c = Math.cos(S), sn = Math.sin(S);
const rot = (p) => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c, p[2]];
// En el sistema del brazo el eje va en el origen; el brazo recto parte de (0,0) a (L,0)
const A = (name, color, x, y, z, dx, dy, dz) => box(name, true, color, [x, y, z], [dx, dy, dz], rot);
for (const s of [1, -1]) A(`Brazo-Barra-${s}`, GREY, L / 2, 0, s * 0.085, L, 0.05, 0.012);
A('Brazo-Placa', GREY, L * 0.62, 0, 0, L * 0.5, 0.012, 0.17); // placa ancha del centro (fotos)
A('Brazo-Travesaño', AL, L - 0.01, 0, 0, 0.012, 0.05, 0.19);
for (const s of [1, -1]) cyl(`Brazo-Engrane-${s}`, true, GOLD, [0, 0, s * 0.095], 0.045, 0.01, 'z', rot, 28);

// ---------- glTF binario ----------
const chunks = []; let off = 0; const views = [], accessors = [], meshes = [], nodes = [];
const push = (typed, target) => { const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); const pad = (4 - (b.length % 4)) % 4; chunks.push(b, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) }); off += b.length + pad; return views.length - 1; };
const normals = (pos, idx) => { const n = new Float32Array(pos.length); for (let t = 0; t < idx.length; t += 3) { const [a, b, d] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3]; const u = [0, 1, 2].map((k) => pos[b + k] - pos[a + k]), v = [0, 1, 2].map((k) => pos[d + k] - pos[a + k]); const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...f) || 1; for (const i of [a, b, d]) for (let k = 0; k < 3; k++) n[i + k] += f[k] / l; } for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } return n; };
const roots = { estatico: [], brazo: [] };
for (const p of parts) {
  const nrm = normals(p.pos, p.idx);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let v = 0; v < p.pos.length; v += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p.pos[v + a]); mx[a] = Math.max(mx[a], p.pos[v + a]); }
  const ia = accessors.length; accessors.push({ bufferView: push(p.idx, 34963), componentType: 5125, count: p.idx.length, type: 'SCALAR' });
  const pa = accessors.length; accessors.push({ bufferView: push(p.pos, 34962), componentType: 5126, count: p.pos.length / 3, type: 'VEC3', min: mn, max: mx });
  const na = accessors.length; accessors.push({ bufferView: push(nrm, 34962), componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
  meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: pa, NORMAL: na }, indices: ia, material: p.mat }] });
  nodes.push({ name: p.name, mesh: meshes.length - 1 });
  roots[p.arm ? 'brazo' : 'estatico'].push(nodes.length - 1);
}
const nStatic = nodes.length;
nodes.push({ name: 'estatico', children: roots.estatico });
nodes.push({ name: 'brazo', translation: [PX, PY, 0], children: roots.brazo });
const materials = mats.map((k) => ({ pbrMetallicRoughness: { baseColorFactor: [...k, 1], metallicFactor: 0.1, roughnessFactor: 0.6 }, doubleSided: true }));
const json = { asset: { version: '2.0', generator: 'labbot-sim axiom approx' }, scene: 0, scenes: [{ nodes: [nStatic, nStatic + 1] }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: off }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const h1 = Buffer.alloc(8); h1.writeUInt32LE(js.length, 0); h1.write('JSON', 4);
const h2 = Buffer.alloc(8); h2.writeUInt32LE(bin.length, 0); h2.write('BIN\0', 4);
const out = new URL('../../public/robots/axiom.glb', import.meta.url);
writeFileSync(out, Buffer.concat([head, h1, js, h2, bin]));
console.log(`axiom.glb: ${parts.length} piezas (${(12 + 16 + js.length + bin.length) / 1000 | 0} kB)`);
