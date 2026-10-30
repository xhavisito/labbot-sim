/**
 * Sesión de juego: une física (cancha, piezas, robots), lógica del match, árbitro, Human Players,
 * AUTO y render. Paso fijo con interpolación.
 *
 * Modos: 'practice' (sin reloj; los sensores igual detectan anotaciones; con `solo` solo existe el
 * robot del jugador) y 'match' (150 s con puntuación, faltas y RP).
 */
import * as THREE from 'three';
import { Bot, type AutoPlan, type BotOptions, type BotOutput } from '../ai/Bot';
import type { AiLevel } from '../ai/difficulty';
import { Team } from '../ai/Team';
import { AUTO_REF_SPEED, AutoRunner, LEAVE_ZONE, type AutoOutput, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { GAME, type GameConfig } from '../config/game';
import { DEFAULT_ROBOT, type RobotSpec } from '../config/robot';
import type { StartSpot } from '../config/startSpot';
import { isTeleop, robotsEnabled, type Phase } from '../core/clock';
import { DEFAULT_DAMAGE, type DamageSettings } from '../core/damage';
import { Match, type MatchEvent } from '../core/match';
import { rng } from '../core/rng';
import type { TimedEvent } from '../core/matchLog';
import { ALLIANCES, opponent, type Alliance, type Level } from '../core/types';
import type { PlayerInput } from '../input/InputManager';
import { buildFieldColliders } from '../physics/FieldColliders';
import { Pieces } from '../physics/Pieces';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Referee } from '../referee/Referee';
import { buildFieldView } from '../render/FieldView';
import { PieceView } from '../render/PieceView';
import { RobotView } from '../render/RobotView';
import { SinkView } from '../render/SinkView';
import { Damage, type DamageEvent } from './Damage';
import { HumanPlayer } from './HumanPlayer';
import type { GripMode, MechEvent } from './Mechanisms';
import { Robot } from './Robot';
import { Sensors } from './Sensors';

export const PHYSICS_HZ = 120;

/** Muestra anotada en un paso (pieza, Cámara, nivel y puntos que dio; 0 en práctica). */
export interface ScoredSample {
  piece: number;
  alliance: Alliance;
  level: Level;
  points: number;
}

/** Observador de cada paso fijo (la grabadora de repeticiones, `replay/Recorder.ts`). */
export interface SessionTap {
  step(s: GameSession, mech: readonly MechEvent[], scored: readonly ScoredSample[]): void;
}

export interface SessionOptions {
  /** Robot que maneja el jugador (0–1 rojo, 2–3 azul). */
  player: number;
  /** Precarga de 1 Muestra por robot (§4.1). */
  preload: boolean;
  specs?: RobotSpec[];
  /** Rutina de AUTO de cada robot (por defecto, salir de la zona). */
  autos?: AutoRoutine[];
  game?: GameConfig;
  /** La IA maneja los robots que no son del jugador en el TELEOP. */
  ai?: boolean;
  /** Human Player automático: encendido y segundos entre Muestras (SUPUESTO, ver HumanPlayer). */
  hp?: { enabled: boolean; interval: number; smart?: boolean };
  /**
   * Práctica libre: solo se crea el robot del jugador (sin aliado ni rivales), su Human Player
   * mete Muestras sin límite y las Cámaras tienen un "vacío" que se traga lo anotado (nunca se
   * llenan). Nada de esto aplica al match (§4.1.1: 10 Muestras por HP).
   */
  solo?: boolean;
  /**
   * Práctica 1 contra 1 (`ui/Practice1v1.ts`, solo con `solo`): además de tu robot, el de enfrente
   * en la otra alianza. 'passive' = se queda quieto en su Zona de Inicio (un obstáculo); 'ai' = la
   * IA lo maneja y anota en su Cámara, sin defender ni subir a la Plataforma; su Human Player le
   * mete Muestras y su Cámara también tiene el vacío. SUPUESTO de diseño (el manual no tiene práctica).
   */
  rival?: 'none' | 'passive' | 'ai';
  /** Estrategia de la IA de cada robot (nivel, de dónde junta, papel, ENDGAME; `ai` = su dificultad). */
  bots?: Array<Partial<BotOptions> | undefined>;
  /** Dificultad de la IA de los robots que no la traen en `bots` (`ai/difficulty.ts`; por defecto difícil). */
  aiLevel?: AiLevel;
  /** Lugar de cada robot en su Zona de Inicio (§4.1, `config/startSpot.ts`); por defecto centrado. */
  starts?: Array<StartSpot | undefined>;
  /** Agarre de la garra (`game/Mechanisms.ts`): con compliants (por defecto), preciso o fácil. */
  grip?: GripMode;
  /** Fallas por golpes y al azar (`core/damage.ts`); por defecto apagadas (las pruebas y la simulación por lotes). */
  damage?: DamageSettings;
  /** Semilla del azar de la física (agarre y fallas); por defecto 1 (reproducible: pruebas y lotes). */
  seed?: number;
  /** Otra IA para algunos robots (comparar versiones en `sim/batch.ts`); null = la de siempre. */
  makeBot?: (r: Robot, opts: Partial<BotOptions> & { auto: AutoPlan; teleop: boolean }, all: Robot[], pieces: Pieces) => BotDriver | null;
}

