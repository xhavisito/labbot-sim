// Arena de la IA: matches con los robots CAD del juego (src/sim/arena.ts), sin navegador.
//
//   npm run arena -- --scenario shipped:new --seeds 40     como el juego: tu alianza (IA Experto
//                                                          de piloto) contra rivales secretos
//   npm run arena -- --scenario mirror:new --seeds 40      los 4 iguales: debe salir parejo
//   npm run arena -- --scenario vs:new:old --seeds 40      IA nueva contra la anterior (lados cruzados)
//   npm run arena -- --scenario vs:new:old:normal          … en otra dificultad
//
// Imprime victorias, puntos y faltas por alianza y por IA; guarda los matches en JSON (--out).
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
  const arena = await server.ssrLoadModule('/src/sim/arena.ts');
  const impls = await server.ssrLoadModule('/src/sim/arenaBots.ts');
  const { initRapier } = await server.ssrLoadModule('/src/physics/PhysicsWorld.ts');
  await initRapier();
  return { server, arena, impls };
}

if (process.env.ARENA_WORKER) {
  const { server, arena, impls } = await load();
  process.on('message', async (jobs) => {
    for (const j of jobs) process.send(arena.runArena(j.scenario, j.seed, impls.botFactory));
    await server.close();
    process.exit(0);
  });
  process.send('ready');
} else {
  const scenario = opt('scenario', 'shipped:new');
  const seeds = Number(opt('seeds', '20'));
  const from = Number(opt('from', '1'));
  const workers = Number(opt('workers', String(Math.max(1, cpus().length))));
  const out = opt('out', 'arena-results.json');
  const jobs = Array.from({ length: seeds }, (_, k) => ({ scenario, seed: from + k }));
  console.log(`${jobs.length} matches (${scenario}) en ${workers} procesos…`);
  const t0 = Date.now();
  const results = [];
  const chunks = Array.from({ length: workers }, (_, w) => jobs.filter((_, k) => k % workers === w)).filter((c) => c.length);
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise((resolve, reject) => {
          const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, ARENA_WORKER: '1' } });
          child.on('message', (m) => {
            if (m === 'ready') child.send(chunk);
            else {
              results.push(m);
              process.stdout.write('.');
            }
          });
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`proceso terminó con ${code}`))));
        }),
    ),
  );
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
  results.sort((a, b) => a.seed - b.seed);
  writeFileSync(out, JSON.stringify(results, null, 1));

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const f1 = (x) => x.toFixed(1);
  // Por lado
  for (const side of ['red', 'blue']) {
    const r = results.map((m) => m[side]);
    console.log(`${side.padEnd(5)} gana ${f1(100 * avg(r.map((x) => x.win)))}%  pts ${f1(avg(r.map((x) => x.total)))}  propios ${f1(avg(r.map((x) => x.own)))}  muestras ${f1(avg(r.map((x) => x.samples)))}  faltas regaladas ${f1(avg(r.map((x) => x.penaltiesOut)))}  RP ${f1(avg(r.map((x) => x.rp)))}`);
  }
  // Por IA (en vs:)
  if (scenario.startsWith('vs:')) {
    const [, a, b] = scenario.split(':');
    for (const impl of [a, b]) {
      const al = results.map((m) => (m.red.robots[0].impl === impl ? m.red : m.blue));
      console.log(`IA ${impl.padEnd(4)} gana ${f1(100 * avg(al.map((x) => x.win)))}%  pts ${f1(avg(al.map((x) => x.total)))}  propios ${f1(avg(al.map((x) => x.own)))}  muestras ${f1(avg(al.map((x) => x.samples)))}  faltas regaladas ${f1(avg(al.map((x) => x.penaltiesOut)))}  RP ${f1(avg(al.map((x) => x.rp)))}`);
    }
  }
  // Por tipo de robot
  const byType = new Map();
  for (const m of results)
    for (const s of ['red', 'blue'])
      for (const r of m[s].robots) {
        const k = `${r.impl}:${r.type}`;
        if (!byType.has(k)) byType.set(k, []);
        byType.get(k).push(r);
      }
  for (const [k, rs] of [...byType].sort()) {
    const modes = {};
    for (const r of rs) for (const [mo, t] of Object.entries(r.modes)) modes[mo] = (modes[mo] ?? 0) + t / rs.length;
    console.log(`  ${k.padEnd(22)} pts ${f1(avg(rs.map((r) => r.points))).padStart(5)}  muestras ${f1(avg(rs.map((r) => r.samples)))}  plat ${Math.round(100 * avg(rs.map((r) => +r.platform)))}%  crit ${Math.round(100 * avg(rs.map((r) => +r.critical)))}%  faltas ${f1(avg(rs.map((r) => r.foulPts)))}  atorado ${f1(avg(rs.map((r) => r.stuck)))}s  ${Object.entries(modes).map(([a, b]) => `${a} ${b.toFixed(0)}`).join(' ')}`);
  }
  // Faltas por regla (por IA)
  const rules = new Map();
  for (const m of results)
    for (const s of ['red', 'blue'])
      for (const r of m[s].robots)
        for (const f of r.fouls ?? []) {
          const k = `${r.impl}:${f.split('@')[0]}`;
          rules.set(k, (rules.get(k) ?? 0) + 1);
        }
  if (rules.size) console.log(`  faltas por match: ${[...rules].sort().map(([k, n]) => `${k} ${(n / results.length).toFixed(2)}`).join('  ')}`);
}
