/**
 * Torneo interno (lógica pura). Arriba: formato del Scouting (calendario, selección sugerida y
 * pronóstico de eliminatorias a partir de los registros). Abajo: el modo torneo contra la IA.
 *
 * El manual (§8.2) fija 8 equipos y 4 alianzas de 2, elegidas por ranking (§8.2.1), y PlayOffs de
 * todos contra todos con final a 2 de 3 (§8.2.2; ese formato lo juega el modo torneo, abajo). El
 * pronóstico del Scouting es más simple y configurable (`DEFAULT_FORMAT`, SUPUESTO): 5 matches de
 * clasificación por equipo con compañeros al azar, ranking por RP promedio y eliminación directa
 * 1 vs 4 y 2 vs 3.
 */
import { GAME, type GameConfig } from '../config/game';
import type { MechanismKind } from '../config/robot';
import type { Match } from './match';
import { rng } from './rng';
import { entriesFromMatch, predictAlliance, samplePoints, summarize, type AlliancePrediction, type LevelCounts, type ScoutEntry, type TeamSummary } from './scouting';
import type { Alliance } from './types';

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

// ================================================================== Modo torneo
//
// Torneo contra la IA, como el de rebuilt-sim: Qualifications con calendario, ranking, selección de
// alianzas con invitación (el capitán invita, el equipo acepta o rechaza) y PlayOffs. Tu equipo juega
// sus matches en el simulador; los de los demás se ven en vivo o se simulan con estadística.
//
// Del manual (§8.2): 8 equipos, 4 alianzas de 2; en Qualifications los equipos rotan; la selección
// sigue el ranking final y el Rank 1 no puede elegir al Rank 2 (§8.2.1); en PlayOffs todos los
// matches son a 2 de 3, sin RP, y primero hay una ronda de todos contra todos: los dos con más
// victorias van a la final (2 de 3) y el último queda eliminado (§8.2.2).
// SUPUESTOS (el manual no lo dice): ranking por RP promedio con desempates como la Tabla 10-1 de FRC
// (puntos sin faltas, AUTO, ENDGAME); un capitán puede invitar a otro capitán y se puede rechazar
// una invitación (como FRC §10.6); "cada alianza se enfrenta a las otras dos" con 4 alianzas se lee
// como contra las otras tres; las victorias del todos contra todos son series ganadas (desempate:
// matches ganados, puntos, seed); un empate de PlayOffs se desempata por puntos sin faltas, AUTO y
// ENDGAME y si sigue, se repite. Opcional: la doble eliminación de rebuilt-sim (formato FRC).

/** Un equipo del torneo (sale de los equipos del Scouting). */
export interface TeamEntry {
  /** Id del Scouting ("E1"…); los registros (`ScoutEntry.team`) lo usan. */
  id: string;
  name: string;
  robot: MechanismKind;
  /** Robot elegido en el menú (solo el equipo del jugador). */
  specId?: string;
  /** 0–1: calidad del equipo para la simulación estadística (SUPUESTO). */
  strength: number;
  isPlayer: boolean;
}

export interface AllianceMatchResult {
  score: number;
  /** Puntos sin los de faltas del rival (1er desempate). */
  noFoul: number;
  auto: number;
  endgame: number;
  samples: number;
  /** RP de Qualifications (§4.4); en PlayOffs no cuentan (§8.2.2). */
  rp: number;
}

export interface MatchResult {
  red: AllianceMatchResult;
  blue: AllianceMatchResult;
  /** Registro por robot, como en el Scouting (rojo y luego azul). */
  entries?: ScoutEntry[];
}

export interface TMatch {
  id: string;
  kind: 'qual' | 'playoff' | 'final';
  red: number[]; // índices de equipo
  blue: number[];
  /** PlayOffs: número de serie (todos contra todos) o de match del bracket; las repeticiones lo comparten. */
  slot?: number;
  result?: MatchResult;
}

export interface SelectionLog {
  alliance: number;
  team: number;
  accepted: boolean;
}

