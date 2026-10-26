/**
 * Historial entre torneos y temporadas (lógica pura): cada torneo terminado del modo torneo (o una
 * foto del Scouting) se guarda como un "evento" con sus registros por robot, los marcadores para el
 * OPR, el ranking final y el lugar de cada equipo. Con eso se arma la tabla de cada equipo a lo largo
 * de los eventos y de las temporadas.
 *
 * SUPUESTO: un equipo es el mismo entre eventos si conserva su id del Scouting ("E1"…), aunque cambie
 * de nombre o de robot; la temporada es el año del evento salvo que se le ponga otra.
 */
import type { GameConfig } from '../config/game';
import { MECHANISM_KINDS, type MechanismKind } from '../config/robot';
import { computeOpr, oprMatchesFromEntries, oprMatchesFromTournament, type OprMatch } from './opr';
import { summarize, type ScoutEntry, type Team, type TeamSummary } from './scouting';
import { placements, rankings, tournamentEntries, type Tournament } from './tournament';

export interface HistoryEvent {
  id: string;
  name: string;
  season: string;
  /** ISO. */
  date: string;
  source: 'tournament' | 'scouting';
  teams: Team[];
  entries: ScoutEntry[];
  matches: OprMatch[];
  /** Ids de equipo en el orden del ranking de clasificación. */
  ranking: string[];
  /** Lugar final de cada equipo (1 = campeón) si hubo PlayOffs. */
  place: Record<string, number>;
  /** Equipo que manejó el jugador (modo torneo). */
  player?: string;
}

export interface HistoryData {
  format: 'labbot-history';
  version: 1;
  events: HistoryEvent[];
}

/** Máximo de eventos guardados (los más viejos se borran). */
export const MAX_EVENTS = 40;

export const emptyHistory = (): HistoryData => ({ format: 'labbot-history', version: 1, events: [] });
export const seasonOf = (date: Date): string => String(date.getFullYear());

/** Id del evento de un torneo (el mismo torneo no se guarda dos veces). */
export const tournamentEventId = (t: Tournament): string => `T-${t.seed}`;

/** Evento a partir de un torneo del modo torneo (lo ideal: ya con campeón). */
export function eventFromTournament(t: Tournament, name: string, now = new Date()): HistoryEvent {
  const place: Record<string, number> = {};
  if (t.alliances) for (const [a, p] of placements(t)) for (const i of t.alliances[a]) place[t.teams[i].id] = p;
  const player = t.teams.find((x) => x.isPlayer)?.id;
  return {
    id: tournamentEventId(t),
    name,
    season: seasonOf(now),
    date: now.toISOString(),
    source: 'tournament',
    teams: t.teams.map((x) => ({ id: x.id, name: x.name, robot: x.robot })),
    entries: tournamentEntries(t),
    matches: oprMatchesFromTournament(t, 'all'),
    ranking: rankings(t).map((r) => t.teams[r.team].id),
    place,
    ...(player ? { player } : {}),
  };
}

/** Evento a partir de los registros del Scouting (ranking por puntos netos, sin lugares). */
export function eventFromScouting(teams: readonly Team[], entries: readonly ScoutEntry[], name: string, cfg: GameConfig, now = new Date()): HistoryEvent {
  return {
    id: `S-${now.getTime()}`,
    name,
    season: seasonOf(now),
    date: now.toISOString(),
    source: 'scouting',
    teams: teams.map((x) => ({ ...x })),
    entries: entries.map((e) => ({ ...e })),
    matches: oprMatchesFromEntries(entries, cfg),
    ranking: summarize(entries, cfg).map((s) => s.team),
    place: {},
  };
}

/** Agrega (o reemplaza, mismo id) un evento; deja los `MAX_EVENTS` más nuevos. */
export function addEvent(h: HistoryData, e: HistoryEvent): HistoryData {
  const events = [...h.events.filter((x) => x.id !== e.id), e].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_EVENTS);
  return { ...h, events };
}

/** Lo que hizo un equipo en un evento. */
export interface TeamEventRow {
  event: HistoryEvent;
  team: string;
  name: string;
  robot: MechanismKind;
  rank: number;
  of: number;
  place?: number;
  summary?: TeamSummary;
  opr?: number;
  ccwm?: number;
}

/** Fila de cada equipo en cada evento donde aparece (orden cronológico). */
export function teamEventRows(h: HistoryData, cfg: GameConfig): TeamEventRow[] {
  const out: TeamEventRow[] = [];
  for (const ev of h.events) {
    const sum = new Map(summarize(ev.entries, cfg).map((s) => [s.team, s]));
    const opr = new Map(computeOpr(ev.matches).map((r) => [r.team, r]));
    for (const tm of ev.teams) {
      const rank = ev.ranking.indexOf(tm.id);
      out.push({ event: ev, team: tm.id, name: tm.name, robot: tm.robot, rank: rank >= 0 ? rank + 1 : ev.teams.length, of: ev.teams.length, place: ev.place[tm.id], summary: sum.get(tm.id), opr: opr.get(tm.id)?.opr, ccwm: opr.get(tm.id)?.ccwm });
    }
  }
  return out;
}

