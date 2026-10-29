/**
 * Fallas de los robots en la física (reglas y números en `core/damage.ts`, todos SUPUESTOS). Cada
 * paso mide el golpe de cada robot (cambio de velocidad que no vino de sus motores), tira los dados
 * y aplica las fallas activas a la física (`RobotPhysics.driveScale/turnBias`) y a la garra
 * (`Mechanisms.jammed/armScale`). La pérdida de comunicación la aplica la sesión (el robot no
 * recibe mandos).
 */
import {
  DAMAGE,
  faultChance,
  faultDuration,
  ImpactMeter,
  impactSide,
  pickFault,
  randomFaultChance,
  type DamageSettings,
  type FaultKind,
} from '../core/damage';
import type { MechEvent } from './Mechanisms';
import type { Robot } from './Robot';

export type DamageEvent =
  | { type: 'impact'; robot: number; speed: number }
  | { type: 'fault'; robot: number; kind: FaultKind; seconds: number; cause: 'impact' | 'random' }
  | { type: 'repaired'; robot: number; kind: FaultKind }
  | { type: 'dropped'; robot: number };

interface RobotState {
  meter: ImpactMeter;
  /** Falla → segundos que le quedan (Infinity = el resto del match). */
  faults: Map<FaultKind, number>;
  /** Velocidad después de los motores, antes del paso de física. */
  vx: number;
  vz: number;
  /** Lado débil de la transmisión (+1 / −1) cuando falla un motor. */
  weakSide: number;
}

export class Damage {
  private state = new Map<number, RobotState>();

  constructor(
    private robots: readonly Robot[],
    public settings: DamageSettings,
    private rand: () => number,
    /** Robot del jugador (para `targets: 'player'`). */
    private player: number,
    dt: number,
  ) {
    for (const r of robots) this.state.set(r.index, { meter: new ImpactMeter(dt), faults: new Map(), vx: 0, vz: 0, weakSide: 1 });
  }

  private applies(r: Robot): boolean {
    return this.settings.level !== 'off' && (this.settings.targets === 'all' || r.index === this.player);
  }

  /** Fallas activas de un robot (falla → segundos que le quedan; Infinity = hasta el final). */
  faults(robot: number): ReadonlyMap<FaultKind, number> {
    return this.state.get(robot)?.faults ?? new Map();
  }

  has(robot: number, kind: FaultKind): boolean {
    return this.state.get(robot)?.faults.has(kind) ?? false;
  }

  /** Golpe actual (m/s) del medidor, para la UI. */
  impact(robot: number): number {
    return this.state.get(robot)?.meter.value ?? 0;
  }

  /** Guarda la velocidad de cada robot después de sus motores (llamar justo antes de `world.step`). */
  beforeStep(): void {
    for (const r of this.robots) {
      const st = this.state.get(r.index)!;
      const v = r.phys.body.linvel();
      st.vx = v.x;
      st.vz = v.z;
    }
  }

  /**
   * Después del paso de física: mide golpes, tira dados y avanza las fallas. `enabled` = los robots
   * están habilitados (AUTO, TELEOP o práctica). Devuelve los eventos del paso.
   */
  afterStep(dt: number, enabled: boolean, mechEvents: MechEvent[]): DamageEvent[] {
    const out: DamageEvent[] = [];
    for (const r of this.robots) {
      const st = this.state.get(r.index)!;
      const v = r.phys.body.linvel();
      const dvx = v.x - st.vx;
      const dvz = v.z - st.vz;
      const hit = st.meter.push(Math.hypot(dvx, dvz));
      if (!enabled || !this.applies(r)) continue;
      const level = this.settings.level;
      if (hit !== null) {
        out.push({ type: 'impact', robot: r.index, speed: hit });
        const p = faultChance(hit, level);
        // La pieza en la garra puede salir volando
        if ((r.mech.inClaw || r.mech.critical) && this.rand() < p * DAMAGE.dropFactor) {
          if (r.mech.release(r.mech.critical ? 'critical' : 'sample', mechEvents, true)) out.push({ type: 'dropped', robot: r.index });
        }
        if (this.rand() < p) {
          const h = r.phys.heading();
          // Cambio de velocidad en el sistema del robot (x adelante)
          const lx = dvx * Math.cos(h) - dvz * Math.sin(h);
          const lz = dvx * Math.sin(h) + dvz * Math.cos(h);
          const kind = pickFault(this.rand, impactSide(lx, lz), new Set(st.faults.keys()));
          if (kind) this.add(r, st, kind, 'impact', out);
        }
      } else if (this.settings.random && this.rand() < randomFaultChance(dt, level)) {
        // Al azar solo lo que pasa sin golpe: un brownout o la garra que se atora
        const kind: FaultKind = this.rand() < 0.6 ? 'commLoss' : 'clawJam';
        if (!st.faults.has(kind)) this.add(r, st, kind, 'random', out);
      }
      for (const [k, left] of st.faults) {
        if (left === Infinity) continue;
        if (left - dt <= 0) {
          st.faults.delete(k);
          out.push({ type: 'repaired', robot: r.index, kind: k });
        } else st.faults.set(k, left - dt);
      }
      this.apply(r, st);
    }
    return out;
  }

  private add(r: Robot, st: RobotState, kind: FaultKind, cause: 'impact' | 'random', out: DamageEvent[]): void {
    const seconds = faultDuration(kind, this.rand);
    st.faults.set(kind, seconds);
    if (kind === 'motorWeak') st.weakSide = this.rand() < 0.5 ? 1 : -1;
    out.push({ type: 'fault', robot: r.index, kind, seconds, cause });
  }

  /** Lleva las fallas activas a la física y la garra. */
  private apply(r: Robot, st: RobotState): void {
    const f = st.faults;
    r.phys.driveScale = f.has('motorWeak') ? DAMAGE.motorWeakScale : 1;
    r.phys.turnBias = f.has('motorWeak') ? st.weakSide * DAMAGE.motorWeakPull : 0;
    r.mech.jammed = f.has('clawJam');
    r.mech.armScale = f.has('armSlow') ? DAMAGE.armSlowScale : 1;
  }

  /** Provoca una falla a mano (pruebas, retos). */
  inflict(robot: number, kind: FaultKind, seconds = faultDuration(kind, this.rand)): void {
    const r = this.robots.find((x) => x.index === robot);
    const st = this.state.get(robot);
    if (!r || !st) return;
    st.faults.set(kind, seconds);
    this.apply(r, st);
  }

  /** Robot sin comunicación: no recibe mandos (la sesión lo deja quieto). */
  disabled(robot: number): boolean {
    return this.has(robot, 'commLoss');
  }

  /** Todo reparado (reacomodar la cancha, match nuevo). */
  reset(): void {
    for (const r of this.robots) {
      const st = this.state.get(r.index)!;
      st.faults.clear();
      st.meter.reset();
      this.apply(r, st);
    }
  }
}
