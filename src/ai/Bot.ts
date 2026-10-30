/**
 * IA de un robot (los que no maneja el jugador, y las rutinas de AUTO "Anotar precarga" y "Anotar y
 * recolectar"). Juega para ganar con lo que da su mecanismo:
 *   recolectar → anotar en el Nivel 3 → (ENDGAME) Muestra Crítica a la Repisa o subir a la Plataforma.
 * - Ciclos: escoge la Muestra que menos tiempo le cuesta (contando el regreso a su Cámara), junta
 *   varias si las tiene cerca y va a anotar cuando llena o cuando la siguiente ya no conviene.
 * - Se coordina con su compañero de IA (`Team`): no van por la misma Muestra, uno atiende al Human
 *   Player, uno lleva la Crítica y se turnan el Nivel 3.
 * - Calcula su tiempo: en AUTO anota antes de que acabe (vale más, §4.4); en el TELEOP deja lo justo
 *   para subir a la Plataforma o llevar la Crítica (§4.3.1).
 * - Evita faltas (§4.5, §4.6): rodea a los rivales y no se les acerca de frente, no pisa la
 *   Plataforma ni toma la Crítica antes del ENDGAME, no se queda frente a la Cámara rival y en AUTO no
 *   cruza la línea central (§4.2). Las Muestras del Human Player rival (zona de su color, D8) solo las
 *   roba el nivel Experto, cuando ningún rival las cuida (D38).
 *   Un filtro final (`guard`) descarta mandos que sacarían una esquina de la cancha.
 * - No defiende (§6.1 "no hay defensa"); el papel 'block' solo existe para medir cuánto cuesta.
 * La dificultad (`ai/difficulty.ts`) cambia velocidad, nivel, Crítica, coordinación y márgenes.
 */
import * as F from '../config/field';
import { GAME } from '../config/game';
import { posDir, posTip, type ElevatorPos } from '../config/robot';
import type { Phase } from '../core/clock';
import { opponent, type Alliance, type Level } from '../core/types';
import { cubePose } from '../game/Mechanisms';
import { obstructZones } from '../referee/Referee';
import type { Robot } from '../game/Robot';
import type { Pieces } from '../physics/Pieces';
import { clawDir } from '../physics/RobotPhysics';
import { AI_PROFILES, type AiLevel, type AiProfile } from './difficulty';
import type { PlanDirective, PlanDriver } from './plan';
import { Team } from './Team';

export interface BotOutput {
  forward: number;
  turn: number;
  intake: boolean;
  elevator: ElevatorPos;
  release: boolean;
  /** Toma la Muestra Crítica (solo la pide en el ENDGAME, §4.6). */
  grabCritical?: boolean;
  releaseCritical?: boolean;
}

type Mode = 'collect' | 'hp' | 'score' | 'climb' | 'critical' | 'block' | 'idle';

/** De dónde junta Muestras: cualquiera, solo el Laboratorio, o solo las que mete su Human Player. */
export type SampleSource = 'any' | 'lab' | 'hp';
/**
 * Papel del robot en el TELEOP:
 * - score: junta y anota.
 * - park: no anota; cruza la línea, espera junto a su rampa y sube a la Plataforma (estrategia).
 * - block: se estaciona frente al Nivel 3 de la Cámara rival. OJO: §6.1 dice "no hay defensa" y
 *   §4.6 cobra Tech Foul por obstruir las zonas del contrario; existe para medir cuánto cuesta.
 */
export type BotRole = 'score' | 'park' | 'block';
/** Qué hace en el ENDGAME (§4.3.1): subir a la Plataforma, además llevar la Muestra Crítica a la Repisa, o seguir anotando. */
export type EndgamePlan = 'platform' | 'critical' | 'none';
/** Qué hace en AUTO: nada (corre la rutina de pasos fijos), solo anotar la precarga, o anotar y recolectar. */
export type AutoPlan = 'none' | 'preload' | 'collect';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
/** Margen alrededor de la Plataforma que la IA no pisa antes del endgame. */
const PLATFORM_CLEAR = 0.65;
/** Centro del robot a no menos de esto de los bordes (sus objetivos se recortan aquí). */
const EDGE_CLEAR = 0.55;
/** Distancia (m, al centro) a la que empieza a alejarse de la orilla al manejar: media diagonal + algo. */
const WALL_CLEAR = 0.6;
/** Pasos de física por segundo (para contar intentos). */
const HZ = 120;
/** Segundos para subir la rampa desde su pie y quedar sobre la Plataforma (medido). */
const CLIMB_TIME = 2.2;

export interface BotOptions {
  /** Nivel al que anota (por defecto el de la dificultad: N3, el que más vale). */
  level?: Level;
  /** Cuántas Muestras junta antes de ir a anotar (por defecto el de la dificultad). */
  batch?: number;
  /** AUTO: solo anota lo que trae ('preload') o también recolecta de su mitad ('collect', §4.2). */
  auto: AutoPlan;
  /** La IA lo maneja en el TELEOP (si no, solo corre en AUTO: es el robot del jugador). */
  teleop: boolean;
  /** De dónde junta; si no se da, lo reparte su `Team`. */
  source?: SampleSource;
  role: BotRole;
  /** ENDGAME; si no se da, su `Team` decide quién lleva la Crítica y los demás suben. */
  endgame?: EndgamePlan;
  /** Dificultad. */
  ai: AiLevel;
  /**
   * Estrategia de alianza que le dibujaste (`ai/plan.ts`, solo tu compañero): en cada paso recorre
   * su ruta y luego junta en su zona, de donde y al nivel que diga el plan.
   */
  plan?: PlanDriver;
  /** AUTO sin anotar (el plan dice "Cruzar la línea" o "Quedarse quieto"): recorre la ruta y se para. */
  autoIdle?: boolean;
}

/** Datos de un acercamiento de precisión (`dock`). */
type DockState = 'travel' | 'align' | 'creep' | 'docked';

export class Bot {
  mode: Mode = 'collect';
  readonly opts: BotOptions;
  readonly profile: AiProfile;
  readonly team: Team;
  private targetPiece = -1;
  private backOff = 0;
  /** Hacia dónde se aparta al atorarse: al revés de como iba (−1 si iba de frente, +1 si de reversa). */
  private backDir = -1;
  private bestDist = Infinity;
  private progressT = 0;
  private lastGoal: { x: number; z: number } | null = null;
  /** Muestras que dejó por imposibles (índice → segundos que faltan). */
  private ignore = new Map<number, number>();
  /** Pausa de "reacción" al cambiar de objetivo (dificultad). */
  private pause = 0;
  private lastMode: Mode = 'collect';
  /** Segundos seguidos frente a la Cámara rival (D17: Tech Foul después de 3 s). */
  private obstructT = 0;
  /** Segundos esperando en la Campana sin que entre nada. */
  private hpWait = 0;
  /** Ya dejó (o intentó dejar) la Crítica: sigue como si fuera a la Plataforma. */
  private criticalDone = false;
  private critTries = 0;
  /** Soltó la Crítica desde la Plataforma: ya está arriba y se queda quieto (si gira, la tira). */
  private critParked = false;
  private critParkX = 0;
  /** Segundos esperando que su compañero desocupe el Nivel 3. */
  private n3Wait = 0;
  /** Nivel al que ya se está arrimando (no cambia hasta soltar todo). */
  private lockedLevel: Level | null = null;
  /** Punto de esquive temporal y cuánto lleva cerrado el paso. */
  private detour: { x: number; z: number; t: number } | null = null;
  private blockT = 0;
  /** Visitas a la Cámara (para repartir dónde caen las Muestras). */
  private visits = 0;
  /** Segundos alineándose o arrimándose sin terminar (atorado contra algo). */
  private dockT = 0;
  /** Último `timeLeft` visto (reloj para que el `Team` sepa si sigue activo). */
  clock = Infinity;
  private phase: Phase = 'PRE';
  private guardT = 0;
  /** Paso del plan en curso, punto de su ruta al que va y segundos tras ese punto. */
  private directive: PlanDirective | null = null;
  private routeIdx = 0;
  private routeT = 0;

  constructor(
    readonly robot: Robot,
    private pieces: Pieces,
    private others: Robot[],
    opts: Partial<BotOptions> = {},
    team?: Team,
  ) {
    this.opts = { auto: 'collect', teleop: true, role: 'score', ai: 'hard', ...opts };
    this.profile = AI_PROFILES[this.opts.ai];
    this.team = team ?? new Team(robot.alliance);
    this.team.join(this);
  }

  /** Lado de la alianza: +1 rojo (+X), −1 azul. */
  private get side(): number {
    return this.robot.alliance === 'red' ? 1 : -1;
  }

  private get level(): Level {
    // Un robot propio del editor puede no llegar al N3 (`RobotSpec.maxLevel`)
    return Math.min(this.opts.level ?? this.profile.level, this.robot.spec.maxLevel ?? 3) as Level;
  }

  /** ¿Le toca la Muestra Crítica? */
  private get critDuty(): boolean {
    if (this.opts.endgame === 'critical') return true;
    if (this.opts.endgame !== undefined) return false;
    return this.team.critBy === this.robot.index;
  }