/** Lo que la sesión necesita de una IA (la de `ai/Bot.ts`, u otra para comparar en la simulación por lotes). */
export interface BotDriver {
  readonly opts: { auto: AutoPlan; teleop: boolean };
  step(dt: number, phase: Phase, timeLeft: number): BotOutput;
}

export class GameSession {
  readonly pw = new PhysicsWorld(PHYSICS_HZ);
  readonly pieces: Pieces;
  readonly robots: Robot[] = [];
  readonly sensors: Sensors;
  readonly referee: Referee;
  readonly hps: Record<Alliance, HumanPlayer>;
  /** Muestras del Human Player rival que anotó cada alianza en el match (las robó de su Campana). */
  readonly stolen: Record<Alliance, number> = { red: 0, blue: 0 };
  /** Fallas de los robots (golpes contra la pared u otros robots, y al azar). */
  readonly damage: Damage;
  /** Eventos de fallas del cuadro (los consume la UI y se vacían en `setInput`). */
  readonly damageEvents: DamageEvent[] = [];
  readonly root = new THREE.Group();
  readonly game: GameConfig;
  match: Match | null = null;
  /** Eventos del cuadro (los consume la UI y se vacían en `setInput`). */
  readonly events: MechEvent[] = [];
  readonly matchEvents: MatchEvent[] = [];
  /** Todos los eventos del match con su tiempo (para el registro exportable). */
  readonly log: TimedEvent[] = [];
  /** Muestras anotadas en práctica (sin match), por alianza. */
  readonly practiceCount: Record<Alliance, number> = { red: 0, blue: 0 };
  /** Dónde se anotó cada Muestra en los pasos del último `update` (partículas y público). */
  readonly scoreFx: Array<{ x: number; y: number; z: number; alliance: Alliance }> = [];
  /** Práctica libre: Muestras anotadas esperando a que el vacío de la Cámara se las trague (índice → s). */
  private sink = new Map<number, { t: number; alliance: Alliance }>();
  private sinkView: SinkView | null = null;
  private pieceView: PieceView;
  private robotViews: RobotView[] = [];
  private autos: AutoRunner[] = [];
  /** IA de cada robot (AUTO de IA y/o TELEOP), coordinada por alianza en un `Team`. */
  bots: Array<BotDriver | null> = [];
  private acc = 0;
  private input: PlayerInput | null = null;
  private stepMechEvents: MechEvent[] = [];
  /** Tiempo de simulación (s). */
  time = 0;
  /** Observador de cada paso (grabadora de la repetición); null = nadie graba. */
  tap: SessionTap | null = null;
  /** Práctica de AUTO: rutina que maneja al robot del jugador fuera del match (ignora sus controles). */
  pilot: AutoRunner | null = null;
  /** Práctica de AUTO: recibe lo que hizo el jugador en cada paso (para grabar la ruta). */
  inputTap: ((o: AutoOutput) => void) | null = null;
  /** Acciones de un disparo del jugador desde el último paso (para `inputTap`). */
  private tapActs: Omit<AutoOutput, 'forward' | 'turn'> = {};

