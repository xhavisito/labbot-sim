/**
 * Piezas de juego (§4.1.1): Muestras de Laboratorio (cubo 150 mm) y Muestras Críticas (cubo
 * 200 mm, una por alianza). Pool fijo de cuerpos Rapier: una pieza guardada (en un robot o en
 * la mano del Human Player) es un contador lógico y su cuerpo se deshabilita; nunca se crean ni
 * destruyen cuerpos durante el match.
 */
import * as F from '../config/field';
import { ALLIANCES, type Alliance } from '../core/types';
import { GROUPS, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export type PieceKind = 'sample' | 'critical';
/** Dónde está la pieza: en la cancha (física), en un robot, o en la reserva del Human Player. */
export type PieceState = { at: 'field' } | { at: 'robot'; robot: number } | { at: 'hp'; alliance: Alliance };

export interface Piece {
  index: number;
  kind: PieceKind;
  /** Alianza dueña (solo Muestra Crítica; las Muestras de Laboratorio son de todos). */
  owner?: Alliance;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: PieceState;
}

/** Fricción de la espuma: no se da. SUPUESTO 0.8 (cubo de espuma sobre alfombra). */
export const FOAM_FRICTION = 0.8;
export const FOAM_RESTITUTION = 0.1;

/** Total de Muestras del pool: Laboratorio + reserva del HP de cada alianza + precargas. */
export const SAMPLE_POOL = F.LAB_SAMPLES + 2 * F.HP_SAMPLES_PER_ALLIANCE + 2 * F.ROBOTS_PER_ALLIANCE * F.PRELOAD_PER_ROBOT;
const PARK_Y = -50;

export class Pieces {
  readonly list: Piece[] = [];

  constructor(private pw: PhysicsWorld) {
    for (let i = 0; i < SAMPLE_POOL; i++) this.create('sample', F.SAMPLE_SIZE, F.SAMPLE_MASS);
    for (const a of ALLIANCES) this.create('critical', F.CRITICAL_SIZE, F.CRITICAL_MASS, a);
  }

  private create(kind: PieceKind, size: number, mass: number, owner?: Alliance): void {
    const index = this.list.length;
    const body = this.pw.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, PARK_Y - index, 0).setLinearDamping(0.05).setAngularDamping(0.3).setCcdEnabled(true),
    );
    const h = size / 2;
    const collider = this.pw.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h, h, h)
        .setMass(mass)
        .setFriction(FOAM_FRICTION)
        .setRestitution(FOAM_RESTITUTION)
        .setCollisionGroups(GROUPS.piece)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.pw.tag(collider, { kind: 'piece', index });
    body.setEnabled(false);
    this.list.push({ index, kind, owner, body, collider, state: { at: 'hp', alliance: owner ?? 'red' } });
  }

  size(p: Piece): number {
    return p.kind === 'critical' ? F.CRITICAL_SIZE : F.SAMPLE_SIZE;
  }

  /** Pone una pieza en la cancha (cuerpo habilitado) en la pose y velocidad dadas. */
  place(p: Piece, x: number, y: number, z: number, yaw = 0, vel?: { x: number; y: number; z: number }): void {
    p.body.setEnabled(true);
    p.body.setTranslation({ x, y, z }, true);
    p.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    p.body.setLinvel(vel ?? { x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.state = { at: 'field' };
  }

  /** Saca una pieza de la cancha (guardada en un robot o en la reserva del HP). */
  stash(p: Piece, state: Exclude<PieceState, { at: 'field' }>): void {
    p.body.setEnabled(false);
    p.body.setTranslation({ x: 0, y: PARK_Y - p.index, z: 0 }, false);
    p.state = state;
  }

  critical(a: Alliance): Piece {
    return this.list.find((p) => p.kind === 'critical' && p.owner === a)!;
  }

  /** Muestras en la reserva del HP de una alianza. */
  hpStock(a: Alliance): Piece[] {
    return this.list.filter((p) => p.kind === 'sample' && p.state.at === 'hp' && p.state.alliance === a);
  }

  /**
   * Acomodo inicial (§3.2.2, §4.1, §4.1.1): 16 Muestras en las marcas del Laboratorio, la Muestra
   * Crítica de cada alianza en la rendija de su Campana y el resto de las Muestras a la reserva del
   * HP (10 por alianza + las precargas, que la sesión entrega a los robots).
   */
  reset(): void {
    const samples = this.list.filter((p) => p.kind === 'sample');
    const spots = F.labSpots();
    samples.forEach((p, i) => {
      if (i < spots.length) this.place(p, spots[i].x, F.SAMPLE_SIZE / 2, spots[i].z);
      else this.stash(p, { at: 'hp', alliance: i % 2 === 0 ? 'red' : 'blue' });
    });
    for (const a of ALLIANCES) {
      const c = F.forAlliance(a, F.CRITICAL_HOLDER_RED);
      this.place(this.critical(a), c.x, F.CRITICAL_HOLDER_RED.y + F.CRITICAL_SIZE / 2 + 0.002, c.z);
    }
  }
}
