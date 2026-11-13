/**
 * Datos del scouting guardados en el navegador (localStorage): equipos del reto, registros por
 * match, formato del torneo (SUPUESTO, `core/tournament.ts`) y calendario. Todo pasa por
 * `sanitizeScout` (un valor raro guardado no rompe la pantalla). Se exporta e importa como JSON y
 * los registros también como CSV (para una hoja de cálculo).
 */
import type { GameConfig } from '../config/game';
import { DEFAULT_ROBOT, MECHANISM_KINDS, type MechanismKind } from '../config/robot';
import { entryPoints, type LevelCounts, type ScoutEntry, type Team } from '../core/scouting';
import { DEFAULT_FORMAT, type QualMatch, type TournamentFormat } from '../core/tournament';

export interface ScoutData {
  format: 'labbot-scouting';
  version: 1;
  teams: Team[];
  entries: ScoutEntry[];
  tournament: TournamentFormat;
  schedule: QualMatch[];
}

/** 8 equipos en el reto interno; mitad con cada versión del pivote (se editan en la pantalla). */
export function defaultTeams(): Team[] {
  const kinds: MechanismKind[] = ['pivot', 'pivot180', 'pivot', 'pivot180', 'pivot', 'pivot180', 'pivot', 'pivot180'];
  return kinds.map((robot, i) => ({ id: `E${i + 1}`, name: `Equipo ${i + 1}`, robot }));
}

export function emptyScout(): ScoutData {
  return { format: 'labbot-scouting', version: 1, teams: defaultTeams(), entries: [], tournament: { ...DEFAULT_FORMAT }, schedule: [] };
}

const KEY = 'labbot.scouting';
const str = (v: unknown, def: string, max = 40): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
const int = (v: unknown, max = 99): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
const counts = (v: unknown): LevelCounts => (Array.isArray(v) ? [int(v[0]), int(v[1]), int(v[2])] : [0, 0, 0]);

/** Datos válidos a partir de cualquier valor (lo que no sirve se descarta o toma el valor por defecto). */
export function sanitizeScout(raw: unknown): ScoutData {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = emptyScout();
  const teams: Team[] = [];
  if (Array.isArray(o.teams))
    for (const x of o.teams) {
      const t = (x ?? {}) as Record<string, unknown>;
      const id = str(t.id, '', 12);
      if (!id || teams.some((y) => y.id === id)) continue;
      // Un tipo quitado (genérico, elevador, torre, chasis, pivote con hopper) pasa a pivote
      teams.push({ id, name: str(t.name, id), robot: MECHANISM_KINDS.find((k) => k === t.robot) ?? DEFAULT_ROBOT.mechanism });
    }
  const ids = new Set((teams.length ? teams : d.teams).map((t) => t.id));
  const entries: ScoutEntry[] = [];
  if (Array.isArray(o.entries))
    for (const x of o.entries) {
      const e = (x ?? {}) as Record<string, unknown>;
      const team = str(e.team, '', 12);
      if (!ids.has(team)) continue;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      entries.push({
        id: str(e.id, `${team}-${entries.length}`, 80),
        match: str(e.match, '?', 20),
        team,
        alliance: e.alliance === 'blue' ? 'blue' : 'red',
        source: e.source === 'sim' ? 'sim' : 'manual',
        autoLine: e.autoLine === true,
        samplesAuto: counts(e.samplesAuto),
        samplesTeleop: counts(e.samplesTeleop),
        platform: e.platform === true,
        critical: e.critical === true,
        fouls: int(e.fouls),
        techFouls: int(e.techFouls),
        yellow: int(e.yellow, 2),
        red: e.red === true,
        allianceScore: num(e.allianceScore),
        opponentScore: num(e.opponentScore),
        rp: num(e.rp),
        ...(typeof e.cycles === 'number' ? { cycles: int(e.cycles) } : {}),
        ...(typeof e.cycleAvg === 'number' && Number.isFinite(e.cycleAvg) && e.cycleAvg > 0 ? { cycleAvg: Math.min(150, Math.round(e.cycleAvg * 10) / 10) } : {}),
        notes: typeof e.notes === 'string' ? e.notes.slice(0, 300) : undefined,
        createdAt: str(e.createdAt, new Date(0).toISOString(), 30),
      });
    }
  const f = (o.tournament ?? {}) as Record<string, unknown>;
  const tournament: TournamentFormat = {
    qualsPerTeam: Math.max(1, Math.min(12, int(f.qualsPerTeam) || DEFAULT_FORMAT.qualsPerTeam)),
    alliances: Math.max(2, Math.min(8, int(f.alliances) || DEFAULT_FORMAT.alliances)),
    allianceSize: f.allianceSize === 3 ? 3 : 2,
    draft: f.draft === 'straight' ? 'straight' : 'serpentine',
    rankBy: f.rankBy === 'points' ? 'points' : 'rp',
  };
  const schedule: QualMatch[] = [];
  if (Array.isArray(o.schedule))
    for (const x of o.schedule) {
      const q = (x ?? {}) as Record<string, unknown>;
      const pair = (v: unknown): [string, string] | null => (Array.isArray(v) && v.length === 2 && v.every((t) => typeof t === 'string' && ids.has(t)) ? [v[0], v[1]] : null);
      const red = pair(q.red);
      const blue = pair(q.blue);
      if (red && blue) schedule.push({ id: str(q.id, `Q${schedule.length + 1}`, 10), red, blue });
    }
  return { format: 'labbot-scouting', version: 1, teams: teams.length ? teams : d.teams, entries, tournament, schedule };
}

export function loadScout(): ScoutData {
  try {
    return sanitizeScout(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return emptyScout();
  }
}

export function saveScout(s: ScoutData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}

/** Registros como CSV (una fila por equipo y match), con los puntos calculados. */
export function scoutCsv(s: ScoutData, cfg: GameConfig): string {
  const name = new Map(s.teams.map((t) => [t.id, t.name]));
  const head = ['match', 'equipo', 'nombre', 'alianza', 'fuente', 'linea', 'auto_n1', 'auto_n2', 'auto_n3', 'teleop_n1', 'teleop_n2', 'teleop_n3', 'plataforma', 'critica', 'fouls', 'tech_fouls', 'yellow', 'red', 'pts_auto', 'pts_teleop', 'pts_endgame', 'pts_total', 'pts_faltas', 'marcador', 'rival', 'rp', 'ciclos', 'ciclo_s', 'notas'];
  const q = (v: unknown) => {
    const x = v === undefined ? '' : String(v);
    return /[",\n]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x;
  };
  const rows = s.entries.map((e) => {
    const p = entryPoints(e, cfg);
    return [e.match, e.team, name.get(e.team), e.alliance, e.source, +e.autoLine, ...e.samplesAuto, ...e.samplesTeleop, +e.platform, +e.critical, e.fouls, e.techFouls, e.yellow, +e.red, p.auto, p.teleop, p.endgame, p.total, p.foulPts, e.allianceScore, e.opponentScore, e.rp, e.cycles, e.cycleAvg, e.notes]
      .map(q)
      .join(',');
  });
  return [head.join(','), ...rows].join('\n');
}
