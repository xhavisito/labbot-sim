/**
 * Aficionada en silla de ruedas junto a la cancha (solo decorativa: sin colisionador, fuera del
 * área de juego y del margen de §3.1). Va en la vista de la cancha y no depende de la calidad,
 * así que se ve en todas. Geometrías fusionadas por material: 5 draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from '../config/field';

const UP = new THREE.Vector3(0, 1, 0);

/** Cilindro (o cápsula) entre dos puntos. */
function segment(a: THREE.Vector3, b: THREE.Vector3, r: number, capsule = false): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8) : new THREE.CylinderGeometry(r, r, len, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Rueda en el plano YZ (eje en X). */
function wheel(x: number, y: number, z: number, r: number, tube: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, 8, 28).rotateY(Math.PI / 2).translate(x, y, z);
}

/** Figura en coordenadas locales: mira hacia +Z, el piso en y = 0. */
export function buildWheelchairFan(): THREE.Group {
  const frame: THREE.BufferGeometry[] = [];
  const rubber: THREE.BufferGeometry[] = [];
  const shirt: THREE.BufferGeometry[] = [];
  const pants: THREE.BufferGeometry[] = [];
  const skin: THREE.BufferGeometry[] = [];

  // ---- Silla: ruedas traseras grandes con aro de empuje, rueditas delanteras, asiento y respaldo
  const axleY = 0.3;
  const axleZ = -0.06;
  for (const s of [-1, 1]) {
    const x = s * 0.31;
    rubber.push(wheel(x, axleY, axleZ, 0.29, 0.018));
    frame.push(wheel(x + s * 0.035, axleY, axleZ, 0.255, 0.007)); // aro de empuje
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI;
      const d = v(0, Math.sin(t) * 0.27, Math.cos(t) * 0.27);
      frame.push(segment(v(x, axleY, axleZ).sub(d), v(x, axleY, axleZ).add(d), 0.003));
    }
    frame.push(segment(v(x - 0.03, axleY, axleZ), v(x + 0.03, axleY, axleZ), 0.03)); // maza
    // Rueditas delanteras con su horquilla
    const cx = s * 0.21;
    rubber.push(wheel(cx, 0.07, 0.36, 0.06, 0.016));
    frame.push(segment(v(cx, 0.07, 0.36), v(cx, 0.24, 0.33), 0.009));
    // Estructura lateral: del eje al frente, poste del respaldo y bajada a los pies
    const fx = s * 0.23;
    frame.push(segment(v(fx, 0.48, -0.12), v(fx, 0.48, 0.32), 0.012));
    frame.push(segment(v(fx, 0.24, -0.08), v(fx, 0.24, 0.33), 0.012));
    frame.push(segment(v(fx, 0.24, 0.33), v(fx, 0.48, 0.32), 0.012));
    frame.push(segment(v(fx, 0.48, 0.3), v(s * 0.13, 0.14, 0.45), 0.011));
    frame.push(segment(v(fx, 0.24, -0.12), v(fx, 0.93, -0.16), 0.012));
    frame.push(segment(v(fx, 0.93, -0.16), v(fx, 0.95, -0.28), 0.012)); // manija
  }
  frame.push(new THREE.BoxGeometry(0.44, 0.05, 0.44).translate(0, 0.5, 0.1)); // asiento
  frame.push(new THREE.BoxGeometry(0.44, 0.36, 0.03).rotateX(-0.08).translate(0, 0.72, -0.15)); // respaldo
  frame.push(new THREE.BoxGeometry(0.3, 0.015, 0.12).translate(0, 0.13, 0.47)); // reposapiés

  // ---- Persona sentada, con un brazo arriba echándole porras a los equipos
  for (const s of [-1, 1]) {
    pants.push(segment(v(s * 0.1, 0.6, -0.02), v(s * 0.1, 0.59, 0.38), 0.075, true)); // muslo
    pants.push(segment(v(s * 0.1, 0.58, 0.4), v(s * 0.1, 0.22, 0.43), 0.055, true)); // pierna
    rubber.push(new THREE.BoxGeometry(0.1, 0.07, 0.2).translate(s * 0.1, 0.175, 0.48)); // tenis
  }
  shirt.push(new THREE.CapsuleGeometry(0.16, 0.24, 3, 10).scale(1, 1, 0.72).translate(0, 0.86, -0.04));
  skin.push(segment(v(0, 1.02, -0.04), v(0, 1.1, -0.03), 0.045)); // cuello
  skin.push(new THREE.SphereGeometry(0.105, 14, 10).translate(0, 1.2, -0.02));
  rubber.push(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1).translate(0, 1.215, -0.035)); // cabello
  // Brazo izquierdo en el aro de empuje
  shirt.push(segment(v(-0.2, 1.02, -0.05), v(-0.25, 0.8, 0.0), 0.05, true));
  skin.push(segment(v(-0.25, 0.8, 0.0), v(-0.31, 0.58, 0.04), 0.04, true));
  skin.push(new THREE.SphereGeometry(0.045, 10, 8).translate(-0.32, 0.53, 0.05));
  // Brazo derecho arriba
  shirt.push(segment(v(0.2, 1.02, -0.05), v(0.31, 1.24, 0.0), 0.05, true));
  skin.push(segment(v(0.31, 1.24, 0.0), v(0.36, 1.48, 0.06), 0.04, true));
  skin.push(new THREE.SphereGeometry(0.048, 10, 8).translate(0.37, 1.54, 0.07));

  const g = new THREE.Group();
  g.name = 'wheelchairFan';
  for (const [geos, mat] of [
    [frame, new THREE.MeshStandardMaterial({ color: 0x2f6fd0, metalness: 0.6, roughness: 0.35 })],
    [rubber, new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.85 })],
    // Playera amarilla de LamBot
    [shirt, new THREE.MeshStandardMaterial({ color: 0xd9ad1f, roughness: 0.85 })],
    [pants, new THREE.MeshStandardMaterial({ color: 0x23344f, roughness: 0.9 })],
    [skin, new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.75 })],
  ] as Array<[THREE.BufferGeometry[], THREE.Material]>) {
    // CapsuleGeometry y CylinderGeometry no son indexadas igual que Box/Torus: se igualan
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x))), mat);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

/** Junto al lado +Z de la cancha, pasando el margen de §3.1, mirando hacia el campo. SUPUESTO: lugar decorativo. */
export function placeWheelchairFan(): THREE.Group {
  const g = buildWheelchairFan();
  g.position.set(-1.6, 0, F.HALF_W + F.OUT_OF_BOUNDS_MARGIN + 0.75);
  g.rotation.y = Math.PI - 0.25;
  return g;
}
