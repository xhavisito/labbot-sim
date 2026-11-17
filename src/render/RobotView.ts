/**
 * Robot visual: chasis tanque con placa del color de la alianza (no lleva bumpers, §7.2), la torre
 * del pivote y el brazo con garra, con la Muestra o la Muestra Crítica que lleva.
 * El robot que maneja el jugador lleva placa y LEDs morados (pedido del equipo); la alianza se sigue
 * leyendo en la placa lateral con la estación (R1, B2…).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CRITICAL_SIZE, SAMPLE_SIZE } from '../config/field';
import { WHEEL_DROP, armTip, clawOf, critSeat, intakeOf, posAngle, seatX, type CadModel, type ClawDims, type CritClaw } from '../config/robot';
import { PALETTES } from '../config/palette';
import { clawDir } from '../physics/RobotPhysics';
import type { Robot } from '../game/Robot';
import { buildCadWheel } from './cadWheel';
import { HitboxDebug, hitboxDebugOn } from './hitboxDebug';
import { ALLIANCE_COLOR } from './FieldView';
import { criticalMaterial, sampleMaterial } from './PieceView';
import { RampSim } from './rampSim';
import { brushedTexture, textTexture } from './textures';

/** Giro (°) de cada dedo de la pinza de Axiom hasta tocar la Muestra: el ángulo de intake del CAD (Xhavi, 16-nov). */
const PINZA_DEG = 23;

const brushed = brushedTexture();
const dark = new THREE.MeshStandardMaterial({ color: 0x3c424c, roughness: 0.5, metalness: 0.4 });
const alu = new THREE.MeshStandardMaterial({ color: brushed ? 0xd2d7de : 0xb8bec7, map: brushed, roughness: 0.32, metalness: 0.85 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xe0a419, roughness: 0.35, metalness: 0.6 });
const sampleMat = sampleMaterial();
/** Radio de las ruedas de los rodillos de la garra (dibujo). SUPUESTO: la foto no da medida; así aprietan ~1 cm. */
const ROLLER_R = 0.041;
/**
 * Flechas de los rodillos de Psycho, de los valeros del CAD (`Garra-Inferior` y `Garra-Superior`, hoyos
 * de 28 mm): distancia a la boca (m), distancia al centro de la caja (m) y de dónde a dónde van (m, sobre
 * la punta del brazo: de la placa de abajo a la de arriba).
 */
const ROLLER_SHAFTS = { fromMouth: [0.0295, 0.1695], z: 0.106, y: [-0.016, 0.164] } as const;
const WHEEL_R = 0.05;
/** Nombre de la pieza del CAD: el GLB la deja en el nodo (la malla viene sin nombre). */
const nodeName = (o: THREE.Object3D): string => o.name || o.parent?.name || '';
/** Flechas (ejes) de los robots del CAD: negras (Xhavi, 16-nov). */
const SHAFT_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.5 });
/** Giro de dibujo de los rodillos del lanzador (rad/s) al tirar. No es el real: así no se ve el efecto estroboscópico. */
const SHOOTER_SPIN_SHOT = 38;
/** Giro de dibujo (rad/s) de las ruedas de abajo del lanzador mientras toman una Muestra. */
const SHOOTER_SPIN_INTAKE = 22;
/** GLB de robots del CAD, una sola descarga por archivo. */
const modelCache = new Map<string, Promise<THREE.Group>>();
export function preloadRobotModels(urls: string[]): void {
  for (const u of urls) loadModel(import.meta.env.BASE_URL + u).catch(() => undefined);
}
function loadModel(url: string): Promise<THREE.Group> {
  let p = modelCache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => g.scene);
    modelCache.set(url, p);
  }
  return p;
}
/** Color de la placa y los LEDs del robot propio, en cualquier alianza. */
export const ROBOT_STYLE = { own: PALETTES.normal.own, fault: PALETTES.normal.fault, plate: { ...PALETTES.normal.plate } };

