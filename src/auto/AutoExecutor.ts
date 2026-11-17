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
 * - Al terminar la rutina (o si se queda sin ella) sigue jugando (`ai/Bot`: junta Muestras de su
 *   mitad y las anota), sin cruzar la línea central (§4.2), salvo las rutinas `idleAfter`.
 * Diferencias con rebuilt-sim por el reto: el robot es tanque (se mueve solo hacia donde mira),
 * anotar reemplaza a disparar (alinea el frente a la pared de la Cámara, sube el elevador al nivel y
 * suelta) y no hay TOWER/BUMP/TRENCH.
 */
import { Bot, type BotOutput } from '../ai/Bot';
import type { ElevatorPos } from '../config/robot';
import type { Robot } from '../game/Robot';
import type { Pieces } from '../physics/Pieces';
import { mirrorWaypointZ, toAlliance, type AutoRoutine, type AutoWaypoint } from './AutoRoutine';
import { buildTrajectory, constraintsFor, headingOf, isStop, sampleAt, type Trajectory } from './Trajectory';

/** Mando de un paso, en fracciones de velocidad (−1…1) como el de la IA. */
export interface AutoOutput {
  forward: number;
  turn: number;
  elevator: ElevatorPos;
  intake: boolean;
  release: boolean;
}

type Stage = { kind: 'goto'; i: number } | { kind: 'act'; i: number; t: number; scored: boolean } | { kind: 'free' } | { kind: 'done' };

const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Segundos máximos de la acción de anotar en un waypoint (alinear, subir, soltar). */
const SCORE_TIME = 6;

export class AutoExecutor {
  stage: Stage;
  private intakeWanted = false;
  private elev: ElevatorPos = 0;
  /** Waypoints con z reflejada (la rutina se adapta al lado por el que salió el robot). */
  private readonly wps: AutoWaypoint[];
  /** Tramo actual (de `legFrom` a la parada `stage.i`), su reloj y su vigilante. */
  private leg: { traj: Trajectory; t: number; stall: number; over: number } | null = null;
  private legFrom = 0;
  /** Siguiente waypoint cuyo cambio de INTAKE ("event marker") falta aplicar. */
  private evNext = 0;
  private free: Bot | null = null;
  /** Ruta completa planeada (marco de la alianza) para dibujarla en el campo. */
  readonly preview: Array<{ x: number; z: number }> = [];

  constructor(
    private r: Robot,
    readonly routine: AutoRoutine,
    private pieces: Pieces,
    private robots: Robot[],
  ) {
    // Rutinas "de cualquier lado": si sale del lado contrario al de su primer waypoint se reflejan en z
    const zb = r.alliance === 'blue' ? r.phys.position().z : -r.phys.position().z;
    const first = routine.waypoints.find((w) => Math.abs(w.z) > 0.3);
    const flip = !!routine.mirrorToStart && !!first && Math.sign(first.z) !== Math.sign(zb) && Math.abs(zb) > 0.3;
    const base = flip ? routine.waypoints.map(mirrorWaypointZ) : routine.waypoints;
    // Punto a punto = paradas en línea recta (igual que la vista previa del diseñador)
    this.wps = routine.spline ? base : base.map((w) => ({ ...w, stop: true, hin: undefined, hout: undefined }));
    this.stage = this.wps.length ? { kind: 'goto', i: this.stopFrom(0) } : routine.idleAfter ? { kind: 'done' } : { kind: 'free' };
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
    return this.stage.kind === 'done' || this.stage.kind === 'free';
  }

  /** Giro proporcional suave hacia `want` (marco azul), con zona muerta y tope de 5 rad/s. */
  private omegaTo(want: number, dead = 0.03): number {
    const d = angDiff(want, this.bluePose().heading);
    if (Math.abs(d) < dead) return 0;
    const lim = Math.min(this.r.spec.maxOmega, 5);
    return Math.max(-lim, Math.min(lim, d * 3.5));
  }

  /** Mando de este paso. `autoLeft` = segundos de AUTO que quedan. */
  update(dt: number, autoLeft = 15): AutoOutput {
    const out: AutoOutput = { forward: 0, turn: 0, elevator: this.elev, intake: this.intakeWanted, release: false };
    const st = this.stage;
    switch (st.kind) {
      case 'goto':
        this.followLeg(dt, st.i, out);
        break;
      case 'act':
        this.act(dt, st, out);
        break;
      case 'free':
        this.freePlay(dt, autoLeft, out);
        break;
      case 'done':
        out.intake = false;
        out.elevator = 0;
        break;
    }
    if (st.kind !== 'free') {
      this.limitCenter(out);
      this.elev = out.elevator;
      this.intakeWanted = out.intake;
    }
    return out;
  }

