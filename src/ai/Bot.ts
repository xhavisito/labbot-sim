/**
 * IA de un robot (los que no maneja el jugador y la rutina de AUTO "Anotar precarga").
 *
 * Siempre tiene una acción útil según el estado del match:
 *   collect  → va por la mejor Muestra libre (incluidas las que mete el HP junto a la pared de su
 *              Campana) con la intake encendida;
 *   score    → las lleva al frente de su Cámara, sube el elevador al nivel y suelta (§4.4);
 *   critical → en el ENDGAME el robot "portador" toma la Muestra Crítica de la rendija de su Campana
 *              y la deja en la Repisa (§4.3.1, §4.4: 15 pts + 1 RP);
 *   climb    → va al pie de su rampa, espera y sube cuando toca (la Plataforma vale 10, o 20 con los 2
 *              robots, §4.4);
 *   idle     → espera en un lugar con sentido (listo para recibir lo del HP o al pie de la rampa), nunca
 *              da vueltas.
 *
 * Respeta lo que el árbitro cobra: no sube a la Plataforma ni toma la Crítica antes del endgame (§4.6),
 * en AUTO no cruza la línea central (§4.2), no sale de la cancha (§4.6), frena antes de tocar a un
 * rival (§4.5) y no recoge Muestras en las zonas del color contrario (§4.6). Un filtro final (`guard`)
 * descarta mandos que sacarían una esquina de la cancha o la meterían a la Plataforma antes de tiempo.
 *
 * Para no verse torpe: el giro usa una curva de frenado (no oscila), y vigilantes detectan "atorado"
 * (empuja sin avanzar) y "girando sin rumbo" (mucho giro sin desplazarse): el objetivo se descarta un
 * rato y el robot se zafa.
 */
import * as F from '../config/field';
import { armAngle, armTip, type ElevatorPos } from '../config/robot';
import type { Phase } from '../core/clock';
import { ALLIANCES, LEVELS, type Level } from '../core/types';
import type { Robot } from '../game/Robot';
import type { Pieces } from '../physics/Pieces';
import { allianceZones } from '../referee/Referee';

export interface BotOutput {
  forward: number;
  turn: number;
  intake: boolean;
  elevator: ElevatorPos;
  release: boolean;
  /** Toma la Muestra Crítica (solo en el ENDGAME, §4.6). */
  grabCritical?: boolean;
  /** Suelta la Muestra Crítica (en la Repisa). */
  releaseCritical?: boolean;
}

type Mode = 'collect' | 'score' | 'critical' | 'climb' | 'idle';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Margen alrededor de la Plataforma que la IA no pisa antes del endgame. */
const PLATFORM_CLEAR = 0.65;
/** Centro del robot a no menos de esto de los bordes (sus objetivos se recortan aquí). */
const EDGE_CLEAR = 0.55;
/** Velocidad media de traslado con la que estima cuánto tarda en llegar a un lugar (m/s). */
const TRAVEL_SPEED = 2.0;
/** Segundos que necesita en la rampa desde que está al pie hasta quedar arriba, más un margen. */
const CLIMB_SECONDS = 9;
/** Inicio del ENDGAME: últimos 30 s (§4.3.1). */
const ENDGAME_SECONDS = 30;

/** Pozos de las Cámaras de las dos alianzas: una Muestra ahí dentro ya está anotada. */
const WELLS = ALLIANCES.flatMap((a) => LEVELS.map((l) => ({ rect: F.rectFor(a, F.camaraWells()[l]), rim: F.camaraWells()[l].rim })));

/** Quién va por qué Muestra: robot → pieza (compartido entre los robots de una misma sesión). */
/** Las dos Cámaras (obstáculos dentro de la cancha). */
const CAMARAS = ALLIANCES.map((a) => F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH, x1: F.CAMARA_X_END_RED, z0: F.CAMARA_Z_RED[0], z1: F.CAMARA_Z_RED[1] }));

/** Barras laterales de las Campanas (§3.2.4): 1250 × 50.8 mm perpendiculares a la pared, 200 mm de alto. */
const BARRAS = ALLIANCES.map((a) => F.rectFor(a, { x0: F.CAMPANA_X_RED[0] - F.BARRIER_WIDTH, x1: F.CAMPANA_X_RED[0], z0: -F.HALF_W, z1: -F.HALF_W + F.BARRIER_LENGTH }));
/** Margen de la barra para el centro del robot (media diagonal del chasis). */
const BARRA_CLEAR = 0.5;

/** Distancia del punto a lo más cercano que estorba al girar: bordes de la cancha, Cámaras y barras. */
function clearance(x: number, z: number, platform = false): number {
  let c = Math.min(F.HALF_L - Math.abs(x), F.HALF_W - Math.abs(z));
  if (platform) c = Math.min(c, Math.hypot(Math.max(Math.abs(x) - F.PLATFORM_LENGTH / 2, 0), Math.max(Math.abs(z) - F.PLATFORM_WIDTH / 2, 0)));
  for (const r of [...CAMARAS, ...BARRAS]) c = Math.min(c, Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)));
  return c;
}

const claimBoards = new WeakMap<Robot[], Map<number, number>>();
/** Robots de una sesión que maneja la IA en TELEOP (para repartir roles entre aliados). */
const teamBots = new WeakMap<Robot[], Set<Robot>>();

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

interface Goal {
  x: number;
  z: number;
}

