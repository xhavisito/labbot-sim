/**
 * Sigue una rutina de AUTO dibujada (`core/autoPath.ts`) en lazo cerrado: en cada paso lee la pose
 * real del robot y manda avance y giro (tanque) hacia el siguiente punto; al llegar hace sus
 * acciones (girar a un rumbo, mover el brazo, soltar, esperar). Como corrige con la pose, aguanta
 * empujones y diferencias entre robots mejor que una ruta grabada (`auto/recorded.ts`).
 *
 * Nada de esto viene del manual (§4.2 solo pide "instrucciones preprogramadas"); las ganancias y
 * tolerancias son SUPUESTOS de diseño, ajustados con la física del sim (`tests/autoPath.test.ts`).
 */
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import { hasArrivalAction, type AutoPath, type PathPoint } from '../core/autoPath';
import type { AutoOutput } from './AutoRoutine';

/** Lo que el seguidor lee del robot (`game/Robot`). */
export interface PathRobot {
  alliance: Alliance;
  spec: { maxSpeed: number; maxOmega: number };
  phys: { position(): { x: number; z: number }; heading(): number };
  mech: { atTarget: boolean };
}

/** Tolerancia de llegada (m): a un punto con acciones, y a uno de paso (sin frenar). */
export const ARRIVE_TOL = 0.07;
export const PASS_TOL = 0.25;
/** Error de rumbo (rad) a partir del cual gira en su lugar antes de avanzar. */
export const TURN_IN_PLACE = 0.6;
/** Error de rumbo aceptado al girar a un rumbo (rad, ≈3°). */
export const FACE_TOL = 0.05;
/** Si en este tiempo no se acerca 5 cm, se da por atorado y pasa al siguiente punto (s). */
export const STUCK_S = 1.5;
/** Límite para girar a un rumbo y para esperar al brazo (s). */
export const FACE_TIMEOUT = 2;
export const ARM_TIMEOUT = 2.5;
/** Tiempo máximo girando en su lugar hacia un punto antes de contar como atorado (s). */
export const TURN_TIMEOUT = 2;
/** Pausa después de soltar para que la pieza caiga antes de moverse (s). */
export const RELEASE_HOLD = 0.25;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Stage = 'drive' | 'face' | 'arm' | 'release' | 'wait';

/** Qué pasó con cada punto (para el resultado de la prueba). */
export interface PointLog {
  /** Segundo del AUTO en que terminó (null = no llegó). */
  doneAt: number | null;
  /** Se brincó por atorado (o se acabó el tiempo de girar o del brazo). */
  skipped: boolean;
}

export class PathFollower {
  /** Punto en curso (== points.length al terminar). */
  i = 0;
  private stage: Stage = 'drive';
  private t = 0;
  private stageT = 0;
  private best = Infinity;
  private bestT = 0;
  private entered = -1;
  /** Tiempo girando en su lugar hacia el punto en curso. */
  private turnT = 0;
  /** La acción de la etapa ya se mandó. */
  private fired = false;
  readonly log: PointLog[];

  constructor(readonly path: AutoPath) {
    this.log = path.points.map(() => ({ doneAt: null, skipped: false }));
  }

  get done(): boolean {
    return this.i >= this.path.points.length;
  }

  /** Punto `q` en la cancha para la alianza del robot y su rumbo pedido (azul = giro de 180°). */
  private target(r: PathRobot, q: PathPoint): { x: number; z: number; face: number | null } {
    const p = F.forAlliance(r.alliance, q);
    return { ...p, face: q.face === null ? null : wrap(q.face + (r.alliance === 'blue' ? Math.PI : 0)) };
  }

  private next(skipped = false): void {
    this.log[this.i] = { doneAt: this.t, skipped: skipped || this.log[this.i].skipped };
    this.i++;
    this.go('drive');
  }

  private go(stage: Stage): void {
    this.stage = stage;
    this.stageT = 0;
    this.fired = false;
  }

