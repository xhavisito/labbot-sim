/**
 * IA básica de un robot (para los robots que no maneja el jugador y para la rutina de AUTO
 * "Anotar precarga"). Máquina de estados sencilla:
 *   recolectar (va a la Muestra libre más cercana con la intake encendida)
 *   → anotar (va al frente de su Cámara, sube el elevador al nivel y suelta todo)
 *   → en el ENDGAME, subir a la Plataforma por su rampa.
 * Respeta reglas que el árbitro cobra: no sube a la Plataforma antes del endgame (la rodea), en AUTO
 * no cruza la línea central, frena si un rival está justo enfrente (para no chocar, §4.5) y un
 * filtro final (`guard`) descarta mandos que sacarían una esquina de la cancha (§4.6) o la meterían
 * a la Plataforma antes de tiempo.
 */
import * as F from '../config/field';
import type { ElevatorPos } from '../config/robot';
import type { Phase } from '../core/clock';
import type { Level } from '../core/types';
import type { Robot } from '../game/Robot';
import type { Pieces } from '../physics/Pieces';

export interface BotOutput {
  forward: number;
  turn: number;
  intake: boolean;
  elevator: ElevatorPos;
  release: boolean;
}

type Mode = 'collect' | 'score' | 'climb' | 'idle';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Margen alrededor de la Plataforma que la IA no pisa antes del endgame. */
const PLATFORM_CLEAR = 0.65;
/** Centro del robot a no menos de esto de los bordes (sus objetivos se recortan aquí). */
const EDGE_CLEAR = 0.55;

export interface BotOptions {
  /** Nivel al que anota (por defecto 3, el que más vale). */
  level: Level;
  /** Cuántas Muestras junta antes de ir a anotar. */
  batch: number;
  /** Solo anota lo que trae (AUTO "Anotar precarga"): no recolecta. */
  scoreOnly: boolean;
  /** No cruza la línea central (AUTO, §4.2). */
  stayHome: boolean;
}

export class Bot {
  mode: Mode = 'collect';
  private targetPiece = -1;
  private backOff = 0;
  private bestDist = Infinity;
  private progressT = 0;
  private lastGoal: { x: number; z: number } | null = null;
  /** Nivel al que va a anotar ahora (cambia si otro robot ocupa ese lugar). */
  private scoreLevel: Level;
  /** Muestras que dejó por imposibles (índice → segundos que faltan). */
  private ignore = new Map<number, number>();
  readonly opts: BotOptions;

  constructor(
    readonly robot: Robot,
    private pieces: Pieces,
    private others: Robot[],
    opts: Partial<BotOptions> = {},
  ) {
    this.opts = { level: 3, batch: 3, scoreOnly: false, stayHome: false, ...opts };
    this.scoreLevel = this.opts.level;
  }

  /** Lado de la alianza: +1 rojo (+X), −1 azul. */
  private get side(): number {
    return this.robot.alliance === 'red' ? 1 : -1;
  }

  /** Punto de anotación: frente a la pared de la Cámara propia, al centro del nivel, viendo hacia ella. */
  scoringPose(level: Level): { x: number; z: number; heading: number } {
    const w = F.camaraWells()[level];
    const p = F.forAlliance(this.robot.alliance, { x: (w.x0 + w.x1) / 2, z: F.CAMARA_Z_RED[0] - this.robot.phys.halfL - 0.04 });
    return { ...p, heading: this.robot.alliance === 'red' ? -Math.PI / 2 : Math.PI / 2 };
  }

  /** `timeLeft`: segundos para el final del match (para ir a la rampa antes del endgame). */
  step(dt: number, phase: Phase, timeLeft = Infinity): BotOutput {
    const out = this.decide(dt, phase, timeLeft);
    this.guard(out, phase === 'ENDGAME');
    return out;
  }

