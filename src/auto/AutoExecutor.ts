/**
 * Ejecuta una rutina de AUTO sin mandos del piloto. Portado de rebuilt-sim (`auto/AutoExecutor.ts`):
 * - Recorre los waypoints siguiendo la trayectoria del diseñador (`Trajectory.ts`: velocidad de
 *   referencia + corrección de posición; si el robot se queda atrás —un empujón, una Muestra— la
 *   referencia espera en vez de escaparse). Cada tramo (hasta la siguiente parada) se genera desde
 *   donde está el robot en ese momento. Punto a punto = todos los waypoints son paradas.
 * - Aplica las acciones al llegar (INTAKE, anotar en un nivel, esperar). Los cambios de INTAKE de los
 *   waypoints por los que pasa sin detenerse son "event markers".
 * - A prueba de choques: cada waypoint tiene un vigilante; si en ~2 s no avanza (lo estorba un
 *   compañero, un rival o quedó trabado), hace su acción donde está o lo salta.
 * - Al terminar la rutina (o si se queda sin ella) el robot se queda quieto hasta el TELEOP, como un autónomo
 *   programado de verdad que ya corrió todo: sin IA ni acciones libres (SUPUESTO, pedido de Xhavi). Frena y deja
 *   la garra y el brazo como los dejó la rutina.
 * Diferencias con rebuilt-sim por el reto: el robot es tanque (se mueve solo hacia donde mira),
 * anotar reemplaza a disparar (alinea el frente a la pared de la Cámara, sube el brazo al nivel y
 * suelta), no hay TOWER/BUMP/TRENCH y el manual nuevo ya no limita la línea central en AUTO (§4.2).
 */
import * as F from '../config/field';
import { posDir, type ElevatorPos } from '../config/robot';
import type { Robot } from '../game/Robot';
import { mirrorWaypointZ, toAlliance, type AutoWaypoint, type DesignedAuto } from './designed';
import { buildTrajectory, constraintsFor, headingOf, isStop, sampleAt, type Trajectory } from './Trajectory';

/** Mando de un paso: avance y giro en fracciones de velocidad (−1…1) y acciones de un disparo (como `AutoOutput` de las rutas dibujadas, ya "raw"). */
export interface ExecOutput {
  forward: number;
  turn: number;
  elevator?: ElevatorPos;
  intake?: boolean;
  release?: boolean;
}

type Stage = { kind: 'goto'; i: number } | { kind: 'act'; i: number; t: number; scored: boolean } | { kind: 'done' };

const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Segundos máximos de la acción de anotar en un waypoint (alinear, subir, soltar). */
const SCORE_TIME = 6;

export class AutoExecutor {
  stage: Stage;
  /** Cambios de garra y brazo por mandar (una vez, como los de `PathFollower`). */
  private pendIntake: boolean | undefined;
  private pendArm: ElevatorPos | undefined;
  /** Waypoints con z reflejada (la rutina se adapta al lado por el que salió el robot). */
  private readonly wps: AutoWaypoint[];
  /** Tramo actual (de `legFrom` a la parada `stage.i`), su reloj y su vigilante. */
  private leg: { traj: Trajectory; t: number; stall: number; over: number } | null = null;
  private legFrom = 0;
  /** Siguiente waypoint cuyo cambio de INTAKE ("event marker") falta aplicar. */
  private evNext = 0;
  /** Ruta completa planeada (marco de la alianza) para dibujarla en el campo. */
  readonly preview: Array<{ x: number; z: number }> = [];

  constructor(
    private r: Robot,
    readonly routine: DesignedAuto,
    private robots: Robot[],
  ) {
    // Rutinas "de cualquier lado": si sale del lado contrario al de su primer waypoint se reflejan en z
    const zb = r.alliance === 'blue' ? r.phys.position().z : -r.phys.position().z;
    const first = routine.waypoints.find((w) => Math.abs(w.z) > 0.3);
    const flip = !!routine.mirrorToStart && !!first && Math.sign(first.z) !== Math.sign(zb) && Math.abs(zb) > 0.3;
    const base = flip ? routine.waypoints.map(mirrorWaypointZ) : routine.waypoints;
    // Punto a punto = paradas en línea recta (igual que la vista previa del diseñador)
    this.wps = routine.spline ? base : base.map((w) => ({ ...w, stop: true, hin: undefined, hout: undefined }));
    this.stage = this.wps.length ? { kind: 'goto', i: this.stopFrom(0) } : { kind: 'done' };
    if (this.wps.length) {
      const tr = buildTrajectory(this.bluePose(), this.wps, this.constraints());
      for (let k = 0; k < tr.samples.length; k += 3) {
        const q = toAlliance(r.alliance, tr.samples[k].x, tr.samples[k].z, null);
        this.preview.push({ x: q.x, z: q.z });
      }
    }
  }

