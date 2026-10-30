/**
 * Estrategias de alianza (menú "Estrategias"): el plan con el que le dices a tu compañero de la IA
 * cómo se van a mover y rotar en el match. Lógica pura (sin DOM, Three.js ni Rapier).
 *
 * Un plan tiene un paso para AUTO, de 1 a 4 turnos en el TELEOP (cada uno empieza a una hora del
 * reloj del match: así se rotan las tareas) y uno para el ENDGAME (los últimos 30 s, §2). En cada
 * paso:
 * - compañero: ruta (puntos por los que pasa al empezar el paso), zona de trabajo (solo junta las
 *   Muestras de ahí), de dónde junta (Laboratorio §3.2.2 / Human Player §3.2.4) y a qué nivel anota
 *   (§4.4);
 * - tú: tu ruta (se dibuja en la cancha durante el match) y una nota.
 * Además, qué hace el compañero en AUTO (las rutinas de siempre) y en el ENDGAME (§4.3.1).
 *
 * SUPUESTO: el manual no habla de estrategias ni de comunicación entre robots; el plan solo cambia
 * lo que decide la IA de tu compañero. Las reglas y el árbitro no cambian (una ruta que pisa la
 * Plataforma antes del ENDGAME o se queda en una zona rival se sigue cobrando, §4.6).
 *
 * Coordenadas: metros, en el marco de la alianza ROJA (la tuya siempre en +X, como `config/field`);
 * para azul se giran 180° al usarse (`F.forAlliance`).
 */
import * as F from '../config/field';
import { GAME } from '../config/game';
import type { Phase } from './clock';

export type PlanSource = 'any' | 'lab' | 'hp';
/** 0 = el que convenga (el de su dificultad). */
export type PlanLevel = 0 | 1 | 2 | 3;
/** AUTO del compañero: las rutinas de `auto/AutoRoutine.ts`. */
export type PlanAuto = 'leave' | 'preload' | 'collect' | 'none';
export type PlanEndgame = 'platform' | 'critical' | 'none';
export type PlanPhase = 'AUTO' | 'TELEOP' | 'ENDGAME';

export interface PlanPoint {
  x: number;
  z: number;
}

export interface PlanStep {
  /** Solo turnos del TELEOP: segundos que le faltan al match cuando empieza el turno. */
  from: number;
  partner: { route: PlanPoint[]; zone: F.Rect | null; source: PlanSource; level: PlanLevel };
  me: { route: PlanPoint[]; note: string };
}

export interface StrategyPlan {
  id: string;
  name: string;
  /** Última edición (ms). */
  updated: number;
  /** Qué hace el compañero en AUTO. */
  auto: PlanAuto;
  /** Qué hace el compañero en el ENDGAME. */
  endgame: PlanEndgame;
  steps: { AUTO: PlanStep; TELEOP: PlanStep[]; ENDGAME: PlanStep };
}

export const PLAN_SOURCES: readonly PlanSource[] = ['any', 'lab', 'hp'];
export const PLAN_LEVELS: readonly PlanLevel[] = [0, 3, 2, 1];
export const PLAN_AUTOS: readonly PlanAuto[] = ['leave', 'preload', 'collect', 'none'];
export const PLAN_ENDGAMES: readonly PlanEndgame[] = ['platform', 'critical', 'none'];
export const MAX_TURNS = 4;
export const MAX_POINTS = 12;
export const MAX_NOTE = 140;
export const MAX_NAME = 40;

/** Segundos del match al empezar el TELEOP (135, §2) y el ENDGAME (30). */
export const TELEOP_FROM = GAME.times.teleop;
export const ENDGAME_FROM = GAME.times.endgame;
/** Horas a las que puede empezar un turno del TELEOP después del primero (cada 15 s, antes del ENDGAME). */
export const TURN_TIMES: readonly number[] = Array.from({ length: (TELEOP_FROM - ENDGAME_FROM) / 15 - 1 }, (_, i) => TELEOP_FROM - 15 * (i + 1));
/** En AUTO no se cruza la línea central (§4.2): los puntos de la ruta se quedan a esta X o más. */
export const AUTO_MIN_X = 0.5;

const emptyStep = (from = 0): PlanStep => ({ from, partner: { route: [], zone: null, source: 'any', level: 0 }, me: { route: [], note: '' } });