/** Selección de alianzas en curso (§8.2.1). */
export interface Selection {
  alliances: number[][];
  /** Turno: la alianza 1 elige primero, luego la 2… (una sola ronda: alianzas de 2). */
  turn: number;
  /** Equipos que rechazaron: ya no pueden ser elegidos (salvo que falten equipos). */
  declined: number[];
  log: SelectionLog[];
  /** Orden del ranking al empezar (Rank 1 ≠ Rank 2 y para promover capitanes). */
  ranking: number[];
}

/** 'manual' = todos contra todos y final (§8.2.2); 'doubleElim' = doble eliminación de rebuilt-sim. */
export type PlayoffFormat = 'manual' | 'doubleElim';

export interface Tournament {
  version: 1;
  teams: TeamEntry[];
  quals: TMatch[];
  alliances: number[][] | null;
  playoffs: TMatch[];
  champion: number | null; // índice de alianza
  seed: number;
  playoffFormat: PlayoffFormat;
  selection?: Selection | null;
  /** Matches de otros equipos: preguntar si verlos u omitirlos siempre. */
  others?: 'ask' | 'skip';
}

/** Alianzas de 2 (§8.2.1). */
export const ALLIANCE_SIZE = 2;
/** 4 alianzas (§8.2); con menos de 8 equipos, las que alcancen. */
export const allianceCountFor = (nTeams: number): number => Math.max(2, Math.min(4, Math.floor(nTeams / ALLIANCE_SIZE)));

/** Crea el torneo con su calendario de Qualifications (`makeSchedule`, el mismo del Scouting). */
export function createTournament(teams: TeamEntry[], perTeam: number, format: PlayoffFormat, seed: number): Tournament {
  const quals = makeSchedule(
    teams.map((_, i) => String(i)),
    perTeam,
    seed,
  ).map((q): TMatch => ({ id: q.id, kind: 'qual', red: q.red.map(Number), blue: q.blue.map(Number) }));
  return { version: 1, teams, quals, alliances: null, playoffs: [], champion: null, seed, playoffFormat: format, others: 'ask' };
}

// ------------------------------------------------------------------ resultados

/**
 * Marcador de las dos alianzas a partir de los registros por robot (§4.4–§4.6): la Plataforma da 10
 * con un robot y 20 con dos (no acumulable), una sola Muestra Crítica por alianza, las faltas suman al
 * rival y la Red Card deja a la alianza en 0 y sin RP (D10).
 */
export function resultFromEntries(red: readonly ScoutEntry[], blue: readonly ScoutEntry[], cfg: GameConfig): MatchResult {
  const P = cfg.points;
  const side = (mine: readonly ScoutEntry[], theirs: readonly ScoutEntry[]) => {
    let auto = 0;
    let teleop = 0;
    let samples = 0;
    for (const e of mine) {
      const s = samplePoints(e, cfg);
      auto += s.auto + (e.autoLine ? P.autoLine : 0);
      teleop += s.teleop;
      samples += e.samplesAuto.reduce((a, b) => a + b, 0) + e.samplesTeleop.reduce((a, b) => a + b, 0);
    }
    const plat = mine.filter((e) => e.platform).length;
    const endgame = (plat >= 2 ? P.platformTwo : plat === 1 ? P.platformOne : 0) + (mine.some((e) => e.critical) ? P.critical : 0);
    const penalties = theirs.reduce((a, e) => a + e.fouls * cfg.fouls.foul + e.techFouls * cfg.fouls.tech, 0);
    const noFoul = auto + teleop + endgame;
    const redCard = mine.some((e) => e.red);
    return { noFoul, auto, endgame, samples, score: redCard ? 0 : noFoul + penalties, redCard, line: mine.length > 0 && mine.every((e) => e.autoLine), crit: mine.some((e) => e.critical) };
  };
  const r = side(red, blue);
  const b = side(blue, red);
  const rp = (me: typeof r, op: typeof r) =>
    me.redCard ? 0 : (me.score > op.score ? cfg.rp.win : me.score === op.score ? cfg.rp.tie : 0) + (me.line ? cfg.rp.autoLine : 0) + (me.crit ? cfg.rp.critical : 0) + (me.samples >= cfg.rp.dominanceSamples ? cfg.rp.dominance : 0);
  const out = (me: typeof r, op: typeof r): AllianceMatchResult => ({ score: me.score, noFoul: me.noFoul, auto: me.auto, endgame: me.endgame, samples: me.samples, rp: rp(me, op) });
  return { red: out(r, b), blue: out(b, r), entries: [...red, ...blue] };
}

