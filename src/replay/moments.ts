/**
 * Jugadas clave de una repetición (lógica pura, sin DOM): Muestras anotadas, Línea de Autónomo,
 * Muestra Crítica, faltas, tarjetas, cambios de fase y Plataforma al final, cada una con su tiempo,
 * su alianza, su robot y la sección del manual de donde sale. Sirve para saltar entre jugadas en la
 * barra de la repetición y para el "Resumen" (solo los segundos alrededor de cada jugada).
 *
 * Qué cuenta y cuánto vale sale del registro del match (`matchEvents`) y de los eventos de la
 * grabación (`events`), no se recalcula aquí: este módulo solo los ordena y los etiqueta.
 */
import { GAME } from '../config/game';
import { RULES } from '../core/fouls';
import { opponent, type Alliance, type Level } from '../core/types';
import { replayDuration, type Replay } from './format';

/** Tipos de jugada (la UI elige ícono y texto por tipo). */
export type MomentKind = 'score' | 'autoLine' | 'critical' | 'foul' | 'card' | 'phase' | 'platform';

/** Filtros de la barra: todas, solo las que dan puntos por jugar, o solo las de arbitraje. */
export type MomentFilter = 'all' | 'points' | 'fouls';
export const MOMENT_FILTERS: readonly MomentFilter[] = ['all', 'points', 'fouls'];

export interface Moment {
  /** Segundos desde el inicio del match (mismo reloj que la repetición). */
  t: number;
  kind: MomentKind;
  /** Alianza que la hizo (en faltas y tarjetas, la que la comete). */
  alliance?: Alliance;
  /** Índice del robot (`RobotSpec` de `header.robots[i].index`), si se sabe. */
  robot?: number;
  /** Puntos que movió en el marcador y a qué alianza fueron (en faltas, a la contraria: §4.5, §4.6). */
  points?: number;
  pointsTo?: Alliance;
  /** Detalle para el texto: nivel de la Muestra, regla o tipo de falta, tarjeta, fase, robots en la Plataforma. */
  level?: Level;
  period?: 'AUTO' | 'TELEOP';
  rule?: string;
  foulKind?: 'FOUL' | 'TECH';
  card?: 'YELLOW' | 'RED';
  phase?: string;
  robots?: number;
  /** Sección del manual que respalda la jugada. */
  section: string;
}

const POINT_KINDS: ReadonlySet<MomentKind> = new Set(['score', 'autoLine', 'critical', 'platform']);
const FOUL_KINDS: ReadonlySet<MomentKind> = new Set(['foul', 'card']);

export function matchesFilter(m: Moment, f: MomentFilter): boolean {
  if (f === 'points') return POINT_KINDS.has(m.kind);
  if (f === 'fouls') return FOUL_KINDS.has(m.kind);
  return true;
}

/** Orden estable dentro del mismo instante: fase primero, luego jugadas, luego arbitraje. */
const ORDER: Record<MomentKind, number> = { phase: 0, autoLine: 1, score: 2, critical: 3, platform: 4, foul: 5, card: 6 };

