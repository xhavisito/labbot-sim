/** Robot = especificación + cuerpo físico + mecanismos + alianza. */
import * as F from '../config/field';
import type { RobotSpec } from '../config/robot';
import type { Alliance } from '../core/types';
import type { Pieces } from '../physics/Pieces';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { RobotPhysics } from '../physics/RobotPhysics';
import { Mechanisms } from './Mechanisms';

export class Robot {
  readonly phys: RobotPhysics;
  readonly mech: Mechanisms;

  constructor(
    pw: PhysicsWorld,
    pieces: Pieces,
    readonly index: number,
    readonly alliance: Alliance,
    /** Zona de Inicio (0 o 1) de su alianza (§3.2.1). */
    readonly station: 0 | 1,
    readonly spec: RobotSpec,
  ) {
    const s = startPose(alliance, station);
    this.phys = new RobotPhysics(pw, spec, index, s.x, s.z, s.heading);
    this.mech = new Mechanisms(this.phys, pieces, alliance);
  }

  /** Regresa a su Zona de Inicio, quieto y vacío. */
  resetPose(): void {
    const s = startPose(this.alliance, this.station);
    this.phys.teleport(s.x, s.z, s.heading);
    this.mech.clear();
  }
}

/**
 * Pose inicial: centrado en su Zona de Inicio, viendo hacia el centro de la cancha (§4.1: dentro de
 * los límites de la zona y sin mecanismos fuera del perímetro). SUPUESTO: centrado y viendo al centro.
 */
export function startPose(a: Alliance, station: 0 | 1): { x: number; z: number; heading: number } {
  const r = F.rectFor(a, F.START_ZONES_RED[station]);
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, heading: a === 'red' ? Math.PI : 0 };
}
