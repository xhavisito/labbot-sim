/**
 * Modo Director — grabación y detección. Se cuelga de la sesión (`GameSession.tap`), toma un cuadro a
 * 30 Hz en un búfer circular de 15 s (sin crear objetos), alimenta al detector de highlights y convierte
 * cada disparo en un `Clip`: 8 s antes y 2 s después del momento (la marca manual, 10 s hacia atrás).
 * Fuera de una sesión no hace nada, así que no cuesta FPS.
 */
import * as F from '../config/field';
import type { Alliance } from '../core/types';
import type { GameSession, ScoredSample, SessionTap } from '../game/GameSession';
import type { MechEvent } from '../game/Mechanisms';
import { buildHeader, writeFrame } from '../replay/Recorder';
import { frameSize, type ReplayHeader } from '../replay/format';
import type { Clip, HighlightKind } from './clip';
import { HighlightDetector, type DetFrame, type Trigger } from './HighlightDetector';
import { BUFFER_SECONDS, FrameRing, RECORD_HZ } from './ring';

export const PRE_ROLL = 8;
export const POST_ROLL = 2;
export const MANUAL_ROLL = 10;
export const MAX_CLIPS = 12;
/** Disparos del mismo robot a menos de esto de un clip pendiente se juntan en él. */
const MERGE_WINDOW = 4;

interface Pending {
  trigger: Trigger;
  tags: HighlightKind[];
  /** Hasta qué tiempo de simulación se sigue grabando antes de guardar. */
  until: number;
}

/** Varios observadores en la única ranura `GameSession.tap` (la grabadora de repeticiones y el Director). */
export function tee(...taps: Array<SessionTap | null>): SessionTap {
  const list = taps.filter((x): x is SessionTap => !!x);
  return { step: (s, mech, scored) => list.forEach((t) => t.step(s, mech, scored)) };
}

export class Director implements SessionTap {
  /** Clips guardados, el más nuevo al final. */
  readonly clips: Clip[] = [];
  /** Aviso a la UI cuando se guarda un clip. */
  onClip: ((c: Clip) => void) | null = null;
  enabled = true;
  private ring: FrameRing | null = null;
  private header: ReplayHeader | null = null;
  private session: GameSession | null = null;
  private detector = new HighlightDetector((t) => this.onTrigger(t));
  private pending: Pending[] = [];
  private lastRec = -Infinity;
  private nextId = 1;
  private det: DetFrame | null = null;

  /** Asocia la sesión nueva: borra el búfer y los clips (los de la sesión anterior). */
  attach(session: GameSession, labels: string[], matchDuration = 0): void {
    this.session = session;
    this.clips.length = 0;
    this.pending.length = 0;
    this.detector.reset();
    this.lastRec = -Infinity;
    this.nextId = 1;
    this.header = buildHeader(session, labels, { duration: matchDuration });
    this.ring = new FrameRing(frameSize(this.header));
    this.det = {
      time: 0,
      remaining: Infinity,
      endgame: false,
      robots: session.robots.map((r) => ({ alliance: r.alliance, x: 0, z: 0, speed: 0, omega: 0, maxSpeed: r.spec.maxSpeed, onPlatform: false })),
      touching: (i, j) => {
        const a = this.session?.robots[i];
        const b = this.session?.robots[j];
        return !!a && !!b && this.session!.referee.isTouching(a.index, b.index);
      },
      criticalOnRepisa: { red: false, blue: false },
      halfL: F.HALF_L,
      halfW: F.HALF_W,
    };
  }

  detach(): void {
    this.session = null;
    this.ring = null;
  }

  get hasSession(): boolean {
    return this.session !== null;
  }

  /** Segundos de juego que hay en el búfer ahora. */
  get bufferSeconds(): number {
    return this.ring ? Math.max(0, this.ring.latest - this.ring.oldest) : 0;
  }