  private decide(dt: number, phase: Phase, timeLeft: number): BotOutput {
    const r = this.robot;
    const m = r.mech;
    const out: BotOutput = { forward: 0, turn: 0, intake: false, elevator: 0, release: false };
    const endgame = phase === 'ENDGAME';
    // Con ~40 s por delante se acerca a su rampa (sube hasta que empiece el endgame, §4.6)
    if ((endgame || timeLeft < 40) && this.mode !== 'climb' && !this.opts.stayHome && (m.stored.length === 0 || this.mode === 'collect' || timeLeft < 34)) this.mode = 'climb';
    if (this.mode === 'collect' && (m.stored.length >= Math.min(this.opts.batch, m.capacity) || (this.opts.scoreOnly && m.stored.length > 0))) this.mode = 'score';
    if (this.mode === 'collect' && this.opts.scoreOnly) this.mode = 'idle';
    if (this.mode === 'score' && m.stored.length === 0) this.mode = this.opts.scoreOnly ? 'idle' : endgame ? 'climb' : 'collect';

    for (const [i, left] of this.ignore) if (left - dt <= 0) this.ignore.delete(i);
    else this.ignore.set(i, left - dt);
    if (this.backOff > 0) {
      this.backOff -= dt;
      out.forward = -0.35;
      out.turn = 0.6;
      return out;
    }

    if (this.mode === 'collect') {
      out.intake = true;
      const piece = this.pickSample();
      if (!piece) return out;
      this.drive(piece, out, false, phase);
    } else if (this.mode === 'score') {
      // Se coloca 0.7 m antes de la pared, se alinea de frente, avanza hasta la pared y suelta
      const level = this.freeLevel();
      const pose = this.scoringPose(level);
      const away = this.robot.alliance === 'red' ? -1 : 1; // hacia la cancha (lejos de la Cámara)
      const stage = { x: pose.x, z: pose.z + away * 0.7 };
      const pos = r.phys.position();
      const err = wrap(pose.heading - r.phys.heading());
      const lateral = Math.abs(pos.x - pose.x);
      const depth = (pos.z - pose.z) * away; // > 0: todavía lejos de la pared
      out.elevator = depth < 1.2 && lateral < 0.5 ? level : 0;
      if (lateral > 0.12 || depth > 0.9 || depth < -0.05) {
        if (Math.hypot(stage.x - pos.x, stage.z - pos.z) > 0.1) this.drive(stage, out, true, phase);
        else out.turn = Math.max(-1, Math.min(1, err * 2));
      } else if (Math.abs(err) > 0.06) {
        out.turn = Math.max(-1, Math.min(1, err * 2));
      } else if (depth > 0.02) {
        out.forward = Math.min(0.35, depth * 1.5 + 0.08);
        out.turn = Math.max(-1, Math.min(1, err * 2));
      } else {
        const ready = Math.abs(m.height - r.spec.elevatorHeights[level]) < 0.01;
        out.release = ready;
      }
    } else if (this.mode === 'climb') {
      // Rampa propia: pie en |x| = 2.0; sube a su carril de la plataforma superior (caben 2 robots)
      const pos = r.phys.position();
      const lane = F.forAlliance(r.alliance, { x: 0, z: r.station === 0 ? -0.37 : 0.37 }).z;
      const onTop = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0 && this.side * pos.x < 0.75;
      if (onTop) return out;
      const foot = { x: this.side * 2.75, z: lane };
      const atFoot = Math.abs(pos.z - lane) < 0.25 && this.side * pos.x < 2.95 && this.side * pos.x > 0.4;
      if (!atFoot) this.drive(foot, out, true, phase);
      else if (endgame) this.drive({ x: this.side * 0.6, z: lane }, out, true, phase, true);
      else out.turn = Math.max(-1, Math.min(1, wrap((this.side > 0 ? Math.PI : 0) - r.phys.heading()) * 2));
    }
    return out;
  }

