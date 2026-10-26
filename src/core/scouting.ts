/**
 * Scouting (lógica pura, sin DOM): un registro por equipo y por match con lo que hizo su robot
 * (línea, Muestras por nivel y periodo, Plataforma, Muestra Crítica, faltas y tarjetas), el
 * resumen por equipo y la predicción de una alianza de dos con el reparto de papeles.
 *
 * Los registros salen del simulador (`entriesFromMatch`, al terminar un match) o se capturan a mano
 * viendo un match real. Los puntos "propios" de un robot son los que su acción le da a la alianza
 * según §4.4; la Plataforma se le acredita a cada robot que sube como 10 (la alianza recibe 20 si
 * suben los dos, no acumulable, §4.4 nota): SUPUESTO de reparto para comparar robots.
 */
import type { GameConfig } from '../config/game';
import type { MechanismKind } from '../config/robot';
import type { Match } from './match';
import { LEVELS, opponent, type Alliance, type Level } from './types';

/** Conteo por nivel [N1, N2, N3]. */
export type LevelCounts = [number, number, number];

export interface ScoutEntry {
  id: string;
  /** Nombre del match ("Q3", "Sim 4"…). */
  match: string;
  /** Id del equipo (ver `Team`). */
  team: string;
  alliance: Alliance;
  source: 'sim' | 'manual';
  autoLine: boolean;
  samplesAuto: LevelCounts;
  samplesTeleop: LevelCounts;
  platform: boolean;
  critical: boolean;
  fouls: number;
  techFouls: number;
  yellow: number;
  red: boolean;
  /** Marcador final y RP de su alianza (si se sabe). */
  allianceScore?: number;
  opponentScore?: number;
  rp?: number;
  /**
   * Ciclos del TELEOP y su tiempo promedio (s). Del simulador salen solos (`cycleStats`); a mano son
   * opcionales.
   */
  cycles?: number;
  cycleAvg?: number;
  notes?: string;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  /** Tipo de robot que lleva (para simular sus matches). */
  robot: MechanismKind;
}

const zero = (): LevelCounts => [0, 0, 0];
const sum = (c: LevelCounts): number => c[0] + c[1] + c[2];

/** Puntos de las Muestras de un registro (§4.4). */
export function samplePoints(e: Pick<ScoutEntry, 'samplesAuto' | 'samplesTeleop'>, cfg: GameConfig): { auto: number; teleop: number } {
  let auto = 0;
  let teleop = 0;
  for (const l of LEVELS) {
    auto += e.samplesAuto[l - 1] * cfg.points.sampleAuto[l];
    teleop += e.samplesTeleop[l - 1] * cfg.points.sampleTeleop[l];
  }
  return { auto, teleop };
}

/** Puntos que el robot le dio a su alianza (§4.4) y los que regaló al rival con faltas (§4.5, §4.6). */
export function entryPoints(e: ScoutEntry, cfg: GameConfig): { auto: number; teleop: number; endgame: number; total: number; foulPts: number } {
  const s = samplePoints(e, cfg);
  const auto = (e.autoLine ? cfg.points.autoLine : 0) + s.auto;
  const endgame = (e.platform ? cfg.points.platformOne : 0) + (e.critical ? cfg.points.critical : 0);
  return { auto, teleop: s.teleop, endgame, total: auto + s.teleop + endgame, foulPts: e.fouls * cfg.fouls.foul + e.techFouls * cfg.fouls.tech };
}

/**
 * Ciclo (definición del sim, no del manual; la misma de `replay/stats.ts`): una ráfaga de Muestras
 * anotadas sin más de `CYCLE_GAP` s entre una y otra. Tiempo de ciclo = del inicio de una ráfaga al
 * de la siguiente. Solo el TELEOP (en AUTO todos arrancan juntos).
 */
export const CYCLE_GAP = 2.5;

/** Ráfagas y tiempo de ciclo promedio a partir de los tiempos (s) de las Muestras del TELEOP. */
export function cycleStats(times: readonly number[]): { cycles: number; cycleAvg?: number } {
  const bursts: number[] = [];
  let last = -Infinity;
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t - last > CYCLE_GAP) bursts.push(t);
    last = t;
  }
  if (bursts.length < 2) return { cycles: bursts.length };
  return { cycles: bursts.length, cycleAvg: Math.round(((bursts[bursts.length - 1] - bursts[0]) / (bursts.length - 1)) * 10) / 10 };
}

/**
 * Un registro por robot de un match del simulador. `teams[i]` = equipo del robot i (0–1 rojo,
 * 2–3 azul). Las Muestras que entraron sin que un robot las soltara (empujadas) no se le cuentan a
 * nadie.
 */
