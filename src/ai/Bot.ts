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
 * - No empuja a nadie (`noPush`): si toca a otro robot por donde va (rival, su compañero o el del
 *   jugador, aunque esté dañado y no se mueva) no avanza hacia él; si sigue cerrado, retrocede, le deja
 *   más espacio un rato y busca otro camino u otra Muestra. Tampoco se pelea una Muestra que otro
 *   robot tiene encima ni la Campana si otro la ocupa.
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
import { canHoldCritical, canTakeCriticalFromHolder, critSeat, intakeOf, posAngle, posDir, posScoreTip, type ElevatorPos } from '../config/robot';
import type { Phase } from '../core/clock';
import { DAMAGE } from '../core/damage';
import { rng } from '../core/rng';
import { opponent, type Alliance, type Level } from '../core/types';
import { cubePose } from '../game/Mechanisms';
import { obstructZones } from '../referee/Referee';
import type { Robot } from '../game/Robot';
import type { Piece, Pieces } from '../physics/Pieces';
import { clawDir, floorPoseOf } from '../physics/RobotPhysics';
import { pushTouch, touches } from './contact';
import { planPath } from './grid';
import { AI_LEVELS, AI_PROFILES, type AiLevel, type AiProfile } from './difficulty';
import { applyPersona, type AiPersona } from './persona';
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
  /**
   * Pulsación del botón de una garra de pinza con interruptor (Axiom): cierra o abre, como el control de una persona
   * (`Mechanisms.toggleClaw`). La IA juega con el mismo mando que tú, no con un agarre más difícil.
   */
  clawToggle?: boolean;
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
/** Distancia (m) a la orilla de la Plataforma dentro de la cual la IA se aparta de ella antes del ENDGAME (§4.6). */
const PLATFORM_GUARD = 0.75;
/** Centro del robot a no menos de esto de los bordes (sus objetivos se recortan aquí). */
const EDGE_CLEAR = 0.55;
/** Distancia (m, al centro) a la que empieza a alejarse de la orilla al manejar: media diagonal + algo. */
const WALL_CLEAR = 0.6;
/** Pasos de física por segundo (para contar intentos). */
const HZ = 120;
/** Segundos para subir la rampa desde su pie y quedar sobre la Plataforma (medido). */
const CLIMB_TIME = 2.2;
/** Separación (m) entre contornos a la que cuenta como tocar a otro robot (`noPush`). */
const CONTACT_GAP = 0.04;
/**
 * Segundos que espera pegado a otro robot (sin empujarlo) antes de echarse para atrás y replanear, y
 * cuánto retrocede. SUPUESTOS de diseño: el manual cobra el contacto con un rival (§4.5) y el pinning
 * sin dar duración (D11); el árbitro del sim cobra pinning a los 3 s.
 */
