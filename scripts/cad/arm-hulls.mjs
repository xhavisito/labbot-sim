// Cascos convexos del brazo y de la muñeca a partir del GLB del robot (nodo `brazo`), escritos en
// `robots/<nombre>.robot.json` → `model.cadArmHulls` (Mentores 3478, Xhavi 21-nov: "agrégale colisión a todo el robot
// porque algunas cosas traspasan las paredes de scoring").
//
// Uso: node scripts/cad/arm-hulls.mjs mentores-3478
//
// - `arm`: las piezas que no cuelgan de la muñeca (centro antes de `cadWrist.fromX`), sin flechas que cruzan todo el ancho
//   (ya las cubren las placas): un casco en el sistema del nodo `brazo` (origen en el eje del hombro, pose del CAD).
// - `wrist`: un casco por lado (placa triangular, espaciadores y motor), con el origen en el eje de la muñeca. Las piezas del
//   centro (rodillos, engranes) no van: los rodillos ya tienen sus cilindros (`cadRollerCols`) y por el centro pasa la Muestra.
// SUPUESTO: un casco convexo por grupo (el brazo es recto y cada placa es un triángulo).
import fs from 'node:fs';

function readGlb(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  return { j: JSON.parse(b.slice(20, 20 + jl).toString()), bin: b.slice(20 + jl + 8) };
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

// Direcciones de soporte: cada 15° en el plano del brazo (x, y) con z a cada lado, más las 6 de los ejes
const DIRS = [[0, 0, 1], [0, 0, -1]];
for (let k = 0; k < 24; k++) for (const z of [-0.3, 0.3]) DIRS.push([Math.cos((k * Math.PI) / 12), Math.sin((k * Math.PI) / 12), z]);

function hull(pts, ox = 0, oy = 0) {
  const out = new Map();
  for (const d of DIRS) {
    let best = null;
    let bv = -Infinity;
    for (const p of pts) {
      const v = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
      if (v > bv) { bv = v; best = p; }
    }
    const q = [best[0] - ox, best[1] - oy, best[2]].map((x) => Math.round(x * 1000) / 1000);
    out.set(q.join(','), q);
  }
  return [...out.values()].flat();
}

for (const name of process.argv.slice(2)) {
  const jsonPath = `robots/${name}.robot.json`;
  const robot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const w = robot.model.cadWrist;
  if (!w) throw new Error(`${name}: sin model.cadWrist`);
  const glb = readGlb(`public/${robot.model.url}`);
  const { j } = glb;
  const brazo = j.nodes.find((n) => n.name === 'brazo');
  const arm = [];
  const side = { 1: [], [-1]: [] };
  const visit = (ni) => {
    const n = j.nodes[ni];
    if (n.translation || n.rotation || n.scale) throw new Error(`nodo ${n.name} con transformación: no soportado`);
    if (n.mesh !== undefined) {
      const pts = positions(glb, n.mesh);
      const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
      const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
      const c = lo.map((v, k) => (v + hi[k]) / 2);
      const across = hi[2] - lo[2] >= 0.3; // flecha que cruza todo el ancho
      if (!across && c[0] >= w.fromX) {
        if (Math.abs(c[2]) > 0.07) side[Math.sign(c[2])].push(...pts);
      } else if (!across) arm.push(...pts);
    }
    for (const ch of n.children ?? []) visit(ch);
  };
  for (const ch of brazo.children) visit(ch);
  const hulls = { arm: hull(arm), wrist: [hull(side[1], w.axis[0], w.axis[1]), hull(side[-1], w.axis[0], w.axis[1])] };
  // Solo se toca la línea de `cadArmHulls` (el resto del archivo conserva su formato)
  const line = `    "cadArmHulls": { "arm": [${hulls.arm}], "wrist": [${hulls.wrist.map((h) => `[${h}]`).join(', ')}] }`;
  let text = fs.readFileSync(jsonPath, 'utf8').replace(/,\n {4}"cadArmHulls": .*/, '');
  text = text.replace(/("cadWrist": .*)\n/, `$1,\n${line}\n`);
  JSON.parse(text);
  fs.writeFileSync(jsonPath, text);
  robot.model.cadArmHulls = hulls;
  console.log(`${name}: brazo ${robot.model.cadArmHulls.arm.length / 3} puntos, muñeca ${robot.model.cadArmHulls.wrist.map((h) => h.length / 3).join(' + ')}`);
}
