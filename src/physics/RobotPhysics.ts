/**
 * Cuerpo físico de un robot con chasis tipo tanque (§7.2: obligatorio; sin bumpers).
 *
 * Colisionadores: 4 esferas-rueda SIN fricción (la tracción la decide el controlador), la caja
 * del chasis (65 × 65 cm) y la torre del pivote. Idea tomada de rebuilt-sim:
 * un controlador de velocidad cuyo cambio por paso está limitado por min(aceleración del motor,
 * μ·g)·(fracción de ruedas en el piso). Así los empujones los deciden la masa y la tracción, y en
 * las rampas de 15° de la Plataforma el robot sube y se inclina por pura física.
 * Tanque: solo avanza sobre su eje; la tracción resiste el deslizamiento lateral.
 *
 * Hitbox literal (Xhavi, 29 y 30-oct: "hitbox literal a cualquier parte del robot"): chasis, torre
 * del pivote (o los soportes del eje bajo), viga del brazo, los dos dedos y la placa de la garra y la
 * pieza que lleva chocan con todo: piezas, otros robots, la pared perimetral y la madera (Cámara,
 * Campana, Plataforma, Repisa, barra y rendija; D34). Cada colisionador mide lo mismo que su dibujo
 * (`render/RobotView.ts`). El brazo se mueve con `setArmPose` en cada paso; si la nueva pose lo
 * metería en una estructura, se detiene ahí (`armHitsField`), como un brazo real que topa con la
 * madera. Los mecanismos van sin masa (densidad 0) para no mover el centro de masa al girar el brazo,
 * y no chocan con la alfombra: la garra pasa rozándola al recoger.
 * CCD en el cuerpo: a toda velocidad o girando no atraviesa las paredes de 8 mm de la Cámara.
 */
import { CLAW, armTip, type RobotSpec } from '../config/robot';
import { CRITICAL_SIZE, SAMPLE_SIZE } from '../config/field';
import { G, GROUPS, RAPIER, groups, type PhysicsWorld } from './PhysicsWorld';

export interface DriveCommand {
  /** Velocidad hacia adelante deseada (m/s). */
  forward: number;
  /** Velocidad angular deseada (rad/s, + = antihorario visto desde arriba). */
  turn: number;
}

const WHEEL_R = 0.05;
const CHASSIS_Y0 = 0.03;
/** Altura de la placa del chasis (lo que se ve: `RobotView`). */
const CHASSIS_TOP = 0.235;
/** Consulta de "¿el brazo se metería en la madera?": solo la cancha (no robots ni piezas). */
const FIELD_QUERY = groups(G.ARM, G.FIELD);
/**
 * Las consultas usan cada pieza 8 mm más chica por lado: el contacto normal (unos milímetros de
 * encimado) no cuenta como "metido", así que el brazo apoyado o rozando la madera no se traba.
 */
const QUERY_SHRINK = 0.008;
const shrunk = (hx: number, hy: number, hz: number) => new RAPIER.Cuboid(Math.max(0.004, hx - QUERY_SHRINK), Math.max(0.004, hy - QUERY_SHRINK), Math.max(0.004, hz - QUERY_SHRINK));

type Pose = { t: { x: number; y: number; z: number }; r: { x: number; y: number; z: number; w: number } };
const NO_ROT = { x: 0, y: 0, z: 0, w: 1 };