  private constraints() {
    return constraintsFor(this.r.spec, this.routine.spline ? this.routine.speed : 0.9);
  }

  /** Índice del waypoint donde termina el tramo que empieza en `from` (cada uno con su tramo). */
  private stopFrom(from: number): number {
    let j = from;
    while (j < this.wps.length - 1 && !isStop(this.wps[j], false)) j++;
    return j;
  }

  /** Pose del robot en el marco azul de la rutina. */
  private bluePose(): { x: number; z: number; heading: number } {
    const p = this.r.phys.position();
    const h = this.r.phys.heading();
    return this.r.alliance === 'blue' ? { x: p.x, z: p.z, heading: h } : { x: -p.x, z: -p.z, heading: h - Math.PI };
  }

  /** Punto de referencia actual de la ruta (marco de la alianza), para dibujarlo. */
  get reference(): { x: number; z: number; heading: number } | null {
    if (!this.leg || this.stage.kind !== 'goto') return null;
    const q = sampleAt(this.leg.traj, this.leg.t);
    const a = toAlliance(this.r.alliance, q.x, q.z, q.heading);
    return { x: a.x, z: a.z, heading: a.h! };
  }

  get done(): boolean {
    return this.stage.kind === 'done';
  }

  /** Giro proporcional suave hacia `want` (marco azul), con zona muerta y tope de 5 rad/s. */
  private omegaTo(want: number, dead = 0.03): number {
    const d = angDiff(want, this.bluePose().heading);
    if (Math.abs(d) < dead) return 0;
    const lim = Math.min(this.r.spec.maxOmega, 5);
    return Math.max(-lim, Math.min(lim, d * 3.5));
  }

  /** Mando de este paso. Terminada la rutina devuelve un mando vacío: el robot frena y se queda quieto. */
  update(dt: number): ExecOutput {
    const out: ExecOutput = { forward: 0, turn: 0 };
    const st = this.stage;
    switch (st.kind) {
      case 'goto':
        this.followLeg(dt, st.i, out);
        break;
      case 'act':
        this.act(dt, st, out);
        break;
      case 'done':
        break;
    }
    // Cambios de garra y brazo de los waypoints: una sola vez, cuando se piden
    if (this.pendIntake !== undefined) out.intake = this.pendIntake;
    if (this.pendArm !== undefined && out.elevator === undefined) out.elevator = this.pendArm;
    this.pendIntake = undefined;
    this.pendArm = undefined;
    return out;
  }

  /** Acciones al llegar a un waypoint: garra, brazo, anotar, esperar. */
  private act(dt: number, st: Extract<Stage, { kind: 'act' }>, out: ExecOutput): void {
    const r = this.r;
    const m = r.mech;
    const w = this.wps[st.i];
    st.t += dt;
    if (w.score && !st.scored) {
      // Anotar: alinea el frente (o la parte de atrás si el brazo suelta atrás) a la pared de la Cámara,
      // sube el brazo al nivel y suelta lo que lleva; la garra apagada para que no se la vuelva a tragar
      out.intake = false;
      out.elevator = w.score;
      const face = w.heading ?? F.camaraHeading('blue');
      const want = posDir(r.spec, w.score) > 0 ? face : face + Math.PI;
      const err = angDiff(want, this.bluePose().heading);
      out.turn = Math.max(-1, Math.min(1, this.omegaTo(want, 0.02) / (r.spec.maxOmega * 0.8)));
      const empty = m.stored.length === 0 && m.critical === null;
      if (Math.abs(err) < 0.06 && m.atTarget && m.target === w.score) {
        out.release = !empty;
      }
      if (empty || st.t >= SCORE_TIME) {
        st.scored = true;
        st.t = 0;
        out.release = false;
        out.elevator = 0;
      }
      return;
    }
    if (w.wait && st.t < w.wait) return;
    this.next();
  }