/** Resultado de un match jugado en el simulador (marcador y RP del `Match`, registros del Scouting). */
export function resultFromMatch(m: Match, t: Tournament, tm: TMatch): MatchResult {
  const side = (a: Alliance): AllianceMatchResult => {
    const b = m.breakdown(a);
    return { score: b.total, noFoul: b.subtotal - b.penalties, auto: b.autoLine + b.samplesAuto, endgame: b.platform + b.critical, samples: m.samplesIn(a), rp: m.rankingPoints(a).total };
  };
  const ids = [...tm.red, ...tm.blue].map((i) => t.teams[i].id);
  return { red: side('red'), blue: side('blue'), entries: entriesFromMatch(m, ids, tm.id) };
}

/**
 * Lo que hace en promedio cada tipo de robot en un match (por robot): Muestras por nivel en AUTO y
 * TELEOP, probabilidad de cruzar la línea y de subir a la Plataforma, de dejar la Crítica cuando le
 * toca llevarla y faltas. Calibrado con 20 matches de la física y la IA nueva (`sim/quickSim.ts`, 4
 * tipos mezclados). `critPref`: quién suele llevar la Crítica en la alianza (en esos matches, el
 * pivote antes que la torre; `ai/Team.ts` la reparte).
 */
const PROFILES: Record<MechanismKind, { auto: LevelCounts; tele: LevelCounts; line: number; platform: number; crit: number; critPref: number; fouls: number; tech: number }> = {
  tower: { auto: [0, 0.31, 0.94], tele: [0.56, 0.06, 9.5], line: 1, platform: 1, crit: 0.9, critPref: 2, fouls: 0.05, tech: 0.06 },
  pivot: { auto: [0, 0.06, 1.13], tele: [0.13, 0.25, 4.75], line: 1, platform: 1, crit: 0.95, critPref: 3, fouls: 0.05, tech: 0.06 },
  // Pivote con hopper: medido con `npm run batch -- --set mech` entre pivotes con hopper, escalado como el pivote
  pivotHopper: { auto: [0, 0.05, 0.7], tele: [0.3, 0.6, 5.0], line: 1, platform: 1, crit: 0.92, critPref: 3, fouls: 0.05, tech: 0.06 },
  elevator: { auto: [0.06, 0.19, 0.69], tele: [0, 1.13, 10.94], line: 1, platform: 1, crit: 0.4, critPref: 0.5, fouls: 0.05, tech: 0 },
  generic: { auto: [0.06, 0.06, 1.06], tele: [0.13, 0.06, 10.5], line: 1, platform: 1, crit: 0.6, critPref: 1, fouls: 0.05, tech: 0 },
  chassis: { auto: [0, 0, 0], tele: [0, 0, 0], line: 1, platform: 1, crit: 0, critPref: 0, fouls: 0.05, tech: 0.81 },
};

const gauss = (rand: () => number): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
function poisson(lambda: number, rand: () => number): number {
  const l = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = rand();
  while (p > l && k < 60) {
    k++;
    p *= rand();
  }
  return k;
}

/**
 * Simulación estadística de un match (los que no juega el jugador y no se ven): cada robot hace lo
 * de su tipo (`PROFILES`) escalado por la fuerza del equipo y por un "día" al azar.
 */