interface GoOpts {
  /** Va más despacio y frena al llegar. */
  precise?: boolean;
  /** Avanza de reversa (su salida de piezas está atrás). */
  reverse?: boolean;
  /** Puede pasar por la Plataforma (ENDGAME). */
  allowPlatform?: boolean;
  /** Radio al que se da por llegado. */
  tol?: number;
  /** Fracción de velocidad con la que sigue de largo al llegar (recoger sin frenar). */
  through?: number;
}

export class Bot {
  mode: Mode = 'collect';
  private phase: Phase = 'TELEOP';
  private timeLeft = Infinity;
  private targetPiece = -1;
  private finalPass = false;
  /** Muestras que dejó por imposibles (índice → segundos que faltan). */
  private ignore = new Map<number, number>();
  /** Nivel al que va a anotar ahora (cambia si otro robot ocupa ese lugar). */
  private scoreLevel: Level;
  private recover = { t: 0, forward: 0, turn: 0 };
  private recoverCount = 0;
  private stuckT = 0;
  private blockedT = 0;
  private hist: Array<[number, number, number]> = [];
  private histT = 0;
  private detourSide = new Map<number, number>();
  private detourT = 0;
  private spinCool = 0;
  private idleT = 0;
  private scoreT = 0;
  private critT = 0;
  private critDone = false;
  /** Ya tomó la Crítica (para saber que la soltó y terminó). */
  private carried = false;
  /** Sin intake un momento tras soltar (para no recoger lo que acaba de dejar). */
  private lockT = 0;
  private lastLevel: Level;
  readonly opts: BotOptions;

  constructor(
    readonly robot: Robot,
    private pieces: Pieces,
    private others: Robot[],
    opts: Partial<BotOptions> = {},
  ) {
    this.opts = { level: 3, batch: 3, scoreOnly: false, stayHome: false, ...opts };
    this.scoreLevel = this.opts.level;
    this.lastLevel = this.opts.level;
    if (!this.opts.stayHome) {
      let set = teamBots.get(others);
      if (!set) teamBots.set(others, (set = new Set()));
      set.add(robot);
    }
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
    this.phase = phase;
    this.timeLeft = timeLeft;
    const out = this.decide(dt);
    const pre = { forward: out.forward, turn: out.turn };
    this.guard(out, phase === 'ENDGAME');
    this.watch(dt, pre);
    this.publishClaim();
    return out;
  }

  // ------------------------------------------------------------------ decisión

  private decide(dt: number): BotOutput {
    const out: BotOutput = { forward: 0, turn: 0, intake: false, elevator: 0, release: false };
    const endgame = this.phase === 'ENDGAME';
    for (const [i, left] of this.ignore) if (left - dt <= 0) this.ignore.delete(i);
    else this.ignore.set(i, left - dt);

    // Zafarse de un atorón o de un giro sin rumbo: unos instantes de maniobra y se elige otra cosa
    if (this.recover.t > 0) {
      this.recover.t -= dt;
      out.forward = this.recover.forward;
      out.turn = this.recover.turn;
      out.intake = this.mode === 'collect';
      return out;
    }
    this.spinCool = Math.max(0, this.spinCool - dt);
    this.lockT = Math.max(0, this.lockT - dt);
    this.detourT -= dt;
    if (this.detourT <= 0 && this.detourSide.size) this.detourSide.clear();

    this.updateMode(dt, endgame);

    switch (this.mode) {
      case 'collect': {
        out.intake = true;
        const piece = this.pickSample();
        if (!piece) this.mode = 'idle';
        else this.goCollect(piece, out);
        if (this.mode === 'collect') break;
        // sin Muestras: cae en espera este mismo paso
        this.idle(out, dt);
        break;
      }
      case 'score':
        this.score(out, dt);
        break;
      case 'critical':
        this.critical(out, dt);
        break;
      case 'climb':
        this.climb(out, endgame);
        break;
      case 'idle':
        out.intake = !this.opts.scoreOnly;
        this.idle(out, dt);
        break;
    }
    if (this.mode !== 'collect') this.finalPass = false;
    if (this.lockT > 0) out.intake = false;
    return out;
  }

  /** ¿Es este robot el que toma la Crítica? Prefiere un mecanismo que no sea pivote y la Zona de Inicio junto a la Campana. */
  private isCarrier(): boolean {
    const r = this.robot;
    const rank = (o: Robot): number => (o.spec.mechanism === 'pivot' ? 10 : 0) + o.station;
    const team = teamBots.get(this.others);
    return this.others.every((o) => o === r || o.alliance !== r.alliance || (team && !team.has(o)) || rank(r) < rank(o) || (rank(r) === rank(o) && r.index < o.index));
  }

  private get hpStock(): number {
    return this.pieces.hpStock(this.robot.alliance).length;
  }

  /** Segundos que tarda en llegar a `g` más lo que sube a la rampa. */
  private travel(g: Goal): number {
    const p = this.robot.phys.position();
    return Math.hypot(g.x - p.x, g.z - p.z) / TRAVEL_SPEED;
  }

  private footPoint(): Goal {
    return { x: this.side * 2.75, z: this.lane() };
  }

  /** Carril de su Zona de Inicio sobre la Plataforma (caben 2 robots). */
  private lane(): number {
    return F.forAlliance(this.robot.alliance, { x: 0, z: this.robot.station === 0 ? -0.37 : 0.37 }).z;
  }

