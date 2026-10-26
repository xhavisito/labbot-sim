/**
 * Entrenamiento por retos sobre la física: acomoda la cancha para el reto y lleva la cuenta paso a
 * paso (`GameSession.tap`) del robot del jugador en una sesión de práctica (solo su robot). La
 * medalla y el récord los decide `core/training.ts`.
 */
import * as F from '../config/field';
import { GAME } from '../config/game';
import type { RobotSpec } from '../config/robot';
import { teleopPoints, type Drill, type DrillOutcome } from '../core/training';
import type { Level } from '../core/types';
import { GameSession, PHYSICS_HZ, type ScoredSample, type SessionOptions, type SessionTap } from './GameSession';
import type { MechEvent } from './Mechanisms';

/** Segundos que la Crítica tiene que quedarse en la Repisa para contar (que no se caiga). SUPUESTO. */
export const CRITICAL_HOLD = 0.5;
/** Segundos que el robot tiene que quedarse en la Plataforma (al sonar la bocina tiene que estar ahí, §4.3.1). SUPUESTO. */
export const PLATFORM_HOLD = 1;

/**
 * Pose de salida "frente a la Cámara" (reto de Plataforma): de frente al Nivel 2 de la Cámara propia,
 * a 20 cm de ella, como después de anotar. SUPUESTO del reto. Para azul, la rotación de 180°.
 */
export function camaraStart(alliance: 'red' | 'blue', spec: RobotSpec): { x: number; z: number; heading: number } {
  const w = F.camaraWells()[2];
  const p = F.forAlliance(alliance, { x: (w.x0 + w.x1) / 2, z: F.CAMARA_Z_RED[0] - spec.length / 2 - 0.2 });
  // Rojo ve hacia +Z (rumbo −π/2: adelante = (cos h, −sin h)); azul, al revés
  return { ...p, heading: alliance === 'red' ? -Math.PI / 2 : Math.PI / 2 };
}

/** Opciones de la sesión del reto: solo tu robot; precarga salvo en el de la Crítica (la garra del pivote va vacía). */
export function drillSessionOptions(d: Drill, player: number, spec: RobotSpec, hpInterval: number): SessionOptions {
  const specs: RobotSpec[] = [];
  specs[player] = spec;
  return { player, preload: d.needs !== 'critical', solo: true, ai: false, specs, hp: { enabled: d.hp, interval: hpInterval } };
}

/** Acomoda la cancha y el robot para empezar el reto. */
export function setupDrill(s: GameSession, d: Drill): void {
  s.resetField();
  if (d.start === 'camara') {
    const p = camaraStart(s.player.alliance, s.player.spec);
    s.player.phys.teleport(p.x, p.z, p.heading);
  }
  s.snapViews();
}

/** Cuenta del reto, paso a paso. */
export class DrillTracker implements SessionTap {
  steps = 0;
  readonly samples: Record<Level, number> = { 1: 0, 2: 0, 3: 0 };
  /** Segundo en que cumplió la meta (retos 'time'). */
  doneAt: number | null = null;
  /** Al sonar la bocina del reto (o al cumplir la meta). */
  ended = false;
  /** Estado en vivo (y, al final del ENDGAME, el evaluado al sonar la bocina). */
  onPlatform = false;
  criticalOn = false;
  private streak = 0;

  constructor(
    readonly drill: Drill,
    /** Límite de este reto con este robot (`drillTargets`). */
    readonly limit: number,
  ) {}

  get time(): number {
    return this.steps / PHYSICS_HZ;
  }

  get scoredTotal(): number {
    return this.samples[1] + this.samples[2] + this.samples[3];
  }

  /** Puntos con los valores de TELEOP del manual (§4.4); la línea de autónomo vale lo del AUTO. */
  get points(): number {
    if (this.drill.id === 'line') return this.doneAt !== null ? GAME.points.autoLine : 0;
    return teleopPoints(GAME, this.samples, this.onPlatform, this.criticalOn);
  }

  step(s: GameSession, _mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    if (this.ended) return;
    this.steps++;
    const me = s.player;
    // Solo cuenta lo que entra a tu Cámara (D14: en la rival sería para el rival)
    for (const x of scored) if (x.alliance === me.alliance) this.samples[x.level]++;
    const d = this.drill;
    const hold = (on: boolean, need: number): boolean => {
      this.streak = on ? this.streak + 1 : 0;
      return this.streak >= Math.round(need * PHYSICS_HZ);
    };
    let met = false;
    if (d.id === 'line') met = s.sensors.outOfStartZone(me);
    else if (d.id === 'level3') met = this.samples[3] >= (d.goal ?? 1);
    else if (d.id === 'dominance') met = this.scoredTotal >= (d.goal ?? 1);
    else if (d.id === 'critical') {
      this.criticalOn = s.sensors.criticalOnRepisa(me.alliance);
      met = hold(this.criticalOn, CRITICAL_HOLD);
    } else if (d.id === 'platform') {
      this.onPlatform = s.sensors.onPlatform(me);
      met = hold(this.onPlatform, PLATFORM_HOLD);
    } else if (d.id === 'endgame') {
      // Se evalúa al sonar la bocina (§4.3.1); en vivo, para el HUD del reto
      this.onPlatform = s.sensors.onPlatform(me);
      this.criticalOn = s.sensors.criticalOnRepisa(me.alliance);
    }
    if (d.kind === 'time' && met) {
      // La marca es cuando llegó (sin el tiempo que tuvo que quedarse)
      const held = d.id === 'critical' ? CRITICAL_HOLD : d.id === 'platform' ? PLATFORM_HOLD : 0;
      this.doneAt = Math.max(0, this.time - held);
      this.ended = true;
    } else if (this.time >= this.limit - 1e-9) this.ended = true;
  }

  outcome(): DrillOutcome {
    const time = this.doneAt ?? this.time;
    if (this.drill.kind === 'points') return { completed: this.ended, time, points: this.points };
    return { completed: this.doneAt !== null, time, points: this.points };
  }
}
