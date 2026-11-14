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
import { armTip, clawOf, intakeOf, posAngle, seatX, type CadModel, type ClawDims } from '../config/robot';
import { PALETTES } from '../config/palette';
import { clawDir } from '../physics/RobotPhysics';
import type { Robot } from '../game/Robot';
import { ALLIANCE_COLOR } from './FieldView';
import { criticalMaterial, sampleMaterial } from './PieceView';
import { brushedTexture, textTexture } from './textures';

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
/** GLB de robots del CAD, una sola descarga por archivo. */
const modelCache = new Map<string, Promise<THREE.Group>>();
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
  private wheels: Array<{ mesh: THREE.Object3D; side: number }> = [];
  private lastP = new THREE.Vector3();
  private lastYaw = 0;
  private spin = [0, 0];
  /** Rodillos de la garra (robots del CAD): `row` = costado (+1 = +z, −1 = −z) de la flecha vertical; giran hacia adentro. */
  private clawRollers: Array<{ mesh: THREE.Object3D; row: number }> = [];
  private rollerT = 0;
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
    if (s.model || intakeOf(s).rollers) {
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
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.03, 24), rollerMat);
            wheel.position.y = y * sz;
            wheel.castShadow = true;
            axis.add(wheel);
            // Rayo del rin (se nota el giro)
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(R * 1.6, 0.032, 0.006), hubMat);
            spoke.position.y = y * sz;
            axis.add(spoke);
          }
          this.clawRollers.push({ mesh: axis, row: side });
        }
      }
    }
    this.clawSample = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, sz / 2, 0, claw);
    this.clawSample2 = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, sz / 2, 0, claw);
    this.clawSample2.visible = false;
    this.criticalMesh = add(new THREE.BoxGeometry(c, c, c), critMat, 0, c / 2, 0, claw);
    // La garra queda nivelada aunque el brazo gire (se corrige en sync)
    claw.name = 'claw';
    this.criticalMesh.visible = false;
    this.capture();
    this.capture();
    if (s.model && !a.linear && !a.stowTip) void this.useModel(s.model, color, W);
  }

  /** Dibuja el robot del CAD: el chasis y la torre quietos, el brazo con la garra girando en el pivote. */
  private async useModel(m: CadModel, color: number, width: number): Promise<void> {
    let scene: THREE.Group;
    try {
      scene = (await loadModel(import.meta.env.BASE_URL + m.url)).clone(true);
    } catch (e) {
      console.warn('[cad] no se pudo cargar el modelo', m.url, e);
      return; // se queda el dibujo genérico
    }
    const arm = scene.getObjectByName('brazo');
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
      arm.position.set(0, 0, 0); // this.arm ya está en el pivote
      arm.rotation.z = -(m.stowAngle ?? 0); // el CAD está en la pose de guardado
      this.rigidClaw = -(m.stowAngle ?? 0); // la garra del CAD va fija al brazo (no se nivela)
      this.arm.add(arm);
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
    this.group.add(scene);
    for (const g of this.generic) g.visible = false;
    // Placas con la estación: pegadas a los costados del chasis real
    for (const p of this.numPlates) p.position.z = Math.sign(p.position.z) * (width / 2 + 0.002);
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
    this.lastP.copy(this.group.position);
    this.lastYaw = yaw;
    for (const w of this.wheels) w.mesh.rotation.z = -this.spin[w.side];
    const m = this.robot.mech;
    this.criticalMesh.visible = m.critical !== null;
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
    this.clawSample.position.set(seat(0), SAMPLE_SIZE * 0.475, 0);
    this.clawSample2.visible = n >= 2;
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
