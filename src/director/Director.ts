/**
 * Modo Director — grabación y detección. Se cuelga de la sesión (`GameSession.tap`), toma un cuadro
 * a 30 Hz en un búfer circular de 15 s (sin crear objetos), alimenta al detector de highlights y
 * convierte cada disparo en un `Clip`: 8 s antes y 2 s después del momento (el manual, 10 s hacia
 * atrás). Cuando no hay sesión asociada o está en pausa no hace nada, así que no cuesta FPS.
 */
import * as F from '../config/field';
import type { Alliance, Level } from '../core/types';
import type { GameSession } from '../game/GameSession';
import { BUFFER_SECONDS, FLAG_CRITICAL, FLAG_INTAKE, FrameRing, P, pieceOffset, R, RECORD_HZ, robotOffset, type Clip, type HighlightKind } from './clipBuffer';
import { HighlightDetector, type DetFrame, type Trigger } from './HighlightDetector';

export const PRE_ROLL = 8;
export const POST_ROLL = 2;
export const MANUAL_ROLL = 10;
export const MAX_CLIPS = 12;
/** Disparos que caen a menos de esto de un clip pendiente se juntan en él. */
const MERGE_WINDOW = 4;

interface Pending {
  trigger: Trigger;
  tags: HighlightKind[];
  /** Hasta qué tiempo de simulación se sigue grabando antes de guardar. */
  until: number;
  pre: number;
}

export class Director {
  /** Clips guardados, el más nuevo al final. */
  readonly clips: Clip[] = [];
  /** Aviso a la UI cuando se guarda un clip. */
  onClip: ((c: Clip) => void) | null = null;
  enabled = true;
  private ring: FrameRing | null = null;
  private session: GameSession | null = null;
  private detector = new HighlightDetector((t) => this.onTrigger(t));
  private pending: Pending[] = [];
  private lastRec = -Infinity;
  private nextId = 1;
  /** Cuadro de detección reutilizable (sin asignar memoria por cuadro). */
  private det: DetFrame | null = null;

  /** Asocia la sesión nueva: borra el búfer y los clips (los de la sesión anterior). */
  attach(session: GameSession): void {
    this.session = session;
    this.clips.length = 0;
    this.pending.length = 0;
    this.detector.reset();
    this.lastRec = -Infinity;
    this.nextId = 1;
    this.ring = new FrameRing(session.robots.length, session.pieces.list.length);
    this.det = {
      time: 0,
      remaining: Infinity,
      endgame: false,
      robots: session.robots.map((r) => ({ alliance: r.alliance, x: 0, z: 0, speed: 0, omega: 0, maxSpeed: r.spec.maxSpeed, onPlatform: false })),
      touching: (i, j) => this.session?.referee.isTouching(i, j) ?? false,
      criticalOnRepisa: { red: false, blue: false },
      halfL: F.HALF_L,
      halfW: F.HALF_W,
    };
    session.tap = (s) => this.onStep(s);
  }

  detach(): void {
    if (this.session) this.session.tap = null;
    this.session = null;
  }

  get bufferSeconds(): number {
    return this.ring ? Math.max(0, this.ring.latest - this.ring.oldest) : 0;
  }

  /** Llamado al final de cada paso de física de la sesión. */
  private onStep(s: GameSession): void {
    if (!this.enabled || !this.ring || !this.det) return;
    // Muestras anotadas en este paso (los eventos de partida del paso)
    for (const e of s.stepEvents) {
      if (e.type !== 'sample') continue;
      this.detector.onScore(s.time, e.alliance, e.level, this.nearestToCamara(s, e.alliance, e.level), s.match ? s.match.remaining : Infinity);
    }
    if (s.time - this.lastRec >= 1 / RECORD_HZ - 1e-6) {
      this.lastRec = s.time;
      this.record(s);
    }
    // Guarda los pendientes que ya tienen su posproducción
    for (let i = this.pending.length - 1; i >= 0; i--) if (s.time >= this.pending[i].until - 1e-6) this.finish(this.pending.splice(i, 1)[0]);
  }