  /** Llamado al final de cada paso de física de la sesión. */
  step(s: GameSession, _mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    if (!this.enabled || !this.ring || !this.det || s !== this.session) return;
    for (const x of scored) {
      const last = s.pieces.list[x.piece]?.lastRobot;
      let focus = s.robots.findIndex((r) => r.index === last && r.alliance === x.alliance);
      if (focus < 0) focus = s.robots.findIndex((r) => r.alliance === x.alliance);
      this.detector.onScore(s.time, x.alliance, x.level, Math.max(0, focus), s.match ? s.match.remaining : Infinity);
    }
    if (s.time - this.lastRec >= 1 / RECORD_HZ - 1e-6) {
      this.lastRec = s.time;
      this.record(s);
    }
    // Guarda los pendientes que ya tienen su posproducción
    for (let i = this.pending.length - 1; i >= 0; i--) if (s.time >= this.pending[i].until - 1e-6) this.finish(this.pending.splice(i, 1)[0]);
  }

  /** Escribe un cuadro en el búfer y corre el detector. */
  private record(s: GameSession): void {
    const ring = this.ring!;
    const det = this.det!;
    const m = s.match;
    const { data, offset } = ring.slot();
    writeFrame(s, data, offset, 0);
    ring.commit(s.time);

    det.time = s.time;
    det.remaining = m ? m.remaining : Infinity;
    det.endgame = m?.phase === 'ENDGAME';
    s.robots.forEach((r, i) => {
      const b = r.phys.body;
      const t = b.translation();
      const v = b.linvel();
      const d = det.robots[i];
      d.x = t.x;
      d.z = t.z;
      d.speed = Math.hypot(v.x, v.z);
      d.omega = b.angvel().y;
      d.onPlatform = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0;
    });
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
    const focus = Math.max(0, s.robots.indexOf(s.player));
    return this.save(MANUAL_ROLL, 0, { kind: 'manual', time: t, focus, alliance: s.player.alliance as Alliance }, []);
  }

  private onTrigger(t: Trigger): void {
    const near = this.pending.find((p) => Math.abs(p.trigger.time - t.time) <= MERGE_WINDOW && p.trigger.focus === t.focus);
    if (near) {
      if (!near.tags.includes(t.kind) && t.kind !== near.trigger.kind) near.tags.push(t.kind);
      near.until = Math.max(near.until, t.time + POST_ROLL);
      near.trigger = { ...t, kind: near.trigger.kind };
      return;
    }
    this.pending.push({ trigger: t, tags: [], until: t.time + POST_ROLL });
  }

  private finish(p: Pending): void {
    this.save(PRE_ROLL, Math.max(0, p.until - p.trigger.time), p.trigger, p.tags);
  }

  /** Guarda lo que haya pendiente (al terminar el match o antes de abrir el estudio). */
  flush(): void {
    for (const p of this.pending.splice(0)) this.finish(p);
  }

  private save(pre: number, post: number, trig: Trigger, tags: HighlightKind[]): Clip | null {
    const ring = this.ring;
    const header = this.header;
    if (!ring || !header) return null;
    const x = ring.extract(trig.time - Math.min(pre, BUFFER_SECONDS - post), trig.time + post);
    if (!x) return null;
    const m = this.session?.match;
    const matchStart = m ? Math.max(0, m.t - (ring.latest - x.start)) : NaN;
    const last = (x.frames - 1) * ring.size;
    const clip: Clip = {
      id: this.nextId++,
      kind: trig.kind,
      tags,
      focus: trig.focus,
      trigger: Math.min(Math.max(trig.time - x.start, 0), x.duration),
      duration: x.duration,
      matchStart,
      replay: {
        header: { ...header, createdAt: new Date().toISOString(), frames: x.frames, final: { red: x.data[last + 1], blue: x.data[last + 2] }, meta: { ...header.meta, clip: true, hz: RECORD_HZ, t0: Number.isNaN(matchStart) ? 0 : matchStart } },
        events: [],
        matchEvents: [],
        data: x.data,
      },
    };
    this.clips.push(clip);
    // Tope: se descarta el más viejo que no sea manual (y si todos lo son, el más viejo)
    while (this.clips.length > MAX_CLIPS) {
      const k = this.clips.findIndex((c) => c.kind !== 'manual');
      this.clips.splice(k >= 0 ? k : 0, 1);
    }
    this.onClip?.(clip);
    return clip;
  }
}