  /** ¿Sube a la Plataforma en el ENDGAME? */
  private get climbs(): boolean {
    return this.opts.endgame !== 'none';
  }

  /**
   * Punto de anotación: frente a la pared de la Cámara propia, al centro del nivel, viendo hacia ella
   * (los dos tipos anotan al frente; `posDir` lo dice por posición).
   */
  scoringPose(level: Level): { x: number; z: number; heading: number } {
    const w = F.camaraWells()[level];
    // Que la pieza caiga lo más al fondo del pozo que se pueda sin chocar con la Cámara, y cada
    // visita un poco a un lado (si todas caen en el mismo punto, la pila llega a la apertura)
    const hl = this.robot.phys.halfL;
    const z = Math.min((w.z0 + w.z1) / 2 - this.tipDistance(level), F.CAMARA_Z_RED[0] - hl - 0.03);
    const spread = (w.x1 - w.x0) / 2 - 0.14;
    const dx = [0, -1, 1, -0.5, 0.5][this.visits % 5] * spread;
    const p = F.forAlliance(this.robot.alliance, { x: (w.x0 + w.x1) / 2 + dx, z });
    const back = this.scoreDir < 0 ? Math.PI : 0;
    return { ...p, heading: wrap((this.robot.alliance === 'red' ? -Math.PI / 2 : Math.PI / 2) + back) };
  }

  /** +1 si anota al frente, −1 si anota atrás (llega a la Cámara de reversa). */
  private get scoreDir(): number {
    return posDir(this.robot.spec, 3);
  }

  /** +1 si recoge del piso al frente, −1 si atrás (llega a la Muestra de reversa, `ArmSpec.pickBack`). */
  private get pickDir(): number {
    return posDir(this.robot.spec, 0);
  }

  /** Distancia (centro del robot → centro de la Muestra al soltarla) en ese nivel. */
  private tipDistance(level: Level): number {
    return Math.abs(posTip(this.robot.spec, level).x);
  }

  /** `timeLeft`: segundos para el final del match (para calcular el AUTO y el ENDGAME). */
  step(dt: number, phase: Phase, timeLeft = Infinity): BotOutput {
    this.clock = timeLeft;
    this.phase = phase;
    this.applyPlan(phase, timeLeft);
    const out = this.decide(dt, phase, timeLeft);
    this.unhook(out);
    this.unjam(out, dt);
    // El brazo topó con la madera al girar (`Mechanisms.armBlocked`): se aleja del lado de la garra
    // para que libre (con la viga chocando, pegado a la Cámara el brazo no pasa de N1)
    const m = this.robot.mech;
    if (m.armBlocked && this.freeT <= 0) {
      out.forward = -clawDir(m.angle) * 0.4;
      out.turn = 0;
    }
    out.forward *= this.profile.speed;
    this.guard(out, phase === 'ENDGAME');
    return out;
  }

  /** Al empezar otro paso del plan: su ruta desde el primer punto y lo que pide (de dónde, nivel). */
  private applyPlan(phase: Phase, timeLeft: number): void {
    const d = this.opts.plan?.at(phase, timeLeft) ?? null;
    if (!d || d.key === this.directive?.key) return;
    this.directive = d;
    this.routeIdx = 0;
    this.routeT = 0;
    this.opts.source = d.source;
    this.opts.level = d.level;
    this.lockedLevel = null;
    this.team.plan();
  }

  /**
   * Ruta del plan: va punto por punto con la garra lista para recoger. Un punto al que no llega en
   * 6 s (un robot en medio, fuera de alcance) se salta. No la sigue si ya le toca subir a la
   * Plataforma o llevar la Crítica (el ENDGAME manda).
   */
  private followRoute(out: BotOutput, phase: Phase, dt: number): boolean {
    const d = this.directive;
    if (!d || this.routeIdx >= d.route.length || this.mode === 'climb' || this.mode === 'critical') return false;
    const pos = this.robot.phys.position();
    const g = d.route[this.routeIdx];
    this.routeT += dt;
    if (Math.hypot(g.x - pos.x, g.z - pos.z) < 0.35 || this.routeT > 6) {
      this.routeIdx++;
      this.routeT = 0;
      return this.followRoute(out, phase, 0);
    }
    this.team.claim(-1, this.robot.index);
    this.targetPiece = -1;
    out.intake = true;
    this.drive(g, out, false, phase, phase === 'ENDGAME');
    return true;
  }

  /** ¿Sigue recorriendo la ruta del paso del plan? */
  get onRoute(): boolean {
    return !!this.directive && this.routeIdx < this.directive.route.length;
  }

  /**
   * La garra choca con la madera (D34): si está arriba de una Cámara (acaba de anotar) y el plan pide
   * bajarla, al girar hacia abajo se engancharía detrás de la pared. Primero se aparta derecho con la
   * garra en alto y la baja cuando ya quedó afuera.
   */
  private unhook(out: BotOutput): void {
    const m = this.robot.mech;
    const s = this.robot.spec;
    if (posTip(s, out.elevator).y >= m.height - 0.05) return;
    const tipX = m.tipX();
    const tip = this.robot.phys.localToWorld(tipX, 0, 0);
    if (!CAMARAS.some((c) => F.inRect(c, tip.x, tip.z))) return;
    out.elevator = m.target;
    out.forward = -Math.sign(tipX || 1) * 0.45;
    out.turn = 0;
  }

  /** Segundos mandando moverse sin moverse, y cuánto le queda a la maniobra para zafarse. */
  private jamT = 0;
  private freeT = 0;
  private freeDir = -1;

  /**
   * Trabado (la garra enganchada en otro robot o en la madera, D34; mandos sin movimiento): sube la
   * garra por encima de los chasis y se aparta derecho, al revés de como empujaba.
   */
  private unjam(out: BotOutput, dt: number): void {
    const p = this.robot.phys;
    if (this.freeT > 0) {
      this.freeT -= dt;
      out.elevator = 4;
      out.forward = this.freeDir * 0.4;
      out.turn = 0;
      return;
    }
    const v = p.body.linvel();
    const c = p.lastCmd;
    const pushing = Math.abs(c.forward) > 0.15 || Math.abs(c.turn) > 0.3;
    this.jamT = pushing && Math.hypot(v.x, v.z) < 0.05 && Math.abs(p.body.angvel().y) < 0.15 ? this.jamT + dt : 0;
    // Arrimándose a la Cámara o a la Campana (`dock`, que ya sabe zafarse) o estacionado a propósito: no
    if (this.dockT > 0 || out.release || this.mode === 'block') this.jamT = 0;
    if (this.jamT > 1.0) {
      this.jamT = 0;
      this.freeT = 0.7;
      this.freeDir = Math.abs(c.forward) > 0.15 ? -Math.sign(c.forward) : -Math.sign(this.robot.mech.tipX() || 1);
    }
  }

  // ------------------------------------------------------------------ tiempos estimados
  /** Velocidad media real (m/s) contando aceleración y curvas (medido ≈ 70% de la máxima). */
  private get vel(): number {
    return Math.max(0.4, this.robot.spec.maxSpeed * this.profile.speed * 0.7);
  }

