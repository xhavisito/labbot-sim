/**
 * Reproductor de repeticiones: arma una sesión "títere" con los mismos robots (sin match, sin IA y
 * sin dar pasos de física) y en cada cuadro pone a mano los cuerpos y los mecanismos en la pose
 * grabada, interpolando entre cuadros. Las vistas (`RobotView`, `PieceView`) dibujan igual que en vivo.
 */
import { GAME } from '../config/game';
import { knownSpec } from '../config/robot';
import { formatTimer, timerSeconds } from '../core/clock';
import { GameSession } from '../game/GameSession';
import { frameScore, frameTime, pieceFrame, REPLAY_HZ, replayDuration, robotFrame, type Replay } from './format';

export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Interpolación de cuaterniones (nlerp por el camino corto; los cuadros están muy cerca). */
function qlerp(a: readonly number[], b: readonly number[], k: number): { x: number; y: number; z: number; w: number } {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => lerp(a[i], s * b[i], k));
  const n = Math.hypot(...q) || 1;
  return { x: q[0] / n, y: q[1] / n, z: q[2] / n, w: q[3] / n };
}

export class ReplayPlayer {
  readonly session: GameSession;
  readonly duration: number;
  t = 0;
  playing = true;
  speed = 1;
  /** Robot que sigue la cámara (posición en `header.robots`). */
  focus: number;

  constructor(readonly replay: Replay) {
    const h = replay.header;
    this.session = new GameSession({ player: h.player, preload: false, ai: false, specs: h.robots.map((r) => knownSpec(r.spec)), hp: { enabled: false, interval: 3 } });
    this.duration = replayDuration(replay);
    this.focus = Math.max(0, h.robots.findIndex((r) => r.index === h.player));
    this.apply();
  }

  /** Cuadro anterior o igual a `t` (los cuadros van a 1/REPLAY_HZ, salvo el último). */
  private frameAt(t: number): number {
    const n = this.replay.header.frames;
    let f = Math.max(0, Math.min(n - 1, Math.floor(t * REPLAY_HZ)));
    while (f > 0 && frameTime(this.replay, f) > t) f--;
    while (f < n - 1 && frameTime(this.replay, f + 1) <= t) f++;
    return f;
  }

  update(dt: number): void {
    if (this.playing) {
      this.t = Math.min(this.duration, this.t + dt * this.speed);
      if (this.t >= this.duration) this.playing = false;
    }
    this.apply();
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.apply();
  }

  /** Pose de los robots y las piezas en `this.t`. */
  private apply(): void {
    const r = this.replay;
    if (r.header.frames === 0) return;
    const f0 = this.frameAt(this.t);
    const f1 = Math.min(r.header.frames - 1, f0 + 1);
    const t0 = frameTime(r, f0);
    const t1 = frameTime(r, f1);
    const k = f1 > f0 && t1 > t0 ? Math.max(0, Math.min(1, (this.t - t0) / (t1 - t0))) : 0;
    const s = this.session;
    const spare = s.pieces.list[0];
    s.robots.forEach((rb, i) => {
      const a = robotFrame(r, f0, i);
      const b = robotFrame(r, f1, i);
      rb.phys.body.setTranslation({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) }, false);
      rb.phys.body.setRotation(qlerp(a.q, b.q, k), false);
      const m = rb.mech;
      const near = k < 0.5 ? a : b;
      m.height = lerp(a.height, b.height, k);
      m.angle = lerp(a.angle, b.angle, k);
      m.intakeOn = near.intake;
      // Las vistas solo cuentan cuántas piezas lleva: se rellenan con una pieza cualquiera
      m.stored.length = 0;
      for (let j = 0; j < near.stored; j++) m.stored.push(spare);
      m.critical = near.critical ? spare : null;
      m.inClaw = near.claw;
    });
    s.pieces.list.forEach((p, i) => {
      const a = pieceFrame(r, f0, i);
      const b = pieceFrame(r, f1, i);
      const both = a.onField && b.onField;
      const one = k < 0.5 ? a : b;
      if (!both && !one.onField) {
        p.state = { at: 'hp', alliance: 'red' };
        return;
      }
      const kk = both ? k : 0;
      const from = both ? a : one;
      const to = both ? b : one;
      p.body.setTranslation({ x: lerp(from.x, to.x, kk), y: lerp(from.y, to.y, kk), z: lerp(from.z, to.z, kk) }, false);
      p.body.setRotation(qlerp(from.q, to.q, kk), false);
      p.state = { at: 'field' };
    });
    s.snapViews();
  }

  /** Marcador, timer y fase en `this.t`. */
  get scoreboard(): { red: number; blue: number; timer: string; phase: string } {
    const sc = frameScore(this.replay, this.frameAt(this.t));
    return { red: sc.red, blue: sc.blue, timer: formatTimer(timerSeconds(this.t, GAME)), phase: sc.phase };
  }

  /** Pose del robot enfocado (para la cámara). */
  get focusPose(): { x: number; y: number; z: number; heading: number } {
    const p = this.session.robots[this.focus].phys;
    const t = p.position();
    return { x: t.x, y: t.y, z: t.z, heading: p.heading() };
  }

  dispose(): void {
    this.session.dispose();
  }
}
