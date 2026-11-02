/**
 * Práctica de AUTO: califica 15 s de AUTO del robot del jugador en una sesión de práctica (sin
 * match) y prueba una ruta desde poses iniciales desplazadas unos cm.
 *
 * Calificación con los puntos de AUTO (§4.4): Línea de Autónomo 5 (salir por completo de la Zona
 * de Inicio, D1) y Muestras 5/10/18 por nivel. Cruzar la línea central es Foul para el rival
 * (§4.2; D7: SUPUESTO Foul, igual que el árbitro). Empezar fuera de la Zona de Inicio no se
 * permite (§4.1). Solo cuenta lo que cae antes de que acaben los 15 s.
 */
import * as F from '../config/field';
import { GAME } from '../config/game';
import type { RobotSpec } from '../config/robot';
import { LEVELS, type Level } from '../core/types';
import { GameSession, PHYSICS_HZ, type ScoredSample, type SessionTap } from '../game/GameSession';
import type { MechEvent } from '../game/Mechanisms';
import type { Robot } from '../game/Robot';
import { AutoRunner, type AutoRoutine } from './AutoRoutine';

/** Pasos de física del AUTO (§4.2: 15 s). */
export const AUTO_STEPS = Math.round(GAME.times.auto * PHYSICS_HZ);

/** Desplazamiento de la pose inicial: adelante y a la derecha del robot (m) y giro (rad, + = izquierda). */
export interface StartOffset {
  forward: number;
  right: number;
  turn: number;
}

export const NO_OFFSET: StartOffset = { forward: 0, right: 0, turn: 0 };

export interface AutoResult {
  points: number;
  /** Cruzó la Línea de Autónomo (D1) y cuándo (s). */
  line: boolean;
  lineAt: number | null;
  samples: Record<Level, number>;
  /** Muestras que cayeron en la Cámara rival (cuentan para el rival). */
  rivalSamples: number;
  /** Cruzó por completo la línea central (§4.2). */
  center: boolean;
  /** La pose inicial queda por completo dentro de la Zona de Inicio (§4.1). */
  startOk: boolean;
  /** Pose al final (x, z en m; rumbo en rad). */
  final: { x: number; z: number; heading: number };
  offset: StartOffset;
}

/** ¿El chasis completo está dentro de su Zona de Inicio? (§4.1) */
export function insideStartZone(r: Robot): boolean {
  const zone = F.rectFor(r.alliance, F.START_ZONES_RED[r.station]);
  return r.phys.footprint().every((c) => F.inRect(zone, c.x, c.z));
}

/** Mueve el robot del jugador a su pose inicial desplazada (robot quieto, en el piso). */
export function applyOffset(s: GameSession, o: StartOffset): void {
  const r = s.player;
  const p = r.phys.position();
  const h = r.phys.heading();
  // Adelante = (cos h, −sin h); derecha = (sin h, cos h) en (x, z) (RobotPhysics)
  const x = p.x + o.forward * Math.cos(h) + o.right * Math.sin(h);
  const z = p.z - o.forward * Math.sin(h) + o.right * Math.cos(h);
  r.phys.teleport(x, z, h + o.turn);
  s.snapViews();
}

/** Lleva la cuenta del AUTO del robot del jugador, paso a paso (`GameSession.tap`). */
export class AutoScorer implements SessionTap {
  steps = 0;
  private lineAt: number | null = null;
  private center = false;
  private samples: Record<Level, number> = { 1: 0, 2: 0, 3: 0 };
  private rival = 0;
  readonly startOk: boolean;

  constructor(
    s: GameSession,
    readonly offset: StartOffset = NO_OFFSET,
  ) {
    this.startOk = insideStartZone(s.player);
  }

  get done(): boolean {
    return this.steps >= AUTO_STEPS;
  }

  step(s: GameSession, _mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    if (this.done) return;
    this.steps++;
    const r = s.player;
    for (const x of scored) {
      if (x.alliance === r.alliance) this.samples[x.level]++;
      else this.rival++;
    }
    if (this.lineAt === null && s.sensors.outOfStartZone(r)) this.lineAt = this.steps / PHYSICS_HZ;
    const k = r.alliance === 'red' ? 1 : -1;
    if (!this.center && r.phys.footprint().every((c) => k * c.x < F.CENTER_LINE_X)) this.center = true;
  }