  constructor(readonly opts: SessionOptions = { player: 0, preload: true }) {
    this.game = opts.game ?? GAME;
    buildFieldColliders(this.pw);
    this.pieces = new Pieces(this.pw);
    this.sensors = new Sensors(this.pieces);
    this.hps = { red: new HumanPlayer('red', this.pieces), blue: new HumanPlayer('blue', this.pieces) };
    for (const a of ALLIANCES) {
      this.hps[a].enabled = opts.hp?.enabled ?? true;
      this.hps[a].interval = opts.hp?.interval ?? this.hps[a].interval;
      this.hps[a].smart = opts.hp?.smart ?? true;
      this.hps[a].robots = this.robots;
    }
    this.root.add(buildFieldView());
    if (opts.solo) {
      this.sinkView = new SinkView();
      this.root.add(this.sinkView.group);
    }
    this.pieceView = new PieceView(this.pieces);
    this.root.add(this.pieceView.group);
    for (let i = 0; i < 2 * F.ROBOTS_PER_ALLIANCE; i++) {
      if (opts.solo && i !== opts.player && i !== this.rivalIndex) continue;
      const r = new Robot(this.pw, this.pieces, i, i < 2 ? 'red' : 'blue', (i % 2) as 0 | 1, opts.specs?.[i] ?? DEFAULT_ROBOT, opts.starts?.[i]);
      this.robots.push(r);
      const v = new RobotView(r, i === opts.player);
      this.robotViews.push(v);
      this.root.add(v.group);
    }
    const rand = rng(opts.seed ?? 1);
    for (const r of this.robots) {
      r.mech.grip = opts.grip ?? 'compliant';
      r.mech.rand = rand;
    }
    this.damage = new Damage(this.robots, opts.damage ?? { ...DEFAULT_DAMAGE, level: 'off' }, rand, opts.player, this.pw.dt);
    this.robots.forEach((r, i) => (this.robotViews[i].faults = () => this.damage.faults(r.index)));
    this.referee = new Referee(this.pw, this.robots, () => this.match, { pieces: this.pieces, sensors: this.sensors });
    this.resetField();
  }

  /** Índice del robot rival de la práctica 1 contra 1 (el de enfrente: misma posición, otra alianza); −1 sin rival. */
  get rivalIndex(): number {
    const o = this.opts;
    if (!o.solo || !o.rival || o.rival === 'none' || o.player < 0) return -1;
    return o.player < 2 ? o.player + 2 : o.player - 2;
  }

  /** Robot rival de la práctica 1 contra 1 (si hay). */
  get rival(): Robot | null {
    return this.robots.find((r) => r.index === this.rivalIndex) ?? null;
  }

  get player(): Robot {
    return this.robots.find((r) => r.index === this.opts.player) ?? this.robots[0];
  }

  /** Fase actual ('PRE' en práctica, sin match). */
  get phase(): Phase {
    return this.match?.phase ?? 'PRE';
  }

  /** Segundos que una Muestra anotada se queda a la vista antes de que el vacío la regrese al HP. */
  static readonly SINK_DELAY = 1;