  /** Giro (fracción −1…1 de la velocidad de giro que usa la sesión, `maxOmega × 0.8`) para corregir `err` rad. */
  private turnFor(r: PathRobot, err: number): number {
    const wMax = r.spec.maxOmega * 0.8;
    // Proporcional con un mínimo para no quedarse a medio grado sin moverse
    const w = 5 * err + Math.sign(err) * Math.min(0.6, Math.abs(err) * 20);
    return clamp(w / wMax, -1, 1);
  }

  step(dt: number, r: PathRobot): AutoOutput {
    this.t += dt;
    this.stageT += dt;
    const out: AutoOutput = { forward: 0, turn: 0, raw: true };
    // Hasta 4 cambios de etapa por paso (acciones instantáneas no gastan un paso de física)
    for (let guard = 0; guard < 4 && !this.done; guard++) {
      const q = this.path.points[this.i];
      const tg = this.target(r, q);
      const pos = r.phys.position();
      const h = r.phys.heading();
      if (this.stage === 'drive') {
        if (this.entered !== this.i) {
          // Al salir hacia el punto: garra y, si va en camino, el brazo
          this.entered = this.i;
          this.best = Infinity;
          this.bestT = this.t;
          this.turnT = 0;
          if (q.intake !== null) out.intake = q.intake;
          if (q.arm !== null && q.armEarly) out.elevator = q.arm;
        }
        const dx = tg.x - pos.x;
        const dz = tg.z - pos.z;
        const d = Math.hypot(dx, dz);
        const stop = hasArrivalAction(q) || this.i === this.path.points.length - 1;
        if (d < (stop ? ARRIVE_TOL : PASS_TOL)) {
          this.go('face');
          continue;
        }
        if (d < this.best - 0.05) {
          this.best = d;
          this.bestT = this.t;
        } else if (this.t - this.bestT > STUCK_S) {
          this.log[this.i].skipped = true;
          this.go('face');
          continue;
        }
        const dir = q.reverse ? -1 : 1;
        const want = wrap(Math.atan2(-dz, dx) + (q.reverse ? Math.PI : 0));
        const err = wrap(want - h);
        // Muy cerca, un error de rumbo grande es que se pasó: no gira, retrocede o avanza lo que falta
        if (Math.abs(err) > TURN_IN_PLACE && d > 0.2) {
          // Girar en su lugar no acerca: no cuenta como atorado (hasta TURN_TIMEOUT; si el brazo topa
          // con la madera puede no girar nunca)
          this.turnT += dt;
          if (this.turnT < TURN_TIMEOUT) this.bestT = this.t;
          out.turn = this.turnFor(r, err);
          return out;
        }
        const along = Math.cos(err) * d;
        const slow = stop ? clamp(Math.abs(along) / 0.6, 0.12, 1) : 1;
        const v = q.speed * slow;
        out.forward = dir * Math.sign(along) * v;
        out.turn = d > 0.2 ? this.turnFor(r, err) : 0;
        return out;
      }
      if (this.stage === 'face') {
        if (tg.face === null) {
          this.go('arm');
          continue;
        }
        const err = wrap(tg.face - h);
        if (Math.abs(err) < FACE_TOL || this.stageT > FACE_TIMEOUT) {
          if (Math.abs(err) >= FACE_TOL) this.log[this.i].skipped = true;
          this.go('arm');
          continue;
        }
        out.turn = this.turnFor(r, err);
        return out;
      }
      if (this.stage === 'arm') {
        if (q.arm === null) {
          this.go('release');
          continue;
        }
        if (!this.fired) {
          out.elevator = q.arm;
          this.fired = true;
          return out;
        }
        // Espera a que el brazo llegue (en camino o al llegar) antes de soltar
        if (r.mech.atTarget || this.stageT > ARM_TIMEOUT) {
          if (!r.mech.atTarget) this.log[this.i].skipped = true;
          this.go('release');
          continue;
        }
        return out;
      }
      if (this.stage === 'release') {
        if (!q.release) {
          this.go('wait');
          continue;
        }
        if (!this.fired) {
          out.release = true;
          this.fired = true;
        }
        if (this.stageT >= RELEASE_HOLD) {
          this.go('wait');
          continue;
        }
        return out;
      }
      // wait
      if (this.stageT >= q.wait) {
        this.next();
        continue;
      }
      return out;
    }
    return out;
  }
}
