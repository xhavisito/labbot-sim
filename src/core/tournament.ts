/**
 * Formato del torneo interno (lógica pura): calendario de clasificación, selección de alianzas y
 * pronóstico de eliminatorias a partir del scouting.
 *
 * El manual NO dice cómo se arman las alianzas ni cómo es el torneo (solo que una alianza son 2
 * robots, §8.2, y el RP de §4.4). Todo el formato de aquí es SUPUESTO y configurable
 * (`DEFAULT_FORMAT`): 8 equipos, 5 matches de clasificación por equipo con compañeros al azar,
 * ranking por RP promedio, 4 alianzas de 2 elegidas por los mejores del ranking y eliminación
 * directa 1 vs 4 y 2 vs 3.
 */
import type { GameConfig } from '../config/game';
import { rng } from './rng';
import { predictAlliance, type AlliancePrediction, type TeamSummary } from './scouting';

export interface TournamentFormat {
  /** SUPUESTO: matches de clasificación por equipo. */
  qualsPerTeam: number;
  /** SUPUESTO: número de alianzas de la eliminatoria. */
  alliances: number;
  /** Robots por alianza de la eliminatoria: 2 (§8.2) o 3 con uno de reserva (SUPUESTO). */
  allianceSize: 2 | 3;
  /** Orden de la segunda ronda de selección (solo con 3): serpentina (4→1) o directa (1→4). */
  draft: 'serpentine' | 'straight';
  /** Cómo se ordena el ranking: RP promedio (desempate por puntos) o solo puntos. */
  rankBy: 'rp' | 'points';
}

export const DEFAULT_FORMAT: TournamentFormat = { qualsPerTeam: 5, alliances: 4, allianceSize: 2, draft: 'serpentine', rankBy: 'rp' };

export interface QualMatch {
  /** "Q1", "Q2"… */
  id: string;
  red: [string, string];
  blue: [string, string];
}

/**
 * Calendario de clasificación: cada equipo juega `qualsPerTeam` matches (los que sobran para
 * completar el último match juegan uno más, como "surrogate") y se reparten compañeros y rivales
 * para repetir lo menos posible. Reproducible con `seed`.
 */
export function makeSchedule(teams: readonly string[], qualsPerTeam: number, seed = 1, tries = 200): QualMatch[] {
  if (teams.length < 4) return [];
  const n = Math.ceil((teams.length * qualsPerTeam) / 4);
  let best: QualMatch[] = [];
  let bestCost = Infinity;
  const rand = rng(seed);
  for (let k = 0; k < tries; k++) {
    const played = new Map(teams.map((t) => [t, 0]));
    const last = new Map(teams.map((t) => [t, -9]));
    const pair = new Map<string, number>();
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const bump = (a: string, b: string, w: number) => pair.set(key(a, b), (pair.get(key(a, b)) ?? 0) + w);
    const out: QualMatch[] = [];
    let cost = 0;
    for (let m = 0; m < n; m++) {
      // Los que menos han jugado (y descansaron más), con desempate al azar
      const pick = [...teams]
        .map((t) => ({ t, r: rand() }))
        .sort((a, b) => played.get(a.t)! - played.get(b.t)! || last.get(a.t)! - last.get(b.t)! || a.r - b.r)
        .slice(0, 4)
        .map((x) => x.t);
      // De las 3 formas de partir 4 en dos parejas, la que menos repite compañeros (pesa 3) y rivales
      const splits: Array<[[string, string], [string, string]]> = [
        [[pick[0], pick[1]], [pick[2], pick[3]]],
        [[pick[0], pick[2]], [pick[1], pick[3]]],
        [[pick[0], pick[3]], [pick[1], pick[2]]],
      ];
      const c = (s: (typeof splits)[number]) =>
        3 * ((pair.get(key(...s[0])) ?? 0) + (pair.get(key(...s[1])) ?? 0)) +
        s[0].reduce((acc, a) => acc + s[1].reduce((b2, b) => b2 + ((pair.get(key(a, b)) ?? 0) % 3), 0), 0);
      const s = splits.map((x) => ({ x, c: c(x), r: rand() })).sort((a, b) => a.c - b.c || a.r - b.r)[0];
      cost += s.c;
      const [red, blue] = rand() < 0.5 ? [s.x[0], s.x[1]] : [s.x[1], s.x[0]];
      bump(red[0], red[1], 3);
      bump(blue[0], blue[1], 3);
      for (const a of red) for (const b of blue) bump(a, b, 1);
      for (const t of [...red, ...blue]) {
        played.set(t, played.get(t)! + 1);
        // Penaliza jugar dos seguidos
        if (last.get(t) === m - 1) cost += 1;
        last.set(t, m);
      }
      out.push({ id: `Q${m + 1}`, red, blue });
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = out;
    }
  }
  return best;
}