  /** Acomodo inicial (§4.1): piezas en su lugar, robots en su Zona de Inicio con su precarga. */
  resetField(): void {
    this.pieces.reset();
    this.sensors.reset();
    this.referee.reset();
    for (const a of ALLIANCES) {
      this.hps[a].reset();
      this.stolen[a] = 0;
      this.practiceCount[a] = 0;
    }
    this.damage.reset();
    for (const r of this.robots) {
      r.resetPose();
      if (this.opts.preload) {
        const s = this.pieces.hpStock(r.alliance)[0];
        if (s) r.mech.load(s);
      }
    }
    // Práctica libre: toda la reserva (la del otro HP y las precargas sin robot) es del HP del jugador;
    // con un rival de la IA, cada HP se queda con la suya
    this.sink.clear();
    if (this.opts.solo && this.opts.rival !== 'ai') for (const p of this.pieces.list) if (p.kind === 'sample' && p.state.at === 'hp') p.state = { at: 'hp', alliance: this.player.alliance };
    // Rival de la práctica 1 contra 1 manejado por la IA (nuevo en cada acomodo): anota a su ritmo,
    // sin defensa ni ENDGAME
    const rv = this.rival;
    if (rv && this.opts.rival === 'ai') {
      this.bots = [];
      const o = { ai: this.opts.aiLevel ?? 'normal', auto: 'none', teleop: true, role: 'score', endgame: 'none' } as const;
      this.bots[rv.index] = new Bot(rv, this.pieces, this.robots, o, new Team(rv.alliance, this.hps[rv.alliance]));
    }
    this.pieceView.capture();
    this.pieceView.capture();
    for (const v of this.robotViews) {
      v.capture();
      v.capture();
    }
  }

  /** Empieza un match nuevo de 150 s desde el acomodo inicial. */
  startMatch(): void {
    if (this.opts.solo) throw new Error('una sesión solo es de práctica: el match necesita los 4 robots');
    this.resetField();
    this.match = new Match(this.game, F.ROBOTS_PER_ALLIANCE);
    this.log.length = 0;
    this.autos = this.robots.map((r) => new AutoRunner(this.opts.autos?.[r.index] ?? LEAVE_ZONE));
    const teams = { red: new Team('red', this.hps.red), blue: new Team('blue', this.hps.blue) };
    this.bots = this.robots.map((r) => {
      const routine = this.autos[r.index].routine.bot;
      const teleop = !!this.opts.ai && r.index !== this.opts.player;
      if (!routine && !teleop) return null;
      // El robot del jugador con AUTO de IA juega como "difícil" (es su rutina, no un rival)
      const ai = teleop ? (this.opts.aiLevel ?? 'hard') : 'hard';
      const o = { ai, ...this.opts.bots?.[r.index], auto: (routine ? (routine.scoreOnly ? 'preload' : 'collect') : 'none') as AutoPlan, teleop };
      return this.opts.makeBot?.(r, o, this.robots, this.pieces) ?? new Bot(r, this.pieces, this.robots, o, teams[r.alliance]);
    });
    this.match.start();
  }

  /** Vuelve a práctica libre (sin reloj). */
  practice(): void {
    this.match = null;
    this.bots = [];
    this.resetField();
  }

  /** Entrada del jugador para el siguiente cuadro. */
  setInput(inp: PlayerInput): void {
    this.input = inp;
    this.events.length = 0;
    this.matchEvents.length = 0;
    this.damageEvents.length = 0;
    // En AUTO el robot sigue su rutina; fuera del match habilitado (PRE en match, DONE) no se mueve
    if (!this.playerEnabled() || this.pilot || this.damage.disabled(this.player.index)) return;
    const m = this.player.mech;
    const a = this.tapActs;
    // Un solo botón por acción para las dos piezas (Xhavi, 30-oct): la garra trabaja solo mientras se
    // mantiene presionado; al soltarlo se apaga. Con el botón presionado toma la Muestra Crítica en
    // cuanto la tiene al alcance y a su altura; si no, agarra Muestras. Soltar suelta lo que traiga
    // en la garra.
    if (inp.intake && !m.critical && m.grabCritical(this.stepMechEvents)) a.grabCritical = true;
    if (m.intakeOn !== inp.intake) a.intake = m.intakeOn = inp.intake;
    if (inp.elevator !== null) a.elevator = m.target = inp.elevator;
    if (inp.releaseSample) {
      if (m.critical) a.releaseCritical = m.release('critical', this.stepMechEvents) || undefined;
      else a.release = m.release('sample', this.stepMechEvents) || undefined;
    }
  }