export function entriesFromMatch(m: Match, teams: readonly string[], match: string, now = new Date()): ScoutEntry[] {
  const out: ScoutEntry[] = [];
  const per = m.robotsPerAlliance;
  teams.forEach((team, i) => {
    const alliance: Alliance = i < per ? 'red' : 'blue';
    const s = m.state[alliance];
    const samplesAuto = zero();
    const samplesTeleop = zero();
    for (const r of s.samples) if (r.robot === i) (r.period === 'AUTO' ? samplesAuto : samplesTeleop)[r.level - 1]++;
    const cyc = cycleStats(s.samples.filter((r) => r.robot === i && r.period === 'TELEOP').map((r) => r.time));
    const mine = m.fouls.filter((f) => f.robot === i);
    const cards = m.cards.filter((c) => c.robot === i);
    out.push({
      id: `${match}-${i}-${now.getTime()}`,
      match,
      team,
      alliance,
      source: 'sim',
      autoLine: s.autoLine.has(i),
      samplesAuto,
      samplesTeleop,
      platform: s.platformBy.includes(i),
      critical: s.criticalBy === i,
      fouls: mine.filter((f) => f.kind === 'FOUL').length,
      techFouls: mine.filter((f) => f.kind === 'TECH').length,
      yellow: cards.filter((c) => c.type === 'YELLOW').length,
      red: cards.some((c) => c.type === 'RED'),
      allianceScore: m.score(alliance),
      opponentScore: m.score(opponent(alliance)),
      rp: m.rankingPoints(alliance).total,
      cycles: cyc.cycles,
      ...(cyc.cycleAvg !== undefined ? { cycleAvg: cyc.cycleAvg } : {}),
      createdAt: now.toISOString(),
    });
  });
  return out;
}