export class RobotView {
  readonly group = new THREE.Group();
  private arm = new THREE.Group();
  private criticalMesh: THREE.Mesh;
  /** Segunda Muestra en la garra (garra con rodillos: en fila detrás de la primera, `seatX`). */
  private clawSample2: THREE.Mesh;
  /** Lanzador: las Muestras de más, en fila por la rampa (la primera es `clawSample`). */
  private rampSamples: THREE.Mesh[] = [];
  /** Con el modelo del CAD la garra va rígida al brazo: su giro respecto al brazo (rad). */
  private rigidClaw: number | null = null;
  /** Dibujo genérico del robot: se oculta cuando el modelo del CAD termina de cargar. */
  private generic: THREE.Object3D[] = [];
  private numPlates: THREE.Mesh[] = [];
  /** Muestra en la garra. */
  private clawSample: THREE.Mesh;
  /** LEDs bajo el chasis: parpadean en ámbar con una falla. */
  private led: THREE.MeshStandardMaterial;
  private ledColor: THREE.Color;
  private faultColor = new THREE.Color();
    /** Fallas activas del robot (las pone la sesión, `game/Damage.ts`). */
  faults: () => ReadonlyMap<string, number> = () => new Map();
  /** Placa de la garra (del lado del brazo). */
  private palm: THREE.Mesh;
  private claw: ClawDims;
  private wheels: Array<{ mesh: THREE.Object3D; side: number; flip?: boolean }> = [];
  private lastP = new THREE.Vector3();
  private lastYaw = 0;
  /** `?hitboxes=1`: los colisionadores de la física en alambre. */
  private hitDebug: HitboxDebug | null = null;
  private spin = [0, 0];
  /** Rodillos de la garra (robots del CAD): `row` = costado (+1 = +z, −1 = −z) de la flecha vertical; giran hacia adentro. */
  private clawRollers: Array<{ mesh: THREE.Object3D; row: number }> = [];
  private rollerT = 0;
  /** Rodillos del lanzador del CAD (Phoenix): `side` = signo del giro (+1 / −1) para que ambas filas empujen la Muestra por la rampa. */
  private shooterRollers: Array<{ mesh: THREE.Object3D; side: number; bottom: boolean; w: number }> = [];
  /** Entrada animada de las Muestras al almacén del lanzador (Phoenix): posición dibujada de cada lugar (0 = en la garra, k = en la rampa). */
  private rampSim: RampSim | null = null;
  private slotT = 0;
  /** Avance del robot hacia adelante en el último cuadro (m), su velocidad (m/s) y aceleración suavizada (m/s²); giro (rad/s²). */
  private fwdStep = 0;
  private fwdVel = 0;
  private accF = 0;
  private yawAcc = 0;
  private yawRate = 0;
  private yawT = 0;
  private critJx = 0;
  private critJv = 0;
  private critJT = 0;
  /** Velocidad angular actual de los rodillos del lanzador (rad/s; solo dibujo). */
  private shooterT = 0;
  private fingerT = 0;
  /**
   * Dedos de la pinza del CAD (Axiom): las piezas `garra`, `side` = costado (+1 = +z, −1 = −z). Se separan o se juntan
   * en z para abrir y cerrar: apertura = `gap` del INTAKE; cerrada = la Muestra (0.15 m) o la Crítica (0.20 m, §4.1.1).
   */
  private clawFingers: Array<{ group: THREE.Group; q: THREE.Quaternion; dir: number; zHorn: number; r: number }> = [];
  private qTmp = new THREE.Quaternion();
  /** Dedos de la garra fija de la Crítica (Psycho): cada uno gira sobre su eje vertical; `side` = costado (+1 = +z). */
  private critFingers: Array<{ g: THREE.Group; side: number }> = [];
  /** Cierre actual de esos dedos (0 = abiertos, la pose del CAD; 1 = sobre la Crítica). */
  private critNow = 0;
  private critT = 0;
  /** Centro de los dedos de la pinza del CAD en el sistema de la garra (donde se dibuja la Muestra que aprieta). */
  private pocket: { x: number; y: number } | null = null;
  /** Giro actual de los dedos hacia adentro (°); 0 = abiertos, la pose del CAD. */
  private fingerNow = 0;
  private halfW = 0;
  private prevP = new THREE.Vector3();
  private curP = new THREE.Vector3();
  private prevQ = new THREE.Quaternion();
  private curQ = new THREE.Quaternion();

