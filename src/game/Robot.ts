/** Robot = especificación + cuerpo físico + mecanismos + alianza. */
import type { RobotSpec } from '../config/robot';
import { clampSpot, CENTER_SPOT, spotPose, type StartSpot } from '../config/startSpot';
import type { Alliance } from '../core/types';
import type { Pieces } from '../physics/Pieces';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RobotPhysics } from '../physics/RobotPhysics';
import { Mechanisms } from './Mechanisms';

export class Robot {
  readonly phys: RobotPhysics;
  readonly mech: Mechanisms;
  readonly spot: StartSpot;

  constructor(
    pw: PhysicsWorld,
    pieces: Pieces,
    readonly index: number,
    readonly alliance: Alliance,
    /** Zona de Inicio (0 o 1) de su alianza (§3.2.1). */
    readonly station: 0 | 1,
    readonly spec: RobotSpec,
    /** Lugar dentro de su Zona de Inicio (§4.1, `config/startSpot.ts`); se recorta a uno válido. */
    spot: StartSpot = CENTER_SPOT,
  ) {
    this.spot = clampSpot(spec.length, spec.width, spot);
    const s = this.startPose();
    this.phys = new RobotPhysics(pw, spec, index, s.x, s.z, s.heading);
    this.mech = new Mechanisms(this.phys, pieces, alliance);
  }

  /** Regresa a su Zona de Inicio, quieto y vacío. */
  resetPose(): void {
    const s = this.startPose();
    this.phys.teleport(s.x, s.z, s.heading);
    this.mech.clear();
  }

  /** Pose inicial: en su lugar de la Zona de Inicio (por defecto centrado y viendo al centro de la cancha). */
  startPose(): { x: number; z: number; heading: number } {
    return spotPose(this.alliance, this.station, this.spot);
  }
}