  /** Segundos estimados de `a` a `b` (rodeando la Plataforma si hace falta) más el giro. */
  eta(a: { x: number; z: number }, b: { x: number; z: number }): number {
    let len = Math.hypot(b.x - a.x, b.z - a.z);
    const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    if (segmentHitsRect(a.x, a.z, b.x, b.z, hx, hz)) {
      // Por la esquina más cómoda
      let best = Infinity;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const c = { x: sx * (hx + 0.1), z: sz * (hz + 0.1) };
          best = Math.min(best, Math.hypot(c.x - a.x, c.z - a.z) + Math.hypot(b.x - c.x, b.z - c.z));
        }
      len = best;
    }
    return len / this.vel + 0.5;
  }

  /** Segundos para alinearse y soltar `n` Muestras en la Cámara una vez en su frente. */
  private scoreTime(n: number): number {
    return 1.6 + 0.4 * Math.max(1, n);
  }

  /** Pie de su rampa, en su carril de la Plataforma (caben 2 robots). */
  private foot(): { x: number; z: number } {
    return { x: this.side * 2.75, z: this.lane() };
  }

  private lane(): number {
    return F.forAlliance(this.robot.alliance, { x: 0, z: this.robot.station === 0 ? -0.37 : 0.37 }).z;
  }

  /** Segundos que necesita desde `p` para quedar sobre la Plataforma. */
  private climbEta(p: { x: number; z: number }): number {
    return this.eta(p, this.foot()) + CLIMB_TIME + this.profile.climbMargin;
  }

  // ------------------------------------------------------------------ decisión
  private decide(dt: number, phase: Phase, timeLeft: number): BotOutput {
    const r = this.robot;
    const m = r.mech;
    const out: BotOutput = { forward: 0, turn: 0, intake: false, elevator: 0, release: false };
    const o = this.opts;

    for (const [i, left] of this.ignore) if (left - dt <= 0) this.ignore.delete(i);
    else this.ignore.set(i, left - dt);

    this.plan(phase, timeLeft);
    if (this.mode === 'critical' && !r.mech.critical) this.team.critPending = r.index;
    else if (this.team.critPending === r.index) this.team.critPending = null;
    if (this.mode !== 'score') {
      if (this.team.n3By === r.index) this.team.n3By = null;
      this.lockedLevel = null;
      this.n3Wait = 0;
    }
    if (this.mode !== 'collect' && this.mode !== 'hp') this.team.claim(-1, r.index);

    // Dificultad: duda un momento al cambiar de plan
    if (this.mode !== this.lastMode) {
      this.lastMode = this.mode;
      this.pause = this.profile.reaction;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      out.intake = this.mode === 'collect' || this.mode === 'hp';
      return out;
    }

    if (this.backOff > 0) {
      this.backOff -= dt;
      // Se aparta girando (al revés de como iba), salvo que tenga a un rival ahí (no chocarle, §4.5)
      out.forward = this.rivalNear(this.backDir, 1.0) ? 0 : this.backDir * 0.35;
      out.turn = 0.6;
      return out;
    }

    // En una zona de anotación rival (frente a su Cámara o su Campana, o en su rampa) en el TELEOP:
    // salir antes de los 3 s (§4.6, D17)
    const pos = r.phys.position();
    const zones = RIVAL_ZONES[r.alliance];
    this.obstructT = phase !== 'AUTO' && zones.some((z) => F.inRect(z, pos.x, pos.z)) ? this.obstructT + dt : 0;
    if (this.obstructT > 1.8 && o.role !== 'block') {
      if (this.targetPiece >= 0) this.ignore.set(this.targetPiece, 15);
      this.targetPiece = -1;
      // De la rampa rival se sale de lado (hacia el centro se quedaría en ella); de lo demás, al centro
      const onRamp = Math.abs(pos.z) < F.PLATFORM_WIDTH / 2 + 0.1;
      this.drive({ x: pos.x, z: onRamp ? (Math.sign(pos.z) || 1) * 1.5 : 0 }, out, false, phase, onRamp);
      out.intake = true;
      return out;
    }

    if (this.followRoute(out, phase, dt)) return out;

    if (this.mode === 'collect') {
      out.intake = true;
      const piece = this.pickSample(phase);
      if (piece) this.driveToPiece(piece, out, phase);
      else if (m.stored.length === 0 && phase !== 'AUTO') this.drive(this.zoneWait() ?? this.waitSpot(), out, false, phase);
    } else if (this.mode === 'hp') {
      this.atHumanPlayer(out, phase, dt);
    } else if (this.mode === 'score') {
      this.score(out, phase);
    } else if (this.mode === 'critical') {
      this.critical(out, phase);
    } else if (this.mode === 'block') {
      // Frente al Nivel 3 rival, a la distancia de su punto de anotación, viendo a lo largo de la pared
      const p = this.blockPose();
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > 0.15) this.drive(p, out, true, phase);
      else out.turn = clamp1(wrap(0 - r.phys.heading()) * 2);
    } else if (this.mode === 'climb') {
      this.climb(out, phase);
    }
    return out;
  }

  /** Elige el modo según la fase, el reloj, lo que trae y su papel. */
  private plan(phase: Phase, timeLeft: number): void {
    const r = this.robot;
    const m = r.mech;
    const o = this.opts;
    const pos = r.phys.position();
    const n = m.stored.length;
    const home = this.scoringPose(this.level);

    if (phase === 'AUTO') {
      const autoLeft = timeLeft - GAME.times.teleop - GAME.times.autoToTeleopPause;
      if (o.autoIdle) {
        this.mode = 'idle';
        return;
      }
      if (o.auto === 'preload' || o.role !== 'score') {
        this.mode = n > 0 && o.role === 'score' ? 'score' : 'idle';
        return;
      }
      if (this.mode === 'score' && n > 0) return;
      // Anota antes de que acabe el AUTO (18 en N3 contra 15 en el TELEOP, §4.4)
      const mustGo = autoLeft < this.eta(pos, home) + this.scoreTime(n) + 0.6;
      this.mode = n > 0 && (n >= this.batchSize() || mustGo || !this.worthAnother(phase, timeLeft)) ? 'score' : 'collect';
      return;
    }

    if (o.role === 'park') {
      this.mode = this.climbs && timeLeft < this.climbEta(pos) + 6 ? 'climb' : 'idle';
      return;
    }
    if (o.role === 'block') {
      this.mode = this.climbs && timeLeft < this.climbEta(pos) + 4 ? 'climb' : 'block';
      return;
    }
    if (this.mode === 'climb') return;

    // Muestra Crítica: estar en la Campana al empezar el ENDGAME (no antes, §4.6) y llevarla a la Repisa
    if (this.critDuty && !this.criticalDone) {
      if (this.mode === 'critical') return;
      const crit = this.pieces.critical(r.alliance);
      const holder = F.forAlliance(r.alliance, F.CRITICAL_HOLDER_RED);
      const ct = crit.body.translation();
      // Sigue en la rendija (el Human Player la desliza a lo largo, D39)
      const available = crit.state.at === 'field' && ct.y >= F.CRITICAL_HOLDER_RED.y - 0.02 && Math.abs(ct.z - holder.z) < 0.15;
      if (!available) this.criticalDone = true;
      else {
        const stage = this.critStage();
        const endgameAt = GAME.times.endgame;
        // Lo último para tomarla y llegar a la Repisa (desde la Campana, con margen)
        const latest = this.eta(stage, this.foot()) + 8 + this.profile.climbMargin;
        const goNow = timeLeft < endgameAt + this.eta(pos, stage) + 1;
        if (goNow) {
          // Si trae Muestras y le da tiempo, primero las anota
          const scoreFirst = n > 0 && timeLeft - (this.eta(pos, home) + this.scoreTime(n) + this.eta(home, stage)) > latest;
          if (!scoreFirst) {
            this.mode = 'critical';
            return;
          }
          this.mode = 'score';
          return;
        }
      }
    }

    // ¿Le alcanza el tiempo para seguir anotando antes de subir?
    const climbFromHome = this.climbs ? this.climbEta(home) : 0;
    const critBusy = this.critDuty && !this.criticalDone;
    const reserve = critBusy ? GAME.times.endgame + this.eta(home, this.critStage()) + 1 : climbFromHome;
    if (this.climbs && !critBusy && timeLeft < this.climbEta(pos) + (n > 0 && this.mode === 'score' ? 0 : 0.5)) {
      this.mode = 'climb';
      return;
    }
    if (this.mode === 'score') {
      if (n === 0) {
        this.mode = 'collect';
        this.visits++;
      } else if (timeLeft - (this.eta(pos, home) + this.scoreTime(n)) < reserve && this.climbs) this.mode = critBusy ? 'critical' : 'climb';
      return;
    }
    if (n >= this.batchSize()) {
      this.mode = 'score';
      return;
    }
    // Recolectar (o esperar en el Human Player) mientras convenga
    const enough = (extra: number) => timeLeft - (extra + this.eta(home, home) + this.scoreTime(n + 1)) > reserve;
    if (n > 0 && !this.worthAnother(phase, timeLeft, enough)) {
      this.mode = 'score';
      return;
    }
    if (n === 0 && !enough(this.eta(pos, home) + 2)) {
      this.mode = critBusy ? 'critical' : this.climbs ? 'climb' : 'collect';
      return;
    }
    this.mode = this.wantsHp(phase) ? 'hp' : 'collect';
  }

  /** Cuántas junta antes de ir a anotar. */
  private batchSize(): number {
    return Math.min(this.robot.mech.capacity, this.opts.batch ?? this.profile.batch);
  }

  /**
   * ¿Vale la pena ir por otra antes de anotar? Sí si la mejor candidata desvía poco el camino a la
   * Cámara y (en AUTO) da tiempo de anotarla antes de que acabe.
   */
  private worthAnother(phase: Phase, timeLeft: number, enough?: (extra: number) => boolean): boolean {
    const pos = this.robot.phys.position();
    const home = this.scoringPose(this.level);
    const c = this.bestCandidate(phase);
    const direct = this.eta(pos, home);
    if (this.wantsHp(phase) && this.robot.mech.stored.length < this.batchSize()) {
      // Esperando en la Campana: sigue mientras el Human Player tenga Muestras y no tarde demasiado
      const hp = this.team.hp;
      if (hp && this.pieces.hpStock(this.robot.alliance).length > 0 && this.hpWait < (hp.interval + 1.5)) return enough ? enough(this.eta(pos, home) + hp.nextIn) : true;
    }
    if (!c) return false;
    const via = c.eta + this.eta(c.at, home);
    const detour = via - direct;
    if (detour > 3.5) return false;
    if (phase === 'AUTO') {
      const autoLeft = timeLeft - GAME.times.teleop - GAME.times.autoToTeleopPause;
      return autoLeft > via + this.scoreTime(this.robot.mech.stored.length + 1) + 0.5;
    }
    return enough ? enough(via - this.eta(home, home)) : true;
  }

  /** ¿Le toca esperar en la Campana a que su Human Player meta Muestras? (§3.2.4, solo TELEOP) */
  private wantsHp(phase: Phase): boolean {
    if (phase === 'AUTO' || !this.team.hp?.enabled) return false;
    // El compañero va por la Crítica: la Campana es suya (se estorbarían)
    if (this.team.critPending !== null && this.team.critPending !== this.robot.index) return false;
    const src = this.opts.source;
    if (src === 'lab') return false;
    const stock = this.pieces.hpStock(this.robot.alliance).length;
    if (stock === 0) return false;
    if (src === 'hp') return true;
    const mine = this.team.hpBy === null ? this.team.members.filter((b) => b.opts.teleop && b.opts.role === 'score').length <= 1 : this.team.hpBy === this.robot.index;
    if (!mine) return false;
    // Solo si no hay Muestras sueltas más baratas
    const c = this.bestCandidate(phase, true);
    const toSlot = this.eta(this.robot.phys.position(), this.hpPose());
    return !c || c.cost > toSlot + (this.team.hp?.nextIn ?? 0) + 0.5 || this.mode === 'hp';
  }

  // ------------------------------------------------------------------ recolectar
  /**
   * La Muestra libre que menos cuesta: tiempo para llegar más una parte del regreso a la Cámara
   * (así junta las que le quedan de camino). No toma las que apartó su compañero.
   */
  private bestCandidate(phase: Phase, labOnly = false): { i: number; at: { x: number; z: number }; eta: number; cost: number } | null {
    const r = this.robot;
    const pos = r.phys.position();
    const home = this.scoringPose(this.level);
    // Con espacio para una sola pieza cada Muestra es un viaje redondo: cuenta todo el regreso
    const back = r.mech.capacity <= 1 ? 1 : r.mech.stored.length > 0 ? 0.6 : 0.3;
    let best: { i: number; at: { x: number; z: number }; eta: number; cost: number } | null = null;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field' || this.ignore.has(p.index)) continue;
      if (this.team.claimedByOther(p.index, r.index) && this.claimActive(p.index)) continue;
      const t = p.body.translation();
      if (t.y > 0.2) continue; // dentro de una Cámara o en el aire
      if (!this.reachable(t, phase, labOnly)) continue;
      const at = { x: t.x, z: t.z };
      const eta = this.eta(pos, at) + this.turnCost(at);
      let cost = eta + back * this.eta(at, home);
      // Seguir con la que ya iba (no cambia por poquito)
      if (p.index === this.targetPiece) cost -= 0.6;
      if (!best || cost < best.cost) best = { i: p.index, at, eta, cost };
    }
    return best;
  }

  /** ¿El que apartó esa Muestra sigue jugando? (el robot del jugador deja de correr la IA al acabar el AUTO) */
  private claimActive(piece: number): boolean {
    const who = this.team.claims.get(piece);
    const b = this.team.members.find((x) => x.robot.index === who);
    return !!b && this.isActive(b);
  }

  /** ¿Ese compañero lo maneja la IA ahora mismo? */
  private isActive(b: Bot): boolean {
    return Math.abs(b.clock - this.clock) < 0.5 && (this.phase === 'AUTO' || b.opts.teleop);
  }

  /** Segundos de giro para encarar un punto. */
  private turnCost(at: { x: number; z: number }): number {
    const pos = this.robot.phys.position();
    const err = Math.abs(wrap(Math.atan2(-(at.z - pos.z), at.x - pos.x) - this.robot.phys.heading()));
    return err / (this.robot.spec.maxOmega * 0.8);
  }

  /** ¿Se puede (y conviene) tomar una Muestra en ese punto? */
  private reachable(t: { x: number; z: number }, phase: Phase, labOnly: boolean): boolean {
    const s = this.side;
    // Pegadas a un borde o junto a una Cámara: la garra no llega sin sacar una esquina
    // (salvo frente a la Campana: ahí deja el Human Player las suyas y se llega de frente a la pared)
    const atCampana = Math.abs(t.x) > F.HALF_L - F.CAMPANA_LENGTH + 0.3 && Math.abs(t.x) < F.HALF_L - 0.35 && Math.sign(t.x) * t.z < 0;
    if (Math.abs(t.x) > F.HALF_L - 0.35 || Math.abs(t.z) > F.HALF_W - (atCampana ? 0.27 : 0.5)) return false;
    if (Math.abs(t.x) < F.PLATFORM_LENGTH / 2 + 0.1 && Math.abs(t.z) < F.PLATFORM_WIDTH / 2 + 0.1) return false;
    // AUTO: solo de su mitad (§4.2)
    if (phase === 'AUTO' && s * t.x < 0.5) return false;
    // Las que mete su Human Player quedan frente a su Campana (lado −Z del rojo, |x| > 2)
    const nearHp = s * t.x > 2.0 && s * t.z < -1.5;
    if (labOnly && nearHp) return false;
    if (this.opts.source === 'hp' && !nearHp) return false;
    if (this.opts.source === 'lab' && nearHp) return false;
    // Zona de trabajo del plan: solo las de ahí (más las de su Campana, si atiende al Human Player)
    const zone = this.directive?.zone;
    if (zone && !F.inRect(zone, t.x, t.z) && !(nearHp && this.opts.source !== 'lab')) return false;
    // Ya anotadas: dentro de una Cámara (botes sin fondo, §3.2.3; quedan en el piso del pozo)
    for (const a of ['red', 'blue'] as const) {
      const c = F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH - 0.05, x1: F.CAMARA_X_END_RED + 0.05, z0: F.CAMARA_Z_RED[0] - 0.05, z1: F.HALF_W });
      if (F.inRect(c, t.x, t.z)) return false;
    }
    // Junto al compañero que se acomoda frente a la Cámara: ir por ella le estorba (se traban los dos)
    for (const b of this.team.members) {
      if (b === this || b.mode !== 'score' || !this.isActive(b)) continue;
      const q = b.robot.phys.position();
      if (Math.hypot(q.x - t.x, q.z - t.z) < 1.1 && s * q.z > 1.2) return false;
    }
    // Pegadas a un robot parado (el del jugador que no se mueve, uno trabado): con la garra abajo lo
    // empujaría (a la Plataforma o fuera de la cancha) en vez de tomarla
    for (const o of this.others) {
      if (o === this.robot) continue;
      const q = o.phys.position();
      const v = o.phys.body.linvel();
      if (Math.hypot(v.x, v.z) < 0.3 && Math.hypot(q.x - t.x, q.z - t.z) < Math.hypot(o.spec.length, o.spec.width) / 2 + 0.15) return false;
    }
    // Las del Human Player rival: quedan detrás de su barrera, en una zona de su color (D8). Solo se
    // roban (Experto) si ningún rival está cerca de ellas y queda tiempo; si no, se dejan
    if (s * t.x < -2.0 && s * t.z > 1.5 && !this.canSteal(t, phase)) return false;
    // Junto a la Cámara rival: tomarla obliga a quedarse en su frente (D17)
    if (s * t.x < -1.25 && s * t.z < -1.75) return false;
    return true;
  }

  /** ¿Conviene robar esta Muestra de la Campana rival? Sin rivales cerca de ella ni de la ranura, con tiempo y sin cargar ya. */
  private canSteal(t: { x: number; z: number }, phase: Phase): boolean {
    if (!this.profile.steal || phase === 'AUTO' || this.clock < 22) return false;
    if (this.robot.mech.stored.length >= this.batchSize()) return false;
    const slot = F.forAlliance(opponent(this.robot.alliance), { x: 3.5, z: -F.HALF_W + 0.085 });
    return !this.others.some((o) => {
      if (o.alliance === this.robot.alliance) return false;
      const q = o.phys.position();
      return Math.hypot(q.x - t.x, q.z - t.z) < 2.2 || Math.hypot(q.x - slot.x, q.z - slot.z) < 2.4;
    });
  }

  /** La Muestra a la que va (la aparta para su compañero), o null. */
  private pickSample(phase: Phase): { x: number; z: number; i: number } | null {
    const c = this.bestCandidate(phase);
    if (!c) {
      this.targetPiece = -1;
      this.team.claim(-1, this.robot.index);
      return null;
    }
    if (c.i !== this.targetPiece) {
      this.bestDist = Infinity;
      this.progressT = 0;
      this.targetPiece = c.i;
    }
    this.team.claim(c.i, this.robot.index);
    return { ...c.at, i: c.i };
  }

  /** Cara por la que entra a la Muestra que persigue (para no cambiarla a cada rato). */
  private approach: { piece: number; k: number } | null = null;

  /**
   * Va hacia una Muestra con la garra abajo para que entre de frente. Con el agarre preciso
   * (`Mechanisms.grip`) la garra solo cierra con la Muestra casi derecha, así que llega por la línea
   * de una de sus caras (la que le queda más de frente): persigue un punto en esa línea, detrás de
   * la Muestra, que se acerca a ella conforme se alinea; y entra despacio (se resbala si llega rápido).
   * Con compliants llega igual: no lo necesita, pero así no estorba a su compañero ni pisa la
   * Plataforma (en 8 matches de prueba anota lo mismo que llegando directo, sin faltas).
   */
  private driveToPiece(p: { x: number; z: number; i?: number }, out: BotOutput, phase: Phase): void {
    const r = this.robot;
    const pos = r.phys.position();
    const s = r.spec;
    // Distancia del centro del robot a la que la toma, y si la garra está al frente o atrás
    const grab = Math.abs(posTip(s, 0).x);
    const pd = this.pickDir;
    const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
    const piece = p.i !== undefined ? this.pieces.list[p.i] : undefined;
    if (!piece || r.mech.grip === 'easy' || dist > grab + 1.6) {
      this.drive(p, out, true, phase, false, pd < 0, Math.max(0, dist - grab));
      return;
    }
    // Cara de la Muestra más de frente al camino que trae, de las que dejan llegar al robot (sin
    // pegarse a una Cámara, la pared, la Plataforma o la barra de la Campana)
    const bearing = Math.atan2(-(p.z - pos.z), p.x - pos.x);
    const f = cubePose(piece.body.rotation()).faceYaw;
    const room = r.phys.halfW + 0.04;
    const hx = F.PLATFORM_LENGTH / 2 + room;
    const hz = F.PLATFORM_WIDTH / 2 + room;
    const free = (q: { x: number; z: number }) =>
      Math.abs(q.x) < F.HALF_L - room && Math.abs(q.z) < F.HALF_W - room && !nearCamara(q, room) && (phase === 'ENDGAME' || !(Math.abs(q.x) < hx && Math.abs(q.z) < hz)) && !nearBarrier(q, room);
    let h = bearing;
    let best = Infinity;
    for (let k = 0; k < 4; k++) {
      const hk = f + (k * Math.PI) / 2;
      const ux = Math.cos(hk);
      const uz = -Math.sin(hk);
      let cost = Math.abs(wrap(hk - bearing)) + (this.approach?.piece === piece.index && this.approach.k === k ? -0.3 : 0);
      if (!free({ x: p.x - ux * grab, z: p.z - uz * grab }) || !free({ x: p.x - ux * (grab + 0.45), z: p.z - uz * (grab + 0.45) })) cost += 10;
      if (cost < best) {
        best = cost;
        h = hk;
        this.approach = { piece: piece.index, k };
      }
    }
    const dx = Math.cos(h);
    const dz = -Math.sin(h);
    // Qué tan atrás de la Muestra va el robot, sobre la línea de esa cara, y qué tan de lado
    const rx = pos.x - p.x;
    const rz = pos.z - p.z;
    const behind = -(rx * dx + rz * dz);
    const side = rx * dz - rz * dx;
    // Con la garra atrás la ve de espaldas y entra de reversa (girar el chasis gira igual el sentido
    // de avance, así que la corrección lateral no cambia de signo)
    const herr = wrap(h + (pd < 0 ? Math.PI : 0) - r.phys.heading());
    // Como lo haría un piloto con tanque: se para detrás de la Muestra, gira en su lugar hasta verla
    // de frente y entra derecho y despacio (la garra cierra en ~0.2 s; se resbala si llega rápido)
    const onLine = behind > grab - 0.08 && Math.abs(side) < 0.12;
    // De reversa (garra atrás) no ve lo que tiene detrás: si la Muestra quedó pegada a otro robot,
    // entrar lo empujaría
    if (pd < 0 && onLine && this.rivalNear(pd, grab + 0.35, true)) {
      this.ignore.set(piece.index, 4);
      this.targetPiece = -1;
      return;
    }
    if (onLine && Math.abs(herr) < 0.15) {
      out.turn = clamp1(herr * 3 - side * 6);
      out.forward = pd * Math.min(0.3, 0.12 + Math.max(0, behind - grab) * 0.4);
      return;
    }
    const stage = { x: p.x - dx * (grab + 0.45), z: p.z - dz * (grab + 0.45) };
    const toStage = Math.hypot(stage.x - pos.x, stage.z - pos.z);
    if (onLine || toStage < 0.1) {
      out.turn = clamp1(herr * 2.5);
      out.forward = 0;
      return;
    }
    this.drive(stage, out, true, phase, false, pd < 0);
  }

  /** Sin nada que juntar en su zona de trabajo del plan: espera en medio de ella. */
  private zoneWait(): { x: number; z: number } | null {
    const z = this.directive?.zone;
    return z ? { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 } : null;
  }

  /**
   * Espera fuera del paso: entre su Cámara y la línea central, a ~1.3 m de la entrada al Nivel 3 (no
   * en el pasillo entre la Plataforma y la Driver Station, que es el camino a la Campana).
   */
  private waitSpot(): { x: number; z: number } {
    // Si su compañero va por la Crítica o a la Plataforma, se pega a la orilla: a 1.95 m le cerraba
    // el pasillo junto a la Plataforma y el de la Crítica se quedaba atorado ahí el resto del match
    const busy = this.team.members.some((b) => b !== this && (b.mode === 'critical' || b.mode === 'climb'));
    return F.forAlliance(this.robot.alliance, { x: 0.6, z: busy ? 2.6 : 1.95 });
  }

  // ------------------------------------------------------------------ Human Player
  /** Frente a la ranura de su Campana, con la garra donde salen las Muestras (§3.2.4). */
  private hpPose(): { x: number; z: number } {
    const r = this.robot;
    const hp = this.team.hp;
    const slot = hp ? hp.slot() : { ...F.forAlliance(r.alliance, { x: 3.5, z: -F.HALF_W + 0.085 }), dz: this.side };
    const reach = r.phys.halfL - 0.06;
    // Una Muestra que quedó junto a la ranura (fuera del alcance de la garra) no deja que el Human
    // Player meta la siguiente: se alinea con ella para tragársela
    let x = slot.x;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field') continue;
      const t = p.body.translation();
      if (t.y < 0.3 && Math.abs(t.x - slot.x) < 0.45 && Math.abs(t.z - slot.z) < 0.45) {
        x = t.x;
        break;
      }
    }
    const lim = (F.CAMPANA_X_RED[1] - F.CAMPANA_X_RED[0]) / 2 - r.phys.halfW - 0.1;
    return { x: Math.max(slot.x - lim, Math.min(slot.x + lim, x)), z: slot.z + slot.dz * reach };
  }

  private atHumanPlayer(out: BotOutput, phase: Phase, dt: number): void {
    const r = this.robot;
    out.intake = true;
    const pose = this.hpPose();
    const faceZ = -this.side; // la Campana del rojo está en −Z
    // Un compañero sale de la Campana (es un pasillo entre la barra y la pared): lo deja salir
    const pos = r.phys.position();
    const leaving = this.team.members.some((b) => {
      return b !== this && this.isActive(b) && b.mode !== 'hp' && inCampana(r.alliance, b.robot.phys.position());
    });
    if (leaving && !inCampana(r.alliance, pos)) {
      this.drive(F.forAlliance(r.alliance, { x: 2.9, z: -1.3 }), out, true, phase);
      return;
    }
    const st = this.dock(pose, faceZ, this.pickDir, out, phase, { stage: 0.5, tol: 0.1, edge: 0.25 });
    if (st === 'docked') {
      out.forward = 0;
      this.hpWait += dt;
    } else this.hpWait = 0;
    // Se le acabó la paciencia: si trae algo, va a anotar
    const hp = this.team.hp;
    if (r.mech.stored.length > 0 && hp && this.hpWait > hp.interval + 1.5) {
      this.mode = 'score';
      this.hpWait = 0;
    }
  }

  // ------------------------------------------------------------------ anotar
  private score(out: BotOutput, phase: Phase): void {
    const r = this.robot;
    const m = r.mech;
    const level = this.chooseLevel();
    if (level === null) {
      // El Nivel 3 lo usa su compañero: espera a un lado con el mecanismo arriba
      this.n3Wait += 1 / HZ;
      const w = this.waitSpot();
      this.drive(w, out, true, phase);
      out.elevator = this.level;
      return;
    }
    const pose = this.scoringPose(level);
    const pos = r.phys.position();
    const near = Math.hypot(pose.x - pos.x, pose.z - pos.z) < 1.6;
    if (level === 3 && near) this.team.n3By = r.index;
    out.elevator = near ? level : 0;
    const st = this.dock(pose, this.side, this.scoreDir, out, phase, { stage: 0.55, tol: 0.1 + this.profile.sloppy, edge: EDGE_CLEAR });
    // Ya se está arrimando: se queda con ese nivel hasta soltar todo
    if (st === 'creep' || st === 'docked') this.lockedLevel = level;
    if (st === 'docked') out.release = m.atTarget;
  }

  /** El nivel al que va ahora, o null si debe esperar su turno (su compañero usa el Nivel 3). */
  private chooseLevel(): Level | null {
    if (this.lockedLevel !== null) return this.lockedLevel;
    const pref = this.level;
    const occupied = (l: Level): boolean => {
      const p = this.scoringPose(l);
      if (this.others.some((o) => o !== this.robot && Math.hypot(o.phys.position().x - p.x, o.phys.position().z - p.z) < 0.8)) return true;
      return l === 3 && this.team.n3By !== null && this.team.n3By !== this.robot.index && this.teammateAtN3();
    };
    if (!occupied(pref)) {
      this.n3Wait = 0;
      return pref;
    }
    // Esperar un momento vale más (N3 15 contra N2 6, §4.4); si tarda, al siguiente nivel libre
    if (this.n3Wait < 4 && this.profile.teamwork) return null;
    return ([3, 2, 1] as Level[]).find((l) => l < pref && !occupied(l)) ?? null;
  }

  private teammateAtN3(): boolean {
    const b = this.team.members.find((x) => x.robot.index === this.team.n3By);
    return !!b && b.mode === 'score' && b.robot.mech.stored.length > 0;
  }

  /**
   * Acercamiento de precisión a una pose junto a una pared en ±Z: llega a un punto `stage` antes,
   * se alinea y se arrima. `faceZ` = hacia dónde (±Z) debe quedar su mecanismo; `dir` = +1 si el
   * mecanismo está al frente, −1 si está atrás (llega de reversa).
   */
  private dock(
    pose: { x: number; z: number },
    faceZ: number,
    dir: number,
    out: BotOutput,
    phase: Phase,
    o: { stage: number; tol: number; edge: number; hold?: boolean },
  ): DockState {
    const r = this.robot;
    const pos = r.phys.position();
    const want = dir > 0 ? (-faceZ * Math.PI) / 2 : (faceZ * Math.PI) / 2;
    const err = wrap(want - r.phys.heading());
    const lateral = pos.x - pose.x;
    const depth = (pose.z - pos.z) * faceZ; // > 0: todavía lejos de la pared
    const stage = { x: pose.x, z: pose.z - faceZ * o.stage };
    if (Math.abs(lateral) > o.tol + 0.06 || depth > o.stage + 0.3 || depth < -0.06) {
      this.dockT = 0;
      // Con el mecanismo atrás va de reversa todo el camino: llega ya de espaldas, sin dar la vuelta
      if (Math.hypot(stage.x - pos.x, stage.z - pos.z) > 0.12) this.drive(stage, out, true, phase, false, dir < 0, undefined, o.edge);
      else out.turn = clamp1(err * 2.5);
      return 'travel';
    }
    // Atorado al arrimarse (una pieza en el piso, otro robot): si ya está cerca, cuenta como listo
    this.dockT += 1 / HZ;
    if (this.dockT > 2.5 && !o.hold) {
      if (depth < 0.2) return 'docked';
      this.dockT = 0;
      this.backOff = 0.5;
      this.backDir = -dir;
      return 'travel';
    }
    if (Math.abs(err) > 0.07) {
      out.turn = clamp1(err * 2.5);
      return 'align';
    }
    if (o.hold) {
      out.turn = clamp1(err * 2.5);
      return depth > o.stage - 0.1 ? 'align' : 'creep';
    }
    if (depth > 0.02) {
      // Arrimarse corrigiendo el error lateral con el rumbo (apunta 0.8 m más allá de la pose)
      const aim = Math.atan2(-faceZ * 0.8, pose.x - pos.x) + (dir > 0 ? 0 : Math.PI);
      const dev = clamp(wrap(aim - want), 0.15);
      out.forward = dir * Math.min(0.55, depth * 1.8 + 0.1);
      out.turn = clamp1(wrap(want + dev - r.phys.heading()) * 2.5);
      return 'creep';
    }
    return 'docked';
  }

  // ------------------------------------------------------------------ ENDGAME
  /** Dónde espera frente a la Campana para tomar la Crítica (§3.2.4). */
  private critStage(): { x: number; z: number } {
    const h = F.CRITICAL_HOLDER_RED;
    return F.forAlliance(this.robot.alliance, { x: h.x, z: h.z + this.critDistance() + 0.55 });
  }

  /** +1 si la garra toma y suelta la Crítica al frente, −1 si atrás (el Pivote 180°). */
  private get critDir(): number {
    return posDir(this.robot.spec, 4);
  }

  /** Distancia (centro del robot → pieza) a la que su garra alcanza la Crítica. */
  private critDistance(): number {
    return Math.abs(posTip(this.robot.spec, 4).x) - 0.05;
  }

  /**
   * Distancia del centro del robot a la mitad de la Plataforma para soltar la Crítica sobre la Repisa
   * (§3.2.5). La pieza sale de la punta con el empujón del mecanismo y vuela mientras cae desde el
   * brazo hasta la Repisa: se suelta antes para que no se pase del otro lado (con la punta sobre el
   * centro caía a 15 cm de la orilla lejana, y si el robot aún se movía, afuera).
   * Apunta a su mitad de la Repisa: el robot rival de su mismo carril suelta la suya enfrente y las
   * dos piezas chocaban en el centro. No se puede acercar más que con el chasis contra el escalón.
   */
  private critDropX(): number {
    const r = this.robot;
    const s = r.spec;
    const hl = r.phys.halfL;
    const tip = Math.abs(posTip(s, 4).x);
    // La garra solo abre (sin empujón): lo que se desliza al tocar la Repisa (medido ≈ 2 cm)
    const drift = 0.02;
    return Math.max(F.REPISA_DEPTH / 2 + hl + 0.01, this.critLanding() + tip + drift);
  }

  /**
   * Dónde quiere que caiga el centro de la Crítica (m desde la mitad de la Repisa, + hacia su lado).
   * Apunta a 5 cm de la mitad, de su lado; como suelta unos centímetros antes de llegar (frena), cae
   * entre 10 y 14 cm. Si la Crítica rival ya cayó en su mitad frente a su carril (el robot rival de
   * su carril la suelta de frente y a veces se le pasa), la deja en la otra mitad: encima no cuenta
   * y tirar la rival de la Repisa es Tech Foul (§4.6).
   */
  private critLanding(): number {
    const want = 0.05;
    const c = this.pieces.critical(opponent(this.robot.alliance));
    const t = c.body.translation();
    const onRepisa = c.state.at === 'field' && Math.abs(t.x) < F.REPISA_DEPTH / 2 + 0.05 && t.y > F.REPISA_TOP;
    if (!onRepisa || Math.abs(t.z - this.lane()) > F.CRITICAL_SIZE + 0.1) return want;
    const xo = this.side * t.x;
    // Solo si estorba a la suya y cabe del otro lado (lo más lejos: −16 cm, que caen en −10)
    return xo > 0.04 ? Math.max(-0.16, xo - 0.26) : want;
  }

  /** ENDGAME con la Crítica: tomarla de la rendija de la Campana (§3.2.4) y dejarla en la Repisa desde la plataforma superior (§4.3.1). */
  private critical(out: BotOutput, phase: Phase): void {
    const r = this.robot;
    const m = r.mech;
    const pos = r.phys.position();
    const endgame = phase === 'ENDGAME';
    const crit = this.pieces.critical(r.alliance);
    const dir = this.critDir;
    if (!m.critical) {
      if (crit.state.at !== 'field' || (endgame && this.critTries > 6)) {
        this.criticalDone = true;
        this.mode = 'climb';
        return;
      }
      // La garra va vacía: si trae una Muestra, la suelta
      if (m.inClaw && m.inHopper >= m.capacity - 1) {
        out.release = true;
        return;
      }
      const h = F.CRITICAL_HOLDER_RED;
      const pose = F.forAlliance(r.alliance, { x: h.x, z: h.z + this.critDistance() });
      const faceZ = -this.side;
      const near = Math.hypot(pose.x - pos.x, pose.z - pos.z) < 1.4;
      out.elevator = near ? 4 : 0;
      const st = this.dock(pose, faceZ, dir, out, phase, { stage: 0.55, tol: 0.08, edge: 0.25, hold: !endgame });
      // Se arrima mientras intenta tomarla (la garra la toma en cuanto queda a su alcance)
      if (endgame && (st === 'creep' || st === 'docked')) {
        if (m.atTarget) {
          out.grabCritical = true;
          this.critTries += 1 / HZ;
        }
        if (st === 'docked') {
          // Ya pegado y no la alcanzó: un poco más
          out.forward = dir * 0.12;
        }
      }
      // Garra encendida todo el camino
      out.intake = true;
      return;
    }
    // Con la Crítica: a su rampa y arriba hasta que la punta quede sobre la Repisa
    const lane = this.lane();
    const onTop = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0 && this.side * pos.x < 1.0;
    const st = this.footState(pos, dir);
    const stop = this.critDropX();
    if (!onTop && st === 'away') {
      this.drive(this.foot(), out, true, phase, false, dir < 0);
      return;
    }
    if (!onTop && st === 'turn') {
      out.turn = clamp1(wrap((this.side > 0 ? Math.PI : 0) + (dir < 0 ? Math.PI : 0) - r.phys.heading()) * 2);
      return;
    }
    out.elevator = 4;
    if (this.side * pos.x > stop + 0.02) this.drive({ x: this.side * (stop - 0.05), z: lane }, out, true, phase, true, dir < 0);
    if (onTop && this.side * pos.x <= stop + 0.06) {
      out.forward = 0;
      // Suelta ya quieto: lo que traiga de vuelo se le suma a la pieza y la pasa de la Repisa
      const v = r.phys.body.linvel();
      if (m.atTarget && Math.hypot(v.x, v.z) < 0.08) {
        out.releaseCritical = true;
        this.criticalDone = true;
        this.critParked = true;
        this.critParkX = this.side * pos.x;
        this.mode = 'climb';
      }
    }
  }

  /** Sube a su carril de la Plataforma (D5: basta con estar en la rampa sin tocar la alfombra). */
  private climb(out: BotOutput, phase: Phase): void {
    const r = this.robot;
    const pos = r.phys.position();
    const endgame = phase === 'ENDGAME';
    const lane = this.lane();
    // La garra arriba: en el piso chocaría con la rampa al subir (D34)
    out.elevator = 4;
    // Después de soltar la Crítica se queda donde la soltó (más atrás que 0.75 para que caiga al
    // centro de la Repisa): girar para acomodarse barría la pieza con el mecanismo
    const onTop = r.phys.wheelsOnPlatform > 0 && r.phys.wheelsOnCarpet === 0 && this.side * pos.x < (this.critParked ? 1.0 : 0.75);
    if (onTop) {
      // Soltó lejos de la Repisa con la cola en la rampa: no dejar que se resbale hacia abajo
      if (this.critParked && this.side * pos.x > this.critParkX + 0.04) out.forward = this.critDir * 0.15;
      return;
    }
    const st = this.footState(pos, 1);
    if (st === 'away') this.drive(this.foot(), out, true, phase);
    else if (endgame && st === 'ready') this.drive({ x: this.side * 0.6, z: lane }, out, true, phase, true);
    else out.turn = clamp1(wrap((this.side > 0 ? Math.PI : 0) - r.phys.heading()) * 2);
  }

  /**
   * Al pie de su rampa: 'away' (aún no llega a su carril), 'turn' (llegó pero no apunta a la rampa:
   * entrar chueco deja una rueda en la alfombra, D5) o 'ready'. `dir` −1 si sube de reversa.
   */
  private footState(pos: { x: number; z: number }, dir: number): 'away' | 'turn' | 'ready' {
    const sx = this.side * pos.x;
    const onRamp = sx < F.PLATFORM_LENGTH / 2 + 0.05;
    if (sx > 2.95 || sx < 0.4 || Math.abs(pos.z - this.lane()) > (onRamp ? 0.3 : 0.12)) return 'away';
    const want = (this.side > 0 ? Math.PI : 0) + (dir < 0 ? Math.PI : 0);
    return onRamp || Math.abs(wrap(want - this.robot.phys.heading())) < 0.3 ? 'ready' : 'turn';
  }

  /** Frente al Nivel 3 de la Cámara rival (papel 'block'). */
  private blockPose(): { x: number; z: number } {
    const w = F.camaraWells()[3];
    return F.forAlliance(opponent(this.robot.alliance), { x: (w.x0 + w.x1) / 2, z: F.CAMARA_Z_RED[0] - this.robot.phys.halfL - 0.25 });
  }

  // ------------------------------------------------------------------ manejo
  /** ¿Hay un rival (o cualquier robot, con `any`) a menos de `d` m en esa dirección (+1 adelante, −1 atrás, ±70°)? */
  private rivalNear(dir: number, d: number, any = false): boolean {
    const r = this.robot;
    const pos = r.phys.position();
    const h = r.phys.heading() + (dir < 0 ? Math.PI : 0);
    return this.others.some((o) => {
      if (o === r || (!any && o.alliance === r.alliance)) return false;
      const op = o.phys.position();
      const od = Math.hypot(op.x - pos.x, op.z - pos.z);
      return od < d && Math.abs(wrap(Math.atan2(-(op.z - pos.z), op.x - pos.x) - h)) < 1.2;
    });
  }

  /**
   * Persecución para tanque: gira hacia el punto y avanza según qué tan alineado va. Rodea la
   * Plataforma si el camino la cruza (salvo `allowPlatform`), se desvía de los otros robots y no
   * avanza hacia un rival que tenga enfrente (§4.5: el que se acerca comete la falta). `reverse`
   * maneja de reversa (el mecanismo atrás). `slowDist`: distancia para frenar (por defecto la del punto).
   */
  private drive(goal: { x: number; z: number }, out: BotOutput, precise: boolean, phase: Phase, allowPlatform = false, reverse = false, slowDist?: number, edge = EDGE_CLEAR): void {
    const r = this.robot;
    const pos = r.phys.position();
    let g = goal;
    // Esquivando a otro robot que le cerraba el paso: primero al punto de esquive
    if (this.detour && (allowPlatform || this.detour.t <= 0 || Math.hypot(this.detour.x - pos.x, this.detour.z - pos.z) < 0.2)) this.detour = null;
    if (this.detour) {
      this.detour.t -= 1 / HZ;
      g = this.detour;
    }
    if (!allowPlatform) g = this.avoidPlatform(pos, g);
    g = this.avoidBarrier(pos, g);
    if (phase === 'AUTO') g = { x: this.side > 0 ? Math.max(0.5, g.x) : Math.min(-0.5, g.x), z: g.z };
    g = { x: clamp(g.x, F.HALF_L - edge), z: clamp(g.z, F.HALF_W - edge) };
    let dx = g.x - pos.x;
    let dz = g.z - pos.z;
    const dist = Math.hypot(dx, dz);
    // Desvío de los otros robots (más de los rivales)
    if (dist > 0.05) {
      let ax = dx / dist;
      let az = dz / dist;
      for (const o of this.others) {
        if (o === r) continue;
        const op = o.phys.position();
        const ox = pos.x - op.x;
        const oz = pos.z - op.z;
        const od = Math.hypot(ox, oz);
        const rival = o.alliance !== r.alliance;
        // En la Plataforma cada quien va por su carril: el compañero no estorba
        if (!rival && allowPlatform) continue;
        // Un robot parado (el del jugador sin moverse, uno trabado) no se aparta: más margen, porque
        // con la garra abajo lo empujaría al pasar rozándolo (a la Plataforma o fuera de la cancha)
        const v = o.phys.body.linvel();
        const still = Math.hypot(v.x, v.z) < 0.3;
        const R = rival ? 1.3 : still ? 1.1 : precise ? 0.8 : 1.0;
        if (od > R || od < 1e-3 || od > dist + 0.4) continue;
        // Solo si el otro queda hacia donde va
        const ahead = -(ox * ax + oz * az) / od;
        if (ahead < -0.2) continue;
        const w = ((R - od) / R) * (rival ? 1.8 : still ? 1.5 : 1.0);
        // Empuje lateral (pasar por un lado) más uno hacia atrás
        const tx = -az;
        const tz = ax;
        const sideSign = Math.sign(ox * tx + oz * tz) || 1;
        ax += (tx * sideSign * 0.9 + (ox / od) * 0.4) * w;
        az += (tz * sideSign * 0.9 + (oz / od) * 0.4) * w;
      }
      // Lejos de la orilla: pegado y paralelo a ella ya no puede girar sin sacar una esquina
      if (!precise) {
        const wx = F.HALF_L - Math.abs(pos.x);
        const wz = F.HALF_W - Math.abs(pos.z);
        if (wx < WALL_CLEAR) ax -= Math.sign(pos.x) * ((WALL_CLEAR - wx) / WALL_CLEAR) * 1.5;
        if (wz < WALL_CLEAR) az -= Math.sign(pos.z) * ((WALL_CLEAR - wz) / WALL_CLEAR) * 1.5;
      }
      const n = Math.hypot(ax, az) || 1;
      dx = (ax / n) * dist;
      dz = (az / n) * dist;
      // Cerrado de frente por otro robot (p. ej. su compañero en sentido contrario): los dos se
      // hacen a su derecha, como en la calle
      const ux = (reverse ? -1 : 1) * Math.cos(r.phys.heading());
      const uz = (reverse ? -1 : 1) * -Math.sin(r.phys.heading());
      const blocked = this.others.some((o) => {
        if (o === r) return false;
        const op = o.phys.position();
        const od = Math.hypot(op.x - pos.x, op.z - pos.z);
        return od < 0.95 && od < dist + 0.3 && ((op.x - pos.x) * ux + (op.z - pos.z) * uz) / od > 0.75;
      });
      this.blockT = blocked ? this.blockT + 1 / HZ : Math.max(0, this.blockT - 1 / HZ);
      if (this.blockT > 0.4 && !this.detour && !allowPlatform) {
        this.blockT = 0;
        // A su derecha; si ahí está la Plataforma o la orilla, a su izquierda
        const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
        const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
        for (const k of [1, -1]) {
          const d = { x: pos.x + k * uz * 0.85 + ux * 0.15, z: pos.z - k * ux * 0.85 + uz * 0.15, t: 1.6 };
          const ok = Math.abs(d.x) < F.HALF_L - 0.9 && Math.abs(d.z) < F.HALF_W - 0.9 && !(Math.abs(d.x) < hx && Math.abs(d.z) < hz) && !nearCamara(d, 0.5) && !inCampana(r.alliance, d) && !inCampana(opponent(r.alliance), d);
          if (ok) {
            this.detour = d;
            break;
          }
        }
      }
    }
    // Junto a la Plataforma (antes del ENDGAME no se puede ni rozar) sale de reversa si le queda atrás
    if (!allowPlatform && !reverse && Math.abs(pos.x) < F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR && Math.abs(pos.z) < F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR) {
      if (Math.abs(wrap(Math.atan2(-dz, dx) - r.phys.heading())) > Math.PI / 2 + 0.2) reverse = true;
    }
    const want = Math.atan2(-dz, dx) + (reverse ? Math.PI : 0);
    const err = wrap(want - r.phys.heading());
    out.turn = clamp1(err * 2.2);
    const align = Math.max(0, Math.cos(err));
    const sd = slowDist ?? dist;
    const f = align * align * Math.min(1, sd / (precise ? 0.6 : 0.35)) * (precise ? 0.8 : 1);
    out.forward = (reverse ? -1 : 1) * Math.max(f, sd > 0.05 && align > 0.9 ? 0.12 : 0);
    // Rival enfrente y cerca (en el sentido de avance): no avanzar hacia él
    if (this.rivalNear(reverse ? -1 : 1, 1.0)) out.forward = 0;
    else if (this.rivalNear(reverse ? -1 : 1, 1.4)) out.forward *= 0.4;
    // Atorado: si en 2.5 s no se acercó 0.15 m al objetivo, retrocede girando y (si iba por una
    // Muestra) la ignora un rato
    if (!this.lastGoal || Math.hypot(goal.x - this.lastGoal.x, goal.z - this.lastGoal.z) > 0.3) {
      this.bestDist = Infinity;
      this.progressT = 0;
    }
    this.lastGoal = goal;
    this.progressT += 1 / HZ;
    const gd = Math.hypot(goal.x - pos.x, goal.z - pos.z);
    if (gd < this.bestDist - 0.15) {
      this.bestDist = gd;
      this.progressT = 0;
    }
    if (this.progressT > 2.5 && gd > 0.15) {
      this.progressT = 0;
      this.bestDist = Infinity;
      this.backOff = 0.6;
      this.backDir = reverse ? 1 : -1;
      if (this.mode === 'collect' && this.targetPiece >= 0) this.ignore.set(this.targetPiece, 8);
      this.targetPiece = -1;
    }
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
    // Margen a la orilla (m); 0 al despegarse de un rincón (usa lo que le queda, sin salirse)
    let edge = 0.03;
    const invasion = (f: number, t: number, plat = !platformOk, withEdge = edge >= 0): number => {
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
        if (withEdge) v += Math.max(0, Math.abs(x) - (F.HALF_L - edge)) + Math.max(0, Math.abs(z) - (F.HALF_W - edge));
        if (plat) v += Math.max(0, Math.min(px - Math.abs(x), pz - Math.abs(z)));
      }
      return v;
    };
    const base = invasion(out.forward, out.turn);
    // Ya dentro del margen de la Plataforma (lejos de la orilla): vale todo lo que no lo empeore
    const edgeOk = invasion(out.forward, out.turn, false) <= 1e-6;
    if (base <= 1e-6 || (edgeOk && base <= invasion(0, 0) + 1e-6)) {
      this.guardT = Math.max(0, this.guardT - 2 / HZ);
      return;
    }
    // Acorralado (paralelo a la orilla o a la Plataforma): cualquier giro saca una esquina y el filtro
    // lo deja yendo y viniendo. Tras 1.5 s seguidos, 0.4 s con su mando si no empeora nada.
    this.guardT += 1 / HZ;
    if (this.guardT > 1.5) {
      if (this.guardT > 1.9) this.guardT = 0;
      // Sigue sin salirse ni pisar la Plataforma (§4.6), pero usa todo el margen
      edge = 0.004;
      if (invasion(out.forward, out.turn) <= invasion(0, 0) + 1e-6) return;
    }
    // Alternativas: de todas las que menos invaden, la más parecida a su mando (giros cortos
    // incluidos: así se despega de una orilla poco a poco en lugar de quedarse quieto)
    const options: Array<[number, number]> = [[0, out.turn], [out.forward, 0], [0, 0]];
    for (const f of [-0.5, -0.3, 0, 0.3, 0.5]) for (const t of [-1, -0.6, -0.15, 0, 0.15, 0.6, 1]) options.push([f, t]);
    let best: [number, number] = [out.forward, out.turn];
    let bestV = invasion(out.forward, out.turn);
    let bestD = 0;
    for (const o of options) {
      const v = invasion(o[0], o[1]);
      const d = Math.hypot(o[0] - out.forward, (o[1] - out.turn) * 0.5);
      if (v < bestV - 1e-6 || (v <= bestV + 1e-6 && d < bestD)) {
        best = o;
        bestV = v;
        bestD = d;
      }
    }
    [out.forward, out.turn] = best;
  }

  /**
   * Barra lateral de cada Campana (§3.2.4: "obliga a los robots a dar la vuelta"): si la recta la
   * cruza, primero a la punta de la barra, del lado del objetivo.
   */
  private avoidBarrier(pos: { x: number; z: number }, goal: { x: number; z: number }): { x: number; z: number } {
    const bx = F.HALF_L - F.CAMPANA_LENGTH - F.BARRIER_WIDTH / 2; // ≈ 2.47 (rojo)
    const tip = -F.HALF_W + F.BARRIER_LENGTH; // ≈ −2.25
    const e = 0.45;
    for (const a of ['red', 'blue'] as const) {
      // Al marco del rojo
      const p = F.forAlliance(a, pos);
      const q = F.forAlliance(a, goal);
      const cx = bx;
      const hx = F.BARRIER_WIDTH / 2 + e;
      const z0 = -F.HALF_W - 1;
      const z1 = tip + e;
      // Rectángulo |x − cx| ≤ hx, z ∈ [z0, z1] → centrado para segmentHitsRect
      const mz = (z0 + z1) / 2;
      const hz = (z1 - z0) / 2;
      if (!segmentHitsRect(p.x - cx, p.z - mz, q.x - cx, q.z - mz, hx, hz)) continue;
      if (Math.abs(p.x - cx) <= hx && p.z <= z1) continue; // ya pegado a la barra: que lo saque el filtro
      const wp = { x: q.x > cx ? cx + hx + 0.15 : cx - hx - 0.15, z: z1 + 0.25 };
      return F.forAlliance(a, wp);
    }
    return goal;
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
    // Dentro del margen: primero salir hacia afuera (sin rozar la Plataforma)
    if (Math.abs(pos.x) < hx && Math.abs(pos.z) < hz) {
      const outX = (Math.abs(pos.x) - F.PLATFORM_LENGTH / 2) / PLATFORM_CLEAR;
      const outZ = (Math.abs(pos.z) - F.PLATFORM_WIDTH / 2) / PLATFORM_CLEAR;
      if (outX > outZ) return { x: Math.sign(pos.x) * cx, z: pos.z };
      return { x: pos.x, z: sz * cz };
    }
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

/** Zonas de anotación rivales que no puede obstruir más de 3 s (§4.6, D17), por alianza propia. */
const RIVAL_ZONES: Record<Alliance, F.Rect[]> = { red: obstructZones('blue'), blue: obstructZones('red') };

/** Las dos Cámaras (§3.2.3) con 15 cm de margen: la garra y la pieza que lleva sobresalen de su punta. */
const CAMARAS: readonly F.Rect[] = (['red', 'blue'] as const).map((a) =>
  F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH - 0.15, x1: F.CAMARA_X_END_RED + 0.15, z0: F.CAMARA_Z_RED[0] - 0.15, z1: F.HALF_W }),
);

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

