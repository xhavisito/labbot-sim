// Comparador de dificultades de la IA por lotes: matches de solo IA (sin navegador, con Vite SSR),
// una dificultad por alianza, alternando lados. Reporta victorias, puntos, faltas y RP por dificultad.
//
//   npm run ai-bench -- --a dificil --b facil --matches 6
//   npm run ai-bench -- --all --matches 4     (todas contra todas)
//
// Dificultades: facil | normal | dificil (src/ai/difficulty.ts). No cambia el comportamiento del juego.
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const N = Number(opt('matches', '4'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const bench = await vite.ssrLoadModule('/src/ai/bench.ts');
  const diff = await vite.ssrLoadModule('/src/ai/difficulty.ts');
  const phys = await vite.ssrLoadModule('/src/physics/PhysicsWorld.ts');
  await phys.initRapier();
  const names = Object.keys(diff.DIFFICULTIES);
  const pairs = args.includes('--all')
    ? names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b]))
    : [[opt('a', 'dificil'), opt('b', 'facil')]];
  for (const [a, b] of pairs) {
    if (!diff.isDifficulty(a) || !diff.isDifficulty(b)) throw new Error(`Dificultad desconocida: ${a}/${b} (usa ${names.join(', ')})`);
    const t0 = Date.now();
    const results = bench.runBatch(a, b, N);
    console.log(`\n${a} vs ${b} · ${N} matches (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    results.forEach((r, k) => {
      const [x, y] = r.sides;
      console.log(`  #${k + 1} ${x.difficulty}(${x.alliance}) ${x.points} – ${y.points} ${y.difficulty}(${y.alliance}) · faltas ${x.fouls}/${y.fouls} · RP ${x.rp}/${y.rp}`);
    });
    for (const s of bench.summarize(results))
      console.log(`  ${s.difficulty.padEnd(8)} ${s.wins}/${s.matches} ganados · ${s.avgPoints.toFixed(1)} pts · ${s.avgFouls.toFixed(2)} faltas · ${s.avgRp.toFixed(2)} RP por match`);
  }
} finally {
  await vite.close();
}
