/**
 * Comparador por lotes de dificultades de la IA: matches completos de solo IA (4 robots) con una
 * dificultad por alianza, alternando los lados para que el lado de la cancha no cuente.
 * Reporta puntos, faltas y RP por dificultad. Se usa desde `scripts/ai-bench.mjs`.
 */
import { GameSession } from '../game/GameSession';
import { SCORE_PRELOAD } from '../auto/AutoRoutine';
import type { Alliance } from '../core/types';
import { DIFFICULTIES, type Difficulty } from './difficulty';

export interface SideResult {
  difficulty: Difficulty;
  alliance: Alliance;
  points: number;
  fouls: number; // cometidas por esta alianza
  rp: number;
  won: boolean;
}

export interface MatchResult {
  sides: [SideResult, SideResult];
}

/** Un match de solo IA: `a` en una alianza y `b` en la otra (`aRed` decide cuál). */
export function runAiMatch(a: Difficulty, b: Difficulty, aRed: boolean): MatchResult {
  const g = new GameSession({
    player: -1, // sin jugador: la IA maneja los 4 robots
    preload: true,
    ai: true,
    autos: [SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD, SCORE_PRELOAD],
    botOptions: { red: DIFFICULTIES[aRed ? a : b], blue: DIFFICULTIES[aRed ? b : a] },
  });
  g.startMatch();
  const m = g.match!;
  for (let i = 0; i < 160 * 120 && !m.finished; i++) {
    g.step();
  }
  const side = (alliance: Alliance, difficulty: Difficulty): SideResult => {
    const other = alliance === 'red' ? 'blue' : 'red';
    return {
      difficulty,
      alliance,
      points: m.score(alliance),
      fouls: m.fouls.filter((f) => f.offender === alliance).length,
      rp: m.rankingPoints(alliance).total,
      won: m.score(alliance) > m.score(other),
    };
  };
  return { sides: [side(aRed ? 'red' : 'blue', a), side(aRed ? 'blue' : 'red', b)] };
}

export interface Summary {
  difficulty: Difficulty;
  matches: number;
  wins: number;
  avgPoints: number;
  avgFouls: number;
  avgRp: number;
}

/** Resumen por dificultad a partir de los resultados de varios matches. */
export function summarize(results: MatchResult[]): Summary[] {
  const acc = new Map<Difficulty, { n: number; wins: number; pts: number; fouls: number; rp: number }>();
  for (const r of results)
    for (const s of r.sides) {
      const x = acc.get(s.difficulty) ?? { n: 0, wins: 0, pts: 0, fouls: 0, rp: 0 };
      x.n++;
      x.wins += s.won ? 1 : 0;
      x.pts += s.points;
      x.fouls += s.fouls;
      x.rp += s.rp;
      acc.set(s.difficulty, x);
    }
  return [...acc].map(([difficulty, x]) => ({ difficulty, matches: x.n, wins: x.wins, avgPoints: x.pts / x.n, avgFouls: x.fouls / x.n, avgRp: x.rp / x.n }));
}

/** `n` matches entre `a` y `b`, alternando de lado. */
export function runBatch(a: Difficulty, b: Difficulty, n: number): MatchResult[] {
  return Array.from({ length: n }, (_, k) => runAiMatch(a, b, k % 2 === 0));
}