/** Producto de cuaterniones a·b. */
function qmul(a: Pose['r'], b: Pose['r']): Pose['r'] {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
/** El brazo (colisionador) termina antes de la punta: ahí van la placa y los dedos de la garra. */
const ARM_BEAM_SHORT = CLAW.fingerLength / 2 + CLAW.palmThickness + 0.01;

/** Hacia dónde abre la garra: +1 si la punta está delante del eje del brazo, −1 si está detrás. */
export const clawDir = (a: number): number => (Math.cos(a) >= 0 ? 1 : -1);

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
  /** Ruedas apoyadas en la Plataforma de Contención (rampa, plataforma superior o Repisa). */
  wheelsOnPlatform = 0;
  lastCmd: DriveCommand = { forward: 0, turn: 0 };
  /** Fallas (`game/Damage.ts`): fracción de la potencia de los motores (1 = sana). */
  driveScale = 1;
  /** Fallas: un lado de la transmisión más débil jala el robot (rad/s de giro a toda velocidad). */
  turnBias = 0;
  /** Colisionadores del brazo, la garra y la pieza agarrada (se mueven con el brazo). */
  /** Formas (un poco más chicas) para preguntar si el brazo se metería en la madera. */
  private armQuery: Record<'beam' | 'finger' | 'palm' | 'sample' | 'critical', RAPIER.Shape>;
  readonly armColliders: { beam: RAPIER.Collider; fingers: [RAPIER.Collider, RAPIER.Collider]; palm: RAPIER.Collider; sample: RAPIER.Collider; critical: RAPIER.Collider };
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
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    const wheelMass = 0.8;
    const superMass = spec.massKg * 0.25;
    const chassisMass = spec.massKg - 4 * wheelMass - superMass;
    const add = (desc: RAPIER.ColliderDesc): RAPIER.Collider => {
      const c = w.createCollider(desc.setCollisionGroups(GROUPS.robot).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body);
      pw.tag(c, { kind: 'robot', robot: index });
      return c;
    };
    // Chasis: centro de masa bajo (batería y motores)
    this.chassis = add(
      RAPIER.ColliderDesc.cuboid(this.halfL, (CHASSIS_TOP - CHASSIS_Y0) / 2, this.halfW)
        .setTranslation(0, (CHASSIS_Y0 + CHASSIS_TOP) / 2, 0)
        .setMass(chassisMass)
        .setFriction(0.3)
        .setRestitution(0.05),
    );
    // Torre del pivote (o los soportes del eje bajo), con las medidas del dibujo (`RobotView`); antes
    // era una caja invisible del 90 % del chasis hasta `baseHeight`
    const a = spec.arm;
    if (a.pivotY > 0.29)
      add(
        RAPIER.ColliderDesc.cuboid(0.06, (a.pivotY - 0.23) / 2, 0.15)
          .setTranslation(a.pivotX, (a.pivotY + 0.23) / 2, 0)
          .setMass(superMass)
          .setFriction(0.3)
          .setRestitution(0.05),
      );
    else
      for (const z of [-1, 1])
        add(
          RAPIER.ColliderDesc.cuboid(0.07, 0.08, 0.015)
            .setTranslation(a.pivotX, 0.25, z * 0.13)
            .setMass(superMass / 2)
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
    // Mecanismos: brazo, dedos y placa de la garra, pieza agarrada (sin masa; ver arriba)
    const mech = (desc: RAPIER.ColliderDesc, group: number = GROUPS.arm): RAPIER.Collider => {
      const c = w.createCollider(desc.setDensity(0).setFriction(0.4).setRestitution(0.05).setCollisionGroups(group).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body);
      pw.tag(c, { kind: 'robot', robot: index });
      return c;
    };
    const beamLen = Math.max(0.05, spec.arm.length - ARM_BEAM_SHORT);
    const fh = CLAW.fingerHeight / 2;
    this.armQuery = {
      beam: shrunk(beamLen / 2, 0.02, CLAW.fingerZ),
      finger: shrunk(CLAW.fingerLength / 2, fh, CLAW.fingerThickness / 2),
      palm: shrunk(CLAW.palmThickness / 2, fh * 0.75, CLAW.fingerZ + CLAW.fingerThickness / 2),
      sample: shrunk(SAMPLE_SIZE / 2, SAMPLE_SIZE / 2, SAMPLE_SIZE / 2),
      critical: shrunk(CRITICAL_SIZE / 2, CRITICAL_SIZE / 2, CRITICAL_SIZE / 2),
    };
    this.armColliders = {
      beam: mech(RAPIER.ColliderDesc.cuboid(beamLen / 2, 0.02, CLAW.fingerZ)),
      fingers: [
        mech(RAPIER.ColliderDesc.cuboid(CLAW.fingerLength / 2, fh, CLAW.fingerThickness / 2)),
        mech(RAPIER.ColliderDesc.cuboid(CLAW.fingerLength / 2, fh, CLAW.fingerThickness / 2)),
      ],
      palm: mech(RAPIER.ColliderDesc.cuboid(CLAW.palmThickness / 2, fh * 0.75, CLAW.fingerZ + CLAW.fingerThickness / 2)),
      sample: mech(RAPIER.ColliderDesc.cuboid(SAMPLE_SIZE / 2, SAMPLE_SIZE / 2, SAMPLE_SIZE / 2)),
      critical: mech(RAPIER.ColliderDesc.cuboid(CRITICAL_SIZE / 2, CRITICAL_SIZE / 2, CRITICAL_SIZE / 2)),
    };
    this.setArmPose(spec.arm.stowAngle ?? 0, null);
  }

  /** Pose local (respecto al cuerpo) de cada colisionador del brazo con el brazo en el ángulo `a`. */
  private armPoses(a: number): Record<'beam' | 'finger0' | 'finger1' | 'palm' | 'sample' | 'critical', Pose> {
    const arm = this.spec.arm;
    const beamLen = Math.max(0.05, arm.length - ARM_BEAM_SHORT);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const tip = armTip(arm, a);
    const fy = tip.y + CLAW.fingerHeight / 2;
    return {
      beam: { t: { x: arm.pivotX + (ca * beamLen) / 2, y: arm.pivotY + (sa * beamLen) / 2, z: 0 }, r: { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) } },
      finger0: { t: { x: tip.x, y: fy, z: CLAW.fingerZ }, r: NO_ROT },
      finger1: { t: { x: tip.x, y: fy, z: -CLAW.fingerZ }, r: NO_ROT },
      palm: { t: { x: tip.x - clawDir(a) * (CLAW.fingerLength / 2 + CLAW.palmThickness / 2), y: fy, z: 0 }, r: NO_ROT },
      sample: { t: { x: tip.x, y: tip.y + SAMPLE_SIZE / 2, z: 0 }, r: NO_ROT },
      critical: { t: { x: tip.x, y: tip.y + CRITICAL_SIZE / 2, z: 0 }, r: NO_ROT },
    };
  }

  /**
   * Coloca los colisionadores del brazo y la garra con el brazo en el ángulo `a` (rad, 0 = horizontal
   * al frente) y prende el de la pieza que lleva en la garra. Llamar en cada paso, antes de la física.
   */
  setArmPose(a: number, held: 'sample' | 'critical' | null): void {
    const c = this.armColliders;
    const p = this.armPoses(a);
    const put = (col: RAPIER.Collider, pose: Pose) => {
      col.setTranslationWrtParent(pose.t);
      col.setRotationWrtParent(pose.r);
    };
    put(c.beam, p.beam);
    put(c.fingers[0], p.finger0);
    put(c.fingers[1], p.finger1);
    put(c.palm, p.palm);
    put(c.sample, p.sample);
    put(c.critical, p.critical);
    c.sample.setEnabled(held === 'sample');
    c.critical.setEnabled(held === 'critical');
  }

  /**
   * ¿La viga, la garra o la pieza que lleva se meterían en una estructura de la cancha (madera o
   * pared) con el brazo en el ángulo `a`? Para detener el brazo donde topa (`Mechanisms.step`).
   */
  armHitsField(a: number, held: 'sample' | 'critical' | null): boolean {
    const q = this.armQuery;
    const p = this.armPoses(a);
    const br = this.body.rotation();
    const parts: Array<[RAPIER.Shape, Pose]> = [
      [q.beam, p.beam],
      [q.finger, p.finger0],
      [q.finger, p.finger1],
      [q.palm, p.palm],
    ];
    if (held) parts.push([q[held], p[held]]);
    for (const [shape, pose] of parts) {
      const w = this.localToWorld(pose.t.x, pose.t.y, pose.t.z);
      if (this.pw.world.intersectionWithShape(w, qmul(br, pose.r), shape, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, FIELD_QUERY)) return true;
    }
    return false;
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

  /**
   * Contorno del robot completo en el piso (x, z), en orden: el chasis estirado hasta donde llega la
   * garra con el brazo en el ángulo `a` (la garra es más angosta que el chasis). Para "fuera de la
   * cancha" (D33: solo cuando TODO el robot está fuera).
   */
  outline(a: number): Array<{ x: number; z: number }> {
    const tip = armTip(this.spec.arm, a).x;
    const reach = CLAW.fingerLength / 2 + CLAW.palmThickness;
    const x0 = Math.min(-this.halfL, tip - reach);
    const x1 = Math.max(this.halfL, tip + reach);
    return [
      [x1, this.halfW],
      [x1, -this.halfW],
      [x0, -this.halfW],
      [x0, this.halfW],
    ].map(([lx, lz]) => {
      const p = this.localToWorld(lx, 0, lz);
      return { x: p.x, z: p.z };
    });
  }

  /** Rayos bajo cada rueda: cuántas tienen piso y cuántas pisan la alfombra. */
  senseGround(): void {
    let n = 0;
    let carpet = 0;
    let platform = 0;
    for (const [lx, lz] of this.wheelLocal) {
      const o = this.localToWorld(lx, WHEEL_R, lz);
      this.ray.origin = o;
      const hit = this.pw.world.castRay(this.ray, WHEEL_R + 0.03, true, undefined, GROUPS.robot, undefined, this.body);
      if (!hit) continue;
      n++;
      const tag = this.pw.tagOf(hit.collider.handle);
      if (tag?.kind === 'floor') carpet++;
      else if (tag?.kind === 'field' && (tag.part === 'ramp' || tag.part === 'platform' || tag.part === 'repisa')) platform++;
    }
    this.grounded = n / 4;
    this.wheelsOnCarpet = carpet;
    this.wheelsOnPlatform = platform;
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
    const top = s.maxSpeed * this.driveScale;
    const fwd = Math.max(-top, Math.min(top, cmd.forward));
    const tx = fwd * fx;
    const tz = fwd * fz;
    const mu = s.traction * this.grounded;
    const aMax = Math.max(0, Math.min(s.maxAccel * this.driveScale, mu * 9.81));
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
    // Falla de un lado de la transmisión: al avanzar, el robot se va hacia el lado débil
    const pull = this.turnBias * (fwd / Math.max(0.1, s.maxSpeed));
    const omegaT = Math.max(-s.maxOmega, Math.min(s.maxOmega, cmd.turn + pull));
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
