/**
 * Logros y progreso (lógica pura): medallas por hitos que se ganan jugando matches con tu robot.
 * Cada hito sale de algo que el manual puntúa (sección en `section`); los números de umbral (cuántas
 * Muestras, cuántos matches) son SUPUESTOS de diseño del simulador, no del manual. Los puntos y el
 * Dominio de Cámara usan `config/game.ts` (§4.4).
 *
 * Solo cuentan los matches en que manejas un robot (no la IA sola, ni la práctica ni los retos).
 */
import type { GameConfig } from '../config/game';
import type { Match } from './match';
import { opponent, type Alliance } from './types';

/** Lo que hizo el jugador (y su alianza) en un match terminado. */
export interface MatchFacts {
  won: boolean;
  tie: boolean;
  score: number;
  /** Muestras que soltó tu robot, por nivel (N1, N2, N3). */
  samples: [number, number, number];
  samplesAuto: number;
  /** Muestras totales de tu alianza en su Cámara (Dominio de Cámara, §4.4). */
  allianceSamples: number;
  autoLine: boolean;
  /** Ambos robots de la alianza cruzaron la línea (RP, §4.4). */
  bothAutoLine: boolean;
  /** Tu robot estaba sobre la Plataforma al sonar la bocina (§4.3.1). */
  onPlatform: boolean;
  /** Los 2 robots de tu alianza sobre la Plataforma (20 pts, §4.4). */
  bothPlatform: boolean;
  /** Tu robot dejó la Muestra Crítica en la Repisa (§4.4). */
  critical: boolean;
  dominance: boolean;
  /** Faltas que cometió tu robot (§4.5, §4.6). */
  fouls: number;
  cards: number;
  redCard: boolean;
  rp: number;
}

/** Extrae los hechos de un match terminado para el robot `player` (índice 0–3). */
export function matchFacts(m: Match, player: number, cfg: GameConfig): MatchFacts {
  const a: Alliance = player < m.robotsPerAlliance ? 'red' : 'blue';
  const mine = m.score(a);
  const other = m.score(opponent(a));
  const s = m.state[a];
  const samples: [number, number, number] = [0, 0, 0];
  let samplesAuto = 0;
  for (const r of s.samples)
    if (r.robot === player) {
      samples[r.level - 1]++;
      if (r.period === 'AUTO') samplesAuto++;
    }
  const rp = m.rankingPoints(a);
  return {
    won: mine > other,
    tie: mine === other,
    score: mine,
    samples,
    samplesAuto,
    allianceSamples: m.samplesIn(a),
    autoLine: s.autoLine.has(player),
    bothAutoLine: rp.autoLine,
    onPlatform: s.platformBy.includes(player),
    bothPlatform: s.platformRobots >= 2,
    critical: s.critical && s.criticalBy === player,
    dominance: m.samplesIn(a) >= cfg.rp.dominanceSamples,
    fouls: m.fouls.filter((f) => f.offender === a && f.robot === player).length,
    cards: m.cards.filter((c) => c.alliance === a && c.robot === player).length,
    redCard: m.breakdown(a).redCard,
    rp: rp.total,
  };
}

/** Acumulados guardados en el navegador. */
export interface AchProgress {
  format: 'labbot-achievements';
  version: 1;
  matches: number;
  wins: number;
  ties: number;
  samples: [number, number, number];
  samplesAuto: number;
  autoLines: number;
  platforms: number;
  bothPlatforms: number;
  criticals: number;
  dominances: number;
  /** Matches sin faltas ni tarjetas de tu robot. */
  clean: number;
  rpTotal: number;
  bestScore: number;
  winStreak: number;
  bestStreak: number;
  /** Id del logro → fecha ISO en que se ganó. */
  unlocked: Record<string, string>;
}

export const emptyAch = (): AchProgress => ({
  format: 'labbot-achievements',
  version: 1,
  matches: 0,
  wins: 0,
  ties: 0,
  samples: [0, 0, 0],
  samplesAuto: 0,
  autoLines: 0,
  platforms: 0,
  bothPlatforms: 0,
  criticals: 0,
  dominances: 0,
  clean: 0,
  rpTotal: 0,
  bestScore: 0,
  winStreak: 0,
  bestStreak: 0,
  unlocked: {},
});

export interface Achievement {
  id: string;
  /** Sección del manual de la que sale el hito. */
  section: string;
  /** Avance actual y meta (para la barra). */
  progress: (p: AchProgress) => { value: number; goal: number };
}

const at = (section: string, id: string, goal: number, value: (p: AchProgress) => number): Achievement => ({
  id,
  section,
  progress: (p) => ({ value: Math.min(goal, value(p)), goal }),
});
const total = (p: AchProgress): number => p.samples[0] + p.samples[1] + p.samples[2];

