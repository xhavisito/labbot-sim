/**
 * Mundo Rapier3D (WASM embebido, versión compat). Paso fijo; grupos de colisión; etiquetas.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance } from '../core/types';
import type { FieldPart } from '../config/fieldLayout';

export { RAPIER };

let ready: Promise<void> | null = null;
/** Inicializa el WASM de Rapier una sola vez. */
export function initRapier(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/** Bits de pertenencia de colisión. */
export const G = {
  FIELD: 1 << 0,
  ROBOT: 1 << 1,
  PIECE: 1 << 2,
  /** Barrera invisible fuera de la cancha. */
  BOUNDARY: 1 << 3,
} as const;

/** Empaqueta membresía/filtro en el formato de 32 bits de Rapier. */
export const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  field: groups(G.FIELD, G.ROBOT | G.PIECE),
  boundary: groups(G.BOUNDARY, G.ROBOT | G.PIECE),
  robot: groups(G.ROBOT, G.FIELD | G.BOUNDARY | G.ROBOT | G.PIECE),
  piece: groups(G.PIECE, G.FIELD | G.BOUNDARY | G.ROBOT | G.PIECE),
};

/** Lo que guardamos de cada colisionador para saber qué tocamos. */
export type ColliderTag =
  | { kind: 'floor' }
  | { kind: 'field'; part: FieldPart; alliance?: Alliance }
  | { kind: 'robot'; robot: number }
  | { kind: 'piece'; index: number };

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly dt: number;
  private tags = new Map<number, ColliderTag>();

  constructor(hz = 120) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.dt = 1 / hz;
    this.world.timestep = this.dt;
    this.events = new RAPIER.EventQueue(true);
  }

  tag(c: RAPIER.Collider, t: ColliderTag): void {
    this.tags.set(c.handle, t);
  }

  tagOf(handle: number): ColliderTag | undefined {
    return this.tags.get(handle);
  }

  step(): void {
    this.world.step(this.events);
  }

  /** Crea un colisionador estático. */
  fixed(desc: RAPIER.ColliderDesc, tag: ColliderTag, group: number = GROUPS.field): RAPIER.Collider {
    desc.setCollisionGroups(group);
    const c = this.world.createCollider(desc);
    this.tag(c, tag);
    return c;
  }

  free(): void {
    this.events.free();
    this.world.free();
  }
}