export function simulateMatch(t: Tournament, m: TMatch, rand: () => number, cfg: GameConfig = GAME): MatchResult {
  const side = (idx: number[], alliance: Alliance): ScoutEntry[] => {
    const crit = [...idx].sort((a, b) => PROFILES[t.teams[b].robot].critPref - PROFILES[t.teams[a].robot].critPref)[0];
    return idx.map((i) => {
      const tm = t.teams[i];
      const p = PROFILES[tm.robot];
      const day = Math.max(0.3, 1 + 0.3 * gauss(rand)) * (0.55 + 0.75 * tm.strength);
      const counts = (c: LevelCounts): LevelCounts => [poisson(c[0] * day, rand), poisson(c[1] * day, rand), poisson(c[2] * day, rand)];
      const fouls = poisson(p.fouls * (1.3 - 0.5 * tm.strength), rand);
      return {
        id: `${m.id}-${i}`,
        match: m.id,
        team: tm.id,
        alliance,
        source: 'sim',
        autoLine: rand() < p.line * (0.9 + 0.1 * tm.strength),
        samplesAuto: counts(p.auto),
        samplesTeleop: counts(p.tele),
        platform: rand() < Math.min(1, p.platform * (0.85 + 0.25 * tm.strength)),
        critical: i === crit && rand() < p.crit * (0.8 + 0.25 * tm.strength),
        fouls,
        techFouls: poisson(p.tech * (1.3 - 0.5 * tm.strength), rand),
        yellow: 0,
        red: false,
        createdAt: new Date(0).toISOString(),
      };
    });
  };
  return resultFromEntries(side(m.red, 'red'), side(m.blue, 'blue'), cfg);
}

/** Registros de todos los matches del torneo con resultado (para la tabla y la selección). */
export function tournamentEntries(t: Tournament, which: 'quals' | 'all' = 'all'): ScoutEntry[] {
  return [...t.quals, ...(which === 'all' ? t.playoffs : [])].flatMap((m) => m.result?.entries ?? []);
}

/** Resumen por equipo (el del Scouting) de los matches del torneo. */
export function tournamentSummaries(t: Tournament, cfg: GameConfig = GAME, which: 'quals' | 'all' = 'all'): Map<number, TeamSummary> {
  const by = new Map(summarize(tournamentEntries(t, which), cfg).map((s) => [s.team, s]));
  const out = new Map<number, TeamSummary>();
  t.teams.forEach((tm, i) => {
    const s = by.get(tm.id);
    if (s) out.set(i, s);
  });
  return out;
}

// ------------------------------------------------------------------ ranking

export interface RankRow {
  team: number; // índice
  played: number;
  rpTotal: number;
  /** Ranking Score: RP promedio (SUPUESTO, como FRC), redondeado a 2 decimales. */
  rs: number;
  avgNoFoul: number;
  avgAuto: number;
  avgEndgame: number;
  rand: number;
}

/** Ranking de Qualifications: RS y desempates (SUPUESTO, adaptado de la Tabla 10-1 de FRC). */
export function rankings(t: Tournament): RankRow[] {
  const rand = rng(t.seed ^ 0x5bd1e995);
  const rows: RankRow[] = t.teams.map((_, i) => ({ team: i, played: 0, rpTotal: 0, rs: 0, avgNoFoul: 0, avgAuto: 0, avgEndgame: 0, rand: rand() }));
  for (const m of t.quals) {
    if (!m.result) continue;
    for (const [idx, res] of [
      [m.red, m.result.red],
      [m.blue, m.result.blue],
    ] as const)
      for (const i of idx) {
        const r = rows[i];
        r.played++;
        r.rpTotal += res.rp;
        r.avgNoFoul += res.noFoul;
        r.avgAuto += res.auto;
        r.avgEndgame += res.endgame;
      }
  }
  for (const r of rows) {
    const n = Math.max(1, r.played);
    r.rs = Math.round((r.rpTotal / n) * 100) / 100;
    r.avgNoFoul /= n;
    r.avgAuto /= n;
    r.avgEndgame /= n;
  }
  return rows.sort((a, b) => b.rs - a.rs || b.avgNoFoul - a.avgNoFoul || b.avgAuto - a.avgAuto || b.avgEndgame - a.avgEndgame || b.rand - a.rand);
}

// ------------------------------------------------------------------ selección de alianzas (§8.2.1)

/** Empieza la selección: los N primeros del ranking son capitanes. */
export function beginSelection(t: Tournament, ranking: RankRow[] = rankings(t), n: number = allianceCountFor(t.teams.length)): Selection {
  t.selection = { alliances: ranking.slice(0, n).map((r) => [r.team]), turn: 0, declined: [], log: [], ranking: ranking.map((r) => r.team) };
  return t.selection;
}

/** Elecciones que hay: una por alianza (alianzas de 2). */
const picks = (s: Selection) => s.alliances.length * (ALLIANCE_SIZE - 1);