export function newPlan(name: string, id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`): StrategyPlan {
  return { id, name, updated: Date.now(), auto: 'leave', endgame: 'platform', steps: { AUTO: emptyStep(), TELEOP: [emptyStep(TELEOP_FROM)], ENDGAME: emptyStep() } };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = <T>(list: readonly T[], v: unknown, def: T): T => list.find((x) => x === v) ?? def;
const clampX = (x: number) => Math.max(-F.HALF_L, Math.min(F.HALF_L, x));
const clampZ = (z: number) => Math.max(-F.HALF_W, Math.min(F.HALF_W, z));
const round = (v: number) => Math.round(v * 100) / 100;

/** Punto dentro de la cancha (en AUTO, de tu lado de la línea central, §4.2). */
export function cleanPoint(p: PlanPoint, phase: PlanPhase): PlanPoint {
  const x = clampX(p.x);
  return { x: round(phase === 'AUTO' ? Math.max(AUTO_MIN_X, x) : x), z: round(clampZ(p.z)) };
}

function route(v: unknown, phase: PlanPhase): PlanPoint[] {
  if (!Array.isArray(v)) return [];
  const out: PlanPoint[] = [];
  for (const p of v.slice(0, MAX_POINTS)) {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const x = num(o.x);
    const z = num(o.z);
    if (x !== null && z !== null) out.push(cleanPoint({ x, z }, phase));
  }
  return out;
}

function zone(v: unknown, phase: PlanPhase): F.Rect | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const [x0, x1, z0, z1] = [num(o.x0), num(o.x1), num(o.z0), num(o.z1)];
  if (x0 === null || x1 === null || z0 === null || z1 === null) return null;
  const a = cleanPoint({ x: Math.min(x0, x1), z: Math.min(z0, z1) }, phase);
  const b = cleanPoint({ x: Math.max(x0, x1), z: Math.max(z0, z1) }, phase);
  // Más chica que un robot no sirve de zona
  if (b.x - a.x < 0.3 || b.z - a.z < 0.3) return null;
  return { x0: a.x, x1: b.x, z0: a.z, z1: b.z };
}

function step(v: unknown, phase: PlanPhase, from = 0): PlanStep {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const p = (o.partner && typeof o.partner === 'object' ? o.partner : {}) as Record<string, unknown>;
  const m = (o.me && typeof o.me === 'object' ? o.me : {}) as Record<string, unknown>;
  return {
    from,
    partner: { route: route(p.route, phase), zone: zone(p.zone, phase), source: pick(PLAN_SOURCES, p.source, 'any'), level: pick(PLAN_LEVELS, p.level, 0) },
    me: { route: route(m.route, phase), note: typeof m.note === 'string' ? m.note.slice(0, MAX_NOTE) : '' },
  };
}

/** Plan válido a partir de cualquier valor guardado (null si no se puede rescatar). */
export function sanitizePlan(raw: unknown): StrategyPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  const s = (o.steps && typeof o.steps === 'object' ? o.steps : {}) as Record<string, unknown>;
  const list = Array.isArray(s.TELEOP) ? s.TELEOP.slice(0, MAX_TURNS) : [];
  // El primer turno empieza con el TELEOP; los demás a una hora válida, en orden y sin repetir
  const froms = list.map((x, i) => {
    const f = num((x as Record<string, unknown> | null)?.from);
    return i === 0 ? TELEOP_FROM : f !== null && TURN_TIMES.includes(f) ? f : null;
  });
  const teleop: PlanStep[] = [];
  list.forEach((x, i) => {
    const f = froms[i];
    if (f === null || teleop.some((t) => t.from === f)) return;
    teleop.push(step(x, 'TELEOP', f));
  });
  if (!teleop.length) teleop.push(step(null, 'TELEOP', TELEOP_FROM));
  teleop.sort((a, b) => b.from - a.from);
  return {
    id: o.id.slice(0, 40),
    name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Estrategia').slice(0, MAX_NAME),
    updated: num(o.updated) ?? 0,
    auto: pick(PLAN_AUTOS, o.auto, 'leave'),
    endgame: pick(PLAN_ENDGAMES, o.endgame, 'platform'),
    steps: { AUTO: step(s.AUTO, 'AUTO'), TELEOP: teleop, ENDGAME: step(s.ENDGAME, 'ENDGAME') },
  };
}

export function sanitizePlans(raw: unknown): StrategyPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: StrategyPlan[] = [];
  for (const r of raw) {
    const p = sanitizePlan(r);
    if (p && !out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

/** Paso del plan activo: `key` cambia cuando empieza otro paso (AUTO, turno i del TELEOP, ENDGAME). */
export interface ActiveStep {
  key: string;
  phase: PlanPhase;
  /** Turno del TELEOP (0…), o −1 en AUTO y ENDGAME. */
  turn: number;
  step: PlanStep;
}

/**
 * Paso que toca según la fase y los segundos que le faltan al match (`Match.remaining`). Fuera del
 * match (PRE, DONE) no hay paso; en la pausa AUTO→TELEOP sigue el de AUTO.
 */
export function activeStep(plan: StrategyPlan, phase: Phase, remaining: number): ActiveStep | null {
  if (phase === 'AUTO' || phase === 'PAUSE') return { key: 'AUTO', phase: 'AUTO', turn: -1, step: plan.steps.AUTO };
  if (phase === 'ENDGAME') return { key: 'ENDGAME', phase: 'ENDGAME', turn: -1, step: plan.steps.ENDGAME };
  if (phase !== 'TELEOP') return null;
  const turns = plan.steps.TELEOP;
  let i = 0;
  for (let k = 1; k < turns.length; k++) if (remaining <= turns[k].from) i = k;
  return { key: `TELEOP${i}`, phase: 'TELEOP', turn: i, step: turns[i] };
}

/** Segundos antes de cambiar de paso en los que la pizarra del match ya enseña el siguiente. */
export const PREVIEW_S = 5;

/** Paso que sigue y en cuántos segundos empieza (`in`); null en el último (ENDGAME) o fuera del match. */
export function nextStep(plan: StrategyPlan, phase: Phase, remaining: number): (ActiveStep & { in: number }) | null {
  const a = activeStep(plan, phase, remaining);
  if (!a || a.phase === 'ENDGAME') return null;
  const turns = plan.steps.TELEOP;
  // AUTO (y la pausa) → primer turno del TELEOP; el último turno → ENDGAME (§2)
  if (a.phase === 'AUTO') return { key: 'TELEOP0', phase: 'TELEOP', turn: 0, step: turns[0], in: Math.max(0, remaining - TELEOP_FROM) };
  const i = a.turn + 1;
  if (i < turns.length) return { key: `TELEOP${i}`, phase: 'TELEOP', turn: i, step: turns[i], in: Math.max(0, remaining - turns[i].from) };
  return { key: 'ENDGAME', phase: 'ENDGAME', turn: -1, step: plan.steps.ENDGAME, in: Math.max(0, remaining - ENDGAME_FROM) };
}

/** Problemas de un plan contra las reglas, para avisar en el editor (no se bloquea nada). */
export interface PlanIssue {
  /** 'AUTO', 'TELEOP0'…, 'ENDGAME'. */
  key: string;
  code: 'platform' | 'rivalZone' | 'noLeave';
  section: string;
}

const inAny = (rs: readonly F.Rect[], p: PlanPoint) => rs.some((r) => F.inRect(r, p.x, p.z));

/**
 * - platform: la ruta del compañero o la tuya pasa por la Plataforma antes del ENDGAME (§4.6; la IA
 *   la rodea, tú no).
 * - rivalZone: un punto o la zona de trabajo queda en una zona de anotación rival (§4.6, D17: 3 s ahí
 *   es Tech Foul; la IA se sale antes).
 * - noLeave: el compañero hace "Cruzar la línea" con una ruta que no sale de su Zona de Inicio
 *   (sin los 5 pts de la línea de autónomo, §4.4; D1).
 * `rival`: zonas de anotación del contrario en el marco rojo (`obstructZones('blue')`).
 */
export function planIssues(plan: StrategyPlan, rival: readonly F.Rect[]): PlanIssue[] {
  const out: PlanIssue[] = [];
  const platform: F.Rect = { x0: -F.PLATFORM_LENGTH / 2, x1: F.PLATFORM_LENGTH / 2, z0: -F.PLATFORM_WIDTH / 2, z1: F.PLATFORM_WIDTH / 2 };
  const check = (key: string, s: PlanStep, endgame: boolean) => {
    const pts = [...s.partner.route, ...s.me.route];
    if (!endgame && pts.some((p) => F.inRect(platform, p.x, p.z))) out.push({ key, code: 'platform', section: '§4.6' });
    const z = s.partner.zone;
    const zoneHits = z && rival.some((r) => r.x0 < z.x1 && r.x1 > z.x0 && r.z0 < z.z1 && r.z1 > z.z0);
    if (zoneHits || pts.some((p) => inAny(rival, p))) out.push({ key, code: 'rivalZone', section: '§4.6' });
  };
  check('AUTO', plan.steps.AUTO, false);
  plan.steps.TELEOP.forEach((s, i) => check(`TELEOP${i}`, s, false));
  check('ENDGAME', plan.steps.ENDGAME, true);
  const r = plan.steps.AUTO.partner.route;
  // La Zona de Inicio está pegada a la pared de la alianza: salir = pasar de su borde hacia el centro
  const zoneEdge = Math.min(...F.START_ZONES_RED.map((z) => z.x0));
  if (plan.auto === 'leave' && r.length && !r.some((p) => p.x < zoneEdge - 0.4)) out.push({ key: 'AUTO', code: 'noLeave', section: '§4.4' });
  return out;
}