  private updateMode(dt: number, endgame: boolean): void {
    const m = this.robot.mech;
    const o = this.opts;
    this.idleT = this.mode === 'idle' ? this.idleT + dt : 0;
    if (o.stayHome) {
      // AUTO: recolecta en su mitad y anota; nunca sube ni toma la Crítica
      if (this.mode === 'collect' && (m.stored.length >= Math.min(o.batch, m.capacity) || (o.scoreOnly && m.stored.length > 0))) this.mode = 'score';
      if (this.mode === 'collect' && o.scoreOnly) this.mode = 'idle';
      if (this.mode === 'score' && m.stored.length === 0) this.mode = o.scoreOnly ? 'idle' : 'collect';
      if (this.mode === 'idle' && !o.scoreOnly && this.hasFree()) this.mode = 'collect';
      if ((this.mode as Mode) === 'critical' || (this.mode as Mode) === 'climb') this.mode = 'collect';
      return;
    }
    const carrier = this.isCarrier();
    const critActive = carrier && !this.critDone;
    const foot = this.footPoint();
    const climbBy = CLIMB_SECONDS + this.travel(foot);
    const stored = m.stored.length;
    const pivot = this.robot.spec.mechanism === 'pivot';
    const scoreTrip = 4 + this.travel(this.scoringPose(this.opts.level));
    const enough = stored >= Math.min(o.batch, m.capacity);
    const cur = this.mode;
    let next: Mode;
    if (cur === 'critical' && !this.critDone && this.timeLeft > 1.5) next = 'critical';
    else if (critActive && endgame && this.timeLeft > 7 && pivot && stored > 0 && this.timeLeft > 24) next = 'score'; // la garra lleva una sola pieza
    else if (critActive && endgame && this.timeLeft > 7) next = 'critical'; // la Crítica vale 15 y 1 RP (§4.4)
    else if (this.carried && this.critDone) next = 'climb'; // la Crítica ya está en la Repisa: se queda en la Plataforma
    else if (this.timeLeft < climbBy) next = 'climb';
    else if (cur === 'score' && stored > 0) next = 'score';
    else if (stored > 0 && (enough || this.timeLeft < climbBy + scoreTrip + 6 || (!this.hasFree() && !(carrier && this.hpStock > 0 && this.idleT < 6 && this.timeLeft > climbBy + scoreTrip + 12))))
      next = this.timeLeft > climbBy + scoreTrip ? 'score' : 'climb';
    else if (critActive && !endgame && this.timeLeft < ENDGAME_SECONDS + 3 && stored === 0) next = 'idle'; // listo para la Crítica
    else if (this.timeLeft > climbBy + 2 && this.hasFree()) next = 'collect';
    else next = 'idle';
    if (next !== cur) {
      if (next === 'critical') this.critT = 0;
      if (next === 'score') this.scoreT = 0;
      if (next !== 'collect') this.finalPass = false;
    }
    this.mode = next;
  }

  /** ¿Hay una Muestra que valga la pena ir por ella? */
  private hasFree(): boolean {
    return this.bestSample() !== null;
  }

  // ------------------------------------------------------------------ Muestras

  /** ¿Se puede ir por esta Muestra? (libre, no anotada, fuera de zonas rivales y de la Plataforma) */
  private pickable(p: { index: number; kind: string; state: { at: string }; body: { translation(): { x: number; y: number; z: number } } }): boolean {
    if (p.kind !== 'sample' || p.state.at !== 'field' || this.ignore.has(p.index)) return false;
    const t = p.body.translation();
    if (t.y > 0.2) return false; // en el aire o dentro de una Cámara
    // Ya anotada: dentro de un pozo de una Cámara
    if (WELLS.some((w) => t.y < w.rim && F.inRect(w.rect, t.x, t.z))) return false;
    // Pegadas a la pared corta, donde la intake no llega sin sacar una esquina
    if (Math.abs(t.x) > F.HALF_L - 0.45 || Math.abs(t.z) > F.HALF_W - 0.2) return false;
    if (Math.abs(t.x) < F.PLATFORM_LENGTH / 2 + 0.1 && Math.abs(t.z) < F.PLATFORM_WIDTH / 2 + 0.1) return false;
    if (this.opts.stayHome && this.side * t.x < 0.5) return false;
    // §4.6: no se mete a las zonas del color contrario
    const opp = this.robot.alliance === 'red' ? 'blue' : 'red';
    if (allianceZones(opp).some((z) => F.inRect(z, t.x, t.z))) return false;
    return true;
  }

