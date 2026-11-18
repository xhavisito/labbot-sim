/**
 * Trazos de la pizarra táctica (`core/board.ts`) como cintas planas sobre la alfombra. Se redibuja
 * solo cuando cambia la pizarra (`rev`). No se graba en la repetición.
 */
import * as THREE from 'three';
import { BOARD_HEX, type Board } from '../core/board';

const Y = 0.032;
const W = 0.04;

export class BoardView {
  readonly group = new THREE.Group();
  private rev = -1;

  constructor() {
    this.group.renderOrder = 3;
  }

  /** Redibuja si `rev` (contador de cambios de la pizarra) cambió. */
  update(board: Board, rev: number): void {
    if (rev === this.rev) return;
    this.rev = rev;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const s of board.strokes) {
      const pos: number[] = [];
      const pts = s.pts;
      if (pts.length === 1) {
        const p = pts[0];
        quad(pos, { x: p.x - W, z: p.z }, { x: p.x + W, z: p.z }, W * 1.5);
      }
      for (let i = 1; i < pts.length; i++) quad(pos, pts[i - 1], pts[i], W);
      if (!pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.MeshBasicMaterial({ color: BOARD_HEX[s.color], transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
      this.group.add(new THREE.Mesh(geo, mat));
    }
  }
}

function quad(pos: number[], a: { x: number; z: number }, b: { x: number; z: number }, w: number): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = (-(b.z - a.z) / len) * w;
  const nz = ((b.x - a.x) / len) * w;
  pos.push(a.x + nx, Y, a.z + nz, b.x + nx, Y, b.z + nz, b.x - nx, Y, b.z - nz, a.x + nx, Y, a.z + nz, b.x - nx, Y, b.z - nz, a.x - nx, Y, a.z - nz);
}