/** Capitanes que se pueden invitar: los de alianzas de menor seed que aún no eligen (SUPUESTO, FRC §10.6). */
function invitableCaptains(s: Selection): number[] {
  const a = s.turn;
  return s.alliances.filter((al, j) => j > a && al.length === 1 && !s.declined.includes(al[0])).map((al) => al[0]);
}

function freeTeams(t: Tournament): number[] {
  const taken = new Set(t.selection!.alliances.flat());
  return t.teams.map((_, i) => i).filter((i) => !taken.has(i));
}

const stillNeeded = (s: Selection) => picks(s) - s.turn;

/** "El equipo posicionado en Rank 1 no puede seleccionar al equipo que esté en el Rank 2" (§8.2.1). */
const forbidden = (s: Selection, alliance: number, team: number) => s.alliances[alliance][0] === s.ranking[0] && team === s.ranking[1];

/**
 * Equipos que la alianza en turno puede invitar: los libres que no rechazaron y los capitanes
 * invitables. Si ya no alcanzan para llenar las alianzas (8 equipos = ninguno de sobra), los que
 * rechazaron vuelven a la lista y tienen que aceptar (`mustAccept`).
 */
export function availableTeams(t: Tournament): number[] {
  const s = t.selection!;
  const free = freeTeams(t);
  const open = free.filter((i) => !s.declined.includes(i));
  return [...(open.length >= stillNeeded(s) ? open : free), ...invitableCaptains(s)].filter((i) => !forbidden(s, s.turn, i));
}

/**
 * ¿El equipo tiene que aceptar? Si ya rechazó y volvió a la lista, o si rechazar dejaría una alianza
 * incompleta. Un capitán siempre puede rechazar (sigue como capitán de su alianza).
 */
export function mustAccept(t: Tournament, team: number): boolean {
  const s = t.selection!;
  if (s.alliances.some((al) => al[0] === team)) return false;
  if (s.declined.includes(team)) return true;
  const others = freeTeams(t).filter((i) => i !== team && !s.declined.includes(i)).length;
  return others < stillNeeded(s);
}

/** Alianza que elige ahora (índice 0–N−1), o null si terminó. */
export function selectionTurn(t: Tournament): number | null {
  const s = t.selection;
  if (!s || s.turn >= picks(s) || !availableTeams(t).length) return null;
  return s.turn;
}

/**
 * Elección de un capitán de la IA: el compañero con el que la predicción del Scouting
 * (`predictAlliance`) da más puntos netos; sin registros, el de más fuerza.
 */
export function aiPick(t: Tournament, alliance: number, cfg: GameConfig = GAME): number {
  const s = t.selection!;
  const sum = tournamentSummaries(t, cfg, 'quals');
  const cap = sum.get(s.alliances[alliance][0]);
  const value = (i: number) => {
    const me = sum.get(i);
    if (!cap || !me) return t.teams[i].strength * 100;
    const p = predictAlliance(cap, me, cfg);
    return p.points - p.foulPts;
  };
  return availableTeams(t).sort((a, b) => value(b) - value(a) || a - b)[0];
}

/**
 * ¿Un equipo de la IA acepta? Casi siempre; uno bastante mejor que el capitán que lo invita a veces
 * rechaza. Un capitán invitado acepta si le conviene más que encabezar su alianza.
 */
export function aiAccepts(t: Tournament, team: number, alliance: number, rand: () => number): boolean {
  if (mustAccept(t, team)) return true;
  const cap = t.teams[t.selection!.alliances[alliance][0]];
  const isCaptain = t.selection!.alliances.some((al) => al[0] === team);
  const base = isCaptain ? 0.25 : 0.06;
  const pDecline = Math.max(0.03, Math.min(isCaptain ? 0.85 : 0.45, base + 0.9 * (t.teams[team].strength - cap.strength)));
  return rand() >= pDecline;
}