  /** La mejor Muestra ahora (menor costo), o null. No cambia el objetivo actual. */
  private bestSample(): { index: number; cost: number } | null {
    const r = this.robot;
    const pos = r.phys.position();
    const h = r.phys.heading();
    const board = this.board();
    let best: { index: number; cost: number } | null = null;
    for (const p of this.pieces.list) {
      if (!this.pickable(p)) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - pos.x, t.z - pos.z);
      const turn = Math.abs(wrap(Math.atan2(-(t.z - pos.z), t.x - pos.x) - h));
      let cost = d + 0.3 * turn;
      if (this.wallNormal(t)) cost += 0.5; // hay que alinearse a la pared
      if (p.index === this.targetPiece) cost *= 0.7; // no cambia de opinión a cada rato
      // Si un compañero ya va por ella (y está más cerca), se la deja
      for (const o of this.others) {
        if (o === r) continue;
        const od = Math.hypot(t.x - o.phys.position().x, t.z - o.phys.position().z);
        if (o.alliance === r.alliance) {
          if (board.get(o.index) === p.index && od < d * 1.2) cost += 50;
        } else if (od < d && od < 1.4) cost += 50; // el rival llega primero: evita el contacto (§4.5)
      }
      if (cost < 40 && (!best || cost < best.cost)) best = { index: p.index, cost };
    }
    return best;
  }

  private board(): Map<number, number> {
    let b = claimBoards.get(this.others);
    if (!b) claimBoards.set(this.others, (b = new Map()));
    return b;
  }

  private publishClaim(): void {
    const b = this.board();
    if (this.mode === 'collect' && this.targetPiece >= 0) b.set(this.robot.index, this.targetPiece);
    else b.delete(this.robot.index);
  }

  private pickSample(): Goal | null {
    const best = this.bestSample();
    const idx = best ? best.index : -1;
    if (idx !== this.targetPiece) this.finalPass = false;
    this.targetPiece = idx;
    if (idx < 0) return null;
    const t = this.pieces.list[idx].body.translation();
    return { x: t.x, z: t.z };
  }

  /** Normal hacia la cancha de la pared a menos de 0.9 m de `t` (o null si no hay pared cerca). */
  private wallNormal(t: { x: number; z: number }): Goal | null {
    const dz = F.HALF_W - Math.abs(t.z);
    const dx = F.HALF_L - Math.abs(t.x);
    if (dz > 0.9 && dx > 0.9) return null;
    if (dz <= dx) return { x: 0, z: -Math.sign(t.z) };
    return { x: -Math.sign(t.x), z: 0 };
  }

  /** Va por una Muestra: libre, o de una pared alineándose primero perpendicular a ella. */
  private goCollect(piece: Goal, out: BotOutput): void {
    const pos = this.robot.phys.position();
    const n = this.wallNormal(piece);
    let goal = piece;
    if (n) {
      const rx = pos.x - piece.x;
      const rz = pos.z - piece.z;
      const along = rx * n.x + rz * n.z;
      const lateral = Math.abs(rx * n.z - rz * n.x);
      if (this.finalPass ? lateral > 0.4 || along < 0.2 : along > 0.6 && lateral < 0.2) this.finalPass = along > 0.2 && lateral < (this.finalPass ? 0.4 : 0.2);
      else if (!this.finalPass) this.finalPass = false;
      if (!this.finalPass) goal = { x: piece.x + n.x * 1.1, z: piece.z + n.z * 1.1 };
    }
    this.go(goal, out, { through: 0.45, tol: this.finalPass || !n ? 0.05 : 0.12 });
  }

  // ------------------------------------------------------------------ anotar

  private score(out: BotOutput, dt: number): void {
    const r = this.robot;
    const m = r.mech;
    this.scoreT += dt;
    // Se coloca antes de la pared, se alinea (de frente, o de espaldas si su mecanismo saca las
    // piezas por atrás), se arrima a la pared y suelta
    const level = this.freeLevel();
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.scoreT = 0;
    }
    const pose = this.scoringPose(level);
    const dir = m.side; // +1 avanza hacia la pared, −1 retrocede hacia ella
    const want = dir > 0 ? pose.heading : wrap(pose.heading + Math.PI);
    const pos = r.phys.position();
    const away = r.alliance === 'red' ? -1 : 1; // hacia la cancha (lejos de la Cámara)
    const lateral = Math.abs(pos.x - pose.x);
    const depth = (pos.z - pose.z) * away; // > 0: todavía lejos de la pared
    out.elevator = depth < 1.2 && lateral < 0.5 ? level : 0;
    // Los lugares de anotación contiguos están a ~0.7 m: el del Nivel 2 espera más atrás para poder girar sin chocar con el del 3
    const st = this.dock({ x: pose.x, z: pose.z, heading: want }, dir, out, level === 2 ? 1.4 : 0.7, false);
    if (st.rem < 0.04 && Math.abs(st.err) < 0.15) {
      out.forward = 0;
      out.turn = 0;
      out.release = m.atTarget;
      if (out.release) this.lockT = 1.2;
    }
    // No se cuelga intentando: tras 16 s sin soltar, reinicia la maniobra desde el punto de espera
    if (this.scoreT > 16) {
      this.scoreT = 0;
      this.startRecovery(-0.5, 0.7, 'scoreT');
    }
  }

  /** ¿El pozo del nivel ya está lleno hasta la apertura? (las Muestras se apilan y la siguiente no cabe) */
  private levelFull(l: Level): boolean {
    const w = F.rectFor(this.robot.alliance, F.camaraWells()[l]);
    const rim = F.camaraWells()[l].rim;
    const cap = Math.floor(rim / F.SAMPLE_SIZE) * Math.floor((w.x1 - w.x0) / F.SAMPLE_SIZE) * Math.floor((w.z1 - w.z0) / F.SAMPLE_SIZE);
    let n = 0;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field') continue;
      const t = p.body.translation();
      if (F.inRect(w, t.x, t.z) && t.y < rim + 0.2) n++;
    }
    return n >= cap - 2;
  }

  /** El nivel preferido, o el siguiente que valga más si otro robot está en su lugar de anotación o el pozo está lleno. */
  private freeLevel(): Level {
    const order: Level[] = [this.opts.level, ...([3, 2, 1] as Level[]).filter((l) => l !== this.opts.level)];
    const busy = (l: Level): boolean => {
      const p = this.scoringPose(l);
      return this.others.some((o) => o !== this.robot && Math.hypot(o.phys.position().x - p.x, o.phys.position().z - p.z) < 0.6);
    };
    const ok = (l: Level): boolean => !busy(l) && !this.levelFull(l);
    if (ok(this.scoreLevel) && (this.scoreLevel === order[0] || !ok(order[0]))) return this.scoreLevel;
    this.scoreLevel = order.find(ok) ?? order.find((l) => !this.levelFull(l)) ?? this.scoreLevel;
    return this.scoreLevel;
  }

  // ------------------------------------------------------------------ Crítica y Plataforma

  /** Pose de agarre de la Crítica en la rendija de su Campana (§3.2.4). */
  private grabPose(): { x: number; z: number; heading: number; lx: number } {
    const r = this.robot;
    const s = r.spec;
    const c = F.forAlliance(r.alliance, { x: F.CRITICAL_HOLDER_RED.x, z: F.CRITICAL_HOLDER_RED.z });
    const lx = s.mechanism === 'pivot' && s.arm ? armTip(s.arm, armAngle(s.arm, s.elevatorHeights[4])).x : r.mech.side * (s.length / 2 - 0.02);
    const inward = r.alliance === 'red' ? 1 : -1; // de la Campana hacia la cancha
    const toWall = r.alliance === 'red' ? Math.PI / 2 : -Math.PI / 2;
    return { x: c.x, z: c.z + inward * Math.abs(lx), heading: r.mech.side > 0 ? toWall : wrap(toWall + Math.PI), lx };
  }

  /** Pose frente a la Repisa para soltar la Crítica: su punta queda sobre el centro de la Repisa. */
  private releasePose(): { x: number; z: number; heading: number } {
    const r = this.robot;
    const s = r.spec;
    const tip = s.mechanism === 'pivot' && s.arm ? armTip(s.arm, armAngle(s.arm, s.elevatorHeights[4])).x : s.length / 2 + s.reach - F.CRITICAL_SIZE / 2;
    const toRepisa = r.alliance === 'red' ? Math.PI : 0;
    return { x: this.side * (Math.abs(tip) + 0.1), z: this.lane(), heading: r.mech.side > 0 ? toRepisa : wrap(toRepisa + Math.PI) };
  }

  /**
   * Acoplarse a una pose avanzando (o de reversa) en línea recta: va a un punto de espera en línea con
   * la pose, se alinea y entra siguiendo la línea. Devuelve cuánto le falta y el error de rumbo.
   */
  private dock(pose: { x: number; z: number; heading: number }, travel: 1 | -1, out: BotOutput, stageDist: number, allowPlatform: boolean): { rem: number; err: number } {
    const r = this.robot;
    const pos = r.phys.position();
    const fx = Math.cos(pose.heading) * travel;
    const fz = -Math.sin(pose.heading) * travel;
    const rx = pos.x - pose.x;
    const rz = pos.z - pose.z;
    const along = rx * fx + rz * fz; // < 0: todavía no llega
    const lateral = Math.abs(rx * fz - rz * fx);
    const err = wrap(pose.heading - r.phys.heading());
    const stage = { x: pose.x - fx * stageDist, z: pose.z - fz * stageDist };
    const rem = -along;
    if (lateral > 0.16 || rem > stageDist + 0.45 || along > 0.12) {
      this.go(stage, out, { precise: true, allowPlatform, tol: 0.12 });
      if (Math.hypot(stage.x - pos.x, stage.z - pos.z) <= 0.12) out.turn = this.turnFor(err);
      return { rem, err };
    }
    // En la línea: mira un punto sobre ella un poco más adelante y entra
    const look = Math.min(0.6, Math.max(0.2, rem));
    const lx = pose.x + fx * (along + look);
    const lz = pose.z + fz * (along + look);
    const want = Math.atan2(-(lz - pos.z), lx - pos.x) + (travel < 0 ? Math.PI : 0);
    const e2 = wrap(want - r.phys.heading());
    out.turn = this.turnFor(e2);
    out.forward = Math.abs(e2) > 0.3 || rem < 0.03 ? 0 : travel * clamp(0.08 + rem * 1.2, 0.4);
    return { rem, err };
  }

  private critical(out: BotOutput, dt: number): void {
    const r = this.robot;
    const m = r.mech;
    const pos = r.phys.position();
    this.critT += dt;
    out.elevator = 4;
    if (!m.critical) {
      if (this.carried) {
        this.critDone = true; // ya la soltó en la Repisa: se queda quieta ahí
        return;
      }
      // Tomarla: se arrima de frente a la rendija con el elevador a su altura
      const g = this.grabPose();
      if (this.critT > 14) {
        this.critDone = true; // no se pudo: mejor sube a la Plataforma
        return;
      }
      const st = this.dock(g, m.side, out, 0.6, false);
      const v = r.phys.body.linvel();
      if (st.rem < 0.4 && Math.abs(st.err) < 0.22 && m.atTarget && Math.hypot(v.x, v.z) < 0.6 && this.phase === 'ENDGAME') out.grabCritical = true;
      return;
    }
    // Llevarla a la Repisa y soltarla
    this.carried = true;
    const rel = this.releasePose();
    const foot = this.footPoint();
    const onRamp = Math.abs(pos.z - rel.z) < 0.35 && this.side * pos.x < 3.0 && this.side * pos.x > 0.4;
    if (!onRamp) {
      this.go(foot, out, { precise: true });
      return;
    }
    const st = this.dock(rel, m.side, out, 0.7, true);
    const v = r.phys.body.linvel();
    if (st.rem < 0.06 && Math.abs(st.err) < 0.2 && Math.hypot(v.x, v.z) < 0.06 && m.atTarget) out.releaseCritical = true;
    if (this.critT > 40) this.critDone = true;
  }

  /** Su rampa: pie en |x| = 2.75; espera ahí y sube a su carril cuando toca (ENDGAME, §4.6). */
  private climb(out: BotOutput, endgame: boolean): void {
    const r = this.robot;
    const pos = r.phys.position();
    const lane = this.lane();
    const onTop = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0 && this.side * pos.x < 0.75;
    if (onTop && endgame) return;
    const foot = this.footPoint();
    const atFoot = Math.abs(pos.z - lane) < 0.25 && this.side * pos.x < 2.95 && this.side * pos.x > 0.4;
    // Sube cuando queda justo el tiempo para llegar arriba (así hasta el final suma Muestras)
    const goUp = endgame && (this.timeLeft < CLIMB_SECONDS + 3 || !this.hasFree());
    if (!atFoot) {
      this.go(foot, out, { precise: true, allowPlatform: endgame && pos.x * this.side < 2.9 });
    } else if (goUp) {
      this.go({ x: this.side * 0.6, z: lane }, out, { precise: true, allowPlatform: true });
    } else {
      // Esperando: de frente a la rampa, quieto
      out.turn = this.turnFor(wrap((this.side > 0 ? Math.PI : 0) - r.phys.heading()));
    }
  }

  /** Espera con sentido: listo para lo que viene, sin dar vueltas. */
  private idle(out: BotOutput, dt: number): void {
    if (this.opts.stayHome) return;
    const r = this.robot;
    const carrier = this.isCarrier();
    const pos = r.phys.position();
    if (carrier && !this.critDone) {
      // Frente a su Campana: recibe las Muestras del HP y está lista para la Crítica
      const c = F.forAlliance(r.alliance, { x: (F.CAMPANA_X_RED[0] + F.CAMPANA_X_RED[1]) / 2 + 0.4, z: -F.HALF_W + 1.05 });
      this.hold(c, r.alliance === 'red' ? Math.PI / 2 : -Math.PI / 2, out);
      out.elevator = this.phase === 'ENDGAME' || this.timeLeft < ENDGAME_SECONDS + 4 ? 4 : 0;
      out.intake = this.phase !== 'ENDGAME';
      return;
    }
    // Sin nada que hacer: al pie de su rampa (de ahí sube en el ENDGAME)
    const foot = this.footPoint();
    this.hold(foot, this.side > 0 ? Math.PI : 0, out);
    void dt;
    void pos;
  }

  /** Va a un lugar y se queda quieto mirando hacia `heading`. */
  private hold(g: Goal, heading: number, out: BotOutput): void {
    const pos = this.robot.phys.position();
    if (Math.hypot(g.x - pos.x, g.z - pos.z) > 0.25) this.go(g, out, { precise: true });
    else out.turn = this.turnFor(wrap(heading - this.robot.phys.heading()));
  }

  // ------------------------------------------------------------------ conducción

  /** Giro (−1…1) con curva de frenado: llega al rumbo sin oscilar. */
  private turnFor(err: number): number {
    const s = this.robot.spec;
    const e = Math.abs(err);
    if (e < 0.02) return 0;
    const wmax = s.maxOmega * 0.8;
    const aMax = Math.min(s.maxAccel, s.traction * 9.81);
    const alpha = (aMax / Math.hypot(this.robot.phys.halfL, this.robot.phys.halfW)) * 1.2;
    const w = Math.min(wmax, Math.sqrt(2 * alpha * 0.45 * e));
    return Math.sign(err) * Math.max(0.06, w / wmax);
  }

  /**
   * Persecución para tanque: gira hacia el punto (sin avanzar hasta alinearse) y avanza con perfil de
   * frenado. Rodea la Plataforma si el camino la cruza y frena si hay otro robot enfrente.
   */
  private go(goal: Goal, out: BotOutput, o: GoOpts = {}): void {
    const r = this.robot;
    const pos = r.phys.position();
    let g = goal;
    let via = false;
    if (!o.allowPlatform) {
      g = this.avoidPlatform(pos, goal);
      via = g !== goal;
    }
    {
      const g2 = this.avoidBarras(pos, g);
      via = via || g2 !== g;
      g = g2;
    }
    if (this.opts.stayHome || this.phase === 'AUTO') g = { x: this.side > 0 ? Math.max(0.5, g.x) : Math.min(-0.5, g.x), z: g.z };
    g = { x: clamp(g.x, F.HALF_L - EDGE_CLEAR), z: clamp(g.z, F.HALF_W - EDGE_CLEAR) };
    const g1 = this.detour(pos, g);
    via = via || g1 !== g;
    g = g1;
    const dx = g.x - pos.x;
    const dz = g.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const flip = o.reverse ? Math.PI : 0;
    const err = wrap(Math.atan2(-dz, dx) + flip - r.phys.heading());
    // Un punto de paso solo hay que rozarlo
    const tol = via ? 0.1 : o.tol ?? 0.06;
    if (dist < tol && !via) return;
    // Pegado a una pared (p. ej. recién anotó) y debe voltear: primero se separa, porque girando se atora
    const spin = Math.hypot(r.phys.halfL, r.phys.halfW) + 0.04;
    if (Math.abs(err) > 0.6 && clearance(pos.x, pos.z) < spin) {
      const h = r.phys.heading();
      const at = (k: number): number => clearance(pos.x + Math.cos(h) * k, pos.z - Math.sin(h) * k);
      const dir = at(-0.3) > at(0.3) ? -1 : 1;
      out.forward = dir * 0.4;
      out.turn = 0;
      return;
    }
    out.turn = this.turnFor(err);
    const s = r.spec;
    const vMax = (o.precise ? 0.7 : 0.95) * s.maxSpeed;
    const decel = Math.min(s.maxAccel, s.traction * 9.81) * 0.55;
    const through = (via ? Math.max(o.through ?? 0, 0.5) : o.through ?? 0) * s.maxSpeed;
    const v = Math.min(vMax, Math.sqrt(through * through + 2 * decel * Math.max(0, dist - tol)));
    // Alineado: avanza; muy desalineado: gira en su lugar
    const c = Math.cos(err);
    const align = c > 0 ? (Math.abs(err) < 0.35 ? 1 : c * c * c) : 0;
    out.forward = (o.reverse ? -1 : 1) * (v / s.maxSpeed) * align;
    // Un tanque no debe quedarse "cabeceando": si ya casi llegó y está de lado, solo gira
    if (dist < 0.3 && Math.abs(err) > 0.9) out.forward = 0;
    this.avoidRobots(out);
  }

  /** Rodea a otro robot que está en la recta al objetivo: va primero a un punto al lado de él. */
  private detour(pos: Goal, goal: Goal): Goal {
    const r = this.robot;
    const gx = goal.x - pos.x;
    const gz = goal.z - pos.z;
    const gl = Math.hypot(gx, gz);
    if (gl < 0.3) return goal;
    let best: { o: Robot; t: number } | null = null;
    for (const o of this.others) {
      if (o === r) continue;
      const op = o.phys.position();
      const t = ((op.x - pos.x) * gx + (op.z - pos.z) * gz) / (gl * gl);
      if (t <= 0 || t >= 1) continue;
      const off = ((op.x - pos.x) * gz - (op.z - pos.z) * gx) / gl; // + si queda a la derecha del recorrido
      const rad = o.alliance !== r.alliance ? 1.15 : 0.95;
      if (Math.abs(off) >= rad) continue;
      // Si el objetivo mismo está pegado a ese robot, no hay rodeo que valga
      if (Math.hypot(goal.x - op.x, goal.z - op.z) < rad * 0.8) continue;
      if (!best || t < best.t) best = { o, t };
    }
    if (!best) return goal;
    const op = best.o.phys.position();
    const rad = (best.o.alliance !== r.alliance ? 1.15 : 0.95) + 0.2;
    const off = ((op.x - pos.x) * gz - (op.z - pos.z) * gx) / gl;
    let side = this.detourSide.get(best.o.index) ?? (Math.abs(off) > 0.05 ? -Math.sign(off) : Math.sign(pos.x * gz - pos.z * gx) || 1);
    // Rodea por el lado que no manda a la pared
    const nx = gz / gl;
    const nz = -gx / gl;
    const wx = op.x + side * nx * rad;
    const wz = op.z + side * nz * rad;
    if (Math.abs(wx) > F.HALF_L - EDGE_CLEAR || Math.abs(wz) > F.HALF_W - EDGE_CLEAR) side = -side;
    this.detourSide.set(best.o.index, side);
    this.detourT = 1.5;
    return { x: clamp(op.x + side * nx * rad, F.HALF_L - EDGE_CLEAR), z: clamp(op.z + side * nz * rad, F.HALF_W - EDGE_CLEAR) };
  }

  /** Frena si va a tocar a otro robot (a los rivales no se les toca, §4.5); el rodeo lo resuelve `detour`. */
  private avoidRobots(out: BotOutput): void {
    if (Math.abs(out.forward) < 0.02) {
      this.blockedT = Math.max(0, this.blockedT - 0.01);
      return;
    }
    const r = this.robot;
    const pos = r.phys.position();
    const h = r.phys.heading();
    const dirSign = out.forward > 0 ? 1 : -1;
    let blocked = false;
    for (const o of this.others) {
      if (o === r) continue;
      const op = o.phys.position();
      const od = Math.hypot(op.x - pos.x, op.z - pos.z);
      const oa = wrap(Math.atan2(-(op.z - pos.z), op.x - pos.x) - (dirSign > 0 ? h : h + Math.PI));
      const rival = o.alliance !== r.alliance;
      const stopAt = rival ? 0.95 : 0.72;
      if (od < stopAt + 0.5 && Math.abs(oa) < (rival ? 0.7 : 0.45)) {
        const k = clamp01((od - stopAt) / 0.5);
        // A un aliado se le rebasa despacio (tocarlo no es falta); a un rival se le frena por completo
        out.forward *= rival ? k : Math.max(0.35, k);
        if (rival && k < 0.15) blocked = true;
      }
    }
    this.blockedT = blocked ? this.blockedT + 1 / 120 : Math.max(0, this.blockedT - 0.01);
  }

  // ------------------------------------------------------------------ vigilantes

  /** Mando de escape: el que deja las 4 esquinas del chasis más lejos de paredes, Cámaras y barras. */
  private escapeCmd(forward: number): { forward: number; turn: number } {
    const p = this.robot.phys;
    const pos = p.position();
    const h0 = p.heading();
    const hl = p.halfL;
    const hw = p.halfW;
    let best = { forward: Math.sign(forward) * 0.4 || 0.4, turn: 0 };
    let bestV = -Infinity;
    for (const f of [-0.5, 0.5, 0]) {
      for (const t of [-0.7, 0, 0.7]) {
        if (f === 0 && t === 0) continue;
        const h = h0 + t * this.robot.spec.maxOmega * 0.8 * 0.3;
        const d = f * this.robot.spec.maxSpeed * 0.3;
        const cx = pos.x + Math.cos(h0) * d;
        const cz = pos.z - Math.sin(h0) * d;
        let worst = Infinity;
        for (const [lx, lz] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
          worst = Math.min(worst, clearance(cx + lx * Math.cos(h) + lz * Math.sin(h), cz - lx * Math.sin(h) + lz * Math.cos(h), this.phase !== 'ENDGAME'));
        }
        // Separarse también de otros robots (un aliado trabado es el caso típico)
        for (const o of this.others) {
          if (o === this.robot) continue;
          const op = o.phys.position();
          worst = Math.min(worst, Math.hypot(op.x - cx, op.z - cz) - 0.75);
        }
        // Prefiere avanzar/retroceder en línea recta si empata
        const v = worst - (t !== 0 ? 0.01 : 0);
        if (v > bestV) {
          bestV = v;
          best = { forward: f, turn: t };
        }
      }
    }
    return best;
  }

  private startRecovery(forward: number, turn: number, _why = ''): void {
    this.recoverCount++;
    const e = this.escapeCmd(forward);
    this.recover = { t: 0.5 + Math.min(0.4, this.recoverCount * 0.04), forward: e.forward, turn: e.turn || turn * (this.recoverCount % 2 ? 1 : -1) };
    this.stuckT = 0;
    this.blockedT = 0;
    this.hist.length = 0;
    this.finalPass = false;
    if (this.mode === 'collect' && this.targetPiece >= 0) this.ignore.set(this.targetPiece, 10 + Math.min(20, this.recoverCount * 3));
    this.targetPiece = -1;
  }

  /** Atorado (manda avanzar y no se mueve) o girando sin rumbo (mucho giro y casi nada de traslado). */
  private watch(dt: number, out: { forward: number; turn: number }): void {
    const r = this.robot;
    if (this.recover.t > 0) return;
    const v = r.phys.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    const w = Math.abs(r.phys.body.angvel().y);
    const pushing = (Math.abs(out.forward) > 0.25 || Math.abs(out.turn) > 0.1) && speed < 0.12 && w < 0.12;
    this.stuckT = pushing ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
    const wasForward = out.forward >= 0;
    if (this.stuckT > 1.6) {
      this.startRecovery(wasForward ? -0.5 : 0.5, 0.7, 'stuck');
      return;
    }
    // Esperando a que se libere el paso (un robot enfrente) más de 3 s: busca otra cosa
    if (this.blockedT > 3) {
      this.startRecovery(-0.3, 0.8, 'blocked');
      return;
    }
    this.histT += dt;
    if (this.histT >= 0.1) {
      this.histT = 0;
      const p = r.phys.position();
      this.hist.push([p.x, p.z, r.phys.heading()]);
      if (this.hist.length > 31) this.hist.shift();
      if (this.hist.length === 31 && this.spinCool <= 0) {
        let spin = 0;
        for (let i = 1; i < this.hist.length; i++) spin += Math.abs(wrap(this.hist[i][2] - this.hist[i - 1][2]));
        const a = this.hist[0];
        const b = this.hist[30];
        if (spin > 8 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.8) {
          this.spinCool = 4;
          this.startRecovery(0.6, 0, 'spin');
        }
      }
    }
  }

  // ------------------------------------------------------------------ geometría

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

  /** Si la recta cruza la zona de una barra de Campana, pasa primero por su extremo abierto. */
  private avoidBarras(pos: Goal, goal: Goal): Goal {
    for (const b of BARRAS) {
      const x0 = b.x0 - BARRA_CLEAR;
      const x1 = b.x1 + BARRA_CLEAR;
      // La barra sale de la pared (|z| = 3.5) hacia la cancha: su extremo libre está en el lado que mira al centro
      const wallZ = Math.sign(b.z0 + b.z1);
      const tipZ = wallZ * (F.HALF_W - F.BARRIER_LENGTH - BARRA_CLEAR);
      const zLo = Math.min(wallZ * F.HALF_W, tipZ);
      const zHi = Math.max(wallZ * F.HALF_W, tipZ);
      const inside = (p: Goal): boolean => p.x > x0 && p.x < x1 && p.z > zLo && p.z < zHi;
      if (inside(goal) || inside(pos)) continue;
      if (segmentHitsAabb(pos.x, pos.z, goal.x, goal.z, x0, x1, zLo, zHi)) return { x: (b.x0 + b.x1) / 2, z: tipZ - wallZ * 0.25 };
    }
    return goal;
  }

  /** Si la recta al objetivo cruza la Plataforma (con margen), va primero a la esquina más cómoda. */
  private avoidPlatform(pos: Goal, goal: Goal): Goal {
    const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    // Un objetivo dentro del margen (p. ej. el pie de su rampa) se alcanza en línea recta
    if (Math.abs(goal.x) < hx && Math.abs(goal.z) < hz) return goal;
    const crosses = segmentHitsRect(pos.x, pos.z, goal.x, goal.z, hx, hz);
    if (!crosses) return goal;
    const cx = hx + 0.1;
    const cz = hz + 0.1;
    const sz = Math.sign(pos.z) || 1;
    // Dentro del margen y al lado de la Plataforma: sale primero por el lado largo más cercano
    if (Math.abs(pos.z) < hz && Math.abs(pos.x) < F.PLATFORM_LENGTH / 2 + 0.2 && Math.abs(pos.z) > 0.1) return { x: pos.x, z: sz * cz };
    // En un extremo (frente a una rampa): primero a la esquina de ese extremo, del lado del objetivo
    if (Math.abs(pos.z) < hz) {
      const sx = Math.sign(pos.x) || this.side;
      // Primero sale en línea recta del extremo (así no roza la rampa al girar), luego a la esquina
      if (Math.abs(pos.x) < cx - 0.15) return { x: sx * cx, z: pos.z };
      return { x: sx * cx, z: (Math.sign(goal.z) || sz) * cz };
    }
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

/** ¿El segmento toca el rectángulo [x0,x1]×[z0,z1]? */
function segmentHitsAabb(ax: number, az: number, bx: number, bz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  return segmentHitsRect(ax - cx, az - cz, bx - cx, bz - cz, (x1 - x0) / 2, (z1 - z0) / 2);
}

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