  /**
   * Sigue el tramo que termina en la parada `i` (velocidad de la referencia + corrección
   * proporcional de posición; rumbo con prealimentación). Al llegar pasa a su acción.
   */
  private followLeg(dt: number, i: number, out: ExecOutput): void {
    const r = this.r;
    const me = this.bluePose();
    if (!this.leg) {
      const prev = this.legFrom > 0 ? this.wps[this.legFrom - 1] : null;
      const traj = buildTrajectory(me, this.wps.slice(this.legFrom, i + 1), this.constraints(), { firstIndex: this.legFrom, startOut: prev?.hout ?? null });
      this.leg = { traj, t: 0, stall: 0, over: 0 };
    }
    const L = this.leg;
    const ref = sampleAt(L.traj, L.t);
    const ex = ref.x - me.x;
    const ez = ref.z - me.z;
    const err = Math.hypot(ex, ez);
    // Atrás de la referencia (una Muestra, un empujón): la referencia espera en vez de escaparse
    let k = err < 0.25 ? 1 : Math.max(0, 1 - (err - 0.25) / 0.5);
    // Un robot justo enfrente (hacia donde avanza): frena en vez de chocar
    const blue = r.alliance === 'blue';
    for (const o of this.robots) {
      if (o === r) continue;
      const op = o.phys.position();
      const ox = (blue ? op.x : -op.x) - me.x;
      const oz = (blue ? op.z : -op.z) - me.z;
      const d = Math.hypot(ox, oz);
      const clear = d - o.phys.halfW - r.phys.halfW;
      if (clear < 0.5 && (ox * ref.tx + oz * ref.tz) / (d || 1) > 0.5) k = Math.min(k, Math.max(0, clear / 0.5));
    }
    L.t = Math.min(L.traj.duration, L.t + dt * k);
    // "Event markers": cambios de INTAKE de los waypoints por los que pasa (desde ~0.6 m antes)
    while (this.evNext < i) {
      const w = this.wps[this.evNext];
      if (ref.wp <= this.evNext && Math.hypot(w.x - me.x, w.z - me.z) > 0.6) break;
      if (w.intake !== undefined) this.pendIntake = w.intake;
      if (w.arm !== undefined) this.pendArm = w.arm;
      this.evNext++;
    }
    let vx = ref.tx * ref.v * k + ex * 3;
    let vz = ref.tz * ref.v * k + ez * 3;
    const vm = Math.hypot(vx, vz);
    if (vm > r.spec.maxSpeed) {
      vx *= r.spec.maxSpeed / vm;
      vz *= r.spec.maxSpeed / vm;
    }
    // Tanque: el chasis mira hacia donde avanza; si está muy desalineado casi no avanza y gira
    const want = Math.hypot(vx, vz) > 0.3 ? headingOf(vx, vz) : me.heading;
    const e = Math.abs(angDiff(want, me.heading));
    if (e > 0.6) {
      vx *= 0.15;
      vz *= 0.15;
    }
    const lim = Math.min(r.spec.maxOmega, 5);
    const omega = Math.max(-lim, Math.min(lim, this.omegaTo(want)));
    // Marco azul → mando de tanque: avance = componente sobre el rumbo
    const fwd = vx * Math.cos(me.heading) - vz * Math.sin(me.heading);
    out.forward = Math.max(-1, Math.min(1, fwd / r.spec.maxSpeed));
    out.turn = Math.max(-1, Math.min(1, omega / (r.spec.maxOmega * 0.8)));
    // ¿Llegó a la parada?
    const w = this.wps[i];
    const end = L.traj.samples[L.traj.samples.length - 1];
    const dEnd = Math.hypot(end.x - me.x, end.z - me.z);
    const tol = w.score ? 0.35 : 0.15;
    if (L.t >= L.traj.duration) L.over += dt;
    if (L.t >= L.traj.duration && (dEnd < tol || (dEnd < tol * 2 && L.over > 1.5))) {
      this.markers(i);
      this.stage = { kind: 'act', i, t: 0, scored: false };
      return;
    }
    // Vigilante: la referencia no avanza ~2 s (lo bloquean) o no llega al final → actúa o salta
    L.stall = k < 0.2 || L.t >= L.traj.duration ? L.stall + dt : Math.max(0, L.stall - dt);
    if (L.stall > 2.2) {
      if (w.score || w.intake !== undefined || w.arm !== undefined || w.wait) {
        this.markers(i);
        this.stage = { kind: 'act', i, t: 0, scored: false };
      }
      else this.next();
    }
  }

  /** Garra y brazo del waypoint de parada `i` (si no se aplicaron ya al pasar). */
  private markers(i: number): void {
    const w = this.wps[i];
    if (this.evNext <= i) {
      if (w.intake !== undefined) this.pendIntake = w.intake;
      if (w.arm !== undefined) this.pendArm = w.arm;
    }
  }

  private next(): void {
    const st = this.stage;
    const n = this.wps.length;
    if (st.kind === 'act' || st.kind === 'goto') {
      this.legFrom = st.i + 1;
      this.evNext = Math.max(this.evNext, st.i + 1);
      this.stage = st.i + 1 < n ? { kind: 'goto', i: this.stopFrom(st.i + 1) } : { kind: 'done' };
    }
    this.leg = null;
  }
}