export interface TeamSummary {
  team: string;
  matches: number;
  /** Promedios por match. */
  points: number;
  auto: number;
  teleop: number;
  endgame: number;
  /** Desviación estándar de los puntos propios (consistencia). */
  sd: number;
  samples: number;
  /** Desviación estándar de las Muestras por match. */
  samplesSd: number;
  n3: number;
  autoLinePct: number;
  platformPct: number;
  criticalPct: number;
  foulPts: number;
  cards: number;
  /** Puntos propios menos los que regala. */
  net: number;
  /** RP promedio de su alianza (solo registros que lo traen). */
  rp: number | null;
  best: number;
  /** Muestras promedio por nivel [N1, N2, N3] (AUTO + TELEOP) y solo en AUTO. */
  levels: LevelCounts;
  levelsAuto: LevelCounts;
  /** Nivel donde más anota (0 si no anota). */
  topLevel: 0 | Level;
  /** Ciclos por match y tiempo de ciclo promedio y mejor (s); null sin datos de ciclo. */
  cycles: number | null;
  cycle: number | null;
  bestCycle: number | null;
  /** Puntos propios de cada match, en el orden en que se registraron (tendencia). */
  trend: number[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function levelsOf(es: readonly ScoutEntry[]): Pick<TeamSummary, 'levels' | 'levelsAuto' | 'topLevel'> {
  const lv = (f: (e: ScoutEntry, i: number) => number): LevelCounts => [0, 1, 2].map((i) => mean(es.map((e) => f(e, i)))) as LevelCounts;
  const levels = lv((e, i) => e.samplesAuto[i] + e.samplesTeleop[i]);
  const levelsAuto = lv((e, i) => e.samplesAuto[i]);
  const top = Math.max(...levels);
  return { levels, levelsAuto, topLevel: top > 0 ? ((levels.lastIndexOf(top) + 1) as Level) : 0 };
}

function cyclesOf(es: readonly ScoutEntry[]): Pick<TeamSummary, 'cycles' | 'cycle' | 'bestCycle'> {
  const withC = es.filter((e) => e.cycles !== undefined);
  const avg = es.filter((e) => e.cycleAvg !== undefined).map((e) => e.cycleAvg!);
  return { cycles: withC.length ? mean(withC.map((e) => e.cycles!)) : null, cycle: avg.length ? mean(avg) : null, bestCycle: avg.length ? Math.min(...avg) : null };
}

/** Resumen por equipo de todos sus registros. */
export function summarize(entries: readonly ScoutEntry[], cfg: GameConfig): TeamSummary[] {
  const by = new Map<string, ScoutEntry[]>();
  for (const e of entries) by.set(e.team, [...(by.get(e.team) ?? []), e]);
  const out: TeamSummary[] = [];
  for (const [team, es] of by) {
    const pts = es.map((e) => entryPoints(e, cfg));
    const tot = pts.map((p) => p.total);
    const m = mean(tot);
    const rps = es.filter((e) => e.rp !== undefined).map((e) => e.rp!);
    const foulPts = mean(pts.map((p) => p.foulPts));
    const ns = es.map((e) => sum(e.samplesAuto) + sum(e.samplesTeleop));
    const ms = mean(ns);
    out.push({
      team,
      matches: es.length,
      points: m,
      auto: mean(pts.map((p) => p.auto)),
      teleop: mean(pts.map((p) => p.teleop)),
      endgame: mean(pts.map((p) => p.endgame)),
      sd: Math.sqrt(mean(tot.map((x) => (x - m) ** 2))),
      samples: ms,
      samplesSd: Math.sqrt(mean(ns.map((x) => (x - ms) ** 2))),
      n3: mean(es.map((e) => e.samplesAuto[2] + e.samplesTeleop[2])),
      autoLinePct: mean(es.map((e) => (e.autoLine ? 1 : 0))),
      platformPct: mean(es.map((e) => (e.platform ? 1 : 0))),
      criticalPct: mean(es.map((e) => (e.critical ? 1 : 0))),
      foulPts,
      cards: es.reduce((a, e) => a + e.yellow + (e.red ? 1 : 0), 0),
      net: m - foulPts,
      rp: rps.length ? mean(rps) : null,
      best: Math.max(...tot),
      ...levelsOf(es),
      ...cyclesOf(es),
      trend: tot,
    });
  }
  return out.sort((a, b) => b.net - a.net || b.points - a.points);
}

/** Probabilidad aproximada de que una normal (media, sd) sea ≥ x. */
function pAtLeast(x: number, mu: number, sd: number): number {
  if (sd < 1e-6) return mu >= x ? 1 : 0;
  const z = (x - 0.5 - mu) / sd; // corrección de continuidad (conteo entero)
  // erf aproximada (Abramowitz–Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-((z / Math.SQRT2) ** 2));
  const cdf = 0.5 * (1 + Math.sign(z) * y);
  return 1 - cdf;
}

export type Role = 'critical' | 'n3' | 'support';

export interface AlliancePrediction {
  teams: [string, string];
  /** Puntos esperados de la alianza (sin faltas del rival). */
  points: number;
  /** Puntos que se espera que regale con faltas. */
  foulPts: number;
  samples: number;
  /** RP esperados sin contar la victoria: línea, Crítica, Dominio (§4.4). */
  bonusRp: number;
  pAutoLineRp: number;
  pCriticalRp: number;
  pDominanceRp: number;
  /** Papel sugerido para cada equipo (mismo orden que `teams`). */
  roles: [Role, Role];
}

/**
 * Predicción de una alianza de dos a partir de los resúmenes. Solo hay una Muestra Crítica por
 * alianza, así que cuenta la del que más la logra (y ese se queda el papel); la Plataforma no se
 * acumula (10 con uno, 20 con dos, §4.4); el Dominio pide ≥10 Muestras entre los dos (§4.4).
 * SUPUESTO: los robots rinden igual juntos que en sus registros (sin estorbarse ni ayudarse).
 */
export function predictAlliance(a: TeamSummary, b: TeamSummary, cfg: GameConfig): AlliancePrediction {
  const P = cfg.points;
  const strip = (s: TeamSummary) => s.points - s.platformPct * P.platformOne - s.criticalPct * P.critical;
  const pa = a.platformPct;
  const pb = b.platformPct;
  const platform = P.platformTwo * pa * pb + P.platformOne * (pa * (1 - pb) + pb * (1 - pa));
  const critA = a.criticalPct >= b.criticalPct && (a.criticalPct > 0 || a.n3 <= b.n3);
  const pCrit = Math.max(a.criticalPct, b.criticalPct);
  const samples = a.samples + b.samples;
  // Con pocos registros la sd sale baja: mínimo 1 Muestra de incertidumbre
  const pDom = pAtLeast(cfg.rp.dominanceSamples, samples, Math.max(1, Math.sqrt(a.samplesSd ** 2 + b.samplesSd ** 2)));
  const pLine = a.autoLinePct * b.autoLinePct;
  const roleOf = (s: TeamSummary, isCrit: boolean): Role => (isCrit && pCrit > 0 ? 'critical' : s.n3 >= 1 ? 'n3' : 'support');
  return {
    teams: [a.team, b.team],
    points: strip(a) + strip(b) + platform + pCrit * P.critical,
    foulPts: a.foulPts + b.foulPts,
    samples,
    bonusRp: pLine * cfg.rp.autoLine + pCrit * cfg.rp.critical + pDom * cfg.rp.dominance,
    pAutoLineRp: pLine,
    pCriticalRp: pCrit,
    pDominanceRp: pDom,
    roles: [roleOf(a, critA), roleOf(b, !critA)],
  };
}

/** Los mejores compañeros para `team`, de mayor a menor puntos netos esperados. */
export function bestPartners(team: string, summaries: readonly TeamSummary[], cfg: GameConfig, exclude: ReadonlySet<string> = new Set()): AlliancePrediction[] {
  const me = summaries.find((s) => s.team === team);
  if (!me) return [];
  return summaries
    .filter((s) => s.team !== team && !exclude.has(s.team))
    .map((s) => predictAlliance(me, s, cfg))
    .sort((x, y) => y.points - y.foulPts - (x.points - x.foulPts));
}

/** Para ordenar registros: [N1, N2, N3] desde un nivel. */
export function addSample(c: LevelCounts, level: Level, d = 1): LevelCounts {
  const n = [...c] as LevelCounts;
  n[level - 1] = Math.max(0, n[level - 1] + d);
  return n;
}