/** Todas las jugadas clave de la repetición, en orden de tiempo. */
export function buildMoments(r: Replay): Moment[] {
  const out: Moment[] = [];
  const P = GAME.points;
  const allianceOf = (robot: number): Alliance | undefined => r.header.robots.find((x) => x.index === robot)?.alliance;

  // Muestras: los eventos de la grabación traen el robot que la soltó; si no hay (repetición sin
  // eventos de grabación), se usan las del registro del match
  const scored = r.events.filter((e) => e.type === 'score');
  for (const e of scored) {
    out.push({ t: e.t, kind: 'score', alliance: e.alliance, pointsTo: e.alliance, robot: e.robot ?? undefined, points: e.points, level: e.level, period: e.period, section: '§4.4' });
  }
  for (const e of r.matchEvents) {
    if (e.type === 'sample' && scored.length === 0) {
      out.push({ t: e.t, kind: 'score', alliance: e.alliance, pointsTo: e.alliance, points: e.points, level: e.level, section: '§4.4' });
    } else if (e.type === 'autoLine') {
      out.push({ t: e.t, kind: 'autoLine', alliance: e.alliance, pointsTo: e.alliance, robot: e.robot, points: P.autoLine, section: '§4.4' });
    } else if (e.type === 'foul') {
      const f = e.foul;
      const rule = RULES[f.rule];
      const pts = f.kind === 'TECH' ? GAME.fouls.tech : GAME.fouls.foul;
      out.push({ t: e.t, kind: 'foul', alliance: f.offender, robot: f.robot, points: pts, pointsTo: opponent(f.offender), rule: f.rule, foulKind: f.kind, section: rule?.section ?? (f.kind === 'TECH' ? '§4.6' : '§4.5') });
    } else if (e.type === 'card') {
      const c = e.card;
      out.push({ t: e.t, kind: 'card', alliance: c.alliance, robot: c.robot, card: c.type, section: c.type === 'RED' ? '§4.3.3' : '§4.3.2' });
    } else if (e.type === 'phase' && (e.phase === 'TELEOP' || e.phase === 'ENDGAME')) {
      out.push({ t: e.t, kind: 'phase', phase: e.phase, section: e.phase === 'ENDGAME' ? '§4.3.1' : '§4.3' });
    }
  }

  // Muestra Crítica: el robot la toma de la rendija y la suelta (en la Repisa, si cuenta). Cuenta
  // "al sonar la bocina" (§4.3.1), así que la jugada marca cuándo se soltó y los puntos solo si al
  // final quedó en la Repisa de esa alianza
  const releases = r.events.filter((e) => e.type === 'release' && e.kind === 'critical');
  for (const e of releases) {
    if (e.type !== 'release') continue;
    const a = allianceOf(e.robot);
    const counted = a ? r.header.endgame.critical[a] : false;
    out.push({ t: e.t, kind: 'critical', alliance: a, robot: e.robot, pointsTo: counted ? a : undefined, points: counted ? P.critical : undefined, section: '§4.3.1, §4.4' });
  }

  // Plataforma: se evalúa al sonar la bocina (§4.3.1); 1 robot = 10, 2 = 20, no acumulable (§4.4)
  const end = replayDuration(r);
  for (const a of ['blue', 'red'] as const) {
    const n = r.header.endgame.platform.filter((i) => allianceOf(i) === a).length;
    if (n > 0) out.push({ t: end, kind: 'platform', alliance: a, pointsTo: a, robots: n, points: n >= 2 ? P.platformTwo : P.platformOne, section: '§4.3.1, §4.4' });
  }

  return out.sort((x, y) => x.t - y.t || ORDER[x.kind] - ORDER[y.kind]);
}

/** Segundos antes de la jugada a los que salta la barra, para ver cómo se armó. SUPUESTO de UI (no viene del manual). */
export const LEAD_IN = 3;
/** Segundos después de la jugada que se ven en el Resumen. */
export const LEAD_OUT = 2;

/**
 * Jugada siguiente a la que se está viendo. `last` = la última a la que se saltó: si seguimos
 * parados en su entrada, la siguiente es la que va después en la lista (aunque su entrada quede
 * antes, por estar muy cerca). Si no, la primera cuya entrada todavía no llega; desde el inicio del
 * match, la primera de todas.
 */
export function nextMoment(list: readonly Moment[], t: number, lead = LEAD_IN, last?: Moment | null): Moment | null {
  const i = last ? list.indexOf(last) : -1;
  if (i >= 0 && Math.abs(jumpTime(last!, lead) - t) < 0.1) return list[i + 1] ?? null;
  if (t < 0.05) return list.find((m) => m.t > t) ?? null;
  return list.find((m) => jumpTime(m, lead) > t + 0.05) ?? null;
}

/** Jugada anterior a la que se está viendo (si se acaba de saltar a una, la de antes en la lista). */
export function prevMoment(list: readonly Moment[], t: number, lead = LEAD_IN, last?: Moment | null): Moment | null {
  const i = last ? list.indexOf(last) : -1;
  if (i >= 0 && Math.abs(jumpTime(last!, lead) - t) < 0.1) return i > 0 ? list[i - 1] : null;
  for (let k = list.length - 1; k >= 0; k--) if (jumpTime(list[k], lead) < t - 0.6) return list[k];
  return null;
}

/** Tiempo al que saltar para ver la jugada `m` (con su entrada, sin pasar del inicio). */
export const jumpTime = (m: Moment, lead = LEAD_IN): number => Math.max(0, m.t - lead);

/** Ventanas del Resumen: [t − LEAD_IN, t + LEAD_OUT] por jugada, unidas si se tocan, dentro de [0, duración]. */
export function highlightWindows(list: readonly Moment[], duration: number, lead = LEAD_IN, tail = LEAD_OUT): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of list) {
    const a = Math.max(0, m.t - lead);
    const b = Math.min(duration, m.t + tail);
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * En el Resumen, dónde debe estar la reproducción en `t`: igual si cae dentro de una ventana, al
 * inicio de la siguiente si cae entre dos, o `null` si ya no quedan ventanas (se acabó el resumen).
 */
export function highlightTime(windows: ReadonlyArray<readonly [number, number]>, t: number): number | null {
  for (const [a, b] of windows) {
    if (t < a) return a;
    if (t <= b) return t;
  }
  return null;
}

/** Puntos de cada alianza en jugadas que se ven en la lista (para el encabezado del panel). */
export function momentTotals(list: readonly Moment[]): Record<Alliance, number> {
  const out: Record<Alliance, number> = { red: 0, blue: 0 };
  for (const m of list) if (m.pointsTo && m.points) out[m.pointsTo] += m.points;
  return out;
}
