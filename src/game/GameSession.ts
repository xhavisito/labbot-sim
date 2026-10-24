/**
 * Sesión de juego: une física (cancha + piezas) y render. Paso fijo con interpolación.
 * Los robots (Hito 2) y la lógica del match (Hito 3) se conectan aquí.
 */
import * as THREE from 'three';
import { buildFieldColliders } from '../physics/FieldColliders';
import { Pieces } from '../physics/Pieces';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { buildFieldView } from '../render/FieldView';
import { PieceView } from '../render/PieceView';

export const PHYSICS_HZ = 120;

export class GameSession {
  readonly pw = new PhysicsWorld(PHYSICS_HZ);
  readonly pieces: Pieces;
  readonly root = new THREE.Group();
  private pieceView: PieceView;
  private acc = 0;
  /** Tiempo de simulación (s). */
  time = 0;

  constructor() {
    buildFieldColliders(this.pw);
    this.pieces = new Pieces(this.pw);
    this.pieces.reset();
    this.root.add(buildFieldView());
    this.pieceView = new PieceView(this.pieces);
    this.root.add(this.pieceView.group);
  }

  /** Un paso fijo de física. */
  step(): void {
    this.pw.step();
    this.time += this.pw.dt;
    this.pieceView.capture();
  }

  /** Avanza `frameDt` segundos reales en pasos fijos (máx. 0.1 s por cuadro) y sincroniza la vista. */
  update(frameDt: number): void {
    this.acc += Math.min(frameDt, 0.1);
    while (this.acc >= this.pw.dt) {
      this.step();
      this.acc -= this.pw.dt;
    }
    this.pieceView.sync(this.acc / this.pw.dt);
  }

  dispose(): void {
    this.pw.free();
  }
}
