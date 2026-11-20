// Importa robots desde CAD: lee STEP (.step/.stp) y escribe robots/<nombre>.robot.json.
//   npm run robot:import                       → procesa todo lo que haya en robots/inbox/
//   npm run robot:import -- ruta/Robot.step    → un archivo
// Opciones: --floor m --arm-above m --min-diag m --max-tris n (CAD sin nombres de brazo; modelo con todo el detalle)
//           --name N --up x|y|z|auto --forward +x|-z|auto --mechanism generic|elevator|pivot
//           --arm-max-h m (con --arm-parts: solo las piezas con el centro a m del piso o menos; elevador: el carro de abajo y no las piezas del mismo nombre arriba)
//           --rules ruta.json (colores y tope de triángulos por nombre de pieza: [{match, color:[r,g,b], maxTris}]; el STEP no trae colores)
//           --no-model (sin GLB), --arm-parts REGEX (piezas que giran con el brazo), --skip REGEX (piezas que no van al GLB)
//           --mass 38 --set arm.pivotY=0.45 (repetible) --dry (solo imprime)
// Requiere Node ≥ 22.18 (lee los .ts directamente).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseStep } from '../../src/cad/step.ts';
import { analyzeStep } from '../../src/cad/analyze.ts';
import { stepToGlb } from './glb.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opts = {};
const overrides = {};
const files = [];
let dry = false;
let noModel = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry') dry = true;
  else if (a === '--no-model') noModel = true;
  else if (a === '--static') opts.static = true;
  else if (a === '--set') {
    const [k, v] = (args[++i] ?? '').split('=');
    if (!k || Number.isNaN(Number(v))) throw new Error('--set espera ruta=numero');
    overrides[k] = Number(v);
  } else if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = args[++i];
    opts[k === 'mass' ? 'massKg' : k] = ['mass', 'floor', 'arm-above', 'arm-max-h', 'min-diag', 'max-tris'].includes(k) ? Number(v) : v;
  } else files.push(a);
}
if (opts['arm-above'] !== undefined) opts.armAbove = opts['arm-above'];
if (!files.length) {
  const inbox = join(root, 'robots/inbox');
  if (existsSync(inbox)) for (const f of readdirSync(inbox)) if (/\.(step|stp)$/i.test(f)) files.push(join(inbox, f));
}
if (!files.length) {
  console.error('No hay archivos STEP. Pasa una ruta o deja el .step en robots/inbox/.');
  process.exit(1);
}
mkdirSync(join(root, 'robots'), { recursive: true });
for (const f of files) {
  if (!statSync(f).isFile()) throw new Error(`${f} no es un archivo`);
  const model = parseStep(readFileSync(f, 'utf8'));
  const robot = analyzeStep(model, { ...opts, overrides }, basename(f));
  const id = robot.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'robot';
  const { frame, ...out0 } = robot;
  // `--static`: robot sin brazo que gira (la forma completa en el nodo `estatico`; lo que se mueve se define a mano en el JSON)
  if (!noModel && (robot.spec.arm || opts.static)) {
    const armPattern = opts.static ? /^$/ : new RegExp(opts['arm-parts'] ?? '^(Brazo|Garra|Soporte-BrazoGarra|Sprocket|Flecha)', 'i');
    // `--arm-above h`: el brazo son las piezas con el centro a h m del piso o más (mismo criterio que el análisis); `--min-diag` / `--max-tris`: detalle del modelo
    const armAbove = opts['arm-above'];
    const { glb } = await stepToGlb(f, { armAbove, armMaxH: opts['arm-max-h'], minDiag: opts['min-diag'], rules: opts.rules ? JSON.parse(readFileSync(resolve(opts.rules), 'utf8')) : undefined, skip: opts.skip ? new RegExp(opts.skip, 'i') : undefined, maxTrisPerPart: opts['max-tris'], frame, pivot: robot.spec.arm ? [robot.spec.arm.pivotX, robot.spec.arm.pivotY] : [0, 0], armPattern, log: (m) => console.log('  ' + m) });
    mkdirSync(join(root, 'public/robots'), { recursive: true });
    if (!dry) writeFileSync(join(root, `public/robots/${id}.glb`), glb);
    out0.model = { url: `robots/${id}.glb`, stowAngle: robot.spec.arm?.stowAngle, tint: '^Chasis-(Frontal|Trasero)' };
  }
  const out = join(root, 'robots', `${id}.robot.json`);
  const json = JSON.stringify(out0, null, 2) + '\n';
  if (dry) console.log(json);
  else writeFileSync(out, json);
  console.log(`${dry ? '[dry] ' : ''}${f} → robots/${id}.robot.json (${robot.mechanism}, ${model.parts.length} piezas)`);
  for (const s of robot.supuestos) console.log(`  SUPUESTO: ${s}`);
}