  /** La Muestra libre más cercana (en AUTO, solo de su mitad). */
  private pickSample(): { x: number; z: number } | null {
    const pos = this.robot.phys.position();
    const cur = this.targetPiece >= 0 ? this.pieces.list[this.targetPiece] : null;
    if (cur && cur.state.at === 'field' && cur.body.translation().y < 0.2) {
      const t = cur.body.translation();
      return { x: t.x, z: t.z };
    }
    let best: { i: number; d: number } | null = null;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field' || this.ignore.has(p.index)) continue;
      const t = p.body.translation();
      if (t.y > 0.2) continue; // dentro de una Cámara o en el aire
      // Pegadas a un borde o junto a una Cámara: la intake no llega sin sacar una esquina
      if (Math.abs(t.x) > F.HALF_L - 0.35 || Math.abs(t.z) > F.HALF_W - 0.5) continue;
      if (Math.abs(t.x) < F.PLATFORM_LENGTH / 2 + 0.1 && Math.abs(t.z) < F.PLATFORM_WIDTH / 2 + 0.1) continue;
      if (this.opts.stayHome && this.side * t.x < 0.5) continue;
      const d = Math.hypot(t.x - pos.x, t.z - pos.z);
      if (!best || d < best.d) best = { i: p.index, d };
    }
    if ((best ? best.i : -1) !== this.targetPiece) {
      this.bestDist = Infinity;
      this.progressT = 0;
    }
    this.targetPiece = best ? best.i : -1;
    if (!best) return null;
    const t = this.pieces.list[best.i].body.translation();
    return { x: t.x, z: t.z };
  }

  /**
   * Persecución para tanque: gira hacia el punto y avanza según qué tan alineado va. Rodea la
   * Plataforma si el camino la cruza (salvo `allowPlatform`) y frena si hay un rival enfrente.
   */
  private drive(goal: { x: number; z: number }, out: BotOutput, precise: boolean, phase: Phase, allowPlatform = false): void {
    const r = this.robot;
    const pos = r.phys.position();
    let g = goal;
    if (!allowPlatform) g = this.avoidPlatform(pos, goal);
    if (this.opts.stayHome || phase === 'AUTO') g = { x: this.side > 0 ? Math.max(0.5, g.x) : Math.min(-0.5, g.x), z: g.z };
    g = { x: clamp(g.x, F.HALF_L - EDGE_CLEAR), z: clamp(g.z, F.HALF_W - EDGE_CLEAR) };
    const dx = g.x - pos.x;
    const dz = g.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(-dz, dx);
    const err = wrap(want - r.phys.heading());
    out.turn = Math.max(-1, Math.min(1, err * 2.2));
    const align = Math.max(0, Math.cos(err));
    out.forward = align * align * Math.min(1, dist / (precise ? 0.6 : 0.4)) * (precise ? 0.75 : 0.9);
    // Rival enfrente (a menos de 1.1 m y dentro de ±35°): frenar y desviarse
    for (const o of this.others) {
      if (o === r) continue;
      const op = o.phys.position();
      const od = Math.hypot(op.x - pos.x, op.z - pos.z);
      const oa = wrap(Math.atan2(-(op.z - pos.z), op.x - pos.x) - r.phys.heading());
      if (od < 1.1 && Math.abs(oa) < 0.6) {
        out.forward = Math.min(out.forward, 0.05);
        out.turn = oa > 0 ? -0.8 : 0.8;
      }
    }
    // Atorado: si en 2.5 s no se acercó 0.15 m al objetivo, retrocede girando y (si iba por una
    // Muestra) la ignora un rato
    if (!this.lastGoal || Math.hypot(g.x - this.lastGoal.x, g.z - this.lastGoal.z) > 0.3) {
      this.bestDist = Infinity;
      this.progressT = 0;
    }
    this.lastGoal = g;
    this.progressT += 1 / 120;
    if (dist < this.bestDist - 0.15) {
      this.bestDist = dist;
      this.progressT = 0;
    }
    if (this.progressT > 2.5 && dist > 0.15) {
      this.progressT = 0;
      this.bestDist = Infinity;
      this.backOff = 0.7;
      if (this.mode === 'collect' && this.targetPiece >= 0) this.ignore.set(this.targetPiece, 10);
      this.targetPiece = -1;
    }
  }

  /** El nivel preferido, o el siguiente que valga más si otro robot está en su lugar de anotación. */
  private freeLevel(): Level {
    const order: Level[] = [this.opts.level, ...([3, 2, 1] as Level[]).filter((l) => l !== this.opts.level)];
    const busy = (l: Level): boolean => {
      const p = this.scoringPose(l);
      return this.others.some((o) => o !== this.robot && Math.hypot(o.phys.position().x - p.x, o.phys.position().z - p.z) < 0.6);
    };
    if (!busy(this.scoreLevel)) return this.scoreLevel;
    this.scoreLevel = order.find((l) => !busy(l)) ?? this.scoreLevel;
    return this.scoreLevel;
  }

  /**
   * Filtro final: predice dónde quedan las esquinas del chasis con el mando y, si alguna saldría de la
   * cancha o (antes del endgame) tocaría la Plataforma, usa la alternativa que menos invade.
   */
  private guard(out: BotOutput, platformOk: boolean): void {
    const p = this.robot.phys;
    const pos = p.position();
    const h0 = p.heading();
    const hl = p.halfL;
    const hw = p.halfW;
    const px = F.PLATFORM_LENGTH / 2 + 0.08;
    const pz = F.PLATFORM_WIDTH / 2 + 0.08;
    const invasion = (f: number, t: number): number => {
      const h = h0 + t * this.robot.spec.maxOmega * 0.8 * 0.15;
      const d = f * this.robot.spec.maxSpeed * 0.15;
      const cx = pos.x + Math.cos(h0) * d;
      const cz = pos.z - Math.sin(h0) * d;
      const c = Math.cos(h);
      const s = Math.sin(h);
      let v = 0;
      for (const [lx, lz] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
        const x = cx + lx * c + lz * s;
        const z = cz - lx * s + lz * c;
        v += Math.max(0, Math.abs(x) - (F.HALF_L - 0.03)) + Math.max(0, Math.abs(z) - (F.HALF_W - 0.03));
        if (!platformOk) v += Math.max(0, Math.min(px - Math.abs(x), pz - Math.abs(z)));
      }
      return v;
    };
    const base = invasion(out.forward, out.turn);
    if (base <= 1e-6) return;
    const options: Array<[number, number]> = [
      [0, out.turn],
      [out.forward, 0],
      [-0.3, 0],
      [0.3, 0],
      [0, 0],
    ];
    let best: [number, number] = [out.forward, out.turn];
    let bestV = base;
    for (const o of options) {
      const v = invasion(o[0], o[1]);
      if (v < bestV - 1e-6) {
        best = o;
        bestV = v;
      }
    }
    [out.forward, out.turn] = best;
  }

  /** Si la recta al objetivo cruza la Plataforma (con margen), va primero a la esquina más cómoda. */
  private avoidPlatform(pos: { x: number; z: number }, goal: { x: number; z: number }): { x: number; z: number } {
    const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    const crosses = segmentHitsRect(pos.x, pos.z, goal.x, goal.z, hx, hz);
    if (!crosses) return goal;
    const cx = hx + 0.1;
    const cz = hz + 0.1;
    const sz = Math.sign(pos.z) || 1;
    // En un extremo (frente a una rampa): primero a la esquina de ese extremo, del lado del objetivo
    if (Math.abs(pos.z) < hz) return { x: (Math.sign(pos.x) || this.side) * cx, z: (Math.sign(goal.z) || sz) * cz };
    // Objetivo del otro lado largo: rodear por el extremo (en X) más cercano
    if (Math.sign(goal.z) !== sz && Math.abs(goal.z) > 0.1) {
      const ex = (Math.abs(pos.x + goal.x) > 0.01 ? Math.sign(pos.x + goal.x) : this.side) * cx;
      if (Math.abs(pos.x) < hx) return { x: ex, z: sz * cz };
      return { x: ex, z: goal.z };
    }
    // Mismo lado: bordear hasta la esquina del extremo por donde queda el objetivo
    return { x: Math.abs(goal.x) > hx ? Math.sign(goal.x) * cx : goal.x, z: sz * cz };
  }
}

const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));

/** ¿El segmento (x0,z0)→(x1,z1) toca el rectángulo |x| ≤ hx, |z| ≤ hz? (Liang–Barsky) */
export function segmentHitsRect(x0: number, z0: number, x1: number, z1: number, hx: number, hz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, x0 + hx) && clip(dx, hx - x0) && clip(-dz, z0 + hz) && clip(dz, hz - z0) && t0 <= t1;
}
