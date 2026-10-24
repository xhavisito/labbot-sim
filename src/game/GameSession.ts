/**
 * Sesión de juego: une física (cancha, piezas, robots) y render. Paso fijo con interpolación.
 * La lógica del match (Hito 3) se conecta aquí.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import { DEFAULT_ROBOT, type RobotSpec } from '../config/robot';
import type { PlayerInput } from '../input/InputManager';
import { buildFieldColliders } from '../physics/FieldColliders';
import { Pieces } from '../physics/Pieces';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { buildFieldView } from '../render/FieldView';
import { PieceView } from '../render/PieceView';
import { RobotView } from '../render/RobotView';
import type { MechEvent } from './Mechanisms';
import { Robot } from './Robot';

export const PHYSICS_HZ = 120;

export interface SessionOptions {
  /** Robot que maneja el jugador (0–1 rojo, 2–3 azul). */
  player: number;
  /** Precarga de 1 Muestra por robot (§4.1). */
  preload: boolean;
  specs?: RobotSpec[];
}

export class GameSession {
  readonly pw = new PhysicsWorld(PHYSICS_HZ);
  readonly pieces: Pieces;
  readonly robots: Robot[] = [];
  readonly root = new THREE.Group();
  /** Eventos de mecanismos del último paso (los consume la lógica del match). */
  readonly events: MechEvent[] = [];
  private pieceView: PieceView;
  private robotViews: RobotView[] = [];
  private acc = 0;
  private input: PlayerInput | null = null;
  /** Tiempo de simulación (s). */
  time = 0;

  constructor(readonly opts: SessionOptions = { player: 0, preload: true }) {
    buildFieldColliders(this.pw);
    this.pieces = new Pieces(this.pw);
    this.root.add(buildFieldView());
    this.pieceView = new PieceView(this.pieces);
    this.root.add(this.pieceView.group);
    for (let i = 0; i < 2 * F.ROBOTS_PER_ALLIANCE; i++) {
      const r = new Robot(this.pw, this.pieces, i, i < 2 ? 'red' : 'blue', (i % 2) as 0 | 1, opts.specs?.[i] ?? DEFAULT_ROBOT);
      this.robots.push(r);
      const v = new RobotView(r);
      this.robotViews.push(v);
      this.root.add(v.group);
    }
    this.resetField();
  }

  get player(): Robot {
    return this.robots[this.opts.player];
  }

  /** Acomodo inicial (§4.1): piezas en su lugar, robots en su Zona de Inicio con su precarga. */
  resetField(): void {
    this.pieces.reset();
    for (const r of this.robots) {
      r.resetPose();
      if (this.opts.preload) {
        const s = this.pieces.hpStock(r.alliance)[0];
        if (s) r.mech.load(s);
      }
    }
    this.pieceView.capture();
    this.pieceView.capture();
    for (const v of this.robotViews) {
      v.capture();
      v.capture();
    }
  }

  /** Entrada del jugador para el siguiente cuadro. */
  setInput(inp: PlayerInput): void {
    this.input = inp;
    this.events.length = 0;
    const m = this.player.mech;
    if (inp.toggleIntake) m.intakeOn = !m.intakeOn;
    if (inp.elevator !== null) m.target = inp.elevator;
    if (inp.releaseSample) m.release('sample', this.events);
    if (inp.grabCritical) m.grabCritical(this.events);
    if (inp.releaseCritical) m.release('critical', this.events);
  }

  /** Un paso fijo de física. */
  step(): void {
    const dt = this.pw.dt;
    for (const r of this.robots) {
      const inp = r === this.player ? this.input : null;
      const k = inp?.slow ? 0.5 : 1;
      r.phys.drive({ forward: (inp?.forward ?? 0) * r.spec.maxSpeed * k, turn: (inp?.turn ?? 0) * r.spec.maxOmega * 0.8 * k }, dt);
      r.mech.step(dt, this.events);
    }
    this.pw.step();
    this.time += dt;
    this.pieceView.capture();
    for (const v of this.robotViews) v.capture();
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
  }

  dispose(): void {
    this.pw.free();
  }
}