  result(s: GameSession): AutoResult {
    const P = GAME.points;
    const line = this.lineAt !== null;
    const points = (line ? P.autoLine : 0) + LEVELS.reduce((n, l) => n + this.samples[l] * P.sampleAuto[l], 0);
    const p = s.player.phys.position();
    return {
      points,
      line,
      lineAt: this.lineAt,
      samples: { ...this.samples },
      rivalSamples: this.rival,
      center: this.center,
      startOk: this.startOk,
      final: { x: p.x, z: p.z, heading: s.player.phys.heading() },
      offset: this.offset,
    };
  }
}

/** Sesión de práctica para el AUTO: solo tu robot, con precarga y sin Human Player. */
export function autoSession(player: number, spec: RobotSpec): GameSession {
  const specs: RobotSpec[] = [];
  specs[player] = spec;
  return new GameSession({ player, preload: true, solo: true, ai: false, specs, hp: { enabled: false, interval: 3 } });
}

/** Corre una rutina sin dibujar desde la pose inicial desplazada `o`. */
export function runRoutine(player: number, spec: RobotSpec, routine: AutoRoutine, o: StartOffset = NO_OFFSET): AutoResult {
  const s = autoSession(player, spec);
  try {
    applyOffset(s, o);
    const sc = new AutoScorer(s, o);
    s.tap = sc;
    s.pilot = new AutoRunner(routine);
    while (!sc.done) s.step();
    return sc.result(s);
  } finally {
    s.dispose();
  }
}

export interface VariationSummary {
  runs: AutoResult[];
  base: AutoResult;
  /** Corridas que dan los mismos puntos que la base, sin Foul y empezando dentro de la zona. */
  sameRate: number;
  avgPoints: number;
  minPoints: number;
  maxPoints: number;
  /** Distancia media y máxima (m) de la pose final respecto a la de la base. */
  avgDrift: number;
  maxDrift: number;
}

/** Desplazamientos al azar dentro de ±`cm` y ±`deg` (semilla fija: mismo resultado cada vez). */
export function randomOffsets(n: number, cm: number, deg: number, seed = 7): StartOffset[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const u = () => rnd() * 2 - 1;
  return Array.from({ length: n }, () => ({ forward: (u() * cm) / 100, right: (u() * cm) / 100, turn: (u() * deg * Math.PI) / 180 }));
}

/** Corre la base y cada desplazamiento, cediendo el hilo entre corridas para no congelar la pantalla. */
export async function testVariations(
  player: number,
  spec: RobotSpec,
  routine: AutoRoutine,
  offsets: readonly StartOffset[],
  onProgress?: (f: number) => void,
  cancelled = () => false,
): Promise<VariationSummary> {
  const base = runRoutine(player, spec, routine);
  const runs: AutoResult[] = [];
  for (const o of offsets) {
    if (cancelled()) break;
    await new Promise((r) => setTimeout(r, 0));
    runs.push(runRoutine(player, spec, routine, o));
    onProgress?.(runs.length / offsets.length);
  }
  return summarize(base, runs);
}

export function summarize(base: AutoResult, runs: AutoResult[]): VariationSummary {
  const n = Math.max(1, runs.length);
  const drift = runs.map((r) => Math.hypot(r.final.x - base.final.x, r.final.z - base.final.z));
  const pts = runs.map((r) => r.points);
  return {
    runs,
    base,
    sameRate: runs.filter((r) => r.points === base.points && !r.center && r.startOk).length / n,
    avgPoints: pts.reduce((a, b) => a + b, 0) / n,
    minPoints: pts.length ? Math.min(...pts) : 0,
    maxPoints: pts.length ? Math.max(...pts) : 0,
    avgDrift: drift.reduce((a, b) => a + b, 0) / n,
    maxDrift: drift.length ? Math.max(...drift) : 0,
  };
}
