/**
 * Piezas de juego (§4.1.1): Muestras de Laboratorio (cubo 150 mm) y Muestras Críticas (cubo
 * 200 mm, una por alianza). Pool fijo de cuerpos Rapier: una pieza guardada (en un robot o en
 * la mano del Human Player) es un contador lógico y su cuerpo se deshabilita; nunca se crean ni
 * destruyen cuerpos durante el match.
 */
import * as F from '../config/field';
import { ALLIANCES, type Alliance } from '../core/types';
import { G, GROUPS, RAPIER, groups, type PhysicsWorld } from './PhysicsWorld';

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
  /** Último robot que la soltó (para el scouting: quién anotó). Se borra si el HP o el acomodo la ponen. */
  lastRobot?: number;
}

/** Fricción de la espuma: no se da. SUPUESTO 0.8 (cubo de espuma sobre alfombra). */
export const FOAM_FRICTION = 0.8;
export const FOAM_RESTITUTION = 0.1;

/** Total de Muestras del pool: Laboratorio + reserva del HP de cada alianza + precargas. */
export const SAMPLE_POOL = F.LAB_SAMPLES + 2 * F.HP_SAMPLES_PER_ALLIANCE + 2 * F.ROBOTS_PER_ALLIANCE * F.PRELOAD_PER_ROBOT;
const PARK_Y = -50;

/**
 * Compresión máxima de la espuma (m). SUPUESTO (el manual no da la dureza de la espuma): un robot o su brazo puede
 * apretar un cubo hasta ~3 cm (20 % de 150 mm; con 2 cm la IA ya no lograba tomar la Crítica pegada a la pared) y ahí lo exprime hacia un lado, no lo atraviesa.
 *
 * Por qué hace falta: una Muestra pesa ~0.1 kg y un robot 40 kg (400 a 1). Con esa razón de masas el solver de contactos
 * no alcanza a frenar al robot ni a sacar la pieza: apretada contra la pared, contra la alfombra (brazo que baja) o entre
 * dos robots, la pieza quedaba hundida 8–14 cm dentro del robot (casi su tamaño completo) y se veía atravesada. Medido en
 * matches de IA: cientos de pasos con más de 3 cm y hasta 14 cm. Los colisionadores del brazo, además, cambian de pose de
 * golpe (`setArmPose`), así que meten la pieza de un solo paso.
 */
export const MAX_SQUASH = 0.03;
/**
 * Extra que aguantaban el brazo y la garra (m). Antes valía 0.12: su hitbox se podía meter hasta ~15 cm en la pieza que iba a tomar
 * (la viga, la palma y las placas la atravesaban: cubo de 20 cm hundido casi completo, 851 pasos seguidos en una prueba con Axiom).
 * El agarre (`Mechanisms`) NO depende de eso: toma la pieza por posición (ventana de la garra), no por contacto, así que la garra y el
 * brazo se exprimen igual que el chasis (`MAX_SQUASH`). Medido con Axiom, Psycho y Mentores 3478 (`tests/squash.test.ts`).
 */
const ARM_SQUASH = 0;
/**
 * Lo que sí aguanta la pieza que lleva la garra (m) al tocar otra pieza de la cancha: la Muestra de la precarga llega a meterse ~4 cm en la
 * Crítica de la rendija al bajar la garra sobre ella (`pivot.test`: suelta la precarga y toma la Crítica). Con 0 la sacaba de la rendija.
 */
