/**
 * OPR, DPR y CCWM (lógica pura), como en el scouting de FRC: con el marcador de cada alianza en
 * cada match se estima cuánto aporta cada equipo por mínimos cuadrados (puntos de la alianza ≈ suma
 * de los OPR de sus robots). DPR es lo mismo con los puntos del rival (cuántos le "permite" anotar) y
 * CCWM con el margen (= OPR − DPR). Además se estima por componente (AUTO, TELEOP, ENDGAME, puntos
 * sin faltas y Muestras).
 *
 * El manual no define estas métricas (son del scouting, no del reto). SUPUESTO: con pocos matches el
 * sistema no tiene solución única; se regulariza hacia el promedio por robot (`RIDGE`), así un equipo
 * con un solo match no queda con un número disparatado.
 */
import type { GameConfig } from '../config/game';
import type { ScoutEntry } from './scouting';
import { resultFromEntries, type AllianceMatchResult, type Tournament } from './tournament';

/** Lo que anotó una alianza en un match. */
export interface AllianceScore {
  /** Marcador final (con los puntos de faltas del rival, §4.5–§4.6). */
  score: number;
  /** Puntos propios, sin faltas del rival. */
  noFoul: number;
  auto: number;
  teleop: number;
  endgame: number;
  samples: number;
}

export interface OprMatch {
  id: string;
  red: string[];
  blue: string[];
  redScore: AllianceScore;
  blueScore: AllianceScore;
}

export interface OprRow {
  team: string;
  /** Apariciones en matches usados. */
  matches: number;
  opr: number;
  dpr: number;
  ccwm: number;
  noFoul: number;
  auto: number;
  teleop: number;
  endgame: number;
  samples: number;
}

/** Peso de la regularización hacia el promedio (SUPUESTO; con datos completos casi no se nota). */
export const RIDGE = 0.1;

const fromResult = (r: AllianceMatchResult): AllianceScore => ({ score: r.score, noFoul: r.noFoul, auto: r.auto, teleop: r.noFoul - r.auto - r.endgame, endgame: r.endgame, samples: r.samples });

/**
 * Matches del Scouting con las dos alianzas completas (`perAlliance` registros cada una). El
 * marcador se calcula con los registros (`resultFromEntries`); si alguno trae el marcador real
 * (`allianceScore`) se usa ese.
 */
export function oprMatchesFromEntries(entries: readonly ScoutEntry[], cfg: GameConfig, perAlliance = 2): OprMatch[] {
  const by = new Map<string, ScoutEntry[]>();
  for (const e of entries) by.set(e.match, [...(by.get(e.match) ?? []), e]);
  const out: OprMatch[] = [];
  for (const [id, es] of by) {
    const red = es.filter((e) => e.alliance === 'red');
    const blue = es.filter((e) => e.alliance === 'blue');
    if (red.length !== perAlliance || blue.length !== perAlliance) continue;
    const res = resultFromEntries(red, blue, cfg);
    const real = (side: ScoutEntry[]) => side.find((e) => e.allianceScore !== undefined)?.allianceScore;
    const rs = fromResult(res.red);
    const bs = fromResult(res.blue);
    rs.score = real(red) ?? rs.score;
    bs.score = real(blue) ?? bs.score;
    out.push({ id, red: red.map((e) => e.team), blue: blue.map((e) => e.team), redScore: rs, blueScore: bs });
  }
  return out;
}

/** Matches del modo torneo con resultado (ids de equipo del Scouting). */
export function oprMatchesFromTournament(t: Tournament, which: 'quals' | 'all' = 'quals'): OprMatch[] {
  return [...t.quals, ...(which === 'all' ? t.playoffs : [])]
    .filter((m) => m.result)
    .map((m) => ({ id: m.id, red: m.red.map((i) => t.teams[i].id), blue: m.blue.map((i) => t.teams[i].id), redScore: fromResult(m.result!.red), blueScore: fromResult(m.result!.blue) }));
}

/** Resuelve M·x = v (M simétrica definida positiva) por eliminación de Gauss con pivoteo. */
function solve(M: number[][], v: number[]): number[] {
  const n = v.length;
  const a = M.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / d;
      if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Mínimos cuadrados regularizados: cada fila es una alianza (sus equipos) con su valor `y`.
 * Resuelve las desviaciones respecto al promedio por robot (ȳ / robots por alianza), con `ridge`.
 */
export function leastSquares(rows: ReadonlyArray<{ teams: readonly string[]; y: number }>, teams: readonly string[], ridge = RIDGE): Map<string, number> {
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const out = new Map<string, number>();
  if (!rows.length || !n) return out;
  const size = rows.reduce((a, r) => a + r.teams.length, 0) / rows.length;
  const base = rows.reduce((a, r) => a + r.y, 0) / rows.length / size;
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const v = new Array<number>(n).fill(0);
  for (const r of rows) {
    const ix = r.teams.map((t) => idx.get(t)).filter((i): i is number => i !== undefined);
    const y = r.y - base * ix.length;
    for (const i of ix) {
      v[i] += y;
      for (const j of ix) M[i][j] += 1;
    }
  }
  for (let i = 0; i < n; i++) M[i][i] += ridge;
  solve(M, v).forEach((d, i) => out.set(teams[i], base + d));
  return out;
}

/** OPR, DPR, CCWM y OPR por componente de cada equipo que aparece en los matches. */
export function computeOpr(matches: readonly OprMatch[], ridge = RIDGE): OprRow[] {
  const teams = [...new Set(matches.flatMap((m) => [...m.red, ...m.blue]))].sort();
  const count = new Map<string, number>();
  for (const m of matches) for (const t of [...m.red, ...m.blue]) count.set(t, (count.get(t) ?? 0) + 1);
  const sides = matches.flatMap((m) => [
    { teams: m.red, me: m.redScore, op: m.blueScore },
    { teams: m.blue, me: m.blueScore, op: m.redScore },
  ]);
  const fit = (f: (s: (typeof sides)[number]) => number) => leastSquares(sides.map((s) => ({ teams: s.teams, y: f(s) })), teams, ridge);
  const opr = fit((s) => s.me.score);
  const dpr = fit((s) => s.op.score);
  const comp = (k: keyof AllianceScore) => fit((s) => s.me[k]);
  const noFoul = comp('noFoul');
  const auto = comp('auto');
  const teleop = comp('teleop');
  const endgame = comp('endgame');
  const samples = comp('samples');
  return teams
    .map((team) => ({
      team,
      matches: count.get(team) ?? 0,
      opr: opr.get(team)!,
      dpr: dpr.get(team)!,
      ccwm: opr.get(team)! - dpr.get(team)!,
      noFoul: noFoul.get(team)!,
      auto: auto.get(team)!,
      teleop: teleop.get(team)!,
      endgame: endgame.get(team)!,
      samples: samples.get(team)!,
    }))
    .sort((a, b) => b.opr - a.opr);
}

/**
 * Qué tan bien explica el OPR los marcadores: error promedio (puntos) de predecir cada alianza como la
 * suma de sus OPR. Sirve para avisar cuando hay pocos datos o mucho ruido.
 */
export function oprError(matches: readonly OprMatch[], rows: readonly OprRow[]): number {
  const by = new Map(rows.map((r) => [r.team, r.opr]));
  const errs = matches.flatMap((m) => [
    Math.abs(m.red.reduce((a, t) => a + (by.get(t) ?? 0), 0) - m.redScore.score),
    Math.abs(m.blue.reduce((a, t) => a + (by.get(t) ?? 0), 0) - m.blueScore.score),
  ]);
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
}
