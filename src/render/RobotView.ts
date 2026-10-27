/**
 * Robot visual: chasis tanque con placa del color de la alianza (no lleva bumpers, §7.2), la torre
 * del pivote y el brazo con garra, con la Muestra o la Muestra Crítica que lleva.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CRITICAL_SIZE, SAMPLE_SIZE } from '../config/field';
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
const WHEEL_R = 0.05;

export class RobotView {
  readonly group = new THREE.Group();
  private arm = new THREE.Group();
  private criticalMesh: THREE.Mesh;
  /** Muestra en la garra. */
  private clawSample: THREE.Mesh;
  private wheels: Array<{ mesh: THREE.Object3D; side: number }> = [];
  private lastP = new THREE.Vector3();
  private lastYaw = 0;
  private spin = [0, 0];
  private halfW = 0;
  private prevP = new THREE.Vector3();
  private curP = new THREE.Vector3();
  private prevQ = new THREE.Quaternion();
  private curQ = new THREE.Quaternion();

  constructor(private robot: Robot) {
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
    const color = ALLIANCE_COLOR[robot.alliance];
    // Chasis redondeado y tanque: tres ruedas por lado con cubo dorado (giran al avanzar) y oruga
    add(new RoundedBoxGeometry(L, 0.16, W - 0.12, 3, 0.025), dark, 0, 0.13, 0);
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
        this.wheels.push({ mesh: w, side: z > 0 ? 1 : 0 });
      }
      add(new THREE.BoxGeometry(L - 0.04, 0.012, 0.05), wheelMat, 0, WHEEL_R * 2 + 0.004, z * this.halfW);
    }
    const plate = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 });
    add(new RoundedBoxGeometry(L * 0.98, 0.025, W * 0.98, 2, 0.01), plate, 0, 0.22, 0);
    // Tira de LEDs bajo el chasis (el bloom la hace brillar) y placa con la estación en los costados
    const led = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.6 });
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(L * 0.8, 0.012, 0.01), led, 0, 0.065, z * (W / 2 - 0.115));
    const num = textTexture(`${robot.alliance === 'red' ? 'R' : 'B'}${robot.station + 1}`, { w: 128, h: 64, bg: robot.alliance === 'red' ? '#a01e24' : '#173f9e' });
    if (num) {
      const numMat = new THREE.MeshStandardMaterial({ map: num, roughness: 0.5 });
      for (const z of [-1, 1]) {
        const m = add(new THREE.PlaneGeometry(0.16, 0.08), numMat, -L * 0.18, 0.14, z * ((W - 0.12) / 2 + 0.002));
        m.rotation.y = z > 0 ? 0 : Math.PI;
        m.castShadow = false;
      }
    }
    const sz = SAMPLE_SIZE * 0.95;
    const c = CRITICAL_SIZE;
    const critMat = criticalMaterial(robot.alliance);
    // Torre del pivote, brazo y garra; la pieza agarrada va en la punta
    const a = s.arm;
    if (a.pivotY > 0.29) add(new THREE.BoxGeometry(0.12, a.pivotY - 0.23, 0.3), dark, a.pivotX, (a.pivotY + 0.23) / 2, 0);
    // Eje bajo (el brazo que voltea): soportes a los lados del canal por donde pasa el brazo
    else for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.16, 0.03), dark, a.pivotX, 0.25, z * 0.13);
    this.group.add(this.arm);
    this.arm.position.set(a.pivotX, a.pivotY, 0);
    for (const z of [-0.09, 0.09]) add(new THREE.BoxGeometry(a.length, 0.04, 0.03), alu, a.length / 2, 0, z, this.arm);
    // Garra: dedos a los lados de la pieza (el sistema local del brazo gira con él)
    const claw = new THREE.Group();
    claw.position.set(a.length, 0, 0);
    this.arm.add(claw);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.2, 0.16, 0.02), alu, 0, 0.08, z * 0.11, claw);
    this.clawSample = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, 0, sz / 2, 0, claw);
    this.criticalMesh = add(new THREE.BoxGeometry(c, c, c), critMat, 0, c / 2, 0, claw);
    // La garra queda nivelada aunque el brazo gire (se corrige en sync)
    claw.name = 'claw';
    this.criticalMesh.visible = false;
    this.capture();
    this.capture();
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
    this.arm.rotation.z = m.angle;
    const claw = this.arm.getObjectByName('claw');
    if (claw) claw.rotation.z = -m.angle;
    this.clawSample.visible = m.inClaw;
  }
}