  /** ¿El jugador controla su robot ahora? (práctica o TELEOP) */
  playerEnabled(): boolean {
    // Sin jugador (ver un match del torneo) los controles no mueven a nadie
    if (this.opts.player < 0) return false;
    return !this.match || isTeleop(this.match.phase);
  }

  /** Un paso fijo de física. */
  step(): void {
    const dt = this.pw.dt;
    const m = this.match;
    const phase = this.phase;
    const enabled = !m || robotsEnabled(phase);
    for (const r of this.robots) {
      let forward = 0;
      let turn = 0;
      let slow = false;
      const b = this.bots[r.index];
      // Sin comunicación (falla) el robot no recibe mandos: se queda quieto
      const off = this.damage.disabled(r.index);
      // Sin match solo corre la IA del rival de la práctica 1 contra 1 (juega como en el TELEOP)
      const bot = !b || off ? null : !m ? (b.opts.teleop ? b : null) : phase === 'AUTO' ? (b.opts.auto !== 'none' ? b : null) : isTeleop(phase) && b.opts.teleop ? b : null;
      const runner = off ? null : m && phase === 'AUTO' ? this.autos[r.index] : !m && r === this.player ? this.pilot : null;
      if (bot) {
        const o = bot.step(dt, m ? phase : 'TELEOP', m ? m.remaining : Infinity);
        forward = o.forward;
        turn = o.turn;
        r.mech.intakeOn = o.intake;
        r.mech.target = o.elevator;
        if (o.release) r.mech.release('sample', this.stepMechEvents);
        if (o.grabCritical) r.mech.grabCritical(this.stepMechEvents);
        if (o.releaseCritical) r.mech.release('critical', this.stepMechEvents);
      } else if (runner) {
        const o = runner.step(dt);
        forward = Math.max(-1, Math.min(1, o.raw ? o.forward : (o.forward * AUTO_REF_SPEED) / r.spec.maxSpeed));
        turn = o.turn;
        if (o.elevator !== undefined) r.mech.target = o.elevator;
        if (o.intake !== undefined) r.mech.intakeOn = o.intake;
        if (o.release) r.mech.release('sample', this.stepMechEvents);
        if (o.grabCritical) r.mech.grabCritical(this.stepMechEvents);
        if (o.releaseCritical) r.mech.release('critical', this.stepMechEvents);
      } else if (enabled && !off && r === this.player && this.input) {
        forward = this.input.forward;
        turn = this.input.turn;
        slow = this.input.slow;
        const k = slow ? 0.5 : 1;
        this.inputTap?.({ forward: forward * k, turn: turn * k, ...this.tapActs });
        this.tapActs = {};
      }
      if (!enabled || off) r.mech.intakeOn = false;
      const k = slow ? 0.5 : 1;
      r.phys.drive({ forward: forward * r.spec.maxSpeed * k, turn: turn * r.spec.maxOmega * 0.8 * k }, dt);
      r.mech.step(dt, this.stepMechEvents);
    }
    // Human Player: Muestras por la ranura durante todo el TeleOp (§3.2.4)
    if (m && isTeleop(phase)) for (const a of ALLIANCES) this.hps[a].step(dt, phase === 'ENDGAME');
    else if (!m && this.opts.solo) {
      this.hps[this.player.alliance].step(dt, true);
      if (this.bots.some(Boolean)) this.hps[opponent(this.player.alliance)].step(dt, true);
    }
    this.damage.beforeStep();
    this.pw.step();
    this.time += dt;
    this.referee.drainCollisions();
    this.damageEvents.push(...this.damage.afterStep(dt, enabled, this.stepMechEvents));

    // Sensores → puntuación
    const scored: ScoredSample[] = [];
    for (const s of this.sensors.newSamples()) {
      const at = s.piece.body.translation();
      this.scoreFx.push({ x: at.x, y: at.y, z: at.z, alliance: s.alliance });
      // En práctica también se avisa (0 puntos): la práctica de AUTO y los retos llevan su cuenta
      scored.push({ piece: s.piece.index, alliance: s.alliance, level: s.level, points: m ? m.scoreSample(s.alliance, s.level, s.piece.lastRobot) : 0 });
      // Robada: la metió el Human Player rival y la anotó esta alianza
      if (m && this.hps[opponent(s.alliance)].fed.has(s.piece.index)) this.stolen[s.alliance]++;
      if (!m) {
        this.practiceCount[s.alliance]++;
        if (this.opts.solo) this.sink.set(s.piece.index, { t: 0, alliance: s.alliance });
      }
    }
    this.drainSink(dt);
    if (m && phase === 'AUTO') for (const r of this.robots) if (this.sensors.outOfStartZone(r)) m.crossAutoLine(r.alliance, r.index);
    this.referee.step(dt, phase, this.stepMechEvents);
    this.events.push(...this.stepMechEvents);
    const mechEvents = this.tap ? this.stepMechEvents.slice() : [];
    this.stepMechEvents.length = 0;

    if (m && !m.finished) {
      this.record(m, m.tick(dt));
      // Al sonar la bocina se evalúan Plataforma y Muestra Crítica (§4.3.1)
      if (m.phase === 'DONE') {
        const platform = { red: 0, blue: 0 };
        const onPlatform: number[] = [];
        for (const r of this.robots)
          if (this.sensors.onPlatform(r)) {
            platform[r.alliance]++;
            onPlatform.push(r.index);
          }
        const critBy = (a: Alliance) => (this.sensors.criticalOnRepisa(a) ? this.pieces.critical(a).lastRobot : undefined);
        m.finish(platform, { red: this.sensors.criticalOnRepisa('red'), blue: this.sensors.criticalOnRepisa('blue') }, { onPlatform, criticalBy: { red: critBy('red'), blue: critBy('blue') } });
        this.record(m, m.tick(0));
      }
    }
    this.pieceView.capture();
    for (const v of this.robotViews) v.capture();
    this.tap?.step(this, mechEvents, scored);
  }

