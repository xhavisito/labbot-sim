/**
 * Robot visual: chasis tanque con placa del color de la alianza (no lleva bumpers, §7.2),
 * superestructura, elevador con carro, intake (visible al desplegarse), Muestras guardadas y
 * Muestra Crítica en la pinza.
 */
import * as THREE from 'three';
import { CRITICAL_SIZE, SAMPLE_SIZE } from '../config/field';
import type { Robot } from '../game/Robot';
import { ALLIANCE_COLOR } from './FieldView';

const dark = new THREE.MeshStandardMaterial({ color: 0x30343b, roughness: 0.6, metalness: 0.3 });
const alu = new THREE.MeshStandardMaterial({ color: 0xb8bec7, roughness: 0.4, metalness: 0.6 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
const sampleMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.95 });

export class RobotView {
  readonly group = new THREE.Group();
  private carriage = new THREE.Group();
  private intake: THREE.Mesh;
  private storedMeshes: THREE.Mesh[] = [];
  private criticalMesh: THREE.Mesh;
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
    // Chasis y orugas del tanque
    add(new THREE.BoxGeometry(L, 0.16, W - 0.12), dark, 0, 0.13, 0);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(L, 0.1, 0.06), wheelMat, 0, 0.05, z * (W / 2 - 0.03));
    const plate = new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[robot.alliance], roughness: 0.5 });
    add(new THREE.BoxGeometry(L * 0.98, 0.02, W * 0.98), plate, 0, 0.22, 0);
    // Superestructura (atrás) y mástil del elevador (al frente)
    add(new THREE.BoxGeometry(L * 0.4, s.baseHeight - 0.23, W * 0.8), dark, -L * 0.25, (s.baseHeight + 0.23) / 2, 0);
    for (const z of [-0.12, 0.12]) add(new THREE.BoxGeometry(0.04, s.baseHeight - 0.2, 0.04), alu, L * 0.25, (s.baseHeight + 0.2) / 2, z);
    // Carro del elevador con el depósito que sale al frente (alcance `reach`)
    this.group.add(this.carriage);
    this.carriage.position.set(L * 0.25, 0, 0);
    const trayLen = L / 2 - L * 0.25 + s.reach;
    add(new THREE.BoxGeometry(trayLen, 0.02, 0.3), alu, trayLen / 2, -0.01, 0, this.carriage);
    add(new THREE.BoxGeometry(0.05, 0.2, 0.3), alu, 0, 0.1, 0, this.carriage);
    // Muestras guardadas (en la tolva) y Muestra Crítica (en la pinza)
    const sz = SAMPLE_SIZE * 0.95;
    for (let i = 0; i < s.capacity; i++) {
      const m = add(new THREE.BoxGeometry(sz, sz, sz), sampleMat, -L * 0.05 - (i % 2) * 0.16, 0.23 + sz / 2 + Math.floor(i / 2) * sz, (i % 2 ? -1 : 1) * 0.08);
      m.visible = false;
      this.storedMeshes.push(m);
    }
    const c = CRITICAL_SIZE;
    this.criticalMesh = add(new THREE.BoxGeometry(c, c, c), new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[robot.alliance], roughness: 0.9 }), trayLen - c / 2, c / 2, 0, this.carriage);
    this.criticalMesh.visible = false;
    // Intake (barra con rodillo al frente)
    this.intake = add(new THREE.BoxGeometry(s.intake.extension, 0.08, s.intake.width), alu, L / 2 + s.intake.extension / 2, 0.06, 0);
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
    const m = this.robot.mech;
    this.carriage.position.y = m.height;
    this.intake.visible = m.intakeOn;
    this.storedMeshes.forEach((mesh, i) => (mesh.visible = i < m.stored.length));
    this.criticalMesh.visible = m.critical !== null;
  }
}
