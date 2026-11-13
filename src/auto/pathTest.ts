/**
 * Probar una rutina dibujada contra la IA (§4.2, §4.4): corre sin dibujar los 15 s de AUTO de un
 * match completo de 2 contra 2 —tu robot con la rutina, tu compañero y los rivales con la IA— y
 * cuenta los puntos de AUTO, la Línea de Autónomo y las faltas de cada alianza. Varias semillas
 * (el azar de la física y de la IA) dan una idea de qué tan repetible es.
 * SUPUESTO: la IA rival y tu compañero usan "Anotar y recolectar" en AUTO y tu mismo tipo de robot.
 */
import { ROBOT_PRESETS, type RobotSpec } from '../config/robot';
import { clampSpot } from '../config/startSpot';
import type { AutoPath } from '../core/autoPath';
import { GameSession, PHYSICS_HZ } from '../game/GameSession';
import { pathRoutine } from '../game/autoPathStore';
import { COLLECT_HOME, type AutoRoutine } from './AutoRoutine';

export interface VsAiRun {
  seed: number;
  /** Puntos de AUTO (Línea + Muestras) de tu alianza y de la rival. */
  mine: number;
  rival: number;
  /** Tu robot salió de su Zona de Inicio en AUTO. */
  line: boolean;
  /** Muestras de tu alianza en AUTO. */
  samples: number;
  /** Faltas que cometió tu alianza en AUTO. */
  fouls: number;
}

export interface VsAiSummary {
  runs: VsAiRun[];
  avgMine: number;
  avgRival: number;
  wins: number;
  ties: number;
  lineRate: number;
  avgFouls: number;
}

export const AUTO_RUN_STEPS = 15 * PHYSICS_HZ + 2;

/** Un AUTO de match con la rutina en el robot `player` (0–3) contra la IA. */
export function runVsAi(path: AutoPath, spec: RobotSpec, seed: number, player = path.station, rival: AutoRoutine = COLLECT_HOME): VsAiRun {
  const routine = pathRoutine(path);
  const specs = [0, 1, 2, 3].map((i) => (i === player ? spec : ROBOT_PRESETS.pivot));
  const s = new GameSession({
    player,
    preload: true,
    ai: true,
    specs,
    autos: [0, 1, 2, 3].map((i) => (i === player ? routine : rival)),
    starts: [0, 1, 2, 3].map((i) => (i === player ? clampSpot(spec.length, spec.width, path.start) : undefined)),
    hp: { enabled: true, interval: 3 },
    seed,
  });
  try {
    s.startMatch();
    const m = s.match!;
    for (let i = 0; i < AUTO_RUN_STEPS; i++) s.step();
    const a = s.robots[player].alliance;
    const b = a === 'red' ? 'blue' : 'red';
    const mine = m.breakdown(a);
    return {
      seed,
      mine: mine.auto,
      rival: m.breakdown(b).auto,
      line: m.state[a].autoLine.has(player),
      samples: m.state[a].samples.filter((x) => x.period === 'AUTO').length,
      fouls: m.fouls.filter((f) => f.offender === a).length,
    };
  } finally {
    s.dispose();
  }
}

export function summarizeVsAi(runs: VsAiRun[]): VsAiSummary {
  const n = Math.max(1, runs.length);
  const sum = (f: (r: VsAiRun) => number) => runs.reduce((x, r) => x + f(r), 0);
  return {
    runs,
    avgMine: sum((r) => r.mine) / n,
    avgRival: sum((r) => r.rival) / n,
    wins: runs.filter((r) => r.mine > r.rival).length,
    ties: runs.filter((r) => r.mine === r.rival).length,
    lineRate: runs.filter((r) => r.line).length / n,
    avgFouls: sum((r) => r.fouls) / n,
  };
}

/** Corre `seeds` AUTOs cediendo el hilo entre corridas para no congelar la pantalla. */
export async function testVsAi(path: AutoPath, spec: RobotSpec, seeds: number, onProgress?: (f: number) => void, cancelled = () => false): Promise<VsAiSummary> {
  const runs: VsAiRun[] = [];
  for (let k = 0; k < seeds && !cancelled(); k++) {
    await new Promise((r) => setTimeout(r, 0));
    runs.push(runVsAi(path, spec, k + 1));
    onProgress?.(runs.length / seeds);
  }
  return summarizeVsAi(runs);
}