/** ¿El punto queda a menos de `m` metros de la caja de alguna Cámara? (ahí un robot se atora) */
function nearCamara(p: { x: number; z: number }, m: number): boolean {
  return (['red', 'blue'] as const).some((a) =>
    F.inRect(F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH - m, x1: F.CAMARA_X_END_RED + m, z0: F.CAMARA_Z_RED[0] - m, z1: F.HALF_W }), p.x, p.z),
  );
}

/** ¿El punto queda a menos de `m` metros de la barra de obstáculo de alguna Campana (§3.2.4)? */
function nearBarrier(p: { x: number; z: number }, m: number): boolean {
  return (['red', 'blue'] as const).some((a) => {
    const q = F.forAlliance(a, p);
    const x0 = F.CAMPANA_X_RED[0] - F.BARRIER_WIDTH;
    return q.x > x0 - m && q.x < F.CAMPANA_X_RED[0] + m && q.z < -F.HALF_W + F.BARRIER_LENGTH + m;
  });
}

/** ¿El punto está en el pasillo de la Campana de esa alianza (entre su barra y la pared)? */
function inCampana(a: Alliance, p: { x: number; z: number }): boolean {
  const q = F.forAlliance(a, p);
  return q.x > F.HALF_L - F.CAMPANA_LENGTH - 0.3 && q.z < -F.HALF_W + F.BARRIER_LENGTH + 0.4;
}
