/** Mallas de las piezas: una por cuerpo del pool; se ocultan cuando la pieza no está en la cancha. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Pieces } from '../physics/Pieces';
import type { Alliance } from '../core/types';
import { ALLIANCE_COLOR } from './FieldView';
import { foamTexture } from './textures';

let sample: THREE.MeshStandardMaterial | null = null;
const critical: Partial<Record<Alliance, THREE.MeshPhysicalMaterial>> = {};

/** Muestra de hule espuma (con poros si hay DOM); compartida por la cancha y los robots. */
export function sampleMaterial(): THREE.MeshStandardMaterial {
  if (sample) return sample;
  const foam = foamTexture();
  return (sample = new THREE.MeshStandardMaterial({ color: foam ? 0xffffff : 0xd9c9a8, map: foam?.map ?? null, bumpMap: foam?.bump ?? null, bumpScale: 1.4, roughness: 0.96 }));
}

/** Muestra Crítica: plástico brillante del color de la alianza con un leve resplandor. */
export function criticalMaterial(a: Alliance): THREE.MeshPhysicalMaterial {
  return (critical[a] ??= new THREE.MeshPhysicalMaterial({ color: ALLIANCE_COLOR[a], roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: ALLIANCE_COLOR[a], emissiveIntensity: 0.25 }));
}

export class PieceView {
  readonly group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private prev: Array<{ p: THREE.Vector3; q: THREE.Quaternion }> = [];
  private cur: Array<{ p: THREE.Vector3; q: THREE.Quaternion }> = [];

  constructor(private pieces: Pieces) {
    const sampleMat = sampleMaterial();
    for (const p of pieces.list) {
      const s = pieces.size(p);
      const mat = p.kind === 'critical' ? criticalMaterial(p.owner!) : sampleMat;
      // Cubos con orillas redondeadas (el hule espuma no tiene aristas filosas)
      const m = new THREE.Mesh(new RoundedBoxGeometry(s, s, s, 2, s * 0.12), mat);
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