/** Registra la respuesta a una invitación y avanza el turno si aceptó. */
export function respondInvite(t: Tournament, team: number, alliance: number, accepted: boolean): void {
  const s = t.selection!;
  accepted ||= mustAccept(t, team);
  s.log.push({ alliance, team, accepted });
  const capOf = s.alliances.findIndex((al, j) => j !== alliance && al[0] === team);
  if (!accepted) {
    s.declined.push(team);
    return;
  }
  s.alliances[alliance].push(team);
  s.turn++;
  if (capOf >= 0) {
    // Su alianza desaparece, las de abajo suben un lugar y el siguiente del ranking que esté libre es
    // capitán de la última (puede ser uno que rechazó)
    s.alliances.splice(capOf, 1);
    const taken = new Set(s.alliances.flat());
    const next = s.ranking.find((i) => !taken.has(i));
    if (next !== undefined) {
      s.alliances.push([next]);
      s.declined = s.declined.filter((d) => d !== next);
    }
  }
}

/** Cierra la selección y arma los PlayOffs. */
export function finishSelection(t: Tournament): void {
  t.alliances = t.selection!.alliances.filter((a) => a.length === ALLIANCE_SIZE);
  if (t.playoffFormat === 'doubleElim' && t.alliances.length !== 4) t.playoffFormat = 'manual';
  startPlayoffs(t);
}

// ------------------------------------------------------------------ PlayOffs

/** Victorias para ganar una serie o la final (§8.2.2: "a 2 de 3"). */
export const SERIES_WINS = 2;

/**
 * Ganador de un match de PlayOffs: el de más puntos; empate → puntos sin faltas, AUTO, ENDGAME
 * (SUPUESTO); si persiste, null (el match se repite).
 */
export function playoffWinner(m: TMatch): 'red' | 'blue' | null {
  const r = m.result;
  if (!r) return null;
  const keys: Array<keyof AllianceMatchResult> = ['score', 'noFoul', 'auto', 'endgame'];
  for (const k of keys) if (r.red[k] !== r.blue[k]) return r.red[k] > r.blue[k] ? 'red' : 'blue';
  return null;
}

/** Índice de alianza (0–N−1) de un lado de un match de PlayOffs. */
export function allianceIndexOf(t: Tournament, side: number[]): number {
  return t.alliances!.findIndex((a) => a[0] === side[0]);
}

export function startPlayoffs(t: Tournament): void {
  t.playoffs = [];
  t.champion = null;
  advancePlayoffs(t);
}

/** Series del todos contra todos en rondas (método del círculo): con 4 = 1-4 2-3 · 1-3 4-2 · 1-2 3-4. */
export function roundRobin(n: number): Array<[number, number]> {
  const ids: Array<number | null> = [...Array(n).keys()];
  if (n % 2) ids.push(null);
  const out: Array<[number, number]> = [];
  const m = ids.length;
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = ids[i];
      const b = ids[m - 1 - i];
      if (a !== null && b !== null) out.push(a < b ? [a, b] : [b, a]);
    }
    ids.splice(1, 0, ids.pop()!);
  }
  return out;
}

export interface SeriesState {
  /** Número de serie (slot de sus matches). */
  n: number;
  a: number;
  b: number;
  winsA: number;
  winsB: number;
  /** Alianza ganadora, si ya ganó 2. */
  winner?: number;
}

/** Estado de las series del todos contra todos. */
export function seriesState(t: Tournament): SeriesState[] {
  return roundRobin(t.alliances?.length ?? 0).map(([a, b], k) => {
    const s: SeriesState = { n: k + 1, a, b, winsA: 0, winsB: 0 };
    for (const m of t.playoffs) {
      if (m.kind !== 'playoff' || m.slot !== s.n) continue;
      const w = playoffWinner(m);
      if (!w) continue;
      if (allianceIndexOf(t, m[w]) === a) s.winsA++;
      else s.winsB++;
    }
    if (s.winsA >= SERIES_WINS) s.winner = a;
    else if (s.winsB >= SERIES_WINS) s.winner = b;
    return s;
  });
}

export interface StandingRow {
  alliance: number;
  seriesWon: number;
  seriesLost: number;
  matchWins: number;
  matchLosses: number;
  points: number;
}

