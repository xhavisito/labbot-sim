/**
 * Cuerpo físico de un robot con chasis tipo tanque (§7.2: obligatorio; sin bumpers).
 *
 * Colisionadores: 4 esferas-rueda SIN fricción (la tracción la decide el controlador), la caja
 * del chasis (65 × 65 cm) y la superestructura hasta `baseHeight`. Idea tomada de rebuilt-sim:
 * un controlador de velocidad cuyo cambio por paso está limitado por min(aceleración del motor,
 * μ·g)·(fracción de ruedas en el piso). Así los empujones los deciden la masa y la tracción, y en
 * las rampas de 15° de la Plataforma el robot sube y se inclina por pura física.
 * Tanque: solo avanza sobre su eje; la tracción resiste el deslizamiento lateral.
 */
import type { RobotSpec } from '../config/robot';
import { GROUPS, RAPIER, type PhysicsWorld } from './PhysicsWorld';

export interface DriveCommand {
  /** Velocidad hacia adelante deseada (m/s). */
  forward: number;
  /** Velocidad angular deseada (rad/s, + = antihorario visto desde arriba). */
  turn: number;
}

const WHEEL_R = 0.05;
const CHASSIS_Y0 = 0.03;
const CHASSIS_Y1 = 0.22;

export function yawQuat(h: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
}

