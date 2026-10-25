/**
 * Sesión de juego: une física (cancha, piezas, robots), lógica del match, árbitro, Human Players,
 * AUTO y render. Paso fijo con interpolación.
 *
 * Modos: 'practice' (sin reloj; los sensores igual detectan anotaciones; con `solo` solo existe el
 * robot del jugador) y 'match' (150 s con puntuación, faltas y RP).
 */
import * as THREE from 'three';
import { Bot, type BotOptions } from '../ai/Bot';
import { AutoRunner, LEAVE_ZONE, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import { GAME, type GameConfig } from '../config/game';
import { DEFAULT_ROBOT, type RobotSpec } from '../config/robot';
import { isTeleop, robotsEnabled, type Phase } from '../core/clock';
import { Match, type MatchEvent } from '../core/match';
import type { TimedEvent } from '../core/matchLog';
import { ALLIANCES, type Alliance } from '../core/types';
import type { PlayerInput } from '../input/InputManager';
import { buildFieldColliders } from '../physics/FieldColliders';
import { Pieces } from '../physics/Pieces';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Referee } from '../referee/Referee';
import { buildFieldView } from '../render/FieldView';
import { PieceView } from '../render/PieceView';
import { RobotView } from '../render/RobotView';
import { SinkView } from '../render/SinkView';
import { HumanPlayer } from './HumanPlayer';
import type { MechEvent } from './Mechanisms';
import { Robot } from './Robot';
import { Sensors } from './Sensors';

export const PHYSICS_HZ = 120;

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
  hp?: { enabled: boolean; interval: number };
  /**
   * Práctica libre: solo se crea el robot del jugador (sin aliado ni rivales), su Human Player
   * mete Muestras sin límite y las Cámaras tienen un "vacío" que se traga lo anotado (nunca se
   * llenan). Nada de esto aplica al match (§4.1.1: 10 Muestras por HP).
   */
  solo?: boolean;
  /** Estrategia de la IA de cada robot (nivel, de dónde junta, papel, ENDGAME). */
  bots?: Array<Partial<BotOptions> | undefined>;
}

export class GameSession {
  readonly pw = new PhysicsWorld(PHYSICS_HZ);
  readonly pieces: Pieces;
  readonly robots: Robot[] = [];
  readonly sensors: Sensors;
  readonly referee: Referee;
  readonly hps: Record<Alliance, HumanPlayer>;
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
  /** Práctica libre: Muestras anotadas esperando a que el vacío de la Cámara se las trague (índice → s). */
  private sink = new Map<number, number>();
  private sinkView: SinkView | null = null;
  private pieceView: PieceView;
  private robotViews: RobotView[] = [];
  private autos: AutoRunner[] = [];
  private autoBots: Array<Bot | null> = [];
  private bots: Array<Bot | null> = [];
  private acc = 0;
  private input: PlayerInput | null = null;
  private stepMechEvents: MechEvent[] = [];
  /** Tiempo de simulación (s). */
  time = 0;