const HELD_SQUASH = 0.08;
/** Hasta cuánto se deja metida la pieza tras exprimirla (m): un poco menos que `MAX_SQUASH`, para que el robot que empuja no vibre. */
const SQUASH_TO = 0.027;
/** Lo máximo que se mueve la pieza por paso al exprimirla (m): la sale en varios pasos, sin brincos. */
const SQUASH_STEP = 0.05;
/** Lo máximo que se aparta la pieza por paso cuando la aprieta el brazo o la garra (m): el brazo la lleva más rápido que un chasis. */
const ARM_STEP = 0.1;
/** Cuánto sale de lado por paso la espuma apretada contra una pared (m): ≈1.8 m/s, sale del robot en ~0.2 s. */
const SQUASH_SLIDE = 0.015;
/** Lo máximo que se echa para atrás un robot que aprieta la pieza contra una pared (m por paso). */
const SQUASH_ROBOT_BACK = 0.08;
/** Cuánto se achica el cubo para saber si el lugar a donde se mueve está libre (m). */
const SQUASH_FREE_MARGIN = 0.01;
/** Igual, para deslizarla de lado o hacia arriba (m). */
const SQUASH_SLIDE_MARGIN = 0.04;
/** Qué cuenta como "lugar libre" para sacar la pieza: todo lo que choca con ella menos otras piezas. */
const SQUASH_FREE = groups(G.PIECE, G.FLOOR | G.FIELD | G.BOUNDARY | G.ROBOT | G.ARM);

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
  place(p: Piece, x: number, y: number, z: number, yaw = 0, vel?: { x: number; y: number; z: number }, pitch = 0): void {
    p.body.setEnabled(true);
    p.body.setTranslation({ x, y, z }, true);
    // `pitch`: giro sobre el eje lateral del robot (la Muestra que sale de una caja inclinada sale igual de inclinada,
    // si no queda atravesada entre las placas de la caja y se atora). q = giro en y (yaw) · giro en z (pitch)
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    p.body.setRotation({ x: sy * sp, y: sy * cp, z: cy * sp, w: cy * cp }, true);
    p.body.setLinvel(vel ?? { x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.state = { at: 'field' };
    p.lastRobot = undefined;
  }

  /** Saca una pieza de la cancha (guardada en un robot o en la reserva del HP). */
  stash(p: Piece, state: Exclude<PieceState, { at: 'field' }>): void {
    p.body.setEnabled(false);
    p.body.setTranslation({ x: 0, y: PARK_Y - p.index, z: 0 }, false);
    p.state = state;
  }

  /**
   * Foam que se exprime (ver `MAX_SQUASH`): a cada Muestra de la cancha hundida más de `MAX_SQUASH` en un robot (chasis, brazo, garra
   * o pieza que lleva) la mueve hacia afuera lo que sobra, en la primera dirección con lugar: lejos del robot, hacia un lado
   * (a lo largo de la pared) o hacia arriba. Así una Muestra apretada contra la pared o el piso "sale disparada" de lado
   * como la espuma real en lugar de quedar adentro del robot. Llamar después de cada paso de física. Devuelve cuántas movió.
   */
  relieveSquash(): number {
    const w = this.pw.world;
    let moved = 0;
    for (const p of this.list) {
      if (p.state.at !== 'field') continue;
      let depth = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let robot: RAPIER.Collider | null = null;
      let viaArm = false;
      // lo que la pieza se mete en la pared (o lo que sea fijo): normal que la empuja de vuelta
      const walls: Array<{ d: number; x: number; y: number; z: number }> = [];
      w.contactPairsWith(p.collider, (other) => {
        const kind = this.pw.tagOf(other.handle)?.kind;
        if (kind === 'piece') return;
        // geometría de ahora (no el contacto del paso, que va un paso atrasado): `normal2` sale de `other` hacia la pieza
        const c = p.collider.contactCollider(other, 0);
        if (!c || c.distance >= 0) return;
        const d = -c.distance;
        if (kind !== 'robot') {
          walls.push({ d, x: c.normal2.x, y: c.normal2.y, z: c.normal2.z });
          return;
        }
        // el brazo y la garra cuentan igual que el chasis (`ARM_SQUASH`); la pieza se aparta más rápido de ellos (`ARM_STEP`)
        const isArm = ((other.collisionGroups() >>> 16) & G.ARM) !== 0;
        const held = (this.pw.tagOf(other.handle) as { held?: boolean } | undefined)?.held === true;
        const e = d - (held ? HELD_SQUASH : isArm ? ARM_SQUASH : 0);
        if (e <= depth) return;
        viaArm = isArm;
        depth = e;
        nx = c.normal2.x;
        ny = c.normal2.y;
        nz = c.normal2.z;
        robot = other;
      });
      if (!robot || depth <= 0) continue;
      // lo que la pieza se metió en la pared de atrás también cuenta (apretada por el robot contra ella): todo suma a la compresión
      const nl0 = Math.hypot(nx, ny, nz) || 1;
      let inWall = 0;
      // (el brazo y la garra no suman la pared: la Crítica de la rendija ya queda unos mm en sus paredes y la garra la rodea, sin apretarla)
      if (!viaArm) for (const c of walls) if ((c.x * nx + c.y * ny + c.z * nz) / nl0 < -0.7) inWall = Math.max(inWall, c.d);
      if (depth + inWall <= MAX_SQUASH) continue;
      const t = p.body.translation();
      const rb = (robot as RAPIER.Collider).parent();
      const half = this.size(p) / 2;
      const q = p.body.rotation();
      // "lugar libre" = el cubo, un poco más chico, no choca con nada (menos con el robot que la aprieta si `ignoreRobot`).
      // Para sacarla derecho el margen es corto (no meterla en la pared); para deslizarla de lado es largo, porque la pieza
      // apretada ya está unos mm metida en la pared o el piso
      const isFree = (dx: number, dy: number, dz: number, d: number, margin: number): boolean => {
        const core = half - margin;
        return !w.intersectionWithShape(
          { x: t.x + dx * d, y: t.y + dy * d, z: t.z + dz * d },
          q,
          new RAPIER.Cuboid(core, core, core),
          undefined,
          SQUASH_FREE,
          p.collider,
          rb ?? undefined,
        );
      };
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const over = depth + inWall - SQUASH_TO;
      const stepMax = viaArm ? ARM_STEP : SQUASH_STEP;
      // 1) Hay lugar del lado contrario al robot: la pieza se aparta lo que sobra (sin pasarse del paso máximo)
      if (isFree(nx, ny, nz, Math.min(over, stepMax), SQUASH_FREE_MARGIN)) {
        this.shift(p, nx, ny, nz, Math.min(over, stepMax));
        moved++;
        continue;
      }
      // 2) Apretada de lado contra la pared, el piso o otro robot: la espuma ya no cede, el robot es el que se frena
      if (rb && Math.hypot(nx, nz) > 0.7) {
        const hl = Math.hypot(nx, nz);
        const hx = nx / hl;
        const hz = nz / hl;
        // se saca a la pieza de la pared (hacia el robot) y el robot cede lo que sobra más ese tanto
        if (inWall > 0) this.shift(p, -hx, 0, -hz, Math.min(inWall, SQUASH_ROBOT_BACK));
        const back = Math.min(over + inWall, SQUASH_ROBOT_BACK);
        const rt = rb.translation();
        rb.setTranslation({ x: rt.x - hx * back, y: rt.y, z: rt.z - hz * back }, true);
        const v = rb.linvel();
        const toward = v.x * hx + v.z * hz;
        if (toward > 0) rb.setLinvel({ x: v.x - hx * toward, y: v.y, z: v.z - hz * toward }, true);
        // y la espuma sale exprimida de lado (hacia donde ya está corrida respecto al centro del robot), si no se quedaría
        // atorada entre el robot y la pared y el robot no podría seguir
        const side = Math.sign(-hz * (t.x - rt.x) + hx * (t.z - rt.z)) || 1;
        for (const sg of [side, -side]) {
          if (!isFree(-hz * sg, 0, hx * sg, SQUASH_SLIDE, SQUASH_SLIDE_MARGIN)) continue;
          this.shift(p, -hz * sg, 0, hx * sg, SQUASH_SLIDE);
          break;
        }
        moved++;
        continue;
      }
      // 3) Apretada contra el piso por el brazo (o sin lugar): se exprime hacia un lado o hacia arriba
      let ox = t.x - (rb ? rb.translation().x : t.x);
      let oz = t.z - (rb ? rb.translation().z : t.z);
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol;
      oz /= ol;
      for (const [dx, dy, dz] of [
        [ox, 0, oz],
        [-oz, 0, ox],
        [oz, 0, -ox],
        [0, 1, 0],
      ] as const) {
        const l = Math.hypot(dx, dy, dz);
        if (l < 1e-6) continue;
        const d = Math.min(over, stepMax);
        // el robot que la aprieta no cuenta: moverla de lado sigue metida en él, pero se va saliendo
        if (!isFree(dx / l, dy / l, dz / l, d, SQUASH_SLIDE_MARGIN)) continue;
        this.shift(p, dx / l, dy / l, dz / l, d);
        moved++;
        break;
      }
    }
    return moved;
  }

  /** Mueve la pieza `d` m en la dirección unitaria dada y le quita la velocidad que llevaba hacia el lado contrario. */
  private shift(p: Piece, dx: number, dy: number, dz: number, d: number): void {
    const t = p.body.translation();
    p.body.setTranslation({ x: t.x + dx * d, y: t.y + dy * d, z: t.z + dz * d }, true);
    const v = p.body.linvel();
    const into = v.x * dx + v.y * dy + v.z * dz;
    if (into < 0) p.body.setLinvel({ x: v.x - dx * into, y: v.y - dy * into, z: v.z - dz * into }, true);
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