/** Tabla del todos contra todos: series ganadas, matches ganados, puntos y seed (SUPUESTO). */
export function standings(t: Tournament): StandingRow[] {
  const rows: StandingRow[] = (t.alliances ?? []).map((_, alliance) => ({ alliance, seriesWon: 0, seriesLost: 0, matchWins: 0, matchLosses: 0, points: 0 }));
  for (const s of seriesState(t))
    if (s.winner !== undefined) {
      rows[s.winner].seriesWon++;
      rows[s.winner === s.a ? s.b : s.a].seriesLost++;
    }
  for (const m of t.playoffs) {
    if (m.kind !== 'playoff' || !m.result) continue;
    const r = allianceIndexOf(t, m.red);
    const b = allianceIndexOf(t, m.blue);
    rows[r].points += m.result.red.score;
    rows[b].points += m.result.blue.score;
    const w = playoffWinner(m);
    if (!w) continue;
    rows[w === 'red' ? r : b].matchWins++;
    rows[w === 'red' ? b : r].matchLosses++;
  }
  return rows.sort((x, y) => y.seriesWon - x.seriesWon || y.matchWins - x.matchWins || y.points - x.points || x.alliance - y.alliance);
}

/** De dónde sale cada lado de un match del bracket: un seed, o el ganador / perdedor de otro match. */
export type BracketSrc = { seed: number } | { w: number } | { l: number };

export interface BracketSlot {
  n: number;
  round: number;
  /** Llave inferior (quien pierde aquí queda eliminado). */
  lower: boolean;
  red: BracketSrc;
  blue: BracketSrc;
}

export interface BracketFormat {
  slots: BracketSlot[];
  finals: { red: number; blue: number };
}

/** Doble eliminación de 4 alianzas (la de rebuilt-sim para eventos chicos): 5 matches y la final a 2 de 3. */
export const DOUBLE_ELIM_4: BracketFormat = {
  slots: [
    { n: 1, round: 1, lower: false, red: { seed: 1 }, blue: { seed: 4 } },
    { n: 2, round: 1, lower: false, red: { seed: 2 }, blue: { seed: 3 } },
    { n: 3, round: 2, lower: true, red: { l: 1 }, blue: { l: 2 } },
    { n: 4, round: 2, lower: false, red: { w: 1 }, blue: { w: 2 } },
    { n: 5, round: 3, lower: true, red: { l: 4 }, blue: { w: 3 } },
  ],
  finals: { red: 4, blue: 5 },
};

/** Estado de la doble eliminación calculado a partir de los matches jugados. */
export interface BracketState {
  format: BracketFormat;
  sides: Map<number, { red?: number; blue?: number }>;
  outcomes: Map<number, { w: number; l: number }>;
}

export function bracketState(t: Tournament): BracketState {
  const format = DOUBLE_ELIM_4;
  const sides = new Map<number, { red?: number; blue?: number }>();
  const outcomes = new Map<number, { w: number; l: number }>();
  const resolve = (src: BracketSrc): number | undefined => {
    if ('seed' in src) return src.seed - 1 < (t.alliances?.length ?? 0) ? src.seed - 1 : undefined;
    const o = outcomes.get('w' in src ? src.w : src.l);
    return o ? ('w' in src ? o.w : o.l) : undefined;
  };
  for (const slot of format.slots) {
    const s = { red: resolve(slot.red), blue: resolve(slot.blue) };
    sides.set(slot.n, s);
    if (s.red === undefined || s.blue === undefined) continue;
    const last = t.playoffs.filter((m) => m.kind === 'playoff' && m.slot === slot.n).pop();
    const w = last && playoffWinner(last);
    if (!last || !w) continue;
    const winA = allianceIndexOf(t, last[w]);
    outcomes.set(slot.n, { w: winA, l: winA === s.red ? s.blue : s.red });
  }
  return { format, sides, outcomes };
}

/** Finalistas (rojo = el primero) cuando ya se conocen. */
export function finalists(t: Tournament): { red?: number; blue?: number } {
  if (!t.alliances) return {};
  if (t.playoffFormat === 'doubleElim') {
    const st = bracketState(t);
    return { red: st.outcomes.get(st.format.finals.red)?.w, blue: st.outcomes.get(st.format.finals.blue)?.w };
  }
  if (seriesState(t).some((s) => s.winner === undefined)) return {};
  const [a, b] = standings(t);
  return { red: a?.alliance, blue: b?.alliance };
}