export class RobotPhysics {
  readonly body: RAPIER.RigidBody;
  readonly chassis: RAPIER.Collider;
  readonly halfL: number;
  readonly halfW: number;
  /** Fracción de ruedas con tracción (0–1). */
  grounded = 1;
  /** Ruedas que tocan la alfombra (no la Plataforma): para "sobre la Plataforma" (D5). */
  wheelsOnCarpet = 4;
  lastCmd: DriveCommand = { forward: 0, turn: 0 };
  private wheelLocal: Array<[number, number]> = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(
    private pw: PhysicsWorld,
    readonly spec: RobotSpec,
    readonly index: number,
    x: number,
    z: number,
    heading: number,
  ) {
    const w = pw.world;
    this.halfL = spec.length / 2;
    this.halfW = spec.width / 2;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.002, z)
        .setRotation(yawQuat(heading))
        .setLinearDamping(0.2)
        .setAngularDamping(1.5)
        .setCanSleep(false),
    );
    const wheelMass = 0.8;
    const superMass = spec.massKg * 0.25;
    const chassisMass = spec.massKg - 4 * wheelMass - superMass;
    const add = (desc: RAPIER.ColliderDesc): RAPIER.Collider => {
      const c = w.createCollider(desc.setCollisionGroups(GROUPS.robot), this.body);
      pw.tag(c, { kind: 'robot', robot: index });
      return c;
    };
    // Chasis: centro de masa bajo (batería y motores)
    this.chassis = add(
      RAPIER.ColliderDesc.cuboid(this.halfL, (CHASSIS_Y1 - CHASSIS_Y0) / 2, this.halfW)
        .setTranslation(0, (CHASSIS_Y0 + CHASSIS_Y1) / 2, 0)
        .setMass(chassisMass)
        .setFriction(0.3)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    // Superestructura (un poco adentro del perímetro)
    const top = Math.max(CHASSIS_Y1 + 0.02, spec.baseHeight);
    add(
      RAPIER.ColliderDesc.cuboid(this.halfL * 0.9, (top - CHASSIS_Y1) / 2, this.halfW * 0.9)
        .setTranslation(0, (top + CHASSIS_Y1) / 2, 0)
        .setMass(superMass)
        .setFriction(0.3)
        .setRestitution(0.05),
    );
    // Ruedas
    const ix = this.halfL - 0.08;
    const iz = this.halfW - 0.06;
    this.wheelLocal = [
      [ix, iz],
      [ix, -iz],
      [-ix, iz],
      [-ix, -iz],
    ];
    for (const [lx, lz] of this.wheelLocal)
      add(
        RAPIER.ColliderDesc.ball(WHEEL_R)
          .setTranslation(lx, WHEEL_R, lz)
          .setMass(wheelMass)
          .setFriction(0)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      );
  }

  /** Rumbo (rad): adelante = (cos θ, −sin θ) en (x, z). */
  heading(): number {
    const r = this.body.rotation();
    const fx = 1 - 2 * (r.y * r.y + r.z * r.z);
    const fz = 2 * (r.x * r.z - r.w * r.y);
    return Math.atan2(-fz, fx);
  }

  /** Inclinación respecto a la vertical (rad). */
  tilt(): number {
    const r = this.body.rotation();
    const uy = 1 - 2 * (r.x * r.x + r.z * r.z);
    return Math.acos(Math.max(-1, Math.min(1, uy)));
  }

  position(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  /** Punto local (x adelante, z a la derecha del robot) → mundo (con la rotación completa). */
  localToWorld(lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
    const p = this.body.translation();
    const q = this.body.rotation();
    // v' = v + w·t + u × t, con t = 2 (u × v) y u = parte vectorial de q
    const tx = 2 * (q.y * lz - q.z * ly);
    const ty = 2 * (q.z * lx - q.x * lz);
    const tz = 2 * (q.x * ly - q.y * lx);
    return {
      x: p.x + lx + q.w * tx + (q.y * tz - q.z * ty),
      y: p.y + ly + q.w * ty + (q.z * tx - q.x * tz),
      z: p.z + lz + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  /** Mundo → local, solo con el rumbo (para zonas de intake/depósito). */
  worldToLocalFlat(x: number, z: number): { lx: number; lz: number } {
    const p = this.body.translation();
    const h = this.heading();
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(h);
    const s = Math.sin(h);
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  }

  /** Esquinas del chasis en el piso (x, z), para zonas y límites. */
  footprint(): Array<{ x: number; z: number }> {
    return [
      [this.halfL, this.halfW],
      [this.halfL, -this.halfW],
      [-this.halfL, -this.halfW],
      [-this.halfL, this.halfW],
    ].map(([lx, lz]) => {
      const p = this.localToWorld(lx, 0, lz);
      return { x: p.x, z: p.z };
    });
  }

  /** Rayos bajo cada rueda: cuántas tienen piso y cuántas pisan la alfombra. */
  private senseGround(): void {
    let n = 0;
    let carpet = 0;
    for (const [lx, lz] of this.wheelLocal) {
      const o = this.localToWorld(lx, WHEEL_R, lz);
      this.ray.origin = o;
      const hit = this.pw.world.castRay(this.ray, WHEEL_R + 0.03, true, undefined, GROUPS.robot, undefined, this.body);
      if (!hit) continue;
      n++;
      const tag = this.pw.tagOf(hit.collider.handle);
      if (tag?.kind === 'floor') carpet++;
    }
    this.grounded = n / 4;
    this.wheelsOnCarpet = carpet;
  }

  /** Aplica el mando (llamar antes de cada paso de física). */
  drive(cmd: DriveCommand, dt: number): void {
    this.lastCmd = cmd;
    this.senseGround();
    const s = this.spec;
    const b = this.body;
    const v = b.linvel();
    const h = this.heading();
    const fx = Math.cos(h);
    const fz = -Math.sin(h);
    const fwd = Math.max(-s.maxSpeed, Math.min(s.maxSpeed, cmd.forward));
    const tx = fwd * fx;
    const tz = fwd * fz;
    const mu = s.traction * this.grounded;
    const aMax = Math.max(0, Math.min(s.maxAccel, mu * 9.81));
    let dvx = tx - v.x;
    let dvz = tz - v.z;
    const dv = Math.hypot(dvx, dvz);
    // Al acelerar el par cae con la velocidad; frenar o corregir lo limita solo la tracción
    const speed = Math.hypot(v.x, v.z);
    const along = dv > 1e-5 && speed > 1e-3 ? (dvx * v.x + dvz * v.z) / (dv * speed) : 0;
    const motor = 1 - 0.55 * Math.min(1, speed / Math.max(0.1, s.maxSpeed)) * Math.max(0, along);
    const lim = (along > 0 ? aMax * motor : Math.min(mu * 9.81, s.maxAccel * 1.3)) * dt;
    if (dv > lim) {
      dvx *= lim / dv;
      dvz *= lim / dv;
    }
    const m = b.mass();
    if (dv > 1e-5) b.applyImpulse({ x: dvx * m, y: 0, z: dvz * m }, true);
    // Giro: aceleración angular limitada por la tracción (un tanque derrapa al girar)
    const w = b.angvel();
    const omegaT = Math.max(-s.maxOmega, Math.min(s.maxOmega, cmd.turn));
    const alpha = (aMax / Math.hypot(this.halfL, this.halfW)) * 1.2;
    let dw = omegaT - w.y;
    const wl = alpha * dt;
    dw = Math.max(-wl, Math.min(wl, dw));
    if (Math.abs(dw) > 1e-5) b.setAngvel({ x: w.x, y: w.y + dw, z: w.z }, true);
  }

  /** Coloca el robot quieto en una pose. */
  teleport(x: number, z: number, heading: number, y = 0.002): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(yawQuat(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
