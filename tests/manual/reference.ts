/**
 * Marcador de referencia escrito directo de la tabla de §4.4 y de §4.3.3, §4.5, §4.6, SIN usar
 * `core/match.ts` ni `config/game.ts`. Las pruebas de `manual.test.ts` juegan matches al azar en los
 * dos y comparan: si alguien cambia un número o una regla del simulador, este archivo (el manual)
 * no cambia y la prueba falla. Si el que cambia es el manual, se corrige aquí y en `config/game.ts`.
 */
import type { Alliance, Level } from '../../src/core/types';

/** Tabla de §4.4 tal como viene en el manual (columnas Auto / TeleOp / EndGame / RP). */
export const TABLE_4_4 = {
  autoLine: { auto: 5, rp: 1 }, // "Ambos robots de la alianza cruzan la línea de autónomo" · "5 c/u"
  sample: {
    1: { auto: 5, teleop: 2, endgame: 2 },
    2: { auto: 10, teleop: 6, endgame: 6 },
    3: { auto: 18, teleop: 15, endgame: 15 },
  } as Record<Level, { auto: number; teleop: number; endgame: number }>,
  robotOnPlatform: 10, // 1 robot sobre la Plataforma al sonar la bocina
  allianceOnPlatform: 20, // 2 robots; "no son acumulables … 20 puntos totales (no 10 + 20)"
  critical: { endgame: 15, rp: 1 },
  dominance: { samples: 10, rp: 1 }, // "≥10 muestras anotadas en su Cámara al final del match"
  tie: 1,
  win: 2,
} as const;

/** §2, §4.2, §4.3, §4.3.1: 15 s de AUTO, 135 s de TELEOP; ENDGAME = últimos 30 s. */
export const TIMES = { auto: 15, teleop: 135, endgame: 30 } as const;

/** §4.5: "Cada foul otorga 4 puntos"; §4.6: "Cada Tech Foul otorga 8 puntos". */
export const FOUL_POINTS = { foul: 4, tech: 8 } as const;

export type RefEvent =
  | { t: number; type: 'autoLine'; alliance: Alliance; robot: number }
  | { t: number; type: 'sample'; alliance: Alliance; level: Level }
  | { t: number; type: 'foul'; offender: Alliance; tech: boolean }
  | { t: number; type: 'yellow'; alliance: Alliance; robot: number };

export interface RefEnd {
  platform: Record<Alliance, number>;
  critical: Record<Alliance, boolean>;
}

export interface RefResult {
  score: Record<Alliance, number>;
  rp: Record<Alliance, number>;
}

const other = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

/**
 * Marcador según el manual. Supuestos que usa (los mismos del simulador, ver docs/reglas-reto.md):
 * D2 (5 por robot que cruza), D4 (cada Muestra vale lo del periodo en que se deposita), D9 (sin pausa
 * entre AUTO y TELEOP), D10 (Red Card: la alianza entera en 0 puntos y 0 RP), D12 (sin gracia al final),
 * D25 (Yellow Cards por match).
 */
export function referenceScore(events: readonly RefEvent[], end: RefEnd, robotsPerAlliance = 2): RefResult {
  const T = TABLE_4_4;
  const total = TIMES.auto + TIMES.teleop;
  const pts: Record<Alliance, number> = { red: 0, blue: 0 };
  const samples: Record<Alliance, number> = { red: 0, blue: 0 };
  const crossed: Record<Alliance, Set<number>> = { red: new Set(), blue: new Set() };
  const yellows = new Map<number, number>();
  const red = new Set<Alliance>();
  for (const e of events) {
    if (e.t < 0 || e.t >= total) continue;
    const auto = e.t < TIMES.auto;
    const endgame = e.t >= total - TIMES.endgame;
    if (e.type === 'autoLine') {
      if (auto && !crossed[e.alliance].has(e.robot)) {
        crossed[e.alliance].add(e.robot);
        pts[e.alliance] += T.autoLine.auto;
      }
    } else if (e.type === 'sample') {
      const row = T.sample[e.level];
      pts[e.alliance] += auto ? row.auto : endgame ? row.endgame : row.teleop;
      samples[e.alliance]++;
    } else if (e.type === 'foul') {
      pts[other(e.offender)] += e.tech ? FOUL_POINTS.tech : FOUL_POINTS.foul;
    } else {
      const n = (yellows.get(e.robot) ?? 0) + 1;
      yellows.set(e.robot, n);
      if (n >= 2) red.add(e.alliance); // §4.3.3 "Acumular 2 Yellow Cards"
    }
  }
  for (const a of ['red', 'blue'] as const) {
    const p = end.platform[a];
    pts[a] += p >= 2 ? T.allianceOnPlatform : p === 1 ? T.robotOnPlatform : 0;
    if (end.critical[a]) pts[a] += T.critical.endgame;
  }
  const score = { red: red.has('red') ? 0 : pts.red, blue: red.has('blue') ? 0 : pts.blue };
  const rp = { red: 0, blue: 0 };
  for (const a of ['red', 'blue'] as const) {
    if (red.has(a)) continue;
    const o = other(a);
    rp[a] =
      (score[a] > score[o] ? T.win : score[a] === score[o] ? T.tie : 0) +
      (crossed[a].size >= robotsPerAlliance ? T.autoLine.rp : 0) +
      (end.critical[a] ? T.critical.rp : 0) +
      (samples[a] >= T.dominance.samples ? T.dominance.rp : 0);
  }
  return { score, rp };
}