  constructor(readonly opts: SessionOptions = { player: 0, preload: true }) {
    this.game = opts.game ?? GAME;
    buildFieldColliders(this.pw);
    this.pieces = new Pieces(this.pw);
    this.sensors = new Sensors(this.pieces);
    this.hps = { red: new HumanPlayer('red', this.pieces), blue: new HumanPlayer('blue', this.pieces) };
    for (const a of ALLIANCES) {
      this.hps[a].enabled = opts.hp?.enabled ?? true;
      this.hps[a].interval = opts.hp?.interval ?? this.hps[a].interval;
    }
    this.root.add(buildFieldView());
    if (opts.solo) {
      this.sinkView = new SinkView();
      this.root.add(this.sinkView.group);
    }
    this.pieceView = new PieceView(this.pieces);
    this.root.add(this.pieceView.group);
    for (let i = 0; i < 2 * F.ROBOTS_PER_ALLIANCE; i++) {
      if (opts.solo && i !== opts.player) continue;
      const r = new Robot(this.pw, this.pieces, i, i < 2 ? 'red' : 'blue', (i % 2) as 0 | 1, opts.specs?.[i] ?? DEFAULT_ROBOT);
      this.robots.push(r);
      const v = new RobotView(r);
      this.robotViews.push(v);
      this.root.add(v.group);
    }
    this.referee = new Referee(this.pw, this.robots, () => this.match);
    this.resetField();
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
      this.practiceCount[a] = 0;
    }
    for (const r of this.robots) {
      r.resetPose();
      if (this.opts.preload) {
        const s = this.pieces.hpStock(r.alliance)[0];
        if (s) r.mech.load(s);
      }
    }
    // Práctica libre: toda la reserva (la del otro HP y las precargas sin robot) es del HP del jugador
    this.sink.clear();
    if (this.opts.solo) for (const p of this.pieces.list) if (p.kind === 'sample' && p.state.at === 'hp') p.state = { at: 'hp', alliance: this.player.alliance };
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
    this.autoBots = this.robots.map((r) => {
      const b = this.autos[r.index].routine.bot;
      const level = this.opts.bots?.[r.index]?.level;
      return b ? new Bot(r, this.pieces, this.robots, { ...(level ? { level } : {}), scoreOnly: b.scoreOnly, stayHome: true }) : null;
    });
    this.bots = this.robots.map((r) => (this.opts.ai && r.index !== this.opts.player ? new Bot(r, this.pieces, this.robots, this.opts.bots?.[r.index]) : null));
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
    // En AUTO el robot sigue su rutina; fuera del match habilitado (PRE en match, DONE) no se mueve
    if (!this.playerEnabled()) return;
    const m = this.player.mech;
    if (inp.toggleIntake) m.intakeOn = !m.intakeOn;
    if (inp.elevator !== null) m.target = inp.elevator;
    if (inp.releaseSample) m.release('sample', this.stepMechEvents);
    if (inp.grabCritical) m.grabCritical(this.stepMechEvents);
    if (inp.releaseCritical) m.release('critical', this.stepMechEvents);
  }

  /** ¿El jugador controla su robot ahora? (práctica o TELEOP) */
  playerEnabled(): boolean {
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
      const bot = m && phase === 'AUTO' ? this.autoBots[r.index] : m && isTeleop(phase) ? this.bots[r.index] : null;
      if (bot) {
        const o = bot.step(dt, phase, m ? m.remaining : Infinity);
        forward = o.forward;
        turn = o.turn;
        r.mech.intakeOn = o.intake;
        r.mech.target = o.elevator;
        if (o.release) r.mech.release('sample', this.stepMechEvents);
        if (o.grabCritical) r.mech.grabCritical(this.stepMechEvents);
        if (o.releaseCritical) r.mech.release('critical', this.stepMechEvents);
      } else if (m && phase === 'AUTO') {
        const o = this.autos[r.index].step(dt);
        forward = o.forward;
        turn = o.turn;
        if (o.elevator !== undefined) r.mech.target = o.elevator;
        if (o.intake !== undefined) r.mech.intakeOn = o.intake;
        if (o.release) r.mech.release('sample', this.stepMechEvents);
      } else if (enabled && r === this.player && this.input) {
        forward = this.input.forward;
        turn = this.input.turn;
        slow = this.input.slow;
      }
      if (!enabled) r.mech.intakeOn = false;
      const k = slow ? 0.5 : 1;
      r.phys.drive({ forward: forward * r.spec.maxSpeed * k, turn: turn * r.spec.maxOmega * 0.8 * k }, dt);
      r.mech.step(dt, this.stepMechEvents);
    }
    // Human Player: Muestras por la ranura durante todo el TeleOp (§3.2.4)
    if (m && isTeleop(phase)) for (const a of ALLIANCES) this.hps[a].step(dt);
    else if (!m && this.opts.solo) this.hps[this.player.alliance].step(dt);
    this.pw.step();
    this.time += dt;
    this.referee.drainCollisions();

    // Sensores → puntuación
    for (const s of this.sensors.newSamples()) {
      if (m) m.scoreSample(s.alliance, s.level);
      else {
        this.practiceCount[s.alliance]++;
        if (this.opts.solo) this.sink.set(s.piece.index, 0);
      }
    }
    this.drainSink(dt);
    if (m && phase === 'AUTO') for (const r of this.robots) if (this.sensors.outOfStartZone(r)) m.crossAutoLine(r.alliance, r.index);
    this.referee.step(dt, phase, this.stepMechEvents);
    this.events.push(...this.stepMechEvents);
    this.stepMechEvents.length = 0;

    if (m && !m.finished) {
      this.record(m, m.tick(dt));
      // Al sonar la bocina se evalúan Plataforma y Muestra Crítica (§4.3.1)
      if (m.phase === 'DONE') {
        const platform = { red: 0, blue: 0 };
        for (const r of this.robots) if (this.sensors.onPlatform(r)) platform[r.alliance]++;
        m.finish(platform, { red: this.sensors.criticalOnRepisa('red'), blue: this.sensors.criticalOnRepisa('blue') });
        this.record(m, m.tick(0));
      }
    }
    this.pieceView.capture();
    for (const v of this.robotViews) v.capture();
  }

  /** El vacío de la Cámara: las Muestras anotadas en práctica regresan a la reserva del HP. */
  private drainSink(dt: number): void {
    for (const [i, t] of this.sink) {
      if (t + dt < GameSession.SINK_DELAY) {
        this.sink.set(i, t + dt);
        continue;
      }
      this.sink.delete(i);
      const p = this.pieces.list[i];
      if (p.state.at !== 'field') continue;
      this.pieces.stash(p, { at: 'hp', alliance: this.player.alliance });
      this.sensors.scored.delete(i);
    }
  }

  private record(m: Match, evs: MatchEvent[]): void {
    this.matchEvents.push(...evs);
    for (const e of evs) this.log.push({ ...e, t: Math.round(m.t * 1000) / 1000 });
  }

  /** Avanza `frameDt` segundos reales en pasos fijos (máx. 0.1 s por cuadro) y sincroniza la vista. */
  update(frameDt: number): void {
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
