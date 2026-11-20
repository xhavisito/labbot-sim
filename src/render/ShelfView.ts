/** Malla de la repisa móvil de la Muestra Crítica (interpolada entre pasos de física). */
import * as THREE from 'three';
import { criticalShelfBox } from '../config/fieldLayout';
import * as F from '../config/field';
import type { CriticalShelf } from '../game/CriticalShelf';

export class ShelfView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];

  constructor(private shelves: CriticalShelf[]) {
    const b = criticalShelfBox();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.7 });
    for (const _ of shelves) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'criticalHolder';
      this.meshes.push(m);
      this.group.add(m);
    }
    this.sync(1);
  }

  sync(alpha: number): void {
    const b = criticalShelfBox();
    this.shelves.forEach((s, i) => {
      const x = s.prevX + (s.x - s.prevX) * alpha;
      const p = F.forAlliance(s.alliance, { x, z: b.cz });
      this.meshes[i].position.set(p.x, b.cy, p.z);
    });
  }
}
