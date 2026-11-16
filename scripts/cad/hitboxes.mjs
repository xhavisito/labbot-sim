// Hitbox por pieza a partir del GLB del robot: un casco convexo (pocos puntos) por cada pieza física del
// nodo `estatico`, escrito en `robots/<nombre>.robot.json` → `spec.hitboxes`.
//
// Uso: node scripts/cad/hitboxes.mjs phoenix [psycho ...]
//
// Reglas (SUPUESTOS de diseño, el CAD no dice qué es "físico"):
//  - Se saltan las llantas de tracción, sus bujes y poleas (la física de las ruedas son los cilindros de `spec.wheel`).
//  - Se saltan las piezas que ya caben enteras en una caja de `spec.footprint` (el chasis bajo ya las cubre).
//  - Las placas más delgadas de 1 cm se engrosan a 1 cm (grosor mínimo: una Muestra rápida no las atraviesa).
//  - Cada casco se guarda como ≤26 puntos de soporte (mm); Rapier calcula el casco al crear el colisionador.
import fs from 'node:fs';

const SKIP = /higrip|hex hub|pulley|polea/i;
const MIN_T = 0.01;
const SKIP_DIAG = 0.02;

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jl).toString());
  const bin = b.slice(20 + jl + 8);
  return { j, bin };
}

function positions({ j, bin }, meshIdx) {
  const pts = [];
  for (const prim of j.meshes[meshIdx].primitives) {
    const acc = j.accessors[prim.attributes.POSITION];
    const bv = j.bufferViews[acc.bufferView];
    const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = bv.byteStride ?? 12;
    if (acc.componentType !== 5126) throw new Error('POSITION debe ser float32');
    for (let i = 0; i < acc.count; i++) pts.push([bin.readFloatLE(off + i * stride), bin.readFloatLE(off + i * stride + 4), bin.readFloatLE(off + i * stride + 8)]);
  }
  return pts;
}

const DIRS = (() => {
  const d = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) d.push([x, y, z]);
  return d;
})();

/** Eje de menor extensión (PCA por iteración de potencias sobre la covarianza). Devuelve [normal, grosor]. */
function thinAxis(pts) {
  const n = pts.length;
  const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  // Deflación: dos ejes mayores, el tercero es la normal
  const power = (M, seed) => {
    let v = seed;
    for (let i = 0; i < 60; i++) {
      const w = [0, 1, 2].map((a) => M[a][0] * v[0] + M[a][1] * v[1] + M[a][2] * v[2]);
      const l = Math.hypot(...w) || 1;
      v = w.map((x) => x / l);
    }
    return v;
  };
  const v1 = power(C, [1, 0.3, 0.1]);
  const l1 = [0, 1, 2].reduce((s, a) => s + v1[a] * (C[a][0] * v1[0] + C[a][1] * v1[1] + C[a][2] * v1[2]), 0);
  const C2 = C.map((r, a) => r.map((x, b) => x - l1 * v1[a] * v1[b]));
  const v2 = power(C2, [0.2, 1, 0.3]);
  let nrm = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
  const nl = Math.hypot(...nrm) || 1;
  nrm = nrm.map((x) => x / nl);
  const proj = pts.map((p) => p[0] * nrm[0] + p[1] * nrm[1] + p[2] * nrm[2]);
  return [nrm, Math.max(...proj) - Math.min(...proj)];
}

function hullPoints(pts) {
  const out = new Map();
  const add = (p) => out.set(p.map((x) => Math.round(x * 1000)).join(','), p.map((x) => Math.round(x * 1000) / 1000));
  for (const d of DIRS) {
    let best = null;
    let bv = -Infinity;
    for (const p of pts) {
      const v = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
      if (v > bv) { bv = v; best = p; }
    }
    add(best);
  }
  let list = [...out.values()];
  const [nrm, t] = thinAxis(list.length >= 4 ? pts : list);
  if (t < MIN_T) {
    const e = (MIN_T - t) / 2;
    list = list.flatMap((p) => [p.map((x, k) => x + nrm[k] * e), p.map((x, k) => x - nrm[k] * e)]);
    const m = new Map();
    for (const p of list) m.set(p.map((x) => Math.round(x * 1000)).join(','), p.map((x) => Math.round(x * 1000) / 1000));
    list = [...m.values()];
  }
  return list;
}

for (const name of process.argv.slice(2)) {
  const jsonPath = `robots/${name}.robot.json`;
  const robot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const glb = readGlb(`public/${robot.model.url}`);
  const { j } = glb;
  const root = j.nodes.find((n) => n.name === 'estatico');
  const fp = robot.spec.footprint ?? [];
  const hit = [];
  let skipped = { name: 0, small: 0, inside: 0 };
  for (const ci of root.children) {
    const n = j.nodes[ci];
    if (n.mesh === undefined) continue;
    if (n.translation || n.rotation || n.scale) throw new Error(`nodo ${n.name} con transformación: no soportado`);
    if (SKIP.test(n.name)) { skipped.name++; continue; }
    const pts = positions(glb, n.mesh);
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    if (Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < SKIP_DIAG) { skipped.small++; continue; }
    // Dentro del chasis bajo (alto 0.235 m, `CHASSIS_TOP` de RobotPhysics) y de una caja de la huella
    if (hi[1] <= 0.235 && fp.some(([x0, x1, z0, z1]) => lo[0] >= x0 - 1e-3 && hi[0] <= x1 + 1e-3 && lo[2] >= z0 - 1e-3 && hi[2] <= z1 + 1e-3)) { skipped.inside++; continue; }
    hit.push({ name: n.name, pts: hullPoints(pts).flat() });
  }
  robot.spec.hitboxes = hit;
  robot.supuestos = (robot.supuestos ?? []).filter((s) => !s.startsWith('HITBOX'));
  robot.supuestos.push(
    'HITBOX: un casco convexo por pieza del CAD (ver spec.hitboxes), de ≤26 puntos y grosor mínimo de 1 cm; sin llantas de tracción (cilindros de spec.wheel) ni piezas dentro del chasis bajo; densidad 0 (no mueven el centro de masa). Qué es "físico" es SUPUESTO',
  );
  const text = JSON.stringify(robot, null, 2).replace(/"pts": \[([^\]]*)\]/g, (_, a) => `"pts": [${a.replace(/\s+/g, '')}]`);
  fs.writeFileSync(jsonPath, text + '\n');
  console.log(`${name}: ${hit.length} hitboxes (saltadas: ${JSON.stringify(skipped)})`);
}