  /**
   * §4.2 + D7: pared virtual en la línea central. El centro del robot no pasa de su lado (con 0.5 s
   * de anticipación): ni a toda velocidad, ni al desatorarse, ni empujado se cruza completo.
   */
  private limitCenter(out: AutoOutput): void {
    const r = this.r;
    const own = r.alliance === 'blue' ? -1 : 1;
    const xa = r.phys.position().x * own; // > 0 = de su lado
    const vxPerFwd = Math.cos(r.phys.heading()) * own; // cuánto se adentra por m/s hacia adelante
    const fwd = out.forward * r.spec.maxSpeed;
    if (xa + fwd * vxPerFwd * 0.5 < 0.15 && Math.abs(vxPerFwd) > 0.2) {
      const need = Math.min(1.5, (0.15 - xa) / 0.5);
      out.forward = Math.max(-1, Math.min(1, need / vxPerFwd / r.spec.maxSpeed));
    }
  }

  /** Al terminar la rutina sigue jugando: junta Muestras de su mitad y las anota (IA de labbot). */
  private freePlay(dt: number, autoLeft: number, out: AutoOutput): void {
    if (!this.free) this.free = new Bot(this.r, this.pieces, this.robots, { stayHome: true });
    const o: BotOutput = this.free.step(dt, 'AUTO', autoLeft);
    out.forward = o.forward;
    out.turn = o.turn;
    out.intake = o.intake;
    out.elevator = o.elevator;
    out.release = o.release;
  }

  /** Acciones al llegar a un waypoint: INTAKE, anotar, esperar. */
  private act(dt: number, st: Extract<Stage, { kind: 'act' }>, out: AutoOutput): void {
    const r = this.r;
    const m = r.mech;
    const w = this.wps[st.i];
    st.t += dt;
    if (w.intake !== undefined) this.intakeWanted = out.intake = w.intake;
    if (w.score && !st.scored) {
      // Anotar: alinea el frente (o la parte de atrás, con el elevador que empuja) a la pared de la
      // Cámara, sube al nivel y suelta lo que lleva; sin la intake para que no se la vuelva a tragar
      out.intake = false;
      out.elevator = w.score;
      const face = w.heading ?? Math.PI / 2;
      const want = m.side > 0 ? face : face + Math.PI;
      const err = angDiff(want, this.bluePose().heading);
      out.turn = Math.max(-1, Math.min(1, (this.omegaTo(want, 0.02) / (r.spec.maxOmega * 0.8)) * 1));
      if (Math.abs(err) < 0.06 && m.atTarget && m.target === w.score) out.release = m.stored.length > 0;
      if ((m.stored.length === 0 && m.critical === null) || st.t >= SCORE_TIME) {
        st.scored = true;
        st.t = 0;
        out.release = false;
      }
      return;
    }
    if (w.score) out.elevator = 0;
    if (w.wait && st.t < w.wait) return;
    this.next();
  }

  /**
   * Sigue el tramo que termina en la parada `i` (velocidad de la referencia + corrección
   * proporcional de posición; rumbo con prealimentación). Al llegar pasa a su acción.
   */
  private followLeg(dt: number, i: number, out: AutoOutput): void {
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
      if (w.intake !== undefined) this.intakeWanted = out.intake = w.intake;
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
      this.stage = { kind: 'act', i, t: 0, scored: false };
      return;
    }
    // Vigilante: la referencia no avanza ~2 s (lo bloquean) o no llega al final → actúa o salta
    L.stall = k < 0.2 || L.t >= L.traj.duration ? L.stall + dt : Math.max(0, L.stall - dt);
    if (L.stall > 2.2) {
      if (w.score || w.intake !== undefined || w.wait) this.stage = { kind: 'act', i, t: 0, scored: false };
      else this.next();
    }
  }

  private next(): void {
    const st = this.stage;
    const n = this.wps.length;
    if (st.kind === 'act' || st.kind === 'goto') {
      this.legFrom = st.i + 1;
      this.evNext = Math.max(this.evNext, st.i + 1);
      this.stage = st.i + 1 < n ? { kind: 'goto', i: this.stopFrom(st.i + 1) } : this.routine.idleAfter ? { kind: 'done' } : { kind: 'free' };
    }
    this.leg = null;
  }
}