  private nearestToCamara(s: GameSession, a: Alliance, level: Level): number {
    const w = F.rectFor(a, F.camaraWells()[level]);
    const cx = (w.x0 + w.x1) / 2;
    const cz = (w.z0 + w.z1) / 2;
    let best = s.robots.findIndex((r) => r.alliance === a);
    let bd = Infinity;
    for (const r of s.robots) {
      if (r.alliance !== a) continue;
      const p = r.phys.position();
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < bd) (bd = d), (best = r.index);
    }
    return best;
  }

  /** Escribe un cuadro en el búfer y corre el detector. */
  private record(s: GameSession): void {
    const ring = this.ring!;
    const f = ring.slot();
    const det = this.det!;
    const m = s.match;
    f[0] = m ? m.t : NaN;
    s.robots.forEach((r, i) => {
      const o = robotOffset(ring.layout, i);
      const b = r.phys.body;
      const t = b.translation();
      const q = b.rotation();
      const v = b.linvel();
      const w = b.angvel();
      f[o + R.x] = t.x;
      f[o + R.y] = t.y;
      f[o + R.z] = t.z;
      f[o + R.qx] = q.x;
      f[o + R.qy] = q.y;
      f[o + R.qz] = q.z;
      f[o + R.qw] = q.w;
      f[o + R.height] = r.mech.height;
      f[o + R.angle] = r.mech.angle;
      f[o + R.flags] = (r.mech.intakeOn ? FLAG_INTAKE : 0) | (r.mech.critical ? FLAG_CRITICAL : 0);
      f[o + R.stored] = r.mech.stored.length;
      const speed = Math.hypot(v.x, v.z);
      f[o + R.speed] = speed;
      const d = det.robots[i];
      d.x = t.x;
      d.z = t.z;
      d.speed = speed;
      d.omega = w.y;
      d.onPlatform = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0;
    });
    s.pieces.list.forEach((p, i) => {
      const o = pieceOffset(ring.layout, i);
      const onField = p.state.at === 'field';
      f[o + P.vis] = onField ? 1 : 0;
      if (!onField) return;
      const t = p.body.translation();
      const q = p.body.rotation();
      f[o + P.x] = t.x;
      f[o + P.y] = t.y;
      f[o + P.z] = t.z;
      f[o + P.qx] = q.x;
      f[o + P.qy] = q.y;
      f[o + P.qz] = q.z;
      f[o + P.qw] = q.w;
    });
    ring.commit(s.time);

    det.time = s.time;
    det.remaining = m ? m.remaining : Infinity;
    det.endgame = m?.phase === 'ENDGAME';
    if (m?.running) {
      det.criticalOnRepisa.red = s.sensors.criticalOnRepisa('red');
      det.criticalOnRepisa.blue = s.sensors.criticalOnRepisa('blue');
    }
    this.detector.onFrame(det);
  }

  /** Marca manual (F9 / H): guarda los últimos 10 s ya mismo. */
  markManual(): Clip | null {
    const s = this.session;
    if (!s || !this.ring) return null;
    const t = this.ring.latest;
    if (!isFinite(t)) return null;
    // Protagonista: el robot propio
    return this.save(MANUAL_ROLL, 0, { kind: 'manual', time: t, focus: s.player.index, alliance: s.player.alliance }, []);
  }

  private onTrigger(t: Trigger): void {
    const near = this.pending.find((p) => Math.abs(p.trigger.time - t.time) <= MERGE_WINDOW && p.trigger.focus === t.focus);
    if (near) {
      if (!near.tags.includes(t.kind) && t.kind !== near.trigger.kind) near.tags.push(t.kind);
      near.until = Math.max(near.until, t.time + POST_ROLL);
      near.trigger = { ...t, kind: near.trigger.kind };
      return;
    }
    this.pending.push({ trigger: t, tags: [], until: t.time + POST_ROLL, pre: PRE_ROLL });
  }

  private finish(p: Pending): void {
    this.save(p.pre, Math.max(0, p.until - p.trigger.time), p.trigger, p.tags);
  }

  /** Guarda lo que haya pendiente (al terminar el match). */
  flush(): void {
    for (const p of this.pending.splice(0)) this.finish(p);
  }

  private save(pre: number, post: number, trig: Trigger, tags: HighlightKind[]): Clip | null {
    const ring = this.ring;
    if (!ring) return null;
    const c = ring.extract(trig.time - Math.min(pre, BUFFER_SECONDS - post), trig.time + post, {
      id: this.nextId,
      kind: trig.kind,
      tags,
      focus: trig.focus,
      triggerTime: trig.time,
    });
    if (!c) return null;
    this.nextId++;
    this.clips.push(c);
    // Tope: se descarta el más viejo que no sea manual (y si todos lo son, el más viejo)
    while (this.clips.length > MAX_CLIPS) {
      const k = this.clips.findIndex((x) => x.kind !== 'manual');
      this.clips.splice(k >= 0 ? k : 0, 1);
    }
    this.onClip?.(c);
    return c;
  }
}