/** Victorias en la final por alianza. */
export function finalsWins(t: Tournament): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of t.playoffs)
    if (m.kind === 'final') {
      const w = playoffWinner(m);
      if (!w) continue;
      const a = allianceIndexOf(t, m[w]);
      out.set(a, (out.get(a) ?? 0) + 1);
    }
  return out;
}

/**
 * Avanza los PlayOffs: programa los siguientes matches cuyos lados ya se conocen (las series del
 * todos contra todos juego por juego, o el bracket), repite los empates, arma la final a 2 de 3 o
 * declara campeón.
 */
export function advancePlayoffs(t: Tournament): void {
  if (!t.alliances || t.champion !== null) return;
  const al = t.alliances;
  const pendingIn = (slot: number) => t.playoffs.some((m) => m.kind === 'playoff' && m.slot === slot && !m.result);
  const count = (slot: number) => t.playoffs.filter((m) => m.kind === 'playoff' && m.slot === slot).length;
  if (t.playoffFormat === 'doubleElim') {
    const st = bracketState(t);
    for (const slot of st.format.slots) {
      const s = st.sides.get(slot.n)!;
      if (s.red === undefined || s.blue === undefined || st.outcomes.has(slot.n) || pendingIn(slot.n)) continue;
      const k = count(slot.n);
      t.playoffs.push({ id: k ? `M${slot.n}-R${k}` : `M${slot.n}`, kind: 'playoff', slot: slot.n, red: al[s.red], blue: al[s.blue] });
    }
  } else
    for (const s of seriesState(t)) {
      if (s.winner !== undefined || pendingIn(s.n)) continue;
      t.playoffs.push({ id: `P${s.n}-${count(s.n) + 1}`, kind: 'playoff', slot: s.n, red: al[s.a], blue: al[s.b] });
    }
  const { red, blue } = finalists(t);
  if (red === undefined || blue === undefined) return;
  for (const [a, w] of finalsWins(t))
    if (w >= SERIES_WINS) {
      t.champion = a;
      return;
    }
  const finals = t.playoffs.filter((m) => m.kind === 'final');
  if (finals.some((m) => !m.result)) return;
  t.playoffs.push({ id: `F${finals.length + 1}`, kind: 'final', red: al[red], blue: al[blue] });
}

/**
 * Lugar de cada alianza (índice → lugar): 1 campeón, 2 finalista; luego, con el formato del manual, el
 * orden del todos contra todos (el último queda eliminado, §8.2.2); con doble eliminación, el perdedor
 * de M5 es 3 y el de M3 es 4. Las que siguen en juego no aparecen.
 */
export function placements(t: Tournament): Map<number, number> {
  const out = new Map<number, number>();
  if (!t.alliances) return out;
  if (t.playoffFormat === 'doubleElim') {
    const st = bracketState(t);
    const l5 = st.outcomes.get(5);
    const l3 = st.outcomes.get(3);
    if (l5) out.set(l5.l, 3);
    if (l3) out.set(l3.l, 4);
  } else if (seriesState(t).every((s) => s.winner !== undefined)) standings(t).forEach((r, i) => i >= 2 && out.set(r.alliance, i + 1));
  if (t.champion !== null) {
    out.set(t.champion, 1);
    const { red, blue } = finalists(t);
    const other = t.champion === red ? blue : red;
    if (other !== undefined) out.set(other, 2);
  }
  return out;
}

/** Torneo guardado válido (o null): versión y forma básica; si no, se empieza otro. */
export function sanitizeTournament(raw: unknown): Tournament | null {
  const o = raw as Tournament | null;
  if (!o || typeof o !== 'object' || o.version !== 1 || !Array.isArray(o.teams) || !Array.isArray(o.quals) || !Array.isArray(o.playoffs)) return null;
  const n = o.teams.length;
  const ok = (m: TMatch) => Array.isArray(m.red) && Array.isArray(m.blue) && [...m.red, ...m.blue].every((i) => Number.isInteger(i) && i >= 0 && i < n);
  if (n < 4 || !o.quals.every(ok) || !o.playoffs.every(ok)) return null;
  o.playoffFormat = o.playoffFormat === 'doubleElim' ? 'doubleElim' : 'manual';
  return o;
}