const PUSH_PATIENCE = 0.6;
const YIELD_TIME = 0.5;
/** Segundos que le deja más espacio a un robot con el que se trabó. */
const WARY_TIME = 6;
/** Segundos de más (sobre lo que tarda en llegar) para tomar la Muestra que persigue antes de dejarla. */
const TARGET_SLACK = 6;
/** Segundos extra de una Muestra de la franja de su compañero (`laneCost`). */
const LANE_COST = 1.5;

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
  /** Personalidad (`ai/persona.ts`): estilo de juego encima de la dificultad; no cambia las reglas ni los filtros de faltas. */
  persona?: AiPersona;
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
  /** Azar reproducible de este robot (dudas, error de puntería): mismos matches, mismos resultados. */
  private readonly rand: () => number;
  /** Error de puntería de la Muestra que persigue (rad) y cuánto lleva otra candidata esperando para sustituirla. */
  private aimBias = 0;
  private switchT = 0;
  private switchTo = -1;
  /** Muestras que traía el paso anterior (para pausar un momento al recoger una). */
  private lastStored = 0;
  private backOff = 0;
  /** Hacia dónde se aparta al atorarse: al revés de como iba (−1 si iba de frente, +1 si de reversa). */
  private backDir = -1;
  private bestDist = Infinity;
  private progressT = 0;
  private lastGoal: { x: number; z: number } | null = null;
  /** Muestras que dejó por imposibles (índice → segundos que faltan). */
  private ignore = new Map<number, number>();
  /** Veces que no pudo tomar cada Muestra (y dónde estaba): la que sigue en el mismo lugar se deja cada vez más tiempo. */
  private pieceFails = new Map<number, { n: number; x: number; z: number }>();
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
  /** Veces (segundos de vida) que salió del embudo de la Cámara o la Campana mientras se alineaba (`dock`). */
  private dockFlips: number[] = [];
  /** Giro al apartarse (`backOff`): 0.6 al atorarse, 0 para salir derecho de una pared. */
  private backTurn = 0.6;
  /** Segundos de vida en que empezó a estar casi quieto mandando moverse (vigilante de giros en su lugar). */
  private stillSince = -1;
  private stillAt = { x: 0, z: 0 };
  /** Segundos alineándose o arrimándose sin terminar (atorado contra algo). */
  private dockT = 0;
  /** En `dock`, ya arrimándose (no solo alineándose), y cuánto lleva sin avanzar así. */
  private creeping = false;
  private creepStallT = 0;
  /** Último `timeLeft` visto (reloj para que el `Team` sepa si sigue activo). */
  clock = Infinity;
  private phase: Phase = 'PRE';
  private guardT = 0;
  /** Segundos pegado a otro robot queriendo avanzar hacia él, y la maniobra para despegarse. */
  private pushT = 0;
  private yieldT = 0;
  private yieldDir = -1;
  /** Robots con los que se trabó hace poco (índice → segundos): les deja más espacio. */
  private wary = new Map<number, number>();
  /** Veces seguidas que se tuvo que hacer para atrás, y segundos sin tocar a nadie desde la última. */
  private yields = 0;
  private clearT = 0;
  /** Plan que dejó porque otro robot le cierra el paso (p. ej. la Campana) y por cuántos segundos. */
  private giveUp: { mode: Mode; t: number } | null = null;
  /** Segundos que sigue rodeando por la rejilla (`planPath`) tras toparse, y el punto al que va. */
  private planT = 0;
  /** Niveles de la Cámara que dejó de intentar (se atascó al arrimarse o están tapados) y hasta cuándo (s de vida del Bot, `age`). */
  private badLevels = new Map<Level, number>();
  private lastLevel: Level = 3;
  private age = 0;
  private failsAt = new Map<Level, number>();
  private dockFails = 0;
  /** Vigilante de avance: ventana de 5 s con la posición de inicio, lo recorrido y cuántas ventanas seguidas sin avanzar. */
  private wd = { t: 0, x: 0, z: 0, len: 0, lx: 0, lz: 0, bad: 0 };
  private planCd = 0;
  private pathWp: { x: number; z: number } | null = null;
  /** Segundos esperando a que se abra el paso (no hay camino libre a su objetivo). */
  pathWaitT = 0;
  /** Segundos detenido por un robot enfrente (sin tocarlo). */
  private holdT = 0;
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
    this.profile = applyPersona(AI_PROFILES[this.opts.ai], this.opts.persona);
    this.rand = rng(0x5eed + robot.index * 7919 + AI_LEVELS.indexOf(this.opts.ai) * 104729);
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
    // Una garra que no abre 20 cm no toma la Crítica (§4.1.1); el constructor de robots lo permite
    if (!canHoldCritical(this.robot.spec)) return false;
    // La IA solo la busca en la rendija de la Campana: un robot que la toma solo del piso (Axiom) no la intenta
    if (!canTakeCriticalFromHolder(this.robot.spec)) return false;
    if (this.opts.endgame === 'critical') return true;
    if (this.opts.endgame !== undefined) return false;
    return this.team.critBy === this.robot.index;
  }

  /** ¿Sube a la Plataforma en el ENDGAME? */
  private get climbs(): boolean {
    if (this.opts.endgame === 'none') return false;
    if (this.opts.endgame !== undefined || this.opts.role !== 'score' || !this.profile.teamwork) return true;
    // El estratega decide si le conviene subir (`Team.climbWorth`); se decide una vez, a 40 s del final, y se mantiene
    if (this.climbChoice === null) {
      if (this.clock > 40) return true;
      const t = this.eta(this.scoringPose(this.level), this.foot()) + CLIMB_TIME + this.climbMargin();
      this.climbChoice = this.team.climbWorth(this, t);
    }
    return this.climbChoice;
  }

  /** Si sube a la Plataforma (lo decide el estratega a 40 s del final; null = aún no). */
  private climbChoice: boolean | null = null;

  /** Puntos de Muestras que anotó (tiros que sí entraron) y cuándo (s de vida), para medir su ritmo. */
  private scoredLog: Array<{ t: number; pts: number }> = [];

  /**
   * Puntos por segundo que está anotando en este match (ventana de 45 s), sobre una idea inicial por lo que tarda un
   * ciclo de su Cámara al Laboratorio y de regreso. El estratega lo usa para decidir si conviene la Crítica, la
   * Plataforma o seguir anotando.
   */
  pointsPerSecond(): number {
    const W = 45;
    const recent = this.scoredLog.filter((e) => this.age - e.t < W);
    const sum = recent.reduce((a, e) => a + e.pts, 0);
    const span = Math.min(W, Math.max(0, this.age - GAME.times.auto));
    const home = this.scoringPose(3);
    const lab = F.forAlliance(this.robot.alliance, { x: -0.96, z: -1.9 });
    const n = Math.min(2, this.robot.mech.capacity);
    const cycle = 2 * this.eta(home, lab) + 2.5;
    const prior = (GAME.points.sampleTeleop[3] * this.levelOdds(3) * n) / Math.max(3, cycle * (1 + 0.3 * (n - 1)));
    const K = 20;
    return (sum + prior * K) / (span + K);
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
    const z = Math.min((w.z0 + w.z1) / 2 - this.tipDistance(level), F.CAMARA_Z_RED[0] - hl - 0.015);
    const spread = (w.x1 - w.x0) / 2 - 0.14;
    const dx = [0, -1, 1, -0.5, 0.5][this.visits % 5] * spread;
    const p = F.forCamara(this.robot.alliance, { x: (w.x0 + w.x1) / 2 + dx, z });
    const back = posDir(this.robot.spec, level) < 0 ? Math.PI : 0;
    return { ...p, heading: wrap(F.camaraHeading(this.robot.alliance) + back) };
  }

  /** +1 si recoge del piso al frente, −1 si atrás (llega a la Muestra de reversa, `ArmSpec.pickBack`). */
  private get pickDir(): number {
    return posDir(this.robot.spec, 0);
  }

  /** Distancia (centro del robot → centro de la Muestra al soltarla) en ese nivel. */
  private tipDistance(level: Level): number {
    // Lanzador (Phoenix): tira desde `range` m del centro del pozo (en vez de arrimarse a la pared)
    const shooter = this.robot.spec.intake?.shooter;
    if (shooter) return shooter.range + (shooter.muzzle?.x ?? Math.abs(posScoreTip(this.robot.spec, level).x));
    return Math.abs(posScoreTip(this.robot.spec, level).x);
  }

  /** `timeLeft`: segundos para el final del match (para calcular el AUTO y el ENDGAME). */
  step(dt: number, phase: Phase, timeLeft = Infinity): BotOutput {
    this.clock = timeLeft;
    this.age += dt;
    this.watchShots(dt);
    for (const h of this.team.humans()) {
      const v = h.phys.body.linvel();
      this.humanStill.set(h.index, Math.hypot(v.x, v.z) < 0.1 ? (this.humanStill.get(h.index) ?? 0) + dt : 0);
    }
    this.phase = phase;
    this.applyPlan(phase, timeLeft);
    this.team.tick(dt, this);
    const out = this.decide(dt, phase, timeLeft);
    this.unhook(out);
    this.unjam(out, dt);
    this.untilt(out, dt);
    // El brazo topó con la madera al girar (`Mechanisms.armBlocked`): se aleja del lado de la garra
    // para que libre (con la viga chocando, pegado a la Cámara el brazo no pasa de N1)
    // (si ahí tiene a otro robot no lo empuja: sigue su camino y el brazo libra después)
    const m = this.robot.mech;
    if (m.armBlocked && this.freeT <= 0 && !pushTouch(this.robot, -clawDir(m.angle, this.robot.spec.arm), touches(this.robot, this.others, CONTACT_GAP))) {
      out.forward = -clawDir(m.angle, this.robot.spec.arm) * 0.4;
      out.turn = 0;
    }
    this.noPush(out, dt);
    this.humanize(out, dt);
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

  /** Mandos que mandó en el paso anterior (ya suavizados), para limitar qué tan rápido cambian. */
  private cmdF = 0;
  private cmdT = 0;

  /**
   * Manejo de piloto, no de máquina: (1) suelta el acelerador al acercarse a otro robot por donde va
   * (llega despacio en vez de frenar hasta tocarlo; al compañero le da más espacio y el de índice
   * mayor cede primero), y (2) el avance y el giro suben con rampa (`profile.ramp`, `turnRamp`) y
   * bajan más rápido, como un stick que se mueve a mano. Si `noPush` lo detuvo o se está echando para
   * atrás, no hay rampa (frenar a tiempo es lo que evita el golpe). SUPUESTOS de diseño.
   */
  private humanize(out: BotOutput, dt: number): void {
    const p = this.profile;
    if (this.yieldT > 0 || (out.forward === 0 && out.turn === 0)) {
      this.cmdF = out.forward;
      this.cmdT = out.turn;
      return;
    }
    if (p.courtesy > 0 && Math.abs(out.forward) > 0.05) {
      const reach = p.courtesy;
      const k = this.robot.phys.halfW + 0.35;
      for (const t of touches(this.robot, this.others, reach + 0.3)) {
        const ahead = out.forward > 0 ? t.lx > 0 : t.lx < 0;
        if (!ahead || Math.abs(t.lz) > k) continue;
        const mate = t.other.alliance === this.robot.alliance;
        // Al robot de la persona de su alianza siempre le cede el paso (y con más espacio)
        const human = mate && this.team.humans().includes(t.other);
        const zone = reach + (human ? 0.45 : (mate ? 0.3 : 0.1) * (this.robot.index > t.other.index || !mate ? 1 : 0));
        const f = Math.max(0.3, Math.min(1, (t.gap - CONTACT_GAP) / (zone - CONTACT_GAP)));
        out.forward *= f;
      }
    }
    const step = (cur: number, want: number, ramp: number): number => {
      // Subir (mismo signo, más magnitud) con rampa; bajar o invertir, 3 veces más rápido
      const grows = Math.abs(want) > Math.abs(cur) && want * cur >= 0;
      const rate = (grows ? 1 : 3) / Math.max(0.05, ramp);
      return cur + Math.max(-rate * dt, Math.min(rate * dt, want - cur));
    };
    // En AUTO (15 s, cada décima cuenta, §4.4) solo frena al acercarse; la rampa es del TELEOP
    const r = this.phase === 'AUTO' ? 0.05 : 1;
    this.cmdF = step(this.cmdF, out.forward, p.ramp * r);
    this.cmdT = step(this.cmdT, out.turn, p.turnRamp * r);
    out.forward = this.cmdF;
    out.turn = this.cmdT;
  }

  /**
   * No empujar a otro robot. Con un rival, el contacto y el pinning son Foul (§4.5) y en su zona Tech
   * Foul (§4.6); con su compañero o un robot dañado el manual no dice nada (SUPUESTO: tampoco), pero
   * empujarlo lo arrima a la Plataforma o fuera de la cancha y los golpes dañan (D36). Si lo toca por
   * donde va, no avanza hacia él (puede girar y seguir por un lado); si en `PUSH_PATIENCE` s sigue
   * cerrado, retrocede derecho, le deja más espacio un rato (`wary`) y suelta la Muestra que perseguía
   * para buscar otra o rodearlo.
   */
  private noPush(out: BotOutput, dt: number): void {
    for (const [i, t] of this.wary) if (t - dt <= 0) this.wary.delete(i);
    else this.wary.set(i, t - dt);
    const list = touches(this.robot, this.others, CONTACT_GAP);
    if (this.yieldT > 0) {
      this.yieldT -= dt;
      // Derecho (girar pegado a otro lo barre); si también tiene a alguien atrás, quieto
      out.forward = pushTouch(this.robot, this.yieldDir, list) ? 0 : this.yieldDir * 0.4;
      out.turn = 0;
      return;
    }
    if (this.giveUp && (this.giveUp.t -= dt) <= 0) this.giveUp = null;
    const hit = pushTouch(this.robot, out.forward, list);
    if (!hit) {
      this.pushT = Math.max(0, this.pushT - dt);
      this.clearT += dt;
      if (this.clearT > 3) this.yields = 0;
      return;
    }
    this.clearT = 0;
    out.forward = 0;
    this.pushT += dt;
    // Sobre la Plataforma en el ENDGAME no se aparta de reversa (se bajaba de la rampa): el brazo del rival de su
    // carril llega a tocar el suyo sobre la Repisa; se queda quieto
    const r0 = this.robot.phys;
    if (this.pushT < PUSH_PATIENCE || (this.phase === 'ENDGAME' && r0.wheelsOnPlatform > 0 && r0.wheelsOnCarpet === 0)) return;
    this.pushT = 0;
    this.yieldT = YIELD_TIME;
    this.yieldDir = hit.lx > 0 ? -1 : 1;
    this.wary.set(hit.other.index, WARY_TIME);
    if (this.targetPiece >= 0) this.ignore.set(this.targetPiece, WARY_TIME);
    this.targetPiece = -1;
    this.dockT = 0;
    this.detour = null;
    this.lastGoal = null;
    // Al volver, rodea por donde sí cabe (camino en la rejilla con los robots como obstáculos)
    this.planT = 4;
    this.planCd = 0;
    // Ya se hizo para atrás y volvió a toparse: ese camino está cerrado, cambia de plan un rato
    // (la Campana o el Nivel ocupados: junta en otro lado; recolectando ya soltó la Muestra)
    if (++this.yields >= 2) {
      this.yields = 0;
      if (this.mode === 'hp' || this.mode === 'score') this.giveUp = { mode: this.mode, t: 8 };
      if (this.mode === 'score') this.lockedLevel = null;
    }
  }

  /**
   * Siguiente punto (≈0.9 m adelante) de un camino en la rejilla de `pos` a `goal` que rodea a los
   * otros robots, la Plataforma (antes del ENDGAME no se pisa, §4.6), las Cámaras y las barras de las
   * Campanas, sin sacar una esquina de la cancha ni (en AUTO) cruzar la línea central (§4.2).
   */
  private pathWaypoint(pos: { x: number; z: number }, goal: { x: number; z: number }, phase: Phase): { x: number; z: number } | null {
    const robots = this.others
      .filter((o) => o !== this.robot)
      .map((o) => {
        const q = o.phys.position();
        // Con un robot pegado, su disco no tapa el punto de salida (si no, no hay camino)
        return { x: q.x, z: q.z, R: Math.min(0.64 + (this.isWary(o) ? 0.08 : 0) + (o.alliance === this.robot.alliance ? 0.1 : 0), Math.hypot(q.x - pos.x, q.z - pos.z) - 0.05) };
      });
    // Casi todo el margen que el manejo normal no pisa (`PLATFORM_CLEAR`): media diagonal del chasis
    // y algo, para que a toda velocidad y girando no la roce (§4.6)
    const px = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR - 0.1;
    const pz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR - 0.1;
    const mx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const mz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    const zones = RIVAL_ZONES[this.robot.alliance];
    const cost = (p: { x: number; z: number }): number => {
      if (Math.abs(p.x) > F.HALF_L - 0.38 || Math.abs(p.z) > F.HALF_W - 0.38) return Infinity;
      const nearStart = Math.hypot(p.x - pos.x, p.z - pos.z) < 0.3;
      if (!nearStart && ((Math.abs(p.x) < px && Math.abs(p.z) < pz) || nearCamara(p, 0.38) || nearBarrier(p, 0.38))) return Infinity;
      let c = 1;
      for (const o of robots) {
        const d = Math.hypot(p.x - o.x, p.z - o.z);
        if (d < o.R) return Infinity;
        if (d < o.R + 0.4) c += (2 * (o.R + 0.4 - d)) / 0.4;
      }
      if (Math.abs(p.x) < mx && Math.abs(p.z) < mz) c += 3;
      if (phase !== 'AUTO' && zones.some((z) => F.inRect(z, p.x, p.z))) c += 2;
      return c;
    };
    const { path, reached } = planPath(pos, goal, cost, { halfL: F.HALF_L, halfW: F.HALF_W, cell: 0.15 });
    if (!reached && Math.hypot(goal.x - pos.x, goal.z - pos.z) > 1.0) {
      // No hay por dónde: espera (sigue buscando) un rato; si no se abre, cambia de plan
      this.planT = Math.max(this.planT, 0.5);
      this.pathWaitT += 0.25;
      // Su compañero de IA también espera (cada uno le tapa el paso al otro): cede el de índice mayor, y en el ENDGAME
      // no se espera 5 s (con la Crítica en la garra se quedaban los dos parados)
      // (el que va por la Crítica o a la Plataforma tiene preferencia: el otro se aparta)
      const prio = (b: Bot) => b.mode === 'critical' || b.mode === 'climb';
      const outranks = (b: Bot) => (prio(b) && !prio(this)) || (prio(b) === prio(this) && b.robot.index < this.robot.index);
      const mateWaits = this.team.members.some((b) => b !== this && (b.pathWaitT > 0.5 || prio(b)) && outranks(b));
      // Por una Muestra no vale esperar parado (quieto en medio estorba, Xhavi 22-nov): a los 1.5 s busca otra
      if (this.pathWaitT > (mateWaits ? 1 : this.mode === 'collect' ? 1.5 : phase === 'ENDGAME' ? 2 : 4)) {
        this.pathWaitT = 0;
        this.planT = 0;
        if (this.mode === 'hp' || this.mode === 'score') this.giveUp = { mode: this.mode, t: 8 };
        if (this.targetPiece >= 0) this.shun(this.targetPiece, WARY_TIME);
        this.targetPiece = -1;
        return null;
      }
      return WAIT;
    }
    this.pathWaitT = 0;
    if (!path.length) return null;
    // Mientras la recta a su objetivo siga tapada por un robot, sigue el rodeo (si no, al acabar
    // `planT` volvería a la recta y se toparía otra vez)
    if (robots.some((o) => segPointDist(pos, goal, o) < 0.75)) this.planT = Math.max(this.planT, 1);
    let len = 0;
    let prev = pos;
    for (const q of path) {
      len += Math.hypot(q.x - prev.x, q.z - prev.z);
      prev = q;
      if (len >= 0.9) return q;
    }
    return path[path.length - 1];
  }

  /** ¿Se trabó hace poco con ese robot? */
  private isWary(o: Robot): boolean {
    return this.wary.has(o.index);
  }

  /**
   * La garra choca con la madera (D34): si está arriba de una Cámara (acaba de anotar) y el plan pide
   * bajarla, al girar hacia abajo se engancharía detrás de la pared. Primero se aparta derecho con la
   * garra en alto y la baja cuando ya quedó afuera.
   */
  private unhook(out: BotOutput): void {
    const m = this.robot.mech;
    const s = this.robot.spec;
    if (posScoreTip(s, out.elevator).y >= m.height - 0.05) return;
    const tipX = m.tipX();
    const tip = this.robot.phys.localToWorld(tipX, 0, 0);
    if (!CAMARAS.some((c) => F.inRect(c, tip.x, tip.z))) return;
    out.elevator = m.target;
    out.forward = -Math.sign(tipX || 1) * 0.45;
    out.turn = 0;
  }

  /**
   * Se está subiendo a algo en la alfombra (una Muestra bajo el chasis o los dedos): más de 6° de
   * inclinación fuera de la Plataforma. Deja de girar y se aparta 0.4 s al revés de como iba (girar encima la empujaba más
   * adentro y el robot llegaba a 22°).
   */
  private untilt(out: BotOutput, dt: number): void {
    const p = this.robot.phys;
    if (this.tiltT > 0) {
      this.tiltT -= dt;
      out.forward = this.tiltDir * 0.35;
      out.turn = 0;
      return;
    }
    if (p.wheelsOnPlatform > 0 || p.tilt() < 0.105) return;
    // Con la punta de la garra dentro de una Cámara lo inclina el brazo sobre la pared. Arrimándose para anotar eso lo
    // resuelven `unhook` y `dock`; de paso (girando junto a la Cámara con el brazo en alto se subía a 22°), se aparta
    // de la pared derecho, del lado contrario a la garra
    const tipX = this.robot.mech.tipX();
    const tip = p.localToWorld(tipX, 0, 0);
    if (CAMARAS.some((c) => F.inRect(c, tip.x, tip.z))) {
      if (this.dockT > 0) return;
      this.tiltT = 0.4;
      this.tiltDir = -Math.sign(tipX || 1);
      out.forward = this.tiltDir * 0.35;
      out.turn = 0;
      return;
    }
    // Hacia dónde se levanta: con la nariz arriba (subiéndose a algo al frente) se hace para atrás, y al revés.
    // De lado (rodó sobre una pieza) se aparta al revés de como iba
    const q = p.body.rotation();
    const noseUp = 2 * (q.x * q.y + q.w * q.z);
    this.tiltT = 0.4;
    this.tiltDir = noseUp > 0.07 ? -1 : noseUp < -0.07 ? 1 : p.lastCmd.forward > 0.05 ? -1 : p.lastCmd.forward < -0.05 ? 1 : -this.pickDir;
    out.forward = this.tiltDir * 0.35;
    out.turn = 0;
  }

  private tiltT = 0;
  private tiltDir = -1;

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
      // Trabado yendo por una Muestra (pegada a una pared o a la Cámara): la deja un rato
      if (this.mode === 'collect' && this.targetPiece >= 0) {
        this.shun(this.targetPiece, WARY_TIME);
        this.targetPiece = -1;
      }
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
    return this.eta(p, this.foot()) + CLIMB_TIME + this.climbMargin();
  }

  // ------------------------------------------------------------------ decisión
  /**
   * Si en 5 s de trabajo (recolectar, anotar, Human Player, Crítica) recorrió más de 3 m pero no se
   * alejó ni 1 m de donde estaba, anda dando vueltas sin llegar (un robot parado le tapa el paso, una
   * esquina…): rodea por la rejilla, que ve a los otros robots; si sigue igual, cambia de plan.
   */
  private progressWatch(dt: number, phase: Phase): void {
    const w = this.wd;
    const pos = this.robot.phys.position();
    if (w.t === 0) {
      w.x = pos.x;
      w.z = pos.z;
      w.lx = pos.x;
      w.lz = pos.z;
      w.len = 0;
    }
    w.len += Math.hypot(pos.x - w.lx, pos.z - w.lz);
    w.lx = pos.x;
    w.lz = pos.z;
    w.t += dt;
    const working = phase !== 'AUTO' && (this.mode === 'collect' || this.mode === 'score' || this.mode === 'hp' || this.mode === 'critical');
    // Esperas con sentido: frente a la ranura del Human Player o arrimándose a la Cámara
    const waiting = this.hpWait > 0.3 || this.dockT > 0.3 || this.pause > 0;
    if (!working || waiting) {
      w.t = 0;
      w.bad = 0;
      return;
    }
    // Girando en su lugar (mandos sin avanzar) 3 s seguidos sin alejarse ni 25 cm: lo que perseguía no se deja tomar
    // desde ahí (una Muestra pegada a una pared, a la Cámara, a otro robot): la deja y busca otra cosa. Antes podía
    // quedarse así hasta 15 s (medido en la arena)
    const c = this.robot.phys.lastCmd;
    const commanding = Math.abs(c.forward) > 0.05 || Math.abs(c.turn) > 0.3;
    if (commanding && !this.robot.mech.critical) {
      if (this.stillSince < 0 || Math.hypot(pos.x - this.stillAt.x, pos.z - this.stillAt.z) > 0.25) {
        this.stillSince = this.age;
        this.stillAt = { x: pos.x, z: pos.z };
      } else if (this.age - this.stillSince > 3) {
        this.stillSince = -1;
        if (this.targetPiece >= 0) this.shun(this.targetPiece, WARY_TIME);
        this.targetPiece = -1;
        if (this.mode === 'score') {
          this.dockFails++;
          this.lockedLevel = null;
        }
        this.backOff = 0.6;
        this.backDir = this.robot.phys.lastCmd.forward > 0 ? -1 : 1;
      }
    } else this.stillSince = -1;
    if (w.t < 5) return;
    const moved = Math.hypot(pos.x - w.x, pos.z - w.z);
    w.t = 0;
    if (moved > 1.0 || w.len < 3) {
      w.bad = 0;
      return;
    }
    w.bad++;
    // Anotando y sin llegar: el nivel que intentaba está tapado, prueba otro
    this.planT = Math.max(this.planT, 6);
    if (w.bad >= 2) {
      w.bad = 0;
      if (this.mode === 'hp' || this.mode === 'score') this.giveUp = { mode: this.mode, t: 8 };
      if (this.targetPiece >= 0) this.shun(this.targetPiece, WARY_TIME);
      this.targetPiece = -1;
    }
  }

  private decide(dt: number, phase: Phase, timeLeft: number): BotOutput {
    const r = this.robot;
    const m = r.mech;
    const out: BotOutput = { forward: 0, turn: 0, intake: false, elevator: 0, release: false };
    const o = this.opts;

    for (const [i, left] of this.ignore) if (left - dt <= 0) this.ignore.delete(i);
    else this.ignore.set(i, left - dt);

    this.plan(phase, timeLeft);
    this.progressWatch(dt, phase);
    if (this.mode === 'critical' && !r.mech.critical) this.team.critPending = r.index;
    else if (this.team.critPending === r.index) this.team.critPending = null;
    if (this.mode !== 'score') {
      if (this.team.n3By === r.index) this.team.n3By = null;
      this.lockedLevel = null;
      this.n3Wait = 0;
    }
    if (this.mode !== 'collect' && this.mode !== 'hp') this.team.claim(-1, r.index);
    // Ya no se está arrimando a la Cámara ni a la Campana (si no, `unjam` no lo zafaría)
    if (this.mode === 'collect' || this.mode === 'climb') this.dockT = 0;

    // Dificultad: duda un momento al cambiar de plan
    if (this.mode !== this.lastMode) {
      this.lastMode = this.mode;
      this.pause = this.profile.reaction > 0 || this.profile.jitter > 0 ? this.profile.reaction + this.rand() * this.profile.jitter : 0;
    }
    // Recogió una Muestra: confirma que la trae antes de seguir (un piloto no sale disparado al instante)
    if (m.stored.length > this.lastStored && this.profile.pickPause > 0 && phase !== 'AUTO') this.pause = Math.max(this.pause, this.profile.pickPause * (0.6 + 0.8 * this.rand()));
    this.lastStored = m.stored.length;
    if (this.pause > 0) {
      this.pause -= dt;
      out.intake = this.mode === 'collect' || this.mode === 'hp';
      return out;
    }

    if (this.backOff > 0) {
      this.backOff -= dt;
      const pos0 = r.phys.position();
      // Detrás (hacia donde se aparta) tiene la Plataforma antes del ENDGAME o la orilla: se aparta hacia el otro lado
      if (!this.roomToward(this.backDir, phase) && this.roomToward(-this.backDir, phase)) this.backDir = -this.backDir;
      // Se aparta girando (al revés de como iba), salvo que tenga a un rival ahí (no chocarle, §4.5)
      out.forward = this.rivalNear(this.backDir, 1.0) || !this.roomToward(this.backDir, phase) ? 0 : this.backDir * 0.35;
      // Junto a la Plataforma antes del ENDGAME se aparta derecho: girando de reversa la cola se subía a la rampa
      const nearPlat = phase !== 'ENDGAME' && Math.abs(pos0.x) < F.PLATFORM_LENGTH / 2 + 0.8 && Math.abs(pos0.z) < F.PLATFORM_WIDTH / 2 + 0.8;
      out.turn = nearPlat ? 0 : this.backTurn;
      if (this.backOff <= 0) this.backTurn = 0.6;
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
      // De la rampa rival se sale de lado (hacia el centro se quedaría en ella); de lo demás, por el lado libre más cercano
      const onRamp = Math.abs(pos.z) < F.PLATFORM_WIDTH / 2 + 0.1;
      if (onRamp || !this.exitZone(pos, zones, out, phase)) this.drive({ x: pos.x, z: onRamp ? (Math.sign(pos.z) || 1) * 1.5 : 0 }, out, false, phase, onRamp);
      out.intake = true;
      return out;
    }

    if (this.followRoute(out, phase, dt)) return out;

    if (this.mode === 'collect') {
      out.intake = true;
      const piece = this.pickSample(phase, dt);
      if (piece) this.driveToPiece(piece, out, phase);
      else if (m.stored.length === 0 && phase !== 'AUTO') this.park(this.zoneWait() ?? this.idleSpot(phase), out, phase, false);
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
    } else if (this.mode === 'idle' && o.role === 'park' && phase === 'TELEOP') {
      // Esperando para subir: detrás de su carril, de cara a la rampa (donde lo dejó el AUTO quedaba a un lado del pie
      // de la rampa y al subir se atoraba girando junto a su compañero)
      const w = this.climbStage();
      if (Math.hypot(w.x - pos.x, w.z - pos.z) > 0.15) this.drive(w, out, true, phase, false, this.behind(w));
      else out.turn = clamp1(wrap((this.side > 0 ? Math.PI : 0) - r.phys.heading()) * 2);
    }
    return out;
  }

  /** Punto en su carril 55 cm detrás del pie de la rampa: desde ahí sube derecho (§4.4). */
  private climbStage(): { x: number; z: number } {
    return { x: this.side * 3.3, z: this.lane() };
  }

  /** ¿El punto le queda atrás (más cerca de ir de reversa que de frente)? Un tanque no da media vuelta para 50 cm. */
  private behind(p: { x: number; z: number }): boolean {
    const r = this.robot;
    const pos = r.phys.position();
    const h = r.phys.heading();
    return (p.x - pos.x) * Math.cos(h) - (p.z - pos.z) * Math.sin(h) < 0;
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
        const latest = this.eta(stage, this.foot()) + 8 + this.climbMargin();
        // Llega a la Campana justo al empezar el ENDGAME (antes no se puede tomar, §4.6): salir 11 s antes la dejaba
        // esperando parada ~20 s, más de dos ciclos de N3 perdidos (medido en la arena)
        const goNow = timeLeft < endgameAt + this.eta(pos, stage) + this.critLead();
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
    const reserve = critBusy ? GAME.times.endgame + this.eta(home, this.critStage()) + this.critLead() : climbFromHome;
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
    // Dominio: le faltan pocas y el siguiente desvío ya no vale por puntos pero sí por el RP: anota lo que trae
    const dom = this.situation();
    if (dom && n > 0 && dom.need > 0 && n >= dom.need && this.clock < 90) {
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
    const cap = Math.min(this.robot.mech.capacity, this.opts.batch ?? this.profile.batch);
    const sit = this.situation();
    if (!sit) return cap;
    let b = cap;
    // Dominio de Cámara (+1 RP, §4.4): si con una tanda lo completa, la junta justa y la anota ya
    if (sit.need > 0 && sit.need <= this.robot.mech.capacity) b = Math.min(b, sit.need);
    // Ya al final del match: tandas cortas (cada Muestra anotada a tiempo cuenta, una en la garra no)
    if (this.clock < 60) b = Math.min(b, Math.max(2, Math.ceil(b * (1 - 0.4 * this.profile.clutch))));
    return Math.max(1, b);
  }

  /** Marcador y Dominio de su alianza (solo si la dificultad decide por el marcador y la sesión lo da). */
  private situation(): { lead: number; samples: number; need: number } | null {
    if (this.profile.clutch <= 0) return null;
    const s = this.team.situation?.();
    return s ? { ...s, need: Math.max(0, s.need - s.samples) } : null;
  }

  /** Margen (s) para subir a la Plataforma: más holgado si va ganando, más justo si va perdiendo. */
  private climbMargin(): number {
    const sit = this.situation();
    const base = this.profile.climbMargin;
    if (!sit) return base;
    // Ganando por mucho: perder la Plataforma (10–20) no le cambia el resultado, pero un descuido sí
    // (RP de victoria); perdiendo: se la juega hasta el último segundo para alcanzarlos
    const adj = sit.lead > 30 ? 1.2 : sit.lead < -15 ? -0.8 : 0;
    return Math.max(1.2, base + adj * this.profile.clutch);
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
    const sit = this.situation();
    const domPush = !!sit && sit.need > 0 && sit.need <= this.robot.mech.stored.length + 2;
    if (detour > (domPush ? 5.5 : 3.5)) return false;
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
    // La persona de su alianza ya trabaja la Campana: no se le mete (estorbar al compañero es lo peor que hace una IA).
    // Y si la persona llega a la Campana con la IA ahí, la IA le cede el lugar aunque estuviera esperando Muestras
    if (this.team.humanAtHp && this.mode !== 'hp') return false;
    if (this.humanWantsHp()) return false;
    // Plan "labFirst": mientras haya Muestras en el Laboratorio, se las gana al rival antes de ir con su Human Player
    if (src !== 'hp' && this.team.playbook === 'labFirst' && this.mode !== 'hp' && this.labLeft() >= 3) return false;
    // Otro robot (el del jugador, uno dañado, un rival) ocupa la Campana o le cierra el paso a ella:
    // no se mete a empujarlo
    if (src !== 'hp' && ((this.mode !== 'hp' && this.campanaTaken()) || this.giveUp?.mode === 'hp')) return false;
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

  /** ¿La persona de su alianza entra (o ya está) en el pasillo de la Campana? Entonces se lo deja libre. */
  private humanWantsHp(): boolean {
    const a = this.robot.alliance;
    const pose = this.hpPose();
    return this.team.humans().some((h) => {
      const q = h.phys.position();
      // Cerca de la entrada solo si va o viene (parada ahí unos segundos ya no está esperando la Campana)
      // (El robot de la persona lo maneja un Bot en el AUTO: ese no se cede el lugar a sí mismo)
      return h !== this.robot && (inCampana(a, q) || (Math.hypot(q.x - pose.x, q.z - pose.z) < 2.6 && (this.humanStill.get(h.index) ?? 0) < 5));
    });
  }

  /**
   * ¿La persona de su alianza va a anotar a ese punto de su Cámara (trae Muestras y está cerca)? Se lo deja. Parada
   * ahí con la Muestra más de unos segundos sin anotar (no está jugando, o se quedó pensando) ya no: antes la IA la
   * esperaba todo el match sin anotar nada.
   */
  private humanScoringAt(p: { x: number; z: number }): boolean {
    return this.team.humans().some((h) => {
      const q = h.phys.position();
      return h !== this.robot && h.mech.stored.length > 0 && Math.hypot(q.x - p.x, q.z - p.z) < 1.4 && (this.humanStill.get(h.index) ?? 0) < 4;
    });
  }

  /** Cuánto lleva parado (s) cada robot de persona de su alianza. */
  private humanStill = new Map<number, number>();

  /** Muestras que quedan en el piso del Laboratorio (la zona central, §3.2.2). */
  private labLeft(): number {
    let n = 0;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field') continue;
      const t = p.body.translation();
      if (t.y < 0.2 && Math.abs(t.x) < 2.0 && Math.abs(t.z) < 2.9) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ recolectar
  /**
   * No pudo con esa Muestra (pegada a una pared o a la rampa, trabado, la garra no la toma): la deja `t` s, y el doble
   * cada vez que vuelve a fallar con ella en el mismo lugar (hasta 4 veces más). Antes volvía cada 6 s a la misma y
   * se le iban 20 s del match.
   */
  private shun(piece: number, t: number): void {
    const at = this.pieces.list[piece]?.body.translation();
    if (!at) return;
    const f = this.pieceFails.get(piece);
    const n = f && Math.hypot(f.x - at.x, f.z - at.z) < 0.3 ? f.n + 1 : 1;
    this.pieceFails.set(piece, { n, x: at.x, z: at.z });
    this.ignore.set(piece, t * Math.min(4, 2 ** (n - 1)));
  }

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
      cost += this.crowdCost(at);
      cost += this.contestCost(at, eta);
      cost += this.laneCost(at);
      // Seguir con la que ya iba (no cambia por poquito). Ya cerca, más: con una fila de Muestras siempre
      // le salía más barata la siguiente (la de al lado pide girar) y pasaba junto a todas sin tomar ninguna
      if (p.index === this.targetPiece) cost -= Math.hypot(at.x - pos.x, at.z - pos.z) < 1.2 ? 1.6 : 0.6;
      if (!best || cost < best.cost) best = { i: p.index, at, eta, cost };
    }
    return best;
  }

  /**
   * Segundos extra de una Muestra por los robots que tiene cerca: no se pelea una que otro robot ya
   * tiene encima (entrar por ella es chocarlo; con un rival, Foul §4.5) ni trabaja el mismo montón que
   * su compañero. SUPUESTO de diseño.
   */
  private crowdCost(at: { x: number; z: number }): number {
    const r = this.robot;
    let c = 0;
    for (const o of this.others) {
      if (o === r) continue;
      const q = o.phys.position();
      const d = Math.hypot(q.x - at.x, q.z - at.z);
      const R = (o.alliance !== r.alliance ? 1.3 : 1.0) + (this.isWary(o) ? 0.4 : 0);
      if (d < R) c += ((R - d) / R) * (o.alliance !== r.alliance ? 4 : 3);
    }
    // Junto a la que apartó su compañero: él ya va para allá
    for (const [piece, who] of this.team.claims) {
      if (who === r.index || !this.claimActive(piece)) continue;
      const t = this.pieces.list[piece]?.body.translation();
      if (t && Math.hypot(t.x - at.x, t.z - at.z) < 0.8) c += 1.2;
    }
    return c;
  }

  /**
   * Segundos extra de una Muestra fuera de la franja de este robot: con dos robots de IA que juntan,
   * cada uno trabaja su lado de la cancha (`Team.lane`) y no se cruzan. SUPUESTO de diseño.
   */
  private laneCost(at: { x: number; z: number }): number {
    if (!this.profile.teamwork) return 0;
    const lane = this.team.lane(this);
    if (lane === 0) return 0;
    return Math.sign(this.side * at.z || 1) === lane ? 0 : LANE_COST;
  }

  /**
   * Segundos extra de una Muestra a la que un rival llega antes que él: perder la carrera es dar la
   * vuelta con las manos vacías (y quedarse pegado a un rival, §4.5). Solo Normal para arriba. SUPUESTO.
   */
  private contestCost(at: { x: number; z: number }, myEta: number): number {
    const k = this.profile.contest;
    if (k <= 0) return 0;
    let c = 0;
    for (const o of this.others) {
      if (o.alliance === this.robot.alliance) continue;
      const q = o.phys.position();
      const theirs = Math.hypot(q.x - at.x, q.z - at.z) / Math.max(0.4, o.spec.maxSpeed * 0.7);
      if (theirs < myEta) c = Math.max(c, Math.min(6, (myEta - theirs) * 1.5 + 1));
    }
    return c * k;
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
    // AUTO: el manual nuevo (7-nov) ya no limita las Muestras a su mitad (§4.2)
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
      // Su Cámara está en la mitad rival, en la pared −Z (rojo) / +Z (azul)
      if (Math.hypot(q.x - t.x, q.z - t.z) < 1.1 && -s * q.z > 1.2 && -s * q.x > 1) return false;
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
  private pickSample(phase: Phase, dt: number): { x: number; z: number; i: number } | null {
    // Lleva demasiado tras la misma Muestra (girando en su lugar junto a ella sin entrar, trabado sin
    // que `unjam` lo note): la deja un rato y busca otra
    if (this.targetPiece >= 0 && (this.targetT -= dt) <= 0) {
      this.shun(this.targetPiece, WARY_TIME);
      this.targetPiece = -1;
    }
    const c = this.bestCandidate(phase);
    if (!c) {
      this.targetPiece = -1;
      this.team.claim(-1, this.robot.index);
      return null;
    }
    // Otra candidata mejor: un piloto tarda un momento en cambiar de idea (sigue a la que llevaba)
    if (c.i !== this.targetPiece && this.targetPiece >= 0 && this.profile.reaction + this.profile.jitter > 0 && this.pieces.list[this.targetPiece]?.state.at === 'field') {
      if (this.switchTo !== c.i) {
        this.switchTo = c.i;
        this.switchT = this.profile.reaction + this.rand() * this.profile.jitter;
      }
      this.switchT -= dt;
      if (this.switchT > 0) {
        const t = this.pieces.list[this.targetPiece].body.translation();
        this.team.claim(this.targetPiece, this.robot.index);
        return { x: t.x, z: t.z, i: this.targetPiece };
      }
    }
    this.switchTo = -1;
    if (c.i !== this.targetPiece) {
      this.aimBias = (this.rand() * 2 - 1) * this.profile.aim;
      this.bestDist = Infinity;
      this.progressT = 0;
      this.targetPiece = c.i;
      this.targetT = c.eta + TARGET_SLACK;
    }
    this.team.claim(c.i, this.robot.index);
    return { ...c.at, i: c.i };
  }

  /** Segundos que le da a la Muestra que persigue antes de dejarla (`pickSample`). */
  private targetT = 0;

  /** Muestra frente a la que ya llegó a su punto de espera (`driveToPiece`), o −1. */
  private staged = -1;

  /** Cara por la que entra a la Muestra que persigue (para no cambiarla a cada rato). */
  private approach: { piece: number; k: number } | null = null;

  /**
   * Muestra junto a la Plataforma, dentro del margen con que la rodea (antes del ENDGAME no se puede subir, §4.6):
   * ir derecho la dejaba siempre del otro lado del margen y el robot pasaba junto a ella o la arrastraba con el
   * costado (Psycho, 20 s). Como un piloto: se para afuera del margen frente a ella, de cara a la Plataforma con la
   * garra, y entra despacio en línea recta; si el chasis quedaría a menos de 5 cm de la orilla, la deja.
   * Devuelve false si la Muestra no está en ese margen (sigue el acercamiento normal).
   */
  private platformApproach(p: { x: number; z: number }, piece: number, out: BotOutput, phase: Phase, dist: number, grab: number): boolean {
    const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    if (!(Math.abs(p.x) < hx && Math.abs(p.z) < hz)) {
      if (this.standPiece === piece) this.standPiece = -1;
      return false;
    }
    const r = this.robot;
    const pos = r.phys.position();
    const pd = this.pickDir;
    // Por el lado largo (de frente a la orilla en Z) o, pasado el extremo de una rampa, de frente a ella en X
    const along = Math.abs(p.x) < F.PLATFORM_LENGTH / 2 + 0.1;
    const ux = along ? 0 : -Math.sign(p.x);
    const uz = along ? -Math.sign(p.z) : 0;
    const out0 = along ? { x: p.x, z: Math.sign(p.z) * Math.max(Math.abs(p.z) + grab, hz + 0.05) } : { x: Math.sign(p.x) * Math.max(Math.abs(p.x) + grab, hx + 0.05), z: p.z };
    // Qué tan de lado está de la línea que entra a la Muestra, y qué tan atrás de ella
    const lat = along ? pos.x - p.x : pos.z - p.z;
    const back = along ? Math.sign(p.z) * (pos.z - p.z) : Math.sign(p.x) * (pos.x - p.x);
    const want = Math.atan2(-uz, ux) + (pd < 0 ? Math.PI : 0);
    const herr = wrap(want - r.phys.heading());
    if (this.standPiece !== piece) {
      if (Math.hypot(out0.x - pos.x, out0.z - pos.z) > 0.15 && !(Math.abs(lat) < 0.08 && back > grab - 0.05 && Math.abs(herr) < 0.2)) {
        this.drive(out0, out, true, phase, false, false);
        return true;
      }
      this.standPiece = piece;
    }
    // En la línea: primero de cara (girar en su lugar), luego derecho y despacio hasta tomarla
    if (Math.abs(lat) > 0.16 || back < grab - 0.15) {
      this.standPiece = -1;
      this.drive(out0, out, true, phase, false, false);
      return true;
    }
    out.turn = clamp1(herr * 2.5);
    if (Math.abs(herr) > 0.15) {
      out.forward = 0;
      return true;
    }
    // Corrección lateral: girar un poco hacia la Muestra mientras entra
    const bearing = Math.atan2(-(p.z - pos.z), p.x - pos.x) + (pd < 0 ? Math.PI : 0);
    out.turn = clamp1(wrap(bearing - r.phys.heading()) * 2.5);
    const gap = along ? Math.abs(pos.z) - F.PLATFORM_WIDTH / 2 - r.phys.halfL : Math.abs(pos.x) - F.PLATFORM_LENGTH / 2 - r.phys.halfL;
    if (gap < 0.05 && dist > grab + 0.03) {
      // Ya no cabe más cerca sin tocar la Plataforma: no la alcanza
      this.standPiece = -1;
      this.shun(piece, WARY_TIME);
      out.forward = 0;
      return true;
    }
    out.forward = pd * Math.min(0.5, Math.max(0.15, (dist - grab) * 1.5));
    return true;
  }

  private standPiece = -1;

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
    const grab = Math.abs(posScoreTip(s, 0).x);
    const pd = this.pickDir;
    const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
    const piece = p.i !== undefined ? this.pieces.list[p.i] : undefined;
    if (piece && s.footprint?.length) {
      // Dentro del canal abierto del chasis, más adentro que la placa de la garra (a Psycho le caben dos Muestras entre los
      // rieles): ahí la garra no la toma y, al girar para encararla, los rieles la arrastran con el robot: daba vueltas
      // sobre sí mismo 3 s o más (Xhavi 22-nov: "se ponen a dar vueltas"). Avanza derecho, la deja afuera y la toma
      const t = piece.body.translation();
      const { lx, lz } = r.phys.worldToLocalFlat(t.x, t.z);
      const ax = lx * pd;
      if (ax > 0 && ax < Math.abs(r.mech.tipX()) - 0.03 && Math.abs(lz) < r.phys.halfW) {
        // Con la garra abajo la Muestra queda encerrada entre la garra y el chasis y avanza con el robot (Psycho iba y
        // venía junto a la pared con ella adentro): primero sube la garra y luego avanza
        out.elevator = 2;
        out.intake = false;
        out.forward = r.mech.height > 0.12 ? -pd * 0.45 : 0;
        out.turn = 0;
        return;
      }
    }
    if (piece && intakeOf(s).kind === 'pinza') {
      this.pinzaApproach(piece, out, phase, dist, grab);
      return;
    }
    // Compliants (el agarre por defecto) toman la Muestra en cualquier giro (`Mechanisms.runClaw`): llega derecho. El
    // acomodo por la cara de la Muestra solo hace falta con el agarre "Preciso"; con compliants giraba en su lugar frente
    // a la Muestra hasta 15 s (Phoenix, Axiom; medido en la arena)
    const precise = r.mech.grip === 'precise' && !intakeOf(s).shooter;
    if (piece && phase !== 'ENDGAME' && this.platformApproach(p, piece.index, out, phase, dist, grab)) return;
    if (!piece || !precise || dist > grab + 1.6) {
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
    const herr = wrap(h + (pd < 0 ? Math.PI : 0) - r.phys.heading() + this.aimBias * Math.min(1, Math.max(0, dist - grab) / 0.6));
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
    const stage = { x: p.x - dx * (grab + 0.45), z: p.z - dz * (grab + 0.45) };
    const toStage = Math.hypot(stage.x - pos.x, stage.z - pos.z);
    // Ya llegó a su punto de espera: se queda en esta etapa aunque al girar se aleje unos centímetros
    // (con un solo umbral giraba hacia el punto y de vuelta hacia la Muestra sin fin)
    const staged = toStage < (this.staged === piece.index ? 0.3 : 0.1);
    this.staged = staged ? piece.index : -1;
    // Ya de frente: entra corrigiendo de lado (si quedó un poco fuera de la línea, también)
    if ((onLine || (staged && Math.abs(side) < 0.3 && behind > grab - 0.08)) && Math.abs(herr) < 0.15) {
      out.turn = clamp1(herr * 3 - side * 6);
      out.forward = pd * Math.min(0.3, 0.12 + Math.max(0, behind - grab) * 0.4);
      return;
    }
    if (onLine || staged) {
      out.turn = clamp1(herr * 2.5);
      out.forward = 0;
      return;
    }
    this.drive(stage, out, true, phase, false, pd < 0);
  }

  /** Segundos desde que cerró la pinza (para abrirla si cerró en vacío). */
  private pinzaT = 0;

  /**
   * Pinza con interruptor (Axiom): como la maneja una persona. Llega derecho con la garra abierta y la cierra en cuanto
   * la Muestra queda entre los dedos (la toma aunque llegue chueca, `Mechanisms.runClaw` con `latched`); si cerró en
   * vacío, la abre y vuelve a intentar. Antes la IA usaba el agarre "Preciso" (cubo derecho y centrado a ±4.5 cm) y se
   * quedaba girando frente a la Muestra hasta 15 s (medido en la arena, `npm run arena`).
   */
  private pinzaApproach(piece: Piece, out: BotOutput, phase: Phase, dist: number, grab: number): void {
    const r = this.robot;
    const m = r.mech;
    const t = piece.body.translation();
    const pd = this.pickDir;
    out.intake = true;
    if (m.clawClosed && !m.inClaw) {
      this.pinzaT += 1 / HZ;
      // Cerró sin nada: abre (otra pulsación) y vuelve a entrar
      if (this.pinzaT > intakeOf(r.spec).closeTime + 0.35) {
        out.clawToggle = true;
        this.pinzaT = 0;
        this.pinzaMiss++;
        if (this.pinzaMiss >= 3) {
          this.pinzaMiss = 0;
          this.shun(piece.index, WARY_TIME);
          this.targetPiece = -1;
        }
      }
      return;
    }
    this.pinzaT = 0;
    const { lx, lz } = r.phys.worldToLocalFlat(t.x, t.z);
    const tip = m.tipX();
    // Entre los dedos abiertos (±0.14 m en el CAD; con margen): cierra ya
    if (m.height <= floorPoseOf(r.spec) && Math.abs(lx - tip) < 0.085 && Math.abs(lz) < 0.09) {
      out.forward = 0;
      out.clawToggle = true;
      return;
    }
    // Cerca: entra derecho y despacio apuntando la boca a la Muestra
    if (dist < grab + 0.5) {
      const want = Math.atan2(-(t.z - r.phys.position().z), t.x - r.phys.position().x) + (pd < 0 ? Math.PI : 0);
      const err = wrap(want - r.phys.heading());
      // Más cerca que la punta y de lado: girar en su lugar barre la pieza con los dedos abiertos en el piso y el robot
      // se sube en ella (Axiom a 20°). Primero se hace para atrás
      if (dist < grab - 0.02 && Math.abs(err) > 0.25) {
        out.forward = -pd * 0.3;
        out.turn = 0;
        out.elevator = 1;
        return;
      }
      // La garra baja al piso ya de frente a la Muestra (girando con los dedos abiertos en el piso barre las piezas y
      // se sube en ellas, D34)
      out.elevator = Math.abs(err) < 0.25 ? 0 : 1;
      out.turn = clamp1(err * 3);
      out.forward = Math.abs(err) < 0.25 ? pd * Math.min(0.35, 0.12 + Math.max(0, dist - grab) * 0.6) : 0;
      return;
    }
    // Lejos, la garra a media altura (arrastrarla abierta por el piso levantaba el chasis)
    out.elevator = 1;
    this.drive({ x: t.x, z: t.z }, out, true, phase, false, pd < 0, Math.max(0, dist - grab));
  }

  private pinzaMiss = 0;

  /** Sin nada que juntar en su zona de trabajo del plan: espera en medio de ella. */
  private zoneWait(): { x: number; z: number } | null {
    const z = this.directive?.zone;
    return z ? { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 } : null;
  }

  /**
   * Dónde espera sin estorbar (su turno en el Nivel 3, o sin nada que hacer): fuera del pasillo entre su Campana y su
   * Cámara (por ahí van y vienen su compañero y la persona) y fuera del frente de la Cámara, junto a la punta de la
   * Plataforma del lado de su Cámara. Antes esperaba en `forAlliance(0.6, 1.95)`, que con la Cámara en la otra punta
   * quedaba en medio de ese pasillo y frente a la Cámara rival (Xhavi, 22-nov: "solo estorban"). En el ENDGAME, en la
   * punta de la cancha, más lejos del pie de la rampa rival (SUPUESTO de diseño).
   */
  private camaraWaitSpot(): { x: number; z: number } {
    const late = this.phase === 'ENDGAME';
    const spots = (late ? [{ x: 4.0, z: 1.0 }, { x: 4.05, z: 0.45 }] : [{ x: 3.4, z: 0.95 }, { x: 3.45, z: 0.3 }, { x: 4.0, z: 0.7 }]).map((q) => F.forCamara(this.robot.alliance, q));
    const room = (q: { x: number; z: number }) => Math.min(...this.others.filter((o) => o !== this.robot).map((o) => Math.hypot(o.phys.position().x - q.x, o.phys.position().z - q.z)));
    const free = spots.find((q) => room(q) >= 0.8);
    if (free) return free;
    // Todos ocupados (la persona parada entre dos): el más despejado. Antes iba al primero aunque la persona estuviera
    // encima y se quedaba esperando junto a ella dentro de la zona de anotación (≈8 s por match)
    return spots.reduce((a, b) => (room(b) > room(a) ? b : a));
  }

  private waitSpot(): { x: number; z: number } {
    return this.camaraWaitSpot();
  }

  /**
   * Sin nada que juntar ni anotar: con el Laboratorio vacío las Muestras nuevas salen de su Human Player, así que espera
   * a un lado de la salida de su Campana (fuera del pasillo y de la entrada) para tomarlas en cuanto se libere (alianza
   * de solo IA: +21 pts por match en la arena). Con la persona en su alianza espera junto a su Cámara, lejos de la
   * Campana: junto a la Campana pasaba el doble de tiempo a menos de 1 m de ella (17.8 s contra 9.5 s, arena con un
   * robot manejado como persona; Xhavi 22-nov: "no están haciendo nada ahí y solo estorban"). En el ENDGAME, junto a su
   * Cámara (lejos del pie de su rampa).
   */
  private idleSpot(phase: Phase): { x: number; z: number } {
    if (phase === 'ENDGAME' || !this.team.hp?.enabled || this.opts.source === 'lab' || this.team.humans().length > 0 || !this.pieces.hpStock(this.robot.alliance).length) return this.waitSpot();
    return F.forAlliance(this.robot.alliance, { x: 4.05, z: -0.9 });
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

  /** ¿Hay otro robot en el pasillo de su Campana (entre la barra y la pared)? */
  private campanaTaken(): boolean {
    return this.others.some((o) => o !== this.robot && inCampana(this.robot.alliance, o.phys.position()));
  }

  private atHumanPlayer(out: BotOutput, phase: Phase, dt: number): void {
    const r = this.robot;
    out.intake = true;
    const pose = this.hpPose();
    const faceZ = -this.side; // la Campana del rojo está en −Z
    // Un compañero sale de la Campana (es un pasillo entre la barra y la pared): lo deja salir
    const pos = r.phys.position();
    // Otro robot en la Campana (un compañero que sale, el del jugador que la ocupa): espera afuera
    if (this.campanaTaken() && !inCampana(r.alliance, pos)) {
      // A un lado de la salida de la Campana (enfrente le cerraba el paso al que sale: se quedaban los dos parados) y
      // fuera del pasillo hacia la Cámara, junto a la pared del fondo
      this.park(F.forAlliance(r.alliance, { x: 4.05, z: -0.9 }), out, phase);
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
    } else if (hp && this.hpWait > hp.interval + 2.5) {
      // Sin nada y el Human Player no le da: hay Muestras sueltas en la ranura (su intake no las toma contra la pared)
      // y el HP no mete otra encima. Se aparta y las busca desde otro ángulo, o se va al Laboratorio. Antes se quedaba
      // ahí parado hasta el ENDGAME (Psycho: ≈50 s por match en la Campana)
      this.hpWait = 0;
      this.dockFailed(this.pickDir);
      this.backOff = 0.8;
      if (this.opts.source !== 'hp') this.giveUp = { mode: 'hp', t: 8 };
    }
  }

  // ------------------------------------------------------------------ anotar
  private score(out: BotOutput, phase: Phase): void {
    const r = this.robot;
    const m = r.mech;
    const level = this.chooseLevel();
    if (level === null) {
      // El Nivel 3 lo usa su compañero: espera junto a su Cámara, frente a los niveles bajos (fuera del camino por donde
      // sale su compañero), con el mecanismo arriba al llegar. Solo cuenta la espera ya ahí: antes esperaba en el
      // Laboratorio, al otro lado de la Plataforma, y a los 3.5 s se iba a otro nivel sin haber llegado (≈16 s por match)
      const w = this.camaraWaitSpot();
      const p0 = r.phys.position();
      const d = Math.hypot(w.x - p0.x, w.z - p0.z);
      if (d < 0.6) this.n3Wait += 1 / HZ;
      this.park(w, out, phase, d < 1.2);
      out.elevator = d < 1.6 ? this.level : m.inClaw ? 2 : 0;
      return;
    }
    const pose = this.scoringPose(level);
    const pos = r.phys.position();
    const near = Math.hypot(pose.x - pos.x, pose.z - pos.z) < 1.6;
    if (level === 3 && near) this.team.n3By = r.index;
    // Lejos de la Cámara con la Muestra en la garra: la lleva a media altura, no en el piso (rasparía y levantaría el chasis al avanzar)
    out.elevator = near ? level : m.inClaw ? 2 : 0;
    const st = this.dock(pose, -this.side, posDir(this.robot.spec, level), out, phase, { stage: this.robot.spec.intake?.shooter ? 0.2 : this.profile.dockStage, tol: this.scoreTol(level, pose) + this.profile.sloppy, edge: EDGE_CLEAR });
    // Ya se está arrimando: se queda con ese nivel hasta soltar todo
    if (st === 'creep' || st === 'docked') this.lockedLevel = level;
    if (st === 'docked') out.release = m.atTarget;
    if (out.release && m.inClaw) {
      const piece = m.stored[m.stored.length - 1];
      if (piece && !this.pendingShots.some((q) => q.piece === piece.index)) this.pendingShots.push({ piece: piece.index, level, t: 0 });
    }
  }

  /** Tiros (Muestras soltadas en la Cámara) que espera ver caer: a qué nivel y hace cuánto. */
  private pendingShots: Array<{ piece: number; level: Level; t: number }> = [];
  /** Intentos y aciertos por nivel en este match (`levelOdds`). */
  private levelStats = new Map<Level, { tries: number; ok: number }>();

  /**
   * ¿Entró? 1.5 s después de soltarla, la Muestra está dentro de un pozo de su Cámara (o ya la recogió el campo):
   * acierto; si no (quedó en la pared, el piso o rebotó), fallo. Así la IA aprende en el match qué niveles le salen
   * con su robot, como un piloto que ve que el N3 no le entra y cambia al N2.
   */
  private watchShots(dt: number): void {
    if (!this.pendingShots.length) return;
    const wells = F.camaraWells();
    for (const q of this.pendingShots) q.t += dt;
    const done = this.pendingShots.filter((q) => q.t > 1.5);
    if (!done.length) return;
    this.pendingShots = this.pendingShots.filter((q) => q.t <= 1.5);
    for (const q of done) {
      const p = this.pieces.list[q.piece];
      if (!p) continue;
      const t = p.body.translation();
      const inside = p.state.at !== 'field' || ([1, 2, 3] as Level[]).some((l) => F.inRect(F.rectForCamara(this.robot.alliance, wells[l]), t.x, t.z) && t.y < wells[l].rim);
      const st = this.levelStats.get(q.level) ?? { tries: 0, ok: 0 };
      st.tries++;
      if (inside) {
        st.ok++;
        this.scoredLog.push({ t: this.age, pts: (this.phase === 'AUTO' ? GAME.points.sampleAuto : GAME.points.sampleTeleop)[q.level] });
      }
      this.levelStats.set(q.level, st);
    }
  }

  /**
   * Probabilidad de que la Muestra entre en ese nivel: lo que va viendo en el match sobre una idea inicial por la
   * geometría del robot (si la punta de su garra llega más allá de la pared del pozo con el chasis pegado a ella; los
   * lanzadores y los compliants que escupen la avientan). SUPUESTO de diseño, no del manual.
   */
  levelOdds(l: Level): number {
    const s = this.robot.spec;
    let prior = 0.9;
    if (!s.intake?.shooter) {
      const w = F.camaraWells()[l];
      const hl = this.robot.phys.halfL;
      const tip = Math.abs(posScoreTip(s, l).x);
      const push = intakeOf(s).kind === 'compliant' ? 0.12 : 0;
      const reach = F.CAMARA_Z_RED[0] - hl - 0.01 + tip + push;
      const need = w.z0 + F.SAMPLE_SIZE / 2;
      prior = reach >= need + 0.02 ? 0.9 : reach >= need - 0.03 ? 0.55 : 0.2;
    }
    const st = this.levelStats.get(l) ?? { tries: 0, ok: 0 };
    return (st.ok + prior * 2) / (st.tries + 2);
  }

  /** Puntos esperados de una Muestra en ese nivel ahora (§4.4: AUTO 5/10/18, TELEOP 2/6/15) por la probabilidad de que entre. */
  private levelValue(l: Level): number {
    const pts = this.phase === 'AUTO' ? GAME.points.sampleAuto : GAME.points.sampleTeleop;
    return pts[l] * this.levelOdds(l);
  }

  /**
   * Error de lado (m, a lo largo de la pared) que admite frente a ese nivel: lo que deja el pozo para que la Muestra
   * caiga adentro desde donde apunta esta visita (antes 0.1 m fijos: con un pozo de 64–79 cm se quedaba corrigiendo
   * centímetros que no importan).
   */
  private scoreTol(level: Level, pose: { x: number }): number {
    const w = F.rectForCamara(this.robot.alliance, F.camaraWells()[level]);
    const room = Math.min(pose.x - w.x0, w.x1 - pose.x) - F.SAMPLE_SIZE / 2 - 0.05;
    return Math.max(0.06, Math.min(0.14, room - 0.1));
  }

  /** El nivel al que va ahora, o null si debe esperar su turno (su compañero usa el Nivel 3). */
  private chooseLevel(): Level | null {
    if (this.lockedLevel !== null) return this.lockedLevel;
    // Se atoró al arrimarse a ese nivel (una pieza en el piso, el pozo lleno…): lo deja un rato y prueba otro
    if (this.dockFails > 0) {
      this.dockFails = 0;
      // Una sola vez puede ser mala suerte; dos seguidas en el mismo nivel, está tapado
      const n = (this.failsAt.get(this.lastLevel) ?? 0) + 1;
      this.failsAt.set(this.lastLevel, n);
      if (n >= 2) {
        this.failsAt.delete(this.lastLevel);
        this.badLevels.set(this.lastLevel, this.age + 12);
      }
    }
    if (this.robot.mech.stored.length === 0) this.failsAt.clear();
    // Los niveles que puede alcanzar (hasta el que pide su estrategia), del que más puntos espera al que menos:
    // N3 vale 15 contra 6 del N2 (§4.4), pero si al N3 no le entra con su robot, el N2 rinde más
    const order = ([3, 2, 1] as Level[]).filter((l) => l <= this.level).sort((a, b) => this.levelValue(b) - this.levelValue(a) || b - a);
    const pref = order[0];
    const bad = (l: Level): boolean => {
      const until = this.badLevels.get(l);
      return until !== undefined && this.age < until;
    };
    const taken = (l: Level): boolean => {
      const p = this.scoringPose(l);
      // Otro robot en ese frente (o uno con el que se trabó, cerca): a otro nivel o a esperar
      if (this.others.some((o) => o !== this.robot && Math.hypot(o.phys.position().x - p.x, o.phys.position().z - p.z) < (this.isWary(o) ? 1.3 : 0.8))) return true;
      // La persona de su alianza llega a anotar ahí: es suyo (la IA espera fuera del frente de la Cámara)
      if (this.humanScoringAt(p)) return true;
      return l === 3 && this.team.n3By !== null && this.team.n3By !== this.robot.index && this.teammateAtN3();
    };
    const occupied = (l: Level): boolean => bad(l) || this.levelBlocked(l) || taken(l);
    const free = order.find((l) => !occupied(l));
    if (free === pref) {
      this.n3Wait = 0;
      return this.lastLevel = pref;
    }
    // Esperar un momento vale más; si tarda (o el preferido está tapado/lleno), al siguiente nivel libre
    const hard = this.levelBlocked(pref) || bad(pref);
    // Cuánto espera: si lo que queda libre vale poco junto al preferido (N1 = 2 contra 15 del N3, §4.4), más
    const alt = free === undefined ? 0 : this.levelValue(free) / Math.max(0.1, this.levelValue(pref));
    const patience = (this.team.playbook === 'n3Rush' ? 5.5 : 3.5) * (alt < 0.3 ? 2 : 1);
    if (!hard && this.n3Wait < patience && this.profile.teamwork) return null;
    if (free !== undefined) return (this.lastLevel = free);
    // Todos tapados: anota donde sea con tal de no dar vueltas (intenta el preferido y luego los de abajo)
    const any = order.find((l) => !taken(l));
    return any === undefined ? null : (this.lastLevel = any);
  }

  /**
   * ¿Ese nivel no se puede usar ahora? Pozo lleno hasta la apertura (lo que caiga ya no cuenta, §4.4).
   * Lo demás que lo tapa (una Muestra en el piso, un robot) se descubre al arrimarse: `dockFails`.
   */
  private levelBlocked(l: Level): boolean {
    const w = F.camaraWells()[l];
    const rect = F.rectForCamara(this.robot.alliance, w);
    let inside = 0;
    for (const p of this.pieces.list) {
      if (p.kind !== 'sample' || p.state.at !== 'field') continue;
      const t = p.body.translation();
      if (F.inRect(rect, t.x, t.z) && t.y < w.rim + F.SAMPLE_SIZE) {
        // Una Muestra ya a la altura de la apertura: el pozo está lleno
        if (t.y + F.SAMPLE_SIZE / 2 > w.rim - 0.02) inside++;
      }
    }
    return inside >= 3;
  }

  private teammateAtN3(): boolean {
    const b = this.team.members.find((x) => x.robot.index === this.team.n3By);
    if (!b || b.robot === this.robot) return false;
    // La persona: solo si de verdad está anotando ahí (el Bot de su AUTO se queda en 'score' todo el match)
    if (this.team.humans().includes(b.robot)) return this.humanScoringAt(this.scoringPose(3));
    return b.mode === 'score' && b.robot.mech.stored.length > 0;
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
    // Ya alineándose o arrimándose: más tolerancia para no volver a 'travel' (al girar en su lugar el centro se mueve unos
    // centímetros y, justo en el borde, alternaba entre ir al punto de espera y girar hacia la pared sin avanzar)
    const latTol = o.tol + (this.dockT > 0 ? 0.1 : 0.06);
    // Arrimándose, pasarse unos centímetros de la pose no es salirse del embudo: el chasis queda contra la pared y la
    // punta más adentro del pozo. Antes volvía a 'travel' e intentaba girar hacia el punto de espera pegado a la Cámara
    // (Hazmat: ≈7 s por Muestra con el Nivel 3 ocupado mientras su compañero esperaba)
    const over = !o.hold && Math.abs(err) < 0.3 ? -0.2 : -0.06;
    if (Math.abs(lateral) > latTol || depth > o.stage + 0.3 || depth < over) {
      // Iba alineándose y se salió del embudo: si eso pasa seguido (gira, se sale, vuelve…), se aparta derecho de la
      // pared y entra de nuevo desde más lejos (un tanque no corrige 15 cm de lado girando en su lugar)
      if (this.dockT > 0) {
        this.dockFlips.push(this.age);
        this.dockFlips = this.dockFlips.filter((t) => this.age - t < 3);
        if (this.dockFlips.length >= 3) {
          this.dockFlips = [];
          this.backOff = 0.7;
          this.backDir = -dir;
          this.backTurn = 0;
        }
      }
      this.dockT = 0;
      this.creeping = false;
      // Con el mecanismo atrás va de reversa todo el camino: llega ya de espaldas, sin dar la vuelta
      // Pegado a la pared y casi de frente (la Muestra no entró y la volvió a tomar ahí mismo, o se pasó del embudo):
      // girar en su lugar ahí no avanza, la esquina topa con la Cámara (Hazmat: ≈2 s girando contra la pared por
      // intento). Se aparta derecho hasta el punto de partida y entra de nuevo
      if (depth < o.stage - 0.15 && depth > -0.3 && Math.abs(err) < 1.2 && !o.hold) {
        out.forward = -dir * 0.6;
        out.turn = 0;
      } else if (Math.hypot(stage.x - pos.x, stage.z - pos.z) > 0.12) this.drive(stage, out, true, phase, false, dir < 0, undefined, o.edge);
      else out.turn = clamp1(err * 2.5);
      return 'travel';
    }
    // Atorado al arrimarse (una pieza en el piso, otro robot): si ya está cerca, cuenta como listo
    // (esperando por `hold` no cuenta: al soltarlo, con 15 s acumulados, se apartaba en cuanto empezaba el ENDGAME)
    this.dockT = o.hold ? Math.min(this.dockT + 1 / HZ, 0.5) : this.dockT + 1 / HZ;
    if (this.dockT > 2.5 && !o.hold) {
      if (depth < 0.2) return 'docked';
      return this.dockFailed(dir);
    }
    // Arrimándose corrige el lado con el rumbo (hasta 0.15 rad lejos de la pared, nada al llegar: chueco, la esquina del
    // brazo topa primero y el robot se encarama). Con el umbral fijo de 0.07 alternaba entre alinearse parado y avanzar
    // un poco, y no llegaba a la rendija de la Crítica en 2.5 s
    const devMax = 0.15 * Math.min(1, Math.max(0, (depth - 0.08) / 0.3));
    const v = r.phys.body.linvel();
    // Ya contra la pared (a centímetros de la pose y sin avanzar) con el rumbo casi bien: ahí ya no se puede enderezar
    // (la nariz topa) y alternaba entre alinearse y arrimarse ≈1.5 s antes de soltar (Hazmat en N3). Un lanzador no: tira
    // desde lejos de la pared y ahí 0.2 rad de rumbo son 20 cm de error (Phoenix fallaba 3 de 7)
    if (!o.hold && !r.spec.intake?.shooter && this.dockT > 0.3 && depth < 0.08 && Math.abs(err) < 0.2 && Math.hypot(v.x, v.z) < 0.1) return 'docked';
    if (Math.abs(err) > (this.creeping ? Math.max(0.07, devMax + 0.05) : 0.07)) {
      this.creeping = false;
      out.turn = clamp1(err * 2.5);
      return 'align';
    }
    if (o.hold) {
      out.turn = clamp1(err * 2.5);
      return depth > o.stage - 0.1 ? 'align' : 'creep';
    }
    // Ya tocó la pared (el brazo o el chasis no lo dejan avanzar, o el robot empieza a encaramarse): llegó. Empujar
    // 2.5 s contra la pared con el brazo en N2 lo levantaba (Axiom)
    this.creepStallT = this.creeping && Math.hypot(v.x, v.z) < 0.06 ? this.creepStallT + 1 / HZ : 0;
    if (!o.hold && this.creeping && ((depth < 0.2 && this.creepStallT > 0.25) || (depth < 0.25 && r.phys.tilt() > 0.09))) return 'docked';
    // Topó lejos de la pose (el brazo con la Cámara en un nivel que no alcanza, una pieza en el piso): ese intento ya no
    // entra; antes empujaba 2.5 s a todo motor y volvía a intentar el mismo nivel (Mentores en N1, ≈25 s por match)
    if (!o.hold && this.creeping && depth >= 0.2 && this.creepStallT > 0.5) return this.dockFailed(dir);
    if (depth > 0.02) {
      // Arrimarse corrigiendo el error lateral con el rumbo (apunta 0.8 m más allá de la pose)
      const aim = Math.atan2(-faceZ * 0.8, pose.x - pos.x) + (dir > 0 ? 0 : Math.PI);
      const dev = clamp(wrap(aim - want), devMax);
      const k = this.profile.dockSpeed;
      out.forward = dir * Math.min(0.55 * k, depth * 1.8 * k + 0.1);
      // Como un piloto que ve el brazo a centímetros de la madera: si a esta velocidad el brazo topa con la Cámara antes
      // de la pose (Axiom en N2 llega a 1.9 m/s y se encarama), frena y se arrima despacio
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.4 && r.mech.armHitsAhead(dir * (0.04 + (speed * speed) / 10))) out.forward = dir * Math.min(Math.abs(out.forward), 0.12);
      out.turn = clamp1(wrap(want + dev - r.phys.heading()) * 2.5);
      this.creeping = true;
      return 'creep';
    }
    // Un lanzador tira con la velocidad del chasis encima (`Mechanisms.release`): llegando todavía a 0.3–0.5 m/s la
    // Muestra pasaba de largo el pozo. Frena y tira ya parado, como un piloto que espera a que el robot se asiente
    const w = r.phys.body.angvel().y;
    if (r.spec.intake?.shooter && !o.hold && this.dockT < 2 && (Math.hypot(v.x, v.z) > 0.08 || Math.abs(w) > 0.25)) {
      out.forward = 0;
      out.turn = 0;
      return 'creep';
    }
    return 'docked';
  }

  /**
   * Sale de una zona rival (§4.6: más de 3 s es falta, y otra cada 5 s) hacia el punto libre más cercano fuera de ella,
   * de frente o de reversa, sin pasar junto a otro robot. Antes iba siempre hacia el centro de la cancha: con el rival
   * que quería anotar ahí parado enfrente, los dos se esperaban y la IA regalaba una falta cada 5 s (Axiom: 10 en un
   * match de la arena). Devuelve false si no encontró salida (sigue el camino de siempre).
   */
  private exitZone(pos: { x: number; z: number }, zones: readonly F.Rect[], out: BotOutput, phase: Phase): boolean {
    const r = this.robot;
    const h = r.phys.heading();
    const hx = F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR;
    const hz = F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR;
    let best: { q: { x: number; z: number }; rev: boolean; err: number } | null = null;
    let bestCost = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      for (const d of [0.5, 0.9, 1.3, 1.7]) {
        const q = { x: pos.x + Math.cos(a) * d, z: pos.z - Math.sin(a) * d };
        if (Math.abs(q.x) > F.HALF_L - 0.45 || Math.abs(q.z) > F.HALF_W - 0.45) break;
        if ((phase !== 'ENDGAME' && Math.abs(q.x) < hx && Math.abs(q.z) < hz) || nearCamara(q, 0.3) || nearBarrier(q, 0.3)) break;
        if (this.others.some((o) => o !== r && segPointDist(pos, q, o.phys.position()) < 0.75)) break;
        if (zones.some((z) => F.inRect(z, q.x, q.z))) continue;
        // De reversa si le queda atrás (girar en su lugar dentro de la zona es tiempo de falta)
        const fwd = wrap(a - h);
        const rev = Math.abs(fwd) > Math.PI / 2;
        const err = rev ? wrap(fwd + Math.PI) : fwd;
        const cost = d + Math.abs(err) * 0.4;
        if (cost < bestCost) {
          bestCost = cost;
          best = { q, rev, err };
        }
        break;
      }
    }
    if (!best) return false;
    out.turn = clamp1(best.err * 2.5);
    out.forward = (best.rev ? -1 : 1) * (Math.abs(best.err) < 0.5 ? 0.6 : 0);
    return true;
  }

  /**
   * Va a un lugar de espera y ahí se queda quieto. Con `drive` seguía girando hacia un punto que ya tenía casi debajo
   * y daba vueltas en su lugar (Psycho esperando su turno en la Cámara: 2.5 s girando; Xhavi 22-nov: "se ponen a dar
   * vueltas y estorban aún más"). Ya parado tolera que lo muevan unos centímetros sin volver a acomodarse.
   */
  private park(w: { x: number; z: number }, out: BotOutput, phase: Phase, precise = true): void {
    const pos = this.robot.phys.position();
    const d = Math.hypot(w.x - pos.x, w.z - pos.z);
    const there = this.parked !== null && Math.hypot(w.x - this.parked.x, w.z - this.parked.z) < 0.3;
    if (d < (there ? 0.45 : 0.22)) {
      this.parked = { x: w.x, z: w.z };
      out.forward = 0;
      out.turn = 0;
      return;
    }
    this.parked = null;
    this.drive(w, out, precise, phase);
  }

  private parked: { x: number; z: number } | null = null;

  /** No pudo arrimarse: se aparta derecho y lo cuenta (`chooseLevel` cambia de nivel; el nivel ya no queda fijo). */
  private dockFailed(dir: number): DockState {
    this.dockT = 0;
    this.creeping = false;
    this.creepStallT = 0;
    this.backOff = 0.5;
    this.backDir = -dir;
    this.dockFails++;
    if (this.lockedLevel !== null) {
      // Para lo que aprende en el match (`levelOdds`): un intento en ese nivel que no entró
      const st = this.levelStats.get(this.lockedLevel) ?? { tries: 0, ok: 0 };
      st.tries++;
      this.levelStats.set(this.lockedLevel, st);
      this.lastLevel = this.lockedLevel;
      this.lockedLevel = null;
    }
    return 'travel';
  }

  // ------------------------------------------------------------------ ENDGAME
  /** Segundos de holgura con que sale hacia la Crítica (además de lo que tarda en llegar): lo que duda al arrancar y un poco más. */
  private critLead(): number {
    return 2.5 + this.profile.reaction + this.profile.jitter;
  }

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
    return Math.abs(posScoreTip(this.robot.spec, 4).x) - 0.05;
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
    // Dónde va de verdad la Crítica: la Garrita (Psycho) la sujeta donde la tomó, hasta 35 cm más allá de su
    // asiento; con la punta del brazo en la pose 4 la soltaba a 18 cm de la orilla lejana y a veces se caía
    const tip = r.mech.critical && critSeat(s) ? Math.abs(r.phys.critGripLocal(posAngle(s, 4)).x) : Math.abs(posScoreTip(s, 4).x);
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
    // La persona de su alianza ya está en la rendija de la Crítica en el ENDGAME: se la deja (no se pelean la Campana)
    if (!m.critical && endgame && this.team.humanNear(this.critStage(), 1.0) && !this.team.humanNear(pos, 0.5)) {
      this.criticalDone = true;
      this.mode = 'climb';
      return;
    }
    if (!m.critical) {
      // Lleva 3 s intentando y no la toma (la garra no la alcanza en la rendija): a la Plataforma, que todavía vale 10–20
      if (crit.state.at !== 'field' || (endgame && this.critTries > 3)) {
        if (crit.state.at === 'field' && !m.critical) this.team.critFailed(r.index);
        this.criticalDone = true;
        this.mode = 'climb';
        return;
      }
      // La garra va vacía: si trae una Muestra, la suelta
      // (con la garra fija de la Crítica, Psycho, la caja del brazo puede ir llena: son mecanismos distintos)
      if (m.inClaw && m.inHopper >= m.capacity - 1 && !critSeat(r.spec)) {
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
      // Garra encendida ya cerca de la rendija. Encendida todo el camino volvía a tomar la Muestra que acababa de soltar
      // (arriba): la soltaba y la tomaba sin moverse hasta el final del match (Pivote con la Crítica asignada)
      out.intake = near;
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
    // Topó con el escalón de la Repisa antes de llegar (el brazo en alto choca antes que el chasis): ya no se acerca más,
    // la suelta ahí (antes iba y venía hasta la bocina con la Crítica en la garra)
    const v0 = r.phys.body.linvel();
    this.critBlockT = onTop && this.side * pos.x < stop + 0.45 && Math.hypot(v0.x, v0.z) < 0.05 ? this.critBlockT + 1 / HZ : 0;
    if (onTop && (this.side * pos.x <= stop + 0.06 || this.critBlockT > 0.3)) {
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
    const foot = this.foot();
    // Junto al pie pero fuera de su carril (con una rueda fuera de la rampa se atora; girando hacia un punto a 20 cm
    // se quedaba yendo y viniendo): se acomoda desde 55 cm más atrás, una vez cada 4 s
    if (st === 'away' && !this.restage && this.age - this.restageAt > 4 && Math.hypot(foot.x - pos.x, foot.z - pos.z) < 0.7) {
      this.restage = true;
      this.restageAt = this.age;
      this.restageBack = this.behind(this.climbStage());
    }
    if (this.restage) {
      const w = this.climbStage();
      if (Math.hypot(w.x - pos.x, w.z - pos.z) < 0.12 || this.age - this.restageAt > 3) this.restage = false;
      else {
        this.drive(w, out, true, phase, false, this.restageBack);
        return;
      }
    }
    if (st === 'away') this.drive(foot, out, true, phase);
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
    // Ya llegó a su carril: más tolerancia para no alternar entre ir al punto (girando hacia él) y
    // girar hacia la rampa cuando queda justo en el borde
    const tol = onRamp ? 0.3 : this.footLatch ? 0.25 : 0.12;
    if (sx > 2.95 || sx < 0.4 || Math.abs(pos.z - this.lane()) > tol) {
      this.footLatch = false;
      return 'away';
    }
    this.footLatch = true;
    const want = (this.side > 0 ? Math.PI : 0) + (dir < 0 ? Math.PI : 0);
    return onRamp || Math.abs(wrap(want - this.robot.phys.heading())) < 0.3 ? 'ready' : 'turn';
  }

  private footLatch = false;
  /** Robot parado en su objetivo al que está esperando (`drive`), o null. */
  waitOn: number | null = null;
  /** Segundos parado sobre la Plataforma con la Crítica sin llegar a su punto (topó con el escalón). */
  private critBlockT = 0;
  /** Acomodándose desde atrás del pie de la rampa (`climb`): desde cuándo y si va de reversa. */
  private restage = false;
  private restageAt = -Infinity;
  private restageBack = false;

  /** Frente al Nivel 3 de la Cámara rival (papel 'block'). */
  private blockPose(): { x: number; z: number } {
    const w = F.camaraWells()[3];
    return F.forCamara(opponent(this.robot.alliance), { x: (w.x0 + w.x1) / 2, z: F.CAMARA_Z_RED[0] - this.robot.phys.halfL - 0.25 });
  }

  // ------------------------------------------------------------------ manejo
  /** ¿Hay un rival (o cualquier robot, con `any`) a menos de `d` m en esa dirección (+1 adelante, −1 atrás, ±`cone` rad)? */
  private rivalNear(dir: number, d: number, any = false, cone = 1.2): boolean {
    const r = this.robot;
    const pos = r.phys.position();
    const h = r.phys.heading() + (dir < 0 ? Math.PI : 0);
    return this.others.some((o) => {
      if (o === r || (!any && o.alliance === r.alliance)) return false;
      const op = o.phys.position();
      const od = Math.hypot(op.x - pos.x, op.z - pos.z);
      return od < d && Math.abs(wrap(Math.atan2(-(op.z - pos.z), op.x - pos.x) - h)) < cone;
    });
  }

  /**
   * Persecución para tanque: gira hacia el punto y avanza según qué tan alineado va. Rodea la
   * Plataforma si el camino la cruza (salvo `allowPlatform`), se desvía de los otros robots y no
   * avanza hacia un rival que tenga enfrente (§4.5: el que se acerca comete la falta). `reverse`
   * maneja de reversa (el mecanismo atrás). `slowDist`: distancia para frenar (por defecto la del punto).
   */
  /** El paso anterior salía de reversa de junto a la Plataforma (`drive`). */
  private platRev = false;

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
    // Rodeando a un robot con el que se topó: sigue el camino de la rejilla (ya evita la Plataforma)
    if (this.planT > 0 && !allowPlatform) {
      this.planT -= 1 / HZ;
      this.planCd -= 1 / HZ;
      if (this.planCd <= 0) {
        this.planCd = 0.25;
        this.pathWp = this.pathWaypoint(pos, goal, phase);
      }
    } else this.pathWp = null;
    const planned = !!this.pathWp && Math.hypot(goal.x - pos.x, goal.z - pos.z) > 0.4;
    if (planned && this.pathWp === WAIT) {
      // Todo el paso cerrado (otros robots en los dos pasillos): espera donde está y vuelve a buscar
      out.forward = 0;
      out.turn = 0;
      return;
    }
    if (planned) g = this.pathWp!;
    else {
      if (!allowPlatform) g = this.avoidPlatform(pos, g);
      g = this.avoidBarrier(pos, g);
    }
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
        const wary = this.isWary(o);
        const R = (rival ? 1.3 : still ? 1.1 : precise ? 0.8 : 1.0) + (wary ? 0.4 : 0);
        if (od > R || od < 1e-3 || od > dist + 0.4) continue;
        // Solo si el otro queda hacia donde va
        const ahead = -(ox * ax + oz * az) / od;
        if (ahead < -0.2) continue;
        const w = ((R - od) / R) * (rival ? 1.8 : still ? 1.5 : 1.0) * (wary ? 1.5 : 1);
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
      // Antes del ENDGAME ni rozar la Plataforma: lejos de su orilla (la esquina del chasis al girar la alcanza)
      if (!allowPlatform) {
        const px = Math.max(Math.abs(pos.x) - F.PLATFORM_LENGTH / 2, 0);
        const pz = Math.max(Math.abs(pos.z) - F.PLATFORM_WIDTH / 2, 0);
        const pd = Math.hypot(px, pz);
        if (pd < PLATFORM_GUARD && pd > 1e-3) {
          const w = ((PLATFORM_GUARD - pd) / PLATFORM_GUARD) * 2.5;
          ax += (Math.sign(pos.x) * (px / pd)) * w;
          az += (Math.sign(pos.z) * (pz / pd)) * w;
        }
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
    // Junto a la Plataforma (antes del ENDGAME no se puede ni rozar) sale de reversa si le queda atrás. Con histéresis:
    // justo en la orilla de esa franja (un milímetro adentro, uno afuera) alternaba cada paso entre de frente y de reversa,
    // con el giro hacia un lado y luego hacia el otro, y se quedaba ahí segundos sin girar ni avanzar (Phoenix en Experto
    // al salir de la Campana: ≈3 s por match)
    const mg = this.platRev ? 0.15 : 0;
    let platRev = false;
    if (!allowPlatform && !reverse && Math.abs(pos.x) < F.PLATFORM_LENGTH / 2 + PLATFORM_CLEAR + mg && Math.abs(pos.z) < F.PLATFORM_WIDTH / 2 + PLATFORM_CLEAR + mg) {
      if (Math.abs(wrap(Math.atan2(-dz, dx) - r.phys.heading())) > Math.PI / 2 + (this.platRev ? -0.2 : 0.2)) platRev = reverse = true;
    }
    this.platRev = platRev;
    const want = Math.atan2(-dz, dx) + (reverse ? Math.PI : 0);
    const err = wrap(want - r.phys.heading());
    out.turn = clamp1(err * 2.2);
    const align = Math.max(0, Math.cos(err));
    const sd = slowDist ?? dist;
    const f = align * align * Math.min(1, sd / (precise ? 0.6 : 0.35)) * (precise ? 0.8 : 1);
    out.forward = (reverse ? -1 : 1) * Math.max(f, sd > 0.05 && align > 0.9 ? 0.12 : 0);
    // Rival enfrente y cerca (en el sentido de avance): no avanzar hacia él. Siguiendo un camino de
    // la rejilla (ya le deja espacio) solo si lo tiene casi de frente
    const wanted = out.forward;
    const cone = planned ? 0.5 : 1.2;
    if (this.rivalNear(reverse ? -1 : 1, planned ? 0.8 : 1.0, false, cone)) out.forward = 0;
    else if (this.rivalNear(reverse ? -1 : 1, 1.4, false, cone)) out.forward *= 0.4;
    // Cualquier otro robot (su compañero, el del jugador) enfrente y cerca: no más rápido de lo que
    // daña un golpe (`DAMAGE.threshold`, D36), con margen
    else if (this.rivalNear(reverse ? -1 : 1, 0.95, true)) out.forward = clamp(out.forward, (DAMAGE.threshold * 0.8) / (r.spec.maxSpeed * this.profile.speed));
    // Otro robot parado justo en su objetivo (el del jugador en su lugar de espera, uno dañado):
    // espera cerca a que se quite en vez de empujarlo
    // (si es su compañero de IA y él también lo espera a él, pasa el de índice menor: se quedaban los dos parados)
    const blocker = allowPlatform ? undefined : this.others.find((o) => o !== r && isStill(o) && Math.hypot(o.phys.position().x - goal.x, o.phys.position().z - goal.z) < 0.55 && Math.hypot(o.phys.position().x - pos.x, o.phys.position().z - pos.z) < 1.15);
    const mutual = blocker && this.team.members.some((b) => b.robot === blocker && b.waitOn === r.index) && r.index < blocker.index;
    this.waitOn = blocker && !mutual ? blocker.index : null;
    if (this.waitOn !== null) out.forward = 0;
    // Detenido por otro robot que le tapa el camino: tras un momento, busca por dónde rodearlo
    const held = Math.abs(wanted) > 0.1 && Math.abs(out.forward) < 0.02;
    this.holdT = held ? this.holdT + 1 / HZ : 0;
    if (this.holdT > 0.6 && this.planT <= 0 && !allowPlatform) {
      this.holdT = 0;
      this.planT = 3;
      this.planCd = 0;
    }
    // Atorado: si en 2.5 s no se acercó 0.15 m al objetivo, retrocede girando y (si iba por una
    // Muestra) la ignora un rato
    if (!this.lastGoal || Math.hypot(goal.x - this.lastGoal.x, goal.z - this.lastGoal.z) > 0.3) {
      this.bestDist = Infinity;
      this.progressT = 0;
    }
    this.lastGoal = goal;
    // Solo cuenta si de verdad intenta moverse: esperando a propósito (un robot parado en su objetivo, su turno en la
    // Cámara) el atorón lo hacía retroceder a ciegas, y junto a la Plataforma se subía antes del ENDGAME (§4.6)
    // (lo que de verdad se aplicó el paso anterior: el filtro de la orilla o de la Plataforma puede detenerlo)
    const applied = r.phys.lastCmd;
    if ((Math.abs(out.forward) > 0.05 || Math.abs(out.turn) > 0.3) && (Math.abs(applied.forward) > 0.05 || Math.abs(applied.turn) > 0.3)) this.progressT += 1 / HZ;
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
      if (this.mode === 'collect' && this.targetPiece >= 0) this.shun(this.targetPiece, 8);
      this.targetPiece = -1;
    }
  }

  /**
   * ¿Puede avanzar ~50 cm en el sentido `dir` (+1 al frente, −1 de reversa) sin pisar la Plataforma antes del
   * ENDGAME (§4.6) ni salirse de la cancha? Mira las dos esquinas de ese lado del chasis.
   */
  private roomToward(dir: number, phase: Phase): boolean {
    const p = this.robot.phys;
    const pos = p.position();
    const h = p.heading();
    const fx = Math.cos(h) * dir;
    const fz = -Math.sin(h) * dir;
    const px = F.PLATFORM_LENGTH / 2 + 0.08;
    const pz = F.PLATFORM_WIDTH / 2 + 0.08;
    for (const side of [-1, 1]) {
      const x = pos.x + fx * (p.halfL + 0.5) + fz * side * p.halfW;
      const z = pos.z + fz * (p.halfL + 0.5) - fx * side * p.halfW;
      if (Math.abs(x) > F.HALF_L - 0.02 || Math.abs(z) > F.HALF_W - 0.02) return false;
      if (phase !== 'ENDGAME' && Math.abs(x) < px && Math.abs(z) < pz) return false;
    }
    return true;
  }

  /**
   * Filtro final: predice dónde quedan las esquinas del chasis con el mando y, si alguna saldría de la
   * cancha o (antes del endgame) tocaría la Plataforma, usa la alternativa que menos invade.
   */
  private guard(out: BotOutput, platformOk: boolean): void {
    const p = this.robot.phys;
    const pos = p.position();
    const h0 = p.heading();
    const v0 = p.body.linvel();
    const hl = p.halfL;
    const hw = p.halfW;
    const px = F.PLATFORM_LENGTH / 2 + 0.11;
    const pz = F.PLATFORM_WIDTH / 2 + 0.11;
    // Margen a la orilla (m); 0 al despegarse de un rincón (usa lo que le queda, sin salirse)
    let edge = 0.03;
    const invasion = (f: number, t: number, plat = !platformOk, withEdge = edge >= 0): number => {
      const h = h0 + t * this.robot.spec.maxOmega * 0.8 * 0.15;
      const d = f * this.robot.spec.maxSpeed * 0.15;
      // Más lo que ya trae de inercia (frenar no es instantáneo)
      const cx = pos.x + Math.cos(h0) * d + v0.x * 0.1;
      const cz = pos.z - Math.sin(h0) * d + v0.z * 0.1;
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
    for (const f of [-0.5, -0.3, -0.12, 0, 0.12, 0.3, 0.5]) for (const t of [-1, -0.6, -0.15, 0, 0.15, 0.6, 1]) options.push([f, t]);
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
      const across = p.x > cx !== q.x > cx;
      // Ya pegado a la barra: si el objetivo queda del mismo lado, que lo saque el filtro
      if (Math.abs(p.x - cx) <= hx && p.z <= z1 && !across) continue;
      // Del otro lado de la barra y a su altura (saliendo de la Campana): primero sale derecho por su lado, más allá de la
      // punta. Ir a la esquina del otro lado cortaba la punta de la barra y se quedaba empujándola (≈1.5 s cada vez, al
      // salir de la Campana para dejársela a la persona)
      const k = across && p.z < z1 + 0.1 ? (p.x > cx ? 1 : -1) : q.x > cx ? 1 : -1;
      const wp = { x: cx + k * (hx + 0.15), z: z1 + 0.25 };
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
    // Dentro del margen: primero salir hacia afuera (sin rozar la Plataforma), por la salida más corta
    // que no tape otro robot (si no, se le echa encima de reversa). A centímetros de su orilla ya cuenta como afuera:
    // justo en la orilla alternaba entre salir 10 cm hacia atrás y la esquina de al lado, de frente y de reversa
    // cada pocos pasos, sin moverse (Phoenix al salir de la Campana hacia la Cámara: ≈3 s por match)
    const edge = 0.12;
    if (Math.abs(pos.x) < hx - edge && Math.abs(pos.z) < hz - edge) {
      const exits = [{ x: (Math.sign(pos.x) || this.side) * cx, z: pos.z }, { x: pos.x, z: sz * cz }];
      // Frente a una rampa (pasado su extremo) también puede salir por el otro lado
      if (Math.abs(pos.x) > F.PLATFORM_LENGTH / 2 + 0.1) exits.push({ x: pos.x, z: -sz * cz });
      let best = exits[0];
      let bestC = Infinity;
      for (const e of exits) {
        const crowded = this.others.some((o) => o !== this.robot && segPointDist(pos, e, o.phys.position()) < 0.75);
        const c = Math.hypot(e.x - pos.x, e.z - pos.z) + (crowded ? 3 : 0);
        if (c < bestC) {
          bestC = c;
          best = e;
        }
      }
      return best;
    }
    // En un extremo (frente a una rampa): primero a la esquina de ese extremo, del lado del objetivo
    if (Math.abs(pos.z) < hz - edge) return { x: (Math.sign(pos.x) || this.side) * cx, z: (Math.sign(goal.z) || sz) * cz };
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

/** Marca de `pathWaypoint`: no hay camino libre, esperar. */
const WAIT = { x: NaN, z: NaN };

/** Zonas de anotación rivales que no puede obstruir más de 3 s (§4.6, D17), por alianza propia. */
const RIVAL_ZONES: Record<Alliance, F.Rect[]> = { red: obstructZones('blue'), blue: obstructZones('red') };

/** Las dos Cámaras (§3.2.3) con 15 cm de margen: la garra y la pieza que lleva sobresalen de su punta. */
const CAMARAS: readonly F.Rect[] = (['red', 'blue'] as const).map((a) =>
  F.rectFor(a, { x0: F.CAMARA_X_END_RED - F.CAMARA_LENGTH - 0.15, x1: F.CAMARA_X_END_RED + 0.15, z0: F.CAMARA_Z_RED[0] - 0.15, z1: F.HALF_W }),
);

/** ¿El robot está casi parado? (el del jugador sin moverse, uno dañado o trabado) */
function isStill(o: Robot): boolean {
  const v = o.phys.body.linvel();
  return Math.hypot(v.x, v.z) < 0.3;
}

/** Distancia del punto `p` al segmento a–b. */
function segPointDist(a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
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
