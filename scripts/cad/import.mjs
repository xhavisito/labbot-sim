// Importa robots desde CAD: lee STEP (.step/.stp) y escribe robots/<nombre>.robot.json.
//   npm run robot:import                       → procesa todo lo que haya en robots/inbox/
//   npm run robot:import -- ruta/Robot.step    → un archivo
// Opciones: --name N --up x|y|z|auto --forward +x|-z|auto --mechanism generic|elevator|pivot
//           --mass 38 --set arm.pivotY=0.45 (repetible) --dry (solo imprime)
// Requiere Node ≥ 22.18 (lee los .ts directamente).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseStep } from '../../src/cad/step.ts';
import { analyzeStep } from '../../src/cad/analyze.ts';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const opts = {};
const overrides = {};
const files = [];
let dry = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry') dry = true;
  else if (a === '--set') {
    const [k, v] = (args[++i] ?? '').split('=');
    if (!k || Number.isNaN(Number(v))) throw new Error('--set espera ruta=numero');
    overrides[k] = Number(v);
  } else if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = args[++i];
    opts[k === 'mass' ? 'massKg' : k] = k === 'mass' ? Number(v) : v;
  } else files.push(a);
}
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
  const out = join(root, 'robots', `${id}.robot.json`);
  const json = JSON.stringify(robot, null, 2) + '\n';
  if (dry) console.log(json);
  else writeFileSync(out, json);
  console.log(`${dry ? '[dry] ' : ''}${f} → robots/${id}.robot.json (${robot.mechanism}, ${model.parts.length} piezas)`);
  for (const s of robot.supuestos) console.log(`  SUPUESTO: ${s}`);
}