  /**
   * Pone las vistas justo en la pose actual de los cuerpos, sin interpolar (la repetición mueve los
   * cuerpos a mano y nunca da pasos de física).
   */
  snapViews(): void {
    this.pieceView.capture();
    this.pieceView.capture();
    this.pieceView.sync(1);
    for (const v of this.robotViews) {
      v.capture();
      v.capture();
      v.sync(1);
    }
  }

  /** El vacío de la Cámara: las Muestras anotadas en práctica regresan a la reserva del HP. */
  private drainSink(dt: number): void {
    for (const [i, e] of this.sink) {
      if (e.t + dt < GameSession.SINK_DELAY) {
        e.t += dt;
        continue;
      }
      this.sink.delete(i);
      const p = this.pieces.list[i];
      if (p.state.at !== 'field') continue;
      // Con un rival de la IA cada Cámara le regresa la Muestra a su HP; si no, todo es del jugador
      this.pieces.stash(p, { at: 'hp', alliance: this.opts.rival === 'ai' ? e.alliance : this.player.alliance });
      this.sensors.scored.delete(i);
    }
  }

  private record(m: Match, evs: MatchEvent[]): void {
    this.matchEvents.push(...evs);
    for (const e of evs) this.log.push({ ...e, t: Math.round(m.t * 1000) / 1000 });
  }

  /** Avanza `frameDt` segundos reales en pasos fijos (máx. 0.1 s por cuadro) y sincroniza la vista. */
  update(frameDt: number): void {
    this.scoreFx.length = 0;
    this.acc += Math.min(frameDt, 0.1);
    while (this.acc >= this.pw.dt) {
      this.step();
      this.acc -= this.pw.dt;
    }
    const alpha = this.acc / this.pw.dt;
    this.pieceView.sync(alpha);
    for (const v of this.robotViews) v.sync(alpha);
    this.sinkView?.update(this.time);
  }

  dispose(): void {
    this.pw.free();
  }
}