/** Ranking de clasificación según el formato. */
export function rankTeams(summaries: readonly TeamSummary[], f: TournamentFormat): TeamSummary[] {
  return [...summaries].sort((a, b) => (f.rankBy === 'rp' ? (b.rp ?? 0) - (a.rp ?? 0) : 0) || b.points - a.points || b.net - a.net);
}

export interface DraftAlliance {
  seed: number;
  captain: string;
  picks: string[];
  /** Predicción con los dos que juegan (los dos mejores juntos si hay reserva). */
  prediction: AlliancePrediction;
}

const net = (p: AlliancePrediction) => p.points - p.foulPts;

/** Mejor pareja dentro de una alianza (con 3, cuál se queda de reserva). */
function bestPair(teams: string[], by: Map<string, TeamSummary>, cfg: GameConfig): AlliancePrediction {
  let best: AlliancePrediction | null = null;
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++) {
      const p = predictAlliance(by.get(teams[i])!, by.get(teams[j])!, cfg);
      if (!best || net(p) > net(best)) best = p;
    }
  return best!;
}

/**
 * Selección de alianzas sugerida: en su turno, el mejor del ranking que siga libre es capitán y
 * elige al compañero que más sube la predicción de su alianza (puntos esperados menos faltas). Con
 * 3 por alianza hay una segunda ronda en serpentina o directa.
 */
export function suggestDraft(summaries: readonly TeamSummary[], f: TournamentFormat, cfg: GameConfig): DraftAlliance[] {
  const ranked = rankTeams(summaries, f);
  const by = new Map(ranked.map((s) => [s.team, s]));
  const free = new Set(ranked.map((s) => s.team));
  const n = Math.min(f.alliances, Math.floor(ranked.length / 2));
  const al: Array<{ captain: string; picks: string[] }> = [];
  const choose = (members: string[]): string | null => {
    let pick: string | null = null;
    let val = -Infinity;
    for (const t of free) {
      const v = net(bestPair([...members, t], by, cfg));
      if (v > val) {
        val = v;
        pick = t;
      }
    }
    return pick;
  };
  for (let i = 0; i < n; i++) {
    const captain = ranked.find((s) => free.has(s.team))!.team;
    free.delete(captain);
    const p = choose([captain]);
    if (p) free.delete(p);
    al.push({ captain, picks: p ? [p] : [] });
  }
  if (f.allianceSize === 3) {
    const order = f.draft === 'serpentine' ? [...al.keys()].reverse() : [...al.keys()];
    for (const i of order) {
      const p = choose([al[i].captain, ...al[i].picks]);
      if (!p) break;
      free.delete(p);
      al[i].picks.push(p);
    }
  }
  return al.map((a, i) => ({ seed: i + 1, captain: a.captain, picks: a.picks, prediction: bestPair([a.captain, ...a.picks], by, cfg) }));
}

export interface PlayoffMatch {
  round: number;
  a: DraftAlliance;
  b: DraftAlliance;
  /** Marcador esperado: puntos propios + faltas que regala el rival. */
  scoreA: number;
  scoreB: number;
  winner: DraftAlliance;
}

/**
 * Pronóstico de la eliminatoria directa: 1 vs N, 2 vs N−1… y los ganadores siguen (SUPUESTO de
 * formato). Gana la alianza con más puntos esperados.
 */
export function predictPlayoffs(alliances: readonly DraftAlliance[]): PlayoffMatch[] {
  const out: PlayoffMatch[] = [];
  let alive = [...alliances];
  let round = 1;
  while (alive.length > 1) {
    const next: DraftAlliance[] = [];
    for (let i = 0; i < Math.floor(alive.length / 2); i++) {
      const a = alive[i];
      const b = alive[alive.length - 1 - i];
      const scoreA = a.prediction.points + b.prediction.foulPts;
      const scoreB = b.prediction.points + a.prediction.foulPts;
      const winner = scoreA >= scoreB ? a : b;
      out.push({ round, a, b, scoreA, scoreB, winner });
      next.push(winner);
    }
    if (alive.length % 2) next.push(alive[Math.floor(alive.length / 2)]);
    alive = next.sort((x, y) => x.seed - y.seed);
    round++;
  }
  return out;
}