/** Resumen de un equipo en un conjunto de eventos (una temporada o todo el historial). */
export interface TeamCareer {
  team: string;
  /** Nombre del evento más reciente. */
  name: string;
  robot: MechanismKind;
  events: number;
  /** Promedios entre eventos. */
  opr: number | null;
  points: number | null;
  rank: number;
  bestRank: number;
  titles: number;
  finals: number;
  /** OPR de cada evento en orden (tendencia). */
  oprTrend: number[];
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Carrera de cada equipo en los eventos de `season` (todas si no se da). */
export function careers(h: HistoryData, cfg: GameConfig, season?: string): TeamCareer[] {
  const rows = teamEventRows({ ...h, events: h.events.filter((e) => !season || e.season === season) }, cfg);
  const by = new Map<string, TeamEventRow[]>();
  for (const r of rows) by.set(r.team, [...(by.get(r.team) ?? []), r]);
  return [...by.values()]
    .map((rs): TeamCareer => {
      const last = rs[rs.length - 1];
      const oprs = rs.filter((r) => r.opr !== undefined).map((r) => r.opr!);
      return {
        team: last.team,
        name: last.name,
        robot: last.robot,
        events: rs.length,
        opr: avg(oprs),
        points: avg(rs.filter((r) => r.summary).map((r) => r.summary!.points)),
        rank: avg(rs.map((r) => r.rank))!,
        bestRank: Math.min(...rs.map((r) => r.rank)),
        titles: rs.filter((r) => r.place === 1).length,
        finals: rs.filter((r) => r.place === 1 || r.place === 2).length,
        oprTrend: oprs,
      };
    })
    .sort((a, b) => b.titles - a.titles || (b.opr ?? -Infinity) - (a.opr ?? -Infinity) || a.rank - b.rank);
}

/** Temporadas presentes, de la más nueva a la más vieja. */
export const seasons = (h: HistoryData): string[] => [...new Set(h.events.map((e) => e.season))].sort().reverse();

/** Desempeño promedio por tipo de robot (todos los equipos que lo llevan). */
export interface KindRow {
  robot: MechanismKind;
  teams: number;
  matches: number;
  points: number;
  samples: number;
  n3: number;
  cycle: number | null;
  platformPct: number;
  criticalPct: number;
  foulPts: number;
}

export function byRobotKind(summaries: readonly TeamSummary[], kindOf: (team: string) => MechanismKind): KindRow[] {
  const by = new Map<MechanismKind, TeamSummary[]>();
  for (const s of summaries) by.set(kindOf(s.team), [...(by.get(kindOf(s.team)) ?? []), s]);
  // Promedio por match (pesado por los matches de cada equipo)
  const w = (ss: TeamSummary[], f: (s: TeamSummary) => number) => ss.reduce((a, s) => a + f(s) * s.matches, 0) / Math.max(1, ss.reduce((a, s) => a + s.matches, 0));
  return [...by]
    .map(([robot, ss]): KindRow => {
      const cyc = ss.filter((s) => s.cycle !== null);
      return {
        robot,
        teams: ss.length,
        matches: ss.reduce((a, s) => a + s.matches, 0),
        points: w(ss, (s) => s.points),
        samples: w(ss, (s) => s.samples),
        n3: w(ss, (s) => s.n3),
        cycle: cyc.length ? cyc.reduce((a, s) => a + s.cycle!, 0) / cyc.length : null,
        platformPct: w(ss, (s) => s.platformPct),
        criticalPct: w(ss, (s) => s.criticalPct),
        foulPts: w(ss, (s) => s.foulPts),
      };
    })
    .sort((a, b) => b.points - a.points);
}

/** Historial válido a partir de cualquier valor (lo que no sirve se descarta). */
export function sanitizeHistory(raw: unknown): HistoryData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const h = emptyHistory();
  if (!Array.isArray(o.events)) return h;
  const str = (v: unknown, def: string, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const score = (v: unknown) => {
    const s = (v ?? {}) as Record<string, unknown>;
    return { score: num(s.score), noFoul: num(s.noFoul), auto: num(s.auto), teleop: num(s.teleop), endgame: num(s.endgame), samples: num(s.samples) };
  };
  for (const x of o.events) {
    const e = (x ?? {}) as Record<string, unknown>;
    if (!Array.isArray(e.teams) || !Array.isArray(e.entries) || !Array.isArray(e.matches)) continue;
    const teams: Team[] = e.teams
      .map((t) => (t ?? {}) as Record<string, unknown>)
      .filter((t) => typeof t.id === 'string' && t.id)
      .map((t) => ({ id: String(t.id).slice(0, 12), name: str(t.name, String(t.id), 40), robot: MECHANISM_KINDS.find((k) => k === t.robot) ?? 'tower' }));
    const ids = new Set(teams.map((t) => t.id));
    const idList = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && ids.has(t)) : []);
    const place: Record<string, number> = {};
    if (e.place && typeof e.place === 'object') for (const [k, v] of Object.entries(e.place)) if (ids.has(k) && Number.isInteger(v)) place[k] = v as number;
    h.events.push({
      id: str(e.id, `X-${h.events.length}`, 40),
      name: str(e.name, '?'),
      season: str(e.season, '?', 20),
      date: str(e.date, new Date(0).toISOString(), 30),
      source: e.source === 'scouting' ? 'scouting' : 'tournament',
      teams,
      // Los registros ya pasaron por `sanitizeScout` al guardarse; aquí solo se filtran equipos
      entries: (e.entries as ScoutEntry[]).filter((r) => r && ids.has(r.team) && Array.isArray(r.samplesAuto) && Array.isArray(r.samplesTeleop)),
      matches: (e.matches as unknown[]).map((m) => (m ?? {}) as Record<string, unknown>).map((m) => ({ id: str(m.id, '?', 20), red: idList(m.red), blue: idList(m.blue), redScore: score(m.redScore), blueScore: score(m.blueScore) })).filter((m) => m.red.length && m.blue.length),
      ranking: idList(e.ranking),
      place,
      ...(typeof e.player === 'string' && ids.has(e.player) ? { player: e.player } : {}),
    });
  }
  h.events = h.events.slice(-MAX_EVENTS);
  return h;
}
