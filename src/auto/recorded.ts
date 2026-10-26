/**
 * Rutas de AUTO grabadas en la práctica de AUTO: lo que hizo el jugador con los controles en cada
 * paso de física. Repetirlas es "instrucciones preprogramadas" (§4.2) y se pueden elegir como la
 * rutina de AUTO de tu robot en el match. Se guardan en este navegador (localStorage).
 *
 * Los controles son fracción de la velocidad máxima del robot con el que se grabó: con otro robot,
 * o desde la otra Zona de Inicio (no es simétrica a la tuya), la ruta termina en otro lugar.
 */
import { AUTO_ROUTINES, type AutoAction, type AutoOutput, type AutoRoutine, type AutoTrack } from './AutoRoutine';

export const ROUTE_PREFIX = 'rec:';
const KEY = 'labbot.autoRoutes';

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: string;
  /** Robot con el que se grabó (nombre para mostrar) y su Zona de Inicio (0 o 1). */
  robot: string;
  station: 0 | 1;
  track: AutoTrack;
}

/** Graba los controles del jugador paso a paso (`GameSession.inputTap`) hasta `maxSteps`. */
export class TrackRecorder {
  readonly track: AutoTrack;

  constructor(
    hz: number,
    readonly maxSteps: number,
  ) {
    this.track = { hz, forward: [], turn: [], actions: [] };
  }

  get steps(): number {
    return this.track.forward.length;
  }

  get full(): boolean {
    return this.steps >= this.maxSteps;
  }

  readonly push = (o: AutoOutput): void => {
    if (this.full) return;
    const i = this.steps;
    this.track.forward.push(Math.round(o.forward * 1000));
    this.track.turn.push(Math.round(o.turn * 1000));
    const act: AutoAction = { i };
    if (o.intake !== undefined) act.intake = o.intake;
    if (o.elevator !== undefined) act.elevator = o.elevator;
    if (o.release) act.release = true;
    if (o.grabCritical) act.grabCritical = true;
    if (o.releaseCritical) act.releaseCritical = true;
    if (Object.keys(act).length > 1) this.track.actions.push(act);
  };
}

/** Rutina de AUTO que repite una ruta grabada. */
export const routeRoutine = (r: SavedRoute): AutoRoutine => ({ id: ROUTE_PREFIX + r.id, name: r.name, steps: [], track: r.track });

// ------------------------------------------------------------------ guardado (RLE: valor, repeticiones)
export function rle(a: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of a) {
    if (out.length && out[out.length - 2] === v) out[out.length - 1]++;
    else out.push(v, 1);
  }
  return out;
}

export function unrle(a: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) for (let k = 0; k < a[i + 1]; k++) out.push(a[i]);
  return out;
}

const int = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Ruta válida a partir de lo guardado (o null si no sirve). */
export function sanitizeRoute(raw: unknown): SavedRoute | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (o.track && typeof o.track === 'object' ? o.track : {}) as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id)) return null;
  const nums = (v: unknown): number[] | null => (Array.isArray(v) && v.length <= 20000 && v.every((x) => int(x, -1000, 100000) !== null) ? (v as number[]) : null);
  const f = nums(t.forward);
  const tu = nums(t.turn);
  if (!f || !tu) return null;
  const forward = unrle(f).map((x) => Math.max(-1000, Math.min(1000, x)));
  const turn = unrle(tu).map((x) => Math.max(-1000, Math.min(1000, x)));
  if (forward.length !== turn.length || forward.length > 60 * 240) return null;
  const actions: AutoAction[] = [];
  for (const a of Array.isArray(t.actions) ? t.actions : []) {
    const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
    const i = int(x.i, 0, forward.length);
    if (i === null) continue;
    const act: AutoAction = { i };
    if (typeof x.intake === 'boolean') act.intake = x.intake;
    const e = int(x.elevator, 0, 4);
    if (e !== null) act.elevator = e as AutoAction['elevator'];
    if (x.release === true) act.release = true;
    if (x.grabCritical === true) act.grabCritical = true;
    if (x.releaseCritical === true) act.releaseCritical = true;
    actions.push(act);
  }
  actions.sort((a, b) => a.i - b.i);
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Ruta',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date(0).toISOString(),
    robot: typeof o.robot === 'string' ? o.robot.slice(0, 60) : '',
    station: o.station === 1 ? 1 : 0,
    track: { hz: int(t.hz, 30, 480) ?? 120, forward, turn, actions },
  };
}

const pack = (r: SavedRoute) => ({ ...r, track: { ...r.track, forward: rle(r.track.forward), turn: rle(r.track.turn) } });

export function loadRoutes(): SavedRoute[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return (Array.isArray(raw) ? raw : []).map(sanitizeRoute).filter((r): r is SavedRoute => !!r);
  } catch {
    return [];
  }
}

export function saveRoutes(list: readonly SavedRoute[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(pack)));
  } catch {
    /* sin almacenamiento (modo privado): la ruta vive mientras siga abierta la página */
  }
}

/** Las rutas guardadas (se lee una vez; quien las cambia también actualiza este arreglo). */
export const savedRoutes: SavedRoute[] = loadRoutes();

export function storeRoute(r: SavedRoute): void {
  const i = savedRoutes.findIndex((x) => x.id === r.id);
  if (i >= 0) savedRoutes[i] = r;
  else savedRoutes.unshift(r);
  saveRoutes(savedRoutes);
}

export function deleteRoute(id: string): void {
  const i = savedRoutes.findIndex((x) => x.id === id);
  if (i >= 0) savedRoutes.splice(i, 1);
  saveRoutes(savedRoutes);
}

export const newRouteId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Rutinas fijas + rutas grabadas (las de tu robot). */
export const allAutoRoutines = (): AutoRoutine[] => [...AUTO_ROUTINES, ...savedRoutes.map(routeRoutine)];
export const autoRoutineIds = (): string[] => allAutoRoutines().map((r) => r.id);
