/**
 * Grabadora de la repetición: se cuelga de la sesión (`GameSession.tap`) y en cada paso fijo guarda
 * los eventos con su robot; cada 1/REPLAY_HZ s guarda un cuadro con las poses. Una Muestra anotada
 * se atribuye al último robot que la soltó (o al que la tenía, si entró sin soltarse).
 */
import type { MechEvent } from '../game/Mechanisms';
import type { GameSession, ScoredSample, SessionTap } from '../game/GameSession';
import { FLAG_CLAW, FLAG_CRITICAL, FLAG_INTAKE, FRAME_HEAD, frameSize, PHASES, PIECE_VALUES, REPLAY_HZ, ROBOT_VALUES, toAngle, toMm, toQ, type Replay, type ReplayEvent, type ReplayHeader } from './format';

/** Cuadros por bloque de memoria (≈ 20 s). */
const CHUNK = 300;

export class Recorder implements SessionTap {
  readonly header: ReplayHeader;
  readonly events: ReplayEvent[] = [];
  private chunks: Int16Array[] = [];
  private frames = 0;
  private size: number;
  private nextT = 0;
  /** Último robot que soltó cada pieza. */
  private releasedBy = new Map<number, number>();
  private done = false;

  constructor(s: GameSession, labels: string[], meta: Record<string, unknown> = {}) {
    this.header = {
      format: 'labbot-rescue-replay',
      version: 1,
      createdAt: new Date().toISOString(),
      player: s.opts.player,
      robots: s.robots.map((r, i) => ({ index: r.index, alliance: r.alliance, station: r.station, spec: r.spec, label: labels[i] ?? r.spec.name })),
      pieces: s.pieces.list.map((p) => (p.owner ? { kind: p.kind, owner: p.owner } : { kind: p.kind })),
      frames: 0,
      final: { red: 0, blue: 0 },
      endgame: { platform: [], critical: { red: false, blue: false }, autoLine: [] },
      meta,
    };
    this.size = frameSize(this.header);
  }

  get finished(): boolean {
    return this.done;
  }

  step(s: GameSession, mech: readonly MechEvent[], scored: readonly ScoredSample[]): void {
    const m = s.match;
    if (!m || this.done || m.t < 0) return;
    const t = Math.round(m.t * 1000) / 1000;
    for (const e of mech) {
      if (e.type === 'release') {
        this.releasedBy.set(e.piece, e.robot);
        this.events.push({ t, type: 'release', robot: e.robot, kind: s.pieces.list[e.piece].kind });
      } else if (e.type !== 'grabMiss') this.events.push({ t, type: e.type, robot: e.robot });
    }
    for (const x of scored) {
      const robot = this.releasedBy.get(x.piece) ?? null;
      const period = m.phase === 'AUTO' || m.phase === 'PAUSE' ? 'AUTO' : 'TELEOP';
      this.events.push({ t, type: 'score', robot, alliance: x.alliance, level: x.level, points: x.points, period });
    }
    if (m.finished) {
      this.frame(s);
      this.finish(s);
      return;
    }
    if (m.t + 1e-9 >= this.nextT) {
      this.frame(s);
      this.nextT += 1 / REPLAY_HZ;
    }
  }

  private frame(s: GameSession): void {
    const m = s.match!;
    const k = this.frames % CHUNK;
    if (k === 0) this.chunks.push(new Int16Array(CHUNK * this.size));
    const d = this.chunks[this.chunks.length - 1];
    let o = k * this.size;
    d[o] = Math.round(Math.max(0, m.t) * 100);
    d[o + 1] = m.score('red');
    d[o + 2] = m.score('blue');
    d[o + 3] = PHASES.indexOf(m.phase);
    o += FRAME_HEAD;
    for (const r of s.robots) {
      const p = r.phys.body.translation();
      const q = r.phys.body.rotation();
      const mc = r.mech;
      d[o] = toMm(p.x);
      d[o + 1] = toMm(p.y);
      d[o + 2] = toMm(p.z);
      d[o + 3] = toQ(q.x);
      d[o + 4] = toQ(q.y);
      d[o + 5] = toQ(q.z);
      d[o + 6] = toQ(q.w);
      d[o + 7] = toMm(mc.height);
      d[o + 8] = toAngle(mc.angle);
      d[o + 9] = (mc.intakeOn ? FLAG_INTAKE : 0) | (mc.critical ? FLAG_CRITICAL : 0) | (mc.stored.length << 2) | (mc.inClaw ? FLAG_CLAW : 0);
      o += ROBOT_VALUES;
    }
    for (const p of s.pieces.list) {
      if (p.state.at === 'field') {
        const t = p.body.translation();
        const q = p.body.rotation();
        d[o] = toMm(t.x);
        d[o + 1] = toMm(t.y);
        d[o + 2] = toMm(t.z);
        d[o + 3] = toQ(q.x);
        d[o + 4] = toQ(q.y);
        d[o + 5] = toQ(q.z);
        d[o + 6] = toQ(q.w);
        d[o + 7] = 1;
      } // fuera de la cancha: ceros (comprime bien)
      o += PIECE_VALUES;
    }
    this.frames++;
  }

  /** Cierra la grabación con el resultado final (§4.3.1: Plataforma y Muestra Crítica al sonar la bocina). */
  private finish(s: GameSession): void {
    const m = s.match!;
    this.done = true;
    this.header.final = { red: m.score('red'), blue: m.score('blue') };
    this.header.endgame = {
      platform: s.robots.filter((r) => s.sensors.onPlatform(r)).map((r) => r.index),
      critical: { red: m.state.red.critical, blue: m.state.blue.critical },
      autoLine: [...m.state.red.autoLine, ...m.state.blue.autoLine].sort((a, b) => a - b),
    };
  }

  /** La repetición hasta ahora (completa si el match terminó). */
  build(s: GameSession): Replay {
    const data = new Int16Array(this.frames * this.size);
    this.chunks.forEach((c, i) => data.set(c.subarray(0, Math.min(CHUNK, this.frames - i * CHUNK) * this.size), i * CHUNK * this.size));
    return { header: { ...this.header, frames: this.frames }, events: this.events.slice(), matchEvents: s.log.slice(), data };
  }
}