/** Los logros, en el orden en que se muestran. Las metas son SUPUESTOS de diseño. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  at('§2', 'firstMatch', 1, (p) => p.matches),
  at('§2', 'matches10', 10, (p) => p.matches),
  at('§4.4', 'firstWin', 1, (p) => p.wins),
  at('§4.4', 'wins10', 10, (p) => p.wins),
  at('§4.4', 'streak3', 3, (p) => p.bestStreak),
  at('§4.4', 'autoLine', 1, (p) => p.autoLines),
  at('§4.2 · §4.4', 'autoSample', 1, (p) => p.samplesAuto),
  at('§3.2.3 · §4.4', 'firstSample', 1, total),
  at('§3.2.3 · §4.4', 'samples50', 50, total),
  at('§3.2.3 · §4.4', 'level3x20', 20, (p) => p.samples[2]),
  at('§4.4', 'dominance', 1, (p) => p.dominances),
  at('§4.3.1 · §4.4', 'platform', 1, (p) => p.platforms),
  at('§4.3.1 · §4.4', 'platform20', 20, (p) => p.platforms),
  at('§4.4', 'bothPlatform', 1, (p) => p.bothPlatforms),
  at('§3.2.5 · §4.4', 'firstCritical', 1, (p) => p.criticals),
  at('§3.2.5 · §4.4', 'critical10', 10, (p) => p.criticals),
  at('§4.5 · §4.6', 'clean5', 5, (p) => p.clean),
  at('§4.4', 'score100', 100, (p) => p.bestScore),
  at('§4.4', 'rp50', 50, (p) => p.rpTotal),
];

export const achievementById = (id: string): Achievement | undefined => ACHIEVEMENTS.find((a) => a.id === id);
export const isDone = (a: Achievement, p: AchProgress): boolean => a.progress(p).value >= a.progress(p).goal;
export const unlockedCount = (p: AchProgress): number => ACHIEVEMENTS.filter((a) => p.unlocked[a.id]).length;

/** Suma un match al progreso. Devuelve el progreso nuevo y los logros recién ganados. */
export function recordMatch(prev: AchProgress, f: MatchFacts, now = new Date()): { progress: AchProgress; earned: Achievement[] } {
  const p: AchProgress = { ...prev, samples: [...prev.samples] as [number, number, number], unlocked: { ...prev.unlocked } };
  p.matches++;
  if (f.won) p.wins++;
  if (f.tie) p.ties++;
  for (let i = 0; i < 3; i++) p.samples[i] += f.samples[i];
  p.samplesAuto += f.samplesAuto;
  if (f.autoLine) p.autoLines++;
  if (f.onPlatform) p.platforms++;
  if (f.bothPlatform) p.bothPlatforms++;
  if (f.critical) p.criticals++;
  if (f.dominance) p.dominances++;
  if (f.fouls === 0 && f.cards === 0) p.clean++;
  p.rpTotal += f.rp;
  p.bestScore = Math.max(p.bestScore, f.score);
  p.winStreak = f.won ? p.winStreak + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.winStreak);
  const earned: Achievement[] = [];
  for (const a of ACHIEVEMENTS)
    if (!p.unlocked[a.id] && isDone(a, p)) {
      p.unlocked[a.id] = now.toISOString();
      earned.push(a);
    }
  return { progress: p, earned };
}

/** Progreso válido a partir de cualquier valor (lo que no sirve se descarta). */
export function parseAch(raw: string | null): AchProgress {
  const e = emptyAch();
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw ?? 'null') as Record<string, unknown>;
  } catch {
    return e;
  }
  if (!o || typeof o !== 'object' || o.format !== 'labbot-achievements') return e;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const sm = Array.isArray(o.samples) ? o.samples : [];
  const out: AchProgress = {
    ...e,
    matches: num(o.matches),
    wins: num(o.wins),
    ties: num(o.ties),
    samples: [num(sm[0]), num(sm[1]), num(sm[2])],
    samplesAuto: num(o.samplesAuto),
    autoLines: num(o.autoLines),
    platforms: num(o.platforms),
    bothPlatforms: num(o.bothPlatforms),
    criticals: num(o.criticals),
    dominances: num(o.dominances),
    clean: num(o.clean),
    rpTotal: num(o.rpTotal),
    bestScore: num(o.bestScore),
    winStreak: num(o.winStreak),
    bestStreak: num(o.bestStreak),
  };
  if (o.unlocked && typeof o.unlocked === 'object')
    for (const [k, v] of Object.entries(o.unlocked)) if (achievementById(k) && typeof v === 'string') out.unlocked[k] = v.slice(0, 30);
  return out;
}
