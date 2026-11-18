// Simulación por lotes: matches de solo IA entre estrategias de alianza (src/sim/batch.ts), sin
// navegador. Carga el código TypeScript con el SSR de Vite y reparte los matches en procesos.
//
//   npm run batch                                  todos contra todos, 1 semilla, ambos lados
//   npm run batch -- --plans pivn3+pivn3,p180n3+p180n3 --seeds 3
//   npm run batch -- --vs pivn3+pivn3            cada estrategia contra una referencia
//   npm run batch -- --workers 4 --out batch.json
//   npm run batch -- --set mech                    los dos pivotes con hopper y sus papeles (sin el bloqueo)
//   npm run batch -- --set ai --a hard --b normal  IA difícil contra normal, alianzas de los dos tipos
//   npm run batch -- --set ai --a hard --b normal --tweak '{"hard":{"batch":3}}'   prueba una variante del perfil
//
// Imprime una tabla por estrategia (promedios) y guarda todos los matches en JSON.
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

async function load() {
  const server = await createServer({ logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  const batch = await server.ssrLoadModule('/src/sim/batch.ts');
  const { initRapier } = await server.ssrLoadModule('/src/physics/PhysicsWorld.ts');
  await initRapier();
  // --tweak: cambia campos del perfil de una dificultad (`ai/difficulty.ts`) solo en esta corrida
  const tweak = JSON.parse(process.env.BATCH_TWEAK ?? '{}');
  const { AI_PROFILES } = await server.ssrLoadModule('/src/ai/difficulty.ts');
  for (const [level, t] of Object.entries(tweak)) Object.assign(AI_PROFILES[level], t);
  return { server, batch };
}

if (process.env.BATCH_WORKER) {
  // Proceso hijo: recibe la lista de matches, los corre y manda cada resultado
  const { server, batch } = await load();
  const byId = new Map(Object.values(batch.PLAN_SETS).flat().map((p) => [p.id, p]));
  process.on('message', async (jobs) => {
    for (const j of jobs) process.send(batch.runMatch(byId.get(j.red), byId.get(j.blue), j.seed));
    await server.close();
    process.exit(0);
  });
  process.send('ready');
} else {
  const { server, batch } = await load();
  const all = batch.PLAN_SETS[opt('set', 'all')];
  if (!all) throw new Error(`--set desconocido; usa: ${Object.keys(batch.PLAN_SETS).join(', ')}`);
  await server.close();
  const pick = opt('plans');
  const plans = pick ? all.filter((p) => pick.split(',').includes(p.id)) : all;
  const vs = opt('vs');
  const seeds = Number(opt('seeds', '1'));
  const workers = Number(opt('workers', String(Math.max(1, cpus().length))));
  const out = opt('out', 'batch-results.json');
  if (opt('tweak')) process.env.BATCH_TWEAK = opt('tweak');

  const jobs = [];
  // --a <versión> --b <versión>: cada alianza "<a>:…" contra cada "<b>:…" (conjunto `ai`)
  const A = opt('a');
  const B = opt('b');
  for (let s = 1; s <= seeds; s++) {
    if (A && B) {
      for (const p of plans.filter((x) => x.id.startsWith(`${A}:`)))
        for (const q of plans.filter((x) => x.id.startsWith(`${B}:`))) jobs.push({ red: p.id, blue: q.id, seed: s }, { red: q.id, blue: p.id, seed: s });
    } else if (vs) for (const p of plans) jobs.push({ red: p.id, blue: vs, seed: s }, { red: vs, blue: p.id, seed: s });
    else
      for (let i = 0; i < plans.length; i++)
        for (let j = i + 1; j < plans.length; j++) jobs.push({ red: plans[i].id, blue: plans[j].id, seed: s }, { red: plans[j].id, blue: plans[i].id, seed: s });
  }
  console.log(`${jobs.length} matches en ${workers} procesos…`);
  const t0 = Date.now();
  const results = [];
  const chunks = Array.from({ length: workers }, (_, w) => jobs.filter((_, k) => k % workers === w)).filter((c) => c.length);
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((resolve, reject) => {
          const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, BATCH_WORKER: '1' } });
          child.on('message', (m) => {
            if (m === 'ready') child.send(chunk);
            else {
              results.push(m);
              if (results.length % 10 === 0) console.log(`  ${results.length}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
            }
          });
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`proceso salió con ${code}`))));
        }),
    ),
  );
  writeFileSync(out, JSON.stringify({ seeds, vs: vs ?? null, plans: plans.map((p) => ({ id: p.id, name: p.name, robots: p.robots.map((r) => r.id) })), robotPlans: Object.fromEntries(plans.flatMap((p) => p.robots.map((r) => [r.id, { name: r.name, type: r.spec.mechanism }]))), results }, null, 1));

  // Promedios por estrategia
  const rows = new Map();
  for (const r of results)
    for (const a of [r.red, r.blue]) {
      if (vs && a.plan === vs && plans.every((p) => p.id !== vs)) continue;
      const s = rows.get(a.plan) ?? { n: 0, total: 0, own: 0, samples: 0, rp: 0, win: 0, crit: 0, dom: 0, plat: 0, auto: 0, foulsOut: 0, stuck: 0, push: 0, pushMax: 0 };
      s.n++;
      s.stuck += a.robots.reduce((x, r) => x + (r.stuck ?? 0), 0) / 2;
      s.push += a.robots.reduce((x, r) => x + (r.pushing ?? 0), 0) / 2;
      s.pushMax += Math.max(...a.robots.map((r) => r.pushMax ?? 0));
      s.total += a.total;
      s.own += a.own;
      s.samples += a.samples;
      s.rp += a.rp;
      s.win += a.win;
      s.crit += a.rpCritical ? 1 : 0;
      s.dom += a.rpDominance ? 1 : 0;
      s.plat += a.platform;
      s.auto += a.auto;
      s.foulsOut += a.penaltiesOut;
      rows.set(a.plan, s);
    }
  const f = (v, n, d = 1) => (v / n).toFixed(d);
  const table = [...rows].map(([id, s]) => ({
    estrategia: id,
    matches: s.n,
    puntos: f(s.total, s.n),
    propios: f(s.own, s.n),
    auto: f(s.auto, s.n),
    muestras: f(s.samples, s.n),
    plataforma: f(s.plat, s.n),
    'critica%': f(100 * s.crit, s.n, 0),
    'dominio%': f(100 * s.dom, s.n, 0),
    'faltas(pts)': f(s.foulsOut, s.n),
    'atorado(s)': f(s.stuck, s.n),
    'empuja(s)': f(s.push, s.n),
    'empujón máx(s)': f(s.pushMax, s.n),
    RP: f(s.rp, s.n, 2),
    'gana%': f(100 * s.win, s.n, 0),
  }));
  table.sort((a, b) => b.RP - a.RP || b.puntos - a.puntos);
  console.table(table);
  if (A && B) {
    // Resumen por versión de la IA
    const byV = new Map();
    for (const [id, s] of rows) {
      const v = id.split(':')[0];
      const t = byV.get(v) ?? { n: 0, total: 0, own: 0, samples: 0, rp: 0, win: 0, crit: 0, dom: 0, plat: 0, auto: 0, foulsOut: 0, stuck: 0, push: 0, pushMax: 0 };
      for (const k of Object.keys(t)) t[k] += s[k];
      byV.set(v, t);
    }
    console.table([...byV].map(([v, s]) => ({ ia: v, matches: s.n, puntos: f(s.total, s.n), propios: f(s.own, s.n), auto: f(s.auto, s.n), muestras: f(s.samples, s.n), plataforma: f(s.plat, s.n), 'critica%': f(100 * s.crit, s.n, 0), 'dominio%': f(100 * s.dom, s.n, 0), 'faltas(pts)': f(s.foulsOut, s.n), 'atorado(s)': f(s.stuck, s.n), 'empuja(s)': f(s.push, s.n), 'empujón máx(s)': f(s.pushMax, s.n), RP: f(s.rp, s.n, 2), 'gana%': f(100 * s.win, s.n, 0) })));
  }
  console.log(`Listo en ${Math.round((Date.now() - t0) / 1000)} s; resultados en ${out}`);
}
