/**
 * Comparación de score para el editor de robot: matches de solo IA de una alianza de dos robots
 * iguales (el tuyo, o uno de referencia) contra la misma alianza rival, con varias semillas.
 * Corre en el navegador por partes (cede el hilo cada tantos pasos) para no congelar la pantalla.
 *
 * Igual que `batch.ts`, la IA maneja "perfecto" dentro de sus límites: sirve para comparar robots
 * entre sí, no como pronóstico de puntos.
 */
import type { BotOptions } from '../ai/Bot';
import { COLLECT_HOME } from '../auto/AutoRoutine';
import type { RobotSpec } from '../config/robot';
import { GameSession } from '../game/GameSession';
import { rng } from './batch';

export interface CompareSide {
  spec: RobotSpec;
  bot: Partial<BotOptions>;
}

export interface CompareResult {
  matches: number;
  /** Promedios de la alianza: total, puntos propios (sin faltas del rival), Muestras, RP; y victorias (0–1). */
  total: number;
  own: number;
  samples: number;
  rp: number;
  winRate: number;
  rival: number;
}

/** Cómo juega la IA un robot: a su nivel máximo y a la Plataforma; el chasis solo se estaciona. */
export const botFor = (s: RobotSpec): Partial<BotOptions> => (s.mechanism === 'chassis' ? { role: 'park' } : { level: s.maxLevel ?? 3, endgame: 'platform' });

const STEPS = 152 * 120;
const SLICE = 1500;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Juega `n` matches de `side` × 2 (rojo) contra `rival` × 2 (azul). `onProgress` recibe 0–1. */
export async function compareAlliance(side: CompareSide, rival: CompareSide, n: number, onProgress?: (f: number) => void, cancelled = () => false): Promise<CompareResult> {
  const acc = { total: 0, own: 0, samples: 0, rp: 0, win: 0, rival: 0 };
  let done = 0;
  for (let k = 0; k < n && !cancelled(); k++) {
    const rand = rng(1000 + k);
    const sides = [side, side, rival, rival];
    const g = new GameSession({
      player: -1,
      preload: true,
      ai: true,
      specs: sides.map((x) => x.spec),
      autos: sides.map(() => COLLECT_HOME),
      bots: sides.map((x) => x.bot),
      hp: { enabled: true, interval: 2.5 + rand() * 1.5 },
    });
    try {
      g.startMatch();
      // Pequeña variación de la pose inicial (±3 cm, ±3°) para que no salgan idénticos
      for (const r of g.robots) {
        const p = r.phys.position();
        r.phys.teleport(p.x + (rand() - 0.5) * 0.06, p.z + (rand() - 0.5) * 0.06, r.phys.heading() + (rand() - 0.5) * 0.1);
      }
      const m = g.match!;
      for (let i = 0; i < STEPS && !m.finished; i++) {
        g.step();
        if (i % SLICE === SLICE - 1) {
          onProgress?.((k + i / STEPS) / n);
          await tick();
          if (cancelled()) return finish(acc, done);
        }
      }
      const b = m.breakdown('red');
      acc.total += b.total;
      acc.own += b.subtotal - b.penalties;
      acc.samples += m.samplesIn('red');
      acc.rp += m.rankingPoints('red').total;
      acc.win += m.score('red') > m.score('blue') ? 1 : m.score('red') === m.score('blue') ? 0.5 : 0;
      acc.rival += m.score('blue');
      done++;
    } finally {
      g.dispose();
    }
  }
  onProgress?.(1);
  return finish(acc, done);
}

function finish(a: { total: number; own: number; samples: number; rp: number; win: number; rival: number }, n: number): CompareResult {
  const d = Math.max(1, n);
  return { matches: n, total: a.total / d, own: a.own / d, samples: a.samples / d, rp: a.rp / d, winRate: a.win / d, rival: a.rival / d };
}
