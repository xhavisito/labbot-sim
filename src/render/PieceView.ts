/** Mallas de las piezas: una por cuerpo del pool; se ocultan cuando la pieza no está en la cancha. */
import * as THREE from 'three';
import type { Pieces } from '../physics/Pieces';
import { ALLIANCE_COLOR } from './FieldView';

export class PieceView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private prev: Array<{ p: THREE.Vector3; q: THREE.Quaternion }> = [];
  private cur: Array<{ p: THREE.Vector3; q: THREE.Quaternion }> = [];

  constructor(private pieces: Pieces) {
    const sampleMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.95 });
    for (const p of pieces.list) {
      const s = pieces.size(p);
      const mat = p.kind === 'critical' ? new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[p.owner!], roughness: 0.9 }) : sampleMat;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.meshes.push(m);
      this.group.add(m);
      this.prev.push({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
      this.cur.push({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
    }
    this.capture();
    this.capture();
  }

  /** Guarda la pose después de cada paso de física (para interpolar). */
  capture(): void {
    this.pieces.list.forEach((p, i) => {
      this.prev[i].p.copy(this.cur[i].p);
      this.prev[i].q.copy(this.cur[i].q);
      const t = p.body.translation();
      const r = p.body.rotation();
      this.cur[i].p.set(t.x, t.y, t.z);
      this.cur[i].q.set(r.x, r.y, r.z, r.w);
    });
  }

  /** Copia la pose interpolada (alpha 0–1 entre los dos últimos pasos) a las mallas. */
  sync(alpha: number): void {
    this.pieces.list.forEach((p, i) => {
      const m = this.meshes[i];
      m.visible = p.state.at === 'field';
      if (!m.visible) return;
      m.position.lerpVectors(this.prev[i].p, this.cur[i].p, alpha);
      m.quaternion.slerpQuaternions(this.prev[i].q, this.cur[i].q, alpha);
    });
  }
}
