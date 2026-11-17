import * as THREE from 'three';

/**
 * Sin reflejos (Xhavi, 17-nov): todo material estándar queda mate. `metalness` siempre 0 y `roughness`
 * al menos 0.9, así que ni el entorno ni las luces dejan brillos especulares. Se aplica al prototipo,
 * para que cubra también los materiales de los modelos del CAD (GLB). Importar una sola vez.
 */
const MIN_ROUGHNESS = 0.9;
const proto = THREE.MeshStandardMaterial.prototype as unknown as { _rough?: number };
Object.defineProperty(proto, 'metalness', { get: () => 0, set: () => undefined, configurable: true });
Object.defineProperty(proto, 'roughness', {
  get(this: { _rough?: number }) {
    return Math.max(MIN_ROUGHNESS, this._rough ?? 1);
  },
  set(this: { _rough?: number }, v: number) {
    this._rough = v;
  },
  configurable: true,
});