  constructor(private robot: Robot, own = false) {
    const s = robot.spec;
    const L = s.length;
    const W = s.width;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const color = own ? ROBOT_STYLE.own : ALLIANCE_COLOR[robot.alliance];
    // Chasis redondeado y tanque: tres ruedas por lado con cubo dorado (giran al avanzar) y oruga
    this.generic.push(add(new RoundedBoxGeometry(L, 0.16, W - 0.12, 3, 0.025), dark, 0, 0.13, 0));
    this.halfW = W / 2 - 0.03;
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.045, 18).rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.45, WHEEL_R * 0.45, 0.05, 6).rotateX(Math.PI / 2);
    for (const z of [-1, 1]) {
      for (const x of [-L / 2 + 0.07, 0, L / 2 - 0.07]) {
        const w = new THREE.Group();
        w.position.set(x, WHEEL_R, z * this.halfW);
        add(wheelGeo, wheelMat, 0, 0, 0, w);
        add(hubGeo, hubMat, 0, 0, 0, w);
        this.group.add(w);
        this.generic.push(w);
        this.wheels.push({ mesh: w, side: z > 0 ? 1 : 0 });
      }
      this.generic.push(add(new THREE.BoxGeometry(L - 0.04, 0.012, 0.05), wheelMat, 0, WHEEL_R * 2 + 0.004, z * this.halfW));
    }
    const plate = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 });
    this.generic.push(add(new RoundedBoxGeometry(L * 0.98, 0.025, W * 0.98, 2, 0.01), plate, 0, 0.22, 0));
    // Tira de LEDs bajo el chasis (el bloom la hace brillar) y placa con la estación en los costados
    const led = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.6 });
    this.led = led;
    this.ledColor = new THREE.Color(color);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(L * 0.8, 0.012, 0.01), led, 0, 0.065, z * (W / 2 - 0.115));
    const num = textTexture(`${robot.alliance === 'red' ? 'R' : 'B'}${robot.station + 1}`, { w: 128, h: 64, bg: ROBOT_STYLE.plate[robot.alliance] });
    if (num) {
      const numMat = new THREE.MeshStandardMaterial({ map: num, roughness: 0.5 });
      for (const z of [-1, 1]) {
        const m = add(new THREE.PlaneGeometry(0.16, 0.08), numMat, -L * 0.18, 0.14, z * ((W - 0.12) / 2 + 0.002));
        m.rotation.y = z > 0 ? 0 : Math.PI;
        m.castShadow = false;
        this.numPlates.push(m);
      }
    }
    const sz = SAMPLE_SIZE * 0.95;
    const c = CRITICAL_SIZE;
    const critMat = criticalMaterial(robot.alliance);
    // Torre del pivote, brazo y garra; la pieza agarrada va en la punta
    const a = s.arm;
    if (a.linear) this.generic.push(add(new THREE.BoxGeometry(0.08, a.pivotY + a.length - 0.23, 0.3), dark, a.pivotX - a.length, (a.pivotY + a.length + 0.23) / 2, 0));
    else if (a.pivotY > 0.29) this.generic.push(add(new THREE.BoxGeometry(0.12, a.pivotY - 0.23, 0.3), dark, a.pivotX, (a.pivotY + 0.23) / 2, 0));
    // Eje bajo (el brazo que voltea): soportes a los lados del canal por donde pasa el brazo
    else for (const z of [-1, 1]) this.generic.push(add(new THREE.BoxGeometry(0.14, 0.16, 0.03), dark, a.pivotX, 0.25, z * 0.13));
    this.group.add(this.arm);
    this.arm.position.set(a.pivotX, a.pivotY, 0);
    // Elevador: dos rieles verticales detrás del carro; los demás, dos barras del brazo
    if (a.linear) for (const z of [-0.09, 0.09]) this.generic.push(add(new THREE.BoxGeometry(0.04, 2 * a.length + 0.1, 0.03), alu, -a.length, 0, z, this.arm));
    else for (const z of [-0.09, 0.09]) this.generic.push(add(new THREE.BoxGeometry(a.length, 0.04, 0.03), alu, a.length / 2, 0, z, this.arm));
    // Garra: dedos a los lados de la pieza (el sistema local del brazo gira con él)
    const claw = new THREE.Group();
    claw.position.set(a.linear ? 0 : a.length, 0, 0);
    this.arm.add(claw);
    const CLAW = clawOf(s);
    this.claw = CLAW;
    // Elevador: viga horizontal del carro, de los rieles a la garra
    if (a.linear) for (const z of [-0.09, 0.09]) this.generic.push(add(new THREE.BoxGeometry(a.length - 0.1, 0.04, 0.03), alu, -(a.length - 0.1) / 2 - CLAW.fingerLength / 2, 0, z, claw));
    // Mismas medidas que la hitbox (`CLAW`, `RobotPhysics.setArmPose`): dos dedos y la placa
    for (const z of [-1, 1]) this.generic.push(add(new THREE.BoxGeometry(CLAW.fingerLength, CLAW.fingerHeight, CLAW.fingerThickness), alu, 0, CLAW.fingerHeight / 2, z * CLAW.fingerZ, claw));
    this.palm = add(new THREE.BoxGeometry(CLAW.palmThickness, CLAW.fingerHeight * 0.75, 2 * CLAW.fingerZ + CLAW.fingerThickness), dark, -(CLAW.fingerLength / 2 + CLAW.palmThickness / 2), CLAW.fingerHeight / 2, 0, claw);
    this.generic.push(this.palm);
    // Rodillos verdes de la garra-caja: 4 flechas verticales en los valeros del CAD de Psycho (hoyos de
    // 28 mm en la placa de abajo y la de arriba, Xhavi 13-nov), dos por costado: a 3 y a 17 cm de la boca
    // y a 10.6 cm del centro. Cada flecha lleva dos ruedas (abajo y arriba) que aprietan la Muestra ~1 cm
    // por los costados. Solo dibujo: la física de los rodillos está en `Mechanisms.runRollers`.
    // Axiom (pinza) no lleva rodillos: su garra del CAD abre y cierra (`clawFingers`); Phoenix (lanzador) tampoco: sus rodillos son los horizontales del lanzador (Xhavi, 17-nov)
    if ((s.model || intakeOf(s).rollers) && intakeOf(s).kind !== 'pinza' && !intakeOf(s).shooter) {
      const rollerMat = new THREE.MeshStandardMaterial({ color: 0x4fd13c, roughness: 0.55 });
      const hubMat = new THREE.MeshStandardMaterial({ color: 0x2f8f25, roughness: 0.6 });
      const axleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
      const bearingMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.8 });
      const R = ROLLER_R;
      // Hacia dónde abre la caja en su sistema (el de la pose de piso del CAD)
      const dir0 = clawDir(posAngle(s, 0), s.arm);
      for (const side of [1, -1]) {
        for (const fromMouth of ROLLER_SHAFTS.fromMouth) {
          const axis = new THREE.Group();
          axis.position.set(dir0 * (CLAW.fingerLength / 2 - fromMouth), 0, side * ROLLER_SHAFTS.z);
          claw.add(axis);
          const [y0, y1] = ROLLER_SHAFTS.y;
          add(new THREE.CylinderGeometry(0.004, 0.004, y1 - y0, 8), axleMat, 0, (y0 + y1) / 2, 0, axis);
          // Valeros en las placas de abajo y de arriba
          for (const y of [y0 + 0.008, y1 - 0.008]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16), bearingMat, 0, y, 0, axis);
          for (const y of [0.3, 0.72]) {
            // Rueda compliant como las del lanzador de Phoenix (`am-3945`): llanta ancha verde, cubo hex más oscuro que
            // sobresale y seis huecos del rin en cada cara (con ellos se nota el giro). Solo dibujo (Xhavi, 17-nov).
            const W = 0.04;
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 28), rollerMat);
            wheel.position.y = y * sz;
            wheel.castShadow = true;
            axis.add(wheel);
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.36, R * 0.36, W + 0.012, 6), hubMat);
            wheel.add(hub);
            for (const f of [1, -1]) {
              for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2;
                const hole = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.15, R * 0.15, 0.004, 12), hubMat);
                hole.position.set(Math.cos(a) * R * 0.64, f * (W / 2 + 0.0005), Math.sin(a) * R * 0.64);
                wheel.add(hole);
              }
            }
          }
          this.clawRollers.push({ mesh: axis, row: side });
        }
      }
    }
    this.clawSample = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, sz / 2, 0, claw);
    this.clawSample2 = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, sz / 2, 0, claw);
    this.clawSample2.visible = false;
    const shooterSpec = this.robot.spec.intake?.shooter;
    if (shooterSpec?.muzzle) {
      for (let i = 0; i < this.robot.spec.capacity; i++) {
        const mesh = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, 0, 0, this.group);
        mesh.visible = false;
        this.rampSamples.push(mesh);
      }
    }
    this.criticalMesh = add(new THREE.BoxGeometry(c, c, c), critMat, 0, c / 2, 0, claw);
    // La garra queda nivelada aunque el brazo gire (se corrige en sync)
    claw.name = 'claw';
    this.criticalMesh.visible = false;
    // Crítica en la garra fija (Psycho): va en el chasis, no gira con el brazo
    const seat = critSeat(s);
    if (seat) {
      this.criticalMesh.removeFromParent();
      this.criticalMesh.position.set(seat.x, seat.y, 0);
      this.group.add(this.criticalMesh);
    }
    this.capture();
    this.capture();
    // Ruedas de tracción del CAD (no son del dibujo genérico: se quedan al cargar el modelo)
    if (s.wheel && !s.model?.staticWheels) {
      for (const side of [1, -1])
        for (const x of s.wheel.xs) {
          const pivot = new THREE.Group();
          pivot.position.set(x, s.wheel.r - WHEEL_DROP, side * s.wheel.z);
          if (side < 0) pivot.rotation.y = Math.PI;
          const spin = buildCadWheel(s.wheel);
          pivot.add(spin);
          this.group.add(pivot);
          this.wheels.push({ mesh: spin, side: side > 0 ? 1 : 0, flip: side < 0 });
        }
    }
    if (s.model) {
      // Robot del CAD: nada del dibujo genérico mientras carga (solo aparece si el modelo falla)
      for (const g of this.generic) g.visible = false;
      void this.useModel(s.model, color, W);
    }
  }

  /** Dibuja el robot del CAD: el chasis y la torre quietos, el brazo con la garra girando en el pivote. */
  private async useModel(m: CadModel, color: number, width: number): Promise<void> {
    let scene: THREE.Group;
    try {
      scene = (await loadModel(import.meta.env.BASE_URL + m.url)).clone(true);
    } catch (e) {
      console.warn('[cad] no se pudo cargar el modelo', m.url, e);
      for (const g of this.generic) g.visible = true; // solo si falla: el dibujo genérico
      return;
    }
    // Robot sin brazo que gira (Phoenix): el nodo `brazo` va vacío y todo el modelo es estático
    const arm0 = scene.getObjectByName('brazo');
    const arm = arm0 && arm0.children.length ? arm0 : undefined;
    if (arm) {
      // Piezas que se mueven con el brazo aunque el CAD las tenga en el chasis (attach conserva su pose)
      if (m.armParts) {
        const re = new RegExp(m.armParts, 'i');
        const move: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o !== arm && re.test(o.name) && !move.some((x) => x.getObjectById(o.id))) {
            for (let q = o.parent; q; q = q.parent) if (q === arm) return;
            move.push(o);
          }
        });
        scene.updateMatrixWorld(true);
        for (const o of move) arm.attach(o);
      }
      arm.removeFromParent();
      const sa0 = this.robot.spec;
      const claw0 = this.arm.getObjectByName('claw');
      if (sa0.arm.linear && claw0) {
        // Elevador (Hazmat 704): el carro del CAD sube recto con la punta. El nodo `brazo` tiene el origen en el pivote y el CAD
        // está con el carro abajo (punta a `elevatorHeights[0]`): el grupo `claw` está en la punta actual, así que se corre de vuelta.
        arm.position.set(0, sa0.arm.pivotY - sa0.elevatorHeights[0], 0);
        arm.rotation.z = 0;
        claw0.add(arm);
      } else {
        arm.position.set(0, 0, 0); // this.arm ya está en el pivote
        arm.rotation.z = -(m.stowAngle ?? 0); // el CAD está en la pose de guardado
        this.rigidClaw = -(m.stowAngle ?? 0); // la garra del CAD va fija al brazo (no se nivela)
        this.arm.add(arm);
      }
    }
    const tint = m.tint ? new RegExp(m.tint, 'i') : null;
    const tinted = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      // Placas de 5 mm: con receiveShadow se llenan de acné de sombra
      o.receiveShadow = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (tint?.test(p.name)) { o.material = tinted; break; }
    });
    arm?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    // Brazo más largo que el del CAD (Axiom): se estira a lo largo y la garra se recorre `dl`
    const dl = m.cadArmLength !== undefined ? this.robot.spec.arm.length - m.cadArmLength : 0;
    if (arm && dl > 0) this.stretchArm(arm, m.stowAngle ?? 0, dl);
    if (arm && intakeOf(this.robot.spec).kind === 'pinza') this.findFingers(arm, m.stowAngle ?? 0, Math.max(0, dl));
    // Flechas (ejes) del CAD: negras en todos los robots
    // Antes de colgarla del robot: los centros se miden en el sistema del modelo (la sesión ya movió `this.group` a su lugar)
    this.buildShooterRollers(scene);
    this.group.add(scene);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && /flecha/i.test(nodeName(o))) o.material = SHAFT_MAT; // incluye el brazo (`this.arm`)
    });
    const cc = intakeOf(this.robot.spec).critClaw;
    if (cc) this.rigCritClaw(scene, cc);
    for (const g of this.generic) g.visible = false;
    // Placas con la estación: pegadas a los costados del chasis real
    for (const p of this.numPlates) p.position.z = Math.sign(p.position.z) * (width / 2 + 0.002);
  }

  /**
   * Rodillos del lanzador (Phoenix, ruedas compliant `am-3945` / `am-3949` del CAD): cada una se pega a su flecha (la
   * pieza `Flechas…` con el mismo centro en x, y), se pinta de verde y gira sobre ella (eje z). Solo dibujo: la física
   * del tiro está en `Mechanisms` / `shooter.ts`. Las dos filas van del mismo lado de la rampa, así que giran al revés
   * entre sí (Muestra entre ellas: la superficie de cada rueda avanza hacia la boca).
   */
  private buildShooterRollers(scene: THREE.Object3D): void {
    const sh = this.robot.spec.intake?.shooter;
    if (!sh?.muzzle) return;
    scene.updateMatrixWorld(true);
    const wheels: Array<{ mesh: THREE.Mesh; c: THREE.Vector3; big: boolean }> = [];
    const shafts: THREE.Vector3[] = [];
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      box.setFromObject(o);
      const c = box.getCenter(new THREE.Vector3());
      if (/flecha/i.test(nodeName(o))) shafts.push(c);
      else if (/^am-39(45|49)/i.test(nodeName(o))) wheels.push({ mesh: o, c, big: box.getSize(new THREE.Vector3()).x > 0.04 });
    });
    if (!wheels.length || !shafts.length) return;
    // Las flechas van en dos filas paralelas a la rampa (la Muestra pasa entre ellas): se saca la dirección de la rampa por
    // mínimos cuadrados (x = a + b·y, hacia arriba) y de qué lado de esa recta queda cada flecha decide el sentido del giro
    const mx = shafts.reduce((t, c) => t + c.x, 0) / shafts.length;
    const my = shafts.reduce((t, c) => t + c.y, 0) / shafts.length;
    let sxy = 0;
    let syy = 0;
    for (const c of shafts) {
      sxy += (c.x - mx) * (c.y - my);
      syy += (c.y - my) ** 2;
    }
    const slope = syy > 1e-9 ? sxy / syy : 0;
    const ul = Math.hypot(slope, 1);
    const ux = slope / ul;
    const uy = 1 / ul;
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x4fd13c, roughness: 0.55 });
    const hubGreen = new THREE.MeshStandardMaterial({ color: 0x2f8f25, roughness: 0.6 });
    for (const c of shafts) {
      const pivot = new THREE.Group();
      pivot.position.set(c.x, c.y, 0);
      scene.add(pivot);
      const side = Math.sign(ux * (c.y - my) - uy * (c.x - mx)) || 1;
      for (const w of wheels) {
        if (Math.hypot(w.c.x - c.x, w.c.y - c.y) > 0.012) continue;
        w.mesh.material = w.big ? rollerMat : hubGreen;
        pivot.attach(w.mesh);
      }
      this.shooterRollers.push({ mesh: pivot, side, bottom: false, w: 0 });
    }
    // Ruedas de abajo (donde entran las Muestras): las dos flechas más bajas (entre ellas pasa la Muestra al entrar); solo ellas giran con el intake
    const low = Math.min(...this.shooterRollers.map((r) => r.mesh.position.y));
    for (const r of this.shooterRollers) r.bottom = r.mesh.position.y < low + 0.1;
  }

  /**
   * Dedos de la pinza del CAD (piezas `garra`, dos por lado). El CAD es una sola pose: la ABIERTA (la del intake; las
   * ramas de los dedos quedan a ±0.146 m del centro). Cada dedo gira en un eje vertical (el de la garra) hasta `PINZA_DEG`
   * (23°, Xhavi 16-nov) hacia adentro, que es justo lo que hace falta para tocar la Muestra (SUPUESTO: la bisagra no está
   * en el CAD; se pone detrás de la rama para que 23° la lleven a la cara de la Muestra y apretarla).
   */
  private stretchArm(arm: THREE.Object3D, stow: number, dl: number): void {
    const isClaw = (o: THREE.Object3D) => /^garra(_\d+)?$/i.test(o.name);
    const U = new THREE.Vector3(Math.cos(stow), Math.sin(stow), 0);
    // Donde empieza la garra a lo largo del brazo (fin del brazo en el CAD)
    let uEnd = Infinity;
    for (const o of arm.children) {
      if (!(o instanceof THREE.Mesh) || !isClaw(o)) continue;
      const a = o.geometry.getAttribute('position');
      for (let k = 0; k < a.count; k++) uEnd = Math.min(uEnd, new THREE.Vector3().fromBufferAttribute(a, k).dot(U));
    }
    if (!Number.isFinite(uEnd)) return;
    // Estira desde el eje hasta que el extremo del brazo llegue a donde queda la garra recorrida: R(stow)·S(k)·R(−stow)
    const outer = new THREE.Group();
    outer.rotation.z = stow;
    outer.scale.x = (uEnd + dl) / uEnd;
    const inner = new THREE.Group();
    inner.rotation.z = -stow;
    outer.add(inner);
    for (const o of [...arm.children]) if (!isClaw(o)) inner.add(o);
    arm.add(outer);
  }

  private findFingers(arm: THREE.Object3D, stow: number, dl = 0): void {
    const meshes: THREE.Mesh[] = [];
    const box = new THREE.Box3();
    arm.traverse((o) => {
      if (o instanceof THREE.Mesh && /^garra(_\d+)?$/i.test(o.name)) {
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox!);
        meshes.push(o);
      }
    });
    if (meshes.length < 2) return;
    // Ejes de la garra en el sistema del brazo: U a lo largo del brazo, V perpendicular (arriba con el brazo a `stow`), Z a lo ancho
    const U = new THREE.Vector3(Math.cos(stow), Math.sin(stow), 0);
    const V = new THREE.Vector3(-Math.sin(stow), Math.cos(stow), 0);
    const P0 = new THREE.Vector3();
    const verts = (m: THREE.Mesh): THREE.Vector3[] => {
      const a = m.geometry.getAttribute('position');
      return Array.from({ length: a.count }, (_, k) => new THREE.Vector3().fromBufferAttribute(a, k));
    };
    for (const side of [1, -1]) {
      const mine = meshes.filter((m) => Math.sign((m.geometry.boundingBox!.min.z + m.geometry.boundingBox!.max.z) / 2) === side);
      if (!mine.length) return;
      const vs = mine.flatMap(verts);
      const horn = vs.filter((v) => Math.abs(v.z) > 0.1); // la rama que aprieta (las otras son la base)
      const zHorn = Math.min(...horn.map((v) => Math.abs(v.z)));
      const uTip = Math.max(...horn.map((v) => v.dot(U)));
      const vMid = vs.reduce((acc, v) => acc + v.dot(V), 0) / vs.length;
      // Radio para que PINZA_DEG lleve la rama de zHorn a la cara de la Muestra (SAMPLE_SIZE / 2)
      const r = (zHorn - SAMPLE_SIZE / 2) / Math.sin((PINZA_DEG * Math.PI) / 180);
      const pivot = P0.copy(U).multiplyScalar(uTip - r).addScaledVector(V, vMid).add(new THREE.Vector3(0, 0, side * zHorn)).clone();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), V);
      const qInv = q.clone().invert();
      const group = new THREE.Group();
      group.position.copy(pivot).addScaledVector(U, dl); // la garra recorrida `dl` a lo largo del brazo
      group.quaternion.copy(q);
      arm.add(group);
      for (const m of mine) {
        // Que la pieza siga en su sitio: pos_local = q⁻¹ (pos_brazo − P)
        m.position.copy(pivot).negate().applyQuaternion(qInv);
        m.quaternion.copy(qInv);
        group.add(m);
      }
      // Signo del giro hacia adentro: el que acerca la punta de la rama al centro
      const tip = new THREE.Vector3().copy(U).multiplyScalar(uTip).addScaledVector(V, vMid).add(new THREE.Vector3(0, 0, side * zHorn));
      const rot = (ang: number) => tip.clone().sub(pivot).applyAxisAngle(V, ang).add(pivot);
      const dir = Math.abs(rot(0.2).z) < Math.abs(rot(-0.2).z) ? 1 : -1;
      this.clawFingers.push({ group, q, dir, zHorn, r });
    }
    // La Muestra va entre los dedos: el centro de las piezas `garra` (con el eje del brazo en el origen) en el sistema de
    // la garra, que está a `arm.length` del eje (`claw.position`) y gira con el brazo: p − L·(cos, sin)(ángulo del CAD)
    const L = this.robot.spec.arm.length;
    this.pocket = { x: (box.min.x + box.max.x) / 2 + dl * Math.cos(stow) - L * Math.cos(stow), y: (box.min.y + box.max.y) / 2 + dl * Math.sin(stow) - L * Math.sin(stow) };
    this.criticalMesh.position.set(this.pocket.x, this.pocket.y, 0);
  }

  /**
   * Garra fija de la Crítica (`Garrita-Garrita` del CAD, uno por costado): cada dedo gira sobre su eje vertical (`Flecha 10cm`,
   * `CritClaw.shafts`) hacia el frente hasta tocar la Crítica. El CAD solo trae la pose abierta (SUPUESTO el giro y su sentido).
   */
  private rigCritClaw(scene: THREE.Object3D, cc: CritClaw): void {
    const fingers: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && /^Garrita-Garrita/i.test(o.name)) fingers.push(o);
    });
    for (const m of fingers) {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      const side = Math.sign((bb.min.z + bb.max.z) / 2) || 1;
      const sh = cc.shafts.find((q) => Math.sign(q.z) === side);
      if (!sh || !m.parent) continue;
      const g = new THREE.Group();
      g.position.set(sh.x, 0, sh.z);
      m.parent.add(g);
      m.position.set(-sh.x, 0, -sh.z);
      g.add(m);
      this.critFingers.push({ g, side });
    }
  }

  /** Cierra o abre los dedos de la garra de la Crítica según lleve o no la pieza (0.25 s, SUPUESTO). */
  private animateCritClaw(dt: number): void {
    const cc = intakeOf(this.robot.spec).critClaw;
    if (!cc || !this.critFingers.length) return;
    // Con la Crítica adentro cierra hasta tocarla; cerrada en vacío (interruptor, tecla 4) llega a 75 % (SUPUESTO)
    const want = this.robot.mech.critical !== null ? cc.closeDeg : this.robot.mech.critClawClosed ? cc.emptyDeg : 0;
    this.critNow += Math.max(-(cc.emptyDeg / 0.25) * dt, Math.min((cc.emptyDeg / 0.25) * dt, want - this.critNow));
    for (const f of this.critFingers) f.g.rotation.y = f.side * ((this.critNow * Math.PI) / 180);
  }

  /** Grados que hay que girar cada dedo para que su rama quede a `zTarget` del centro (arcsin; tope 40°). */
  private fingerDeg(zTarget: number): number {
    const f = this.clawFingers[0];
    if (!f) return 0;
    return Math.min(40, (Math.asin(Math.max(0, Math.min(1, (f.zHorn - zTarget) / f.r))) * 180) / Math.PI);
  }

  /**
   * Abre/cierra la pinza. Abierta = la pose del CAD (0°). Con la Muestra adentro cierra hasta tocarla (23°) y la aprieta;
   * la Crítica (0.20 m) llega antes; cerrada en vacío (interruptor, `Mechanisms.toggleClaw`) llega a ~30°. Velocidad: lo que
   * falta entre `closeTime` (SUPUESTO).
   */
  private animateFingers(dt: number): void {
    if (!this.clawFingers.length) return;
    const m = this.robot.mech;
    const it = intakeOf(this.robot.spec);
    const hold = this.fingerDeg(SAMPLE_SIZE / 2);
    const empty = this.fingerDeg(0.055);
    const crit = this.fingerDeg(CRITICAL_SIZE / 2);
    const want = m.critical !== null ? crit : m.inClaw ? hold : m.latched && m.clawClosed && m.closingFor === 0 ? empty : m.closingFor > 0 ? (hold * Math.min(1, m.closingFor / Math.max(0.05, it.closeTime))) : 0;
    const v = hold / Math.max(0.05, it.closeTime);
    this.fingerNow += Math.max(-v * dt, Math.min(v * dt, want - this.fingerNow));
    const Y = new THREE.Vector3(0, 1, 0);
    for (const f of this.clawFingers) {
      f.group.quaternion.copy(f.q).multiply(this.qTmp.setFromAxisAngle(Y, (f.dir * this.fingerNow * Math.PI) / 180));
    }
  }

  /** Guarda la pose después de cada paso de física (para interpolar). */
  capture(): void {
    this.prevP.copy(this.curP);
    this.prevQ.copy(this.curQ);
    const t = this.robot.phys.body.translation();
    const r = this.robot.phys.body.rotation();
    this.curP.set(t.x, t.y, t.z);
    this.curQ.set(r.x, r.y, r.z, r.w);
  }

  sync(alpha: number): void {
    this.group.position.lerpVectors(this.prevP, this.curP, alpha);
    this.group.quaternion.slerpQuaternions(this.prevQ, this.curQ, alpha);
    // Giro de las ruedas: avance en la dirección del robot ± lo que gira cada lado
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);
    const yaw = Math.atan2(-fwd.z, fwd.x);
    const ds = this.lastP.distanceToSquared(this.group.position) < 1 ? this.group.position.clone().sub(this.lastP).dot(fwd) : 0;
    let dy = yaw - this.lastYaw;
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    this.spin[0] += (ds - dy * this.halfW) / WHEEL_R;
    this.spin[1] += (ds + dy * this.halfW) / WHEEL_R;
    this.fwdStep = ds;
    this.lastP.copy(this.group.position);
    this.lastYaw = yaw;
    const nowY = performance.now() / 1000;
    const dtY = Math.min(0.1, nowY - (this.yawT || nowY));
    this.yawT = nowY;
    const rate = dtY > 1e-4 ? dy / dtY : 0;
    this.yawAcc += ((dtY > 1e-4 ? (rate - this.yawRate) / dtY : 0) - this.yawAcc) * Math.min(1, dtY * 12);
    this.yawRate = rate;
    if (!this.hitDebug && hitboxDebugOn()) {
      this.hitDebug = new HitboxDebug(this.robot.phys);
      this.group.add(this.hitDebug.group);
    }
    this.hitDebug?.sync();
    for (const w of this.wheels) w.mesh.rotation.z = (w.flip ? 1 : -1) * this.spin[w.side];
    const m = this.robot.mech;
    this.criticalMesh.visible = m.critical !== null;
    // Garrita: la Crítica viene jalada desde donde estaba hasta el asiento (ease-out), girando a su lugar
    const cseat = critSeat(this.robot.spec);
    if (cseat) {
      const pull = m.critPull;
      if (pull && m.critical) {
        const k = Math.min(1, m.critPullAge / Math.max(0.01, m.critPullDur));
        const e = 1 - (1 - k) * (1 - k);
        this.criticalMesh.position.set(pull.x + (cseat.x + m.critHold.dx - pull.x) * e, pull.y + (cseat.y + m.critHold.dy - pull.y) * e, pull.z + (m.critHold.dz - pull.z) * e);
        this.criticalMesh.rotation.y = pull.yaw * (1 - e);
      } else {
        // Lanzador (Phoenix): la Crítica va suelta en su lugar de la rampa y se mece un poco con la inercia (solo dibujo, ±2 cm)
        let jx = 0;
        if (this.robot.spec.intake?.shooter) {
          const dtJ = Math.min(0.05, Math.max(0, performance.now() / 1000 - (this.critJT || performance.now() / 1000)));
          this.critJT = performance.now() / 1000;
          this.critJv += (-120 * this.critJx - 11 * this.critJv - this.accF * 0.6) * dtJ;
          this.critJx = Math.max(-0.02, Math.min(0.02, this.critJx + this.critJv * dtJ));
          jx = this.critJx;
        }
        this.criticalMesh.position.set(cseat.x + m.critHold.dx + jx, cseat.y + m.critHold.dy, m.critHold.dz);
        this.criticalMesh.rotation.y = 0;
      }
    }
    if (this.critFingers.length) {
      const nowC = performance.now() / 1000;
      this.animateCritClaw(Math.min(0.1, nowC - (this.critT || nowC)));
      this.critT = nowC;
    }
    const claw = this.arm.getObjectByName('claw');
    const sa = this.robot.spec.arm;
    if (sa.linear && claw) {
      // El carro sube recto por los rieles (el grupo del brazo no gira)
      const tip = armTip(sa, m.angle);
      this.arm.rotation.z = 0;
      claw.rotation.z = 0;
      claw.position.set(tip.x - sa.pivotX, tip.y - sa.pivotY, 0);
    } else if (sa.stowTip && m.angle > Math.PI / 2 && claw) {
      // Brazo plegado: del eje a la punta, acortado
      const tip = armTip(sa, m.angle);
      const dx = tip.x - sa.pivotX;
      const dy = tip.y - sa.pivotY;
      const b = Math.atan2(dy, dx);
      const k = Math.max(0.05, Math.hypot(dx, dy) / sa.length);
      this.arm.rotation.z = b;
      this.arm.scale.x = k;
      claw.scale.x = 1 / k;
      claw.rotation.z = -b;
    } else {
      this.arm.rotation.z = m.angle;
      this.arm.scale.x = 1;
      if (claw) {
        claw.scale.x = 1;
        claw.rotation.z = this.rigidClaw ?? -m.angle;
      }
    }
    this.palm.position.x = -clawDir(m.angle, sa) * (this.claw.fingerLength / 2 + this.claw.palmThickness / 2);
    // Una o dos Muestras en la garra. Con rodillos van en fila sobre el eje de la boca (la primera en la
    // placa del fondo, la segunda detrás, `seatX`), en el sistema de la caja: con la garra del CAD (fija
    // al brazo) la fila gira con ella y al anotar queda vertical, con la boca hacia abajo (como en las
    // fotos del robot real, que muestran la caja volteada). Sin rodillos, la segunda va encima.
    const n = m.inClaw ? (sa.holdsTwo ? Math.min(2, m.stored.length) : 1) : 0;
    const rollers = intakeOf(this.robot.spec).rollers === true;
    // Hacia dónde abre la caja en su propio sistema: el de la pose de piso si la garra va fija al brazo
    const boxDir = this.rigidClaw !== null ? clawDir(posAngle(this.robot.spec, 0), sa) : clawDir(m.angle, sa);
    const seat = (k: number) => (rollers ? seatX(this.robot.spec, 0, boxDir, k) : 0);
    this.clawSample.visible = n >= 1;
    this.clawSample.position.set(this.pocket?.x ?? seat(0), this.pocket?.y ?? SAMPLE_SIZE * 0.475, 0);
    this.clawSample2.visible = n >= 2 && !this.rampSamples.length;
    // Lanzador: las Muestras suben en fila por la rampa, del pie (donde entran) hacia la boca; cada una ocupa SAMPLE_SIZE
    const ramp = this.robot.spec.intake?.shooter?.muzzle;
    if (ramp) {
      const x0 = sa.pivotX;
      const y0 = SAMPLE_SIZE / 2;
      const len = Math.hypot(ramp.x - x0, ramp.y - y0);
      const ux = (ramp.x - x0) / len;
      const uy = (ramp.y - y0) / len;
      const have = m.inClaw ? m.stored.length : 0;
      // Las Muestras guardadas son cuerpos ligeros (`RampSim`, solo dibujo): entran rodando por el piso y suben por la rampa, se
      // recargan con la inercia del robot, chocan entre sí y con el tope de la boca; al tirar sale la de arriba y las demás suben.
      const nowA = performance.now() / 1000;
      const dtA = Math.min(0.1, nowA - (this.slotT || nowA));
      this.slotT = nowA;
      const vF = dtA > 1e-4 ? this.fwdStep / dtA : 0;
      const aF = dtA > 1e-4 ? (vF - this.fwdVel) / dtA : 0;
      this.fwdVel = vF;
      this.accF += (aF - this.accF) * Math.min(1, dtA * 12); // suavizado: los cuadros del render no coinciden con los pasos de la física
      // Inercia amortiguada (×0.3, tope 12 m/s²): a escala real se veía exagerada
      const accRamp = Math.max(-12, Math.min(12, this.accF * 0.3)) * ux / SAMPLE_SIZE;
      const sim = (this.rampSim ??= new RampSim(this.rampSamples.length));
      sim.step(dtA, have, accRamp, Math.max(-25, Math.min(25, this.yawAcc)));
      const rampRot = Math.atan2(uy, ux) - Math.PI / 2;
      this.rampSamples.forEach((mesh, i) => {
        const b = sim.bodies[i];
        mesh.visible = i < have;
        if (!mesh.visible) return;
        // Detrás del pie rueda por el piso (horizontal); en la rampa va inclinada como ella
        const onRamp = Math.max(0, b.s);
        mesh.position.set(x0 + (b.s < 0 ? b.s * SAMPLE_SIZE : ux * SAMPLE_SIZE * b.s), y0 + uy * SAMPLE_SIZE * onRamp, 0);
        mesh.rotation.z = rampRot * Math.min(1, onRamp) + b.rot;
      });
      this.clawSample.visible = false;
    }
    this.clawSample2.position.set(seat(1), rollers ? SAMPLE_SIZE * 0.475 : SAMPLE_SIZE * 1.45, 0);
    // Rodillos: con la garra prendida giran jalando hacia adentro (hacia la placa); al soltar, hacia afuera
    if (this.clawRollers.length) {
      const nowR = performance.now() / 1000;
      const dtR = Math.min(0.1, nowR - (this.rollerT || nowR));
      this.rollerT = nowR;
      const spin = m.ejectT > 0 ? -1 : m.intakeOn ? 1 : 0;
      if (spin) {
        const w = (intakeOf(this.robot.spec).rollerSpeed / ROLLER_R) * spin;
        // Flechas verticales: la del costado +z gira con +ω (vista desde arriba) para jalar hacia la placa
        for (const r of this.clawRollers) r.mesh.rotation.y += r.row * boxDir * w * dtR;
      }
    }
    // Rodillos del lanzador: con el intake giran solo los de abajo; al tirar giran todos; frenan al terminar
    if (this.shooterRollers.length) {
      const nowS = performance.now() / 1000;
      const dtS = Math.min(0.1, nowS - (this.shooterT || nowS));
      this.shooterT = nowS;
      const shooting = m.shotSpinT > 0 || m.ejectT > 0;
      // Intake prendido: solo giran las ruedas de abajo (las que jalan la Muestra); al tirar giran todas
      for (const r of this.shooterRollers) {
        const target = shooting ? SHOOTER_SPIN_SHOT : m.intakeOn && r.bottom ? SHOOTER_SPIN_INTAKE : 0;
        r.w += (target - r.w) * Math.min(1, dtS * 10);
        if (Math.abs(r.w) < 0.05) r.w = 0;
        r.mesh.rotation.z += r.side * r.w * dtS;
      }
    }
    if (this.clawFingers.length) {
      const nowF = performance.now() / 1000;
      this.animateFingers(Math.min(0.1, nowF - (this.fingerT || nowF)));
      this.fingerT = nowF;
    }
    // Con falla: LEDs en ámbar parpadeando
    const f = this.faults();
    const now = performance.now() / 1000;
    if (f.size === 0) {
      this.led.emissive.copy(this.ledColor);
      this.led.emissiveIntensity = 2.6;
    } else {
      const on = Math.sin(now * 7) > 0;
      this.led.emissive.copy(this.faultColor.set(ROBOT_STYLE.fault));
      this.led.emissiveIntensity = on ? 2.8 : 0.2;
    }
  }
}
