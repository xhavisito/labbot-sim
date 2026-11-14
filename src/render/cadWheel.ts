/**
 * Rueda de tracción del CAD de Psycho (fotos de Xhavi, 14-nov): llanta blanca de hule con dibujo de bloques
 * escalonados, disco negro con 6 ventanas, buje de aluminio con eje hexagonal y tornillos, y una polea
 * dentada negra del lado de adentro. Eje a lo largo de z, centrada en el origen, cara de afuera hacia +z
 * (para el otro costado se gira 180° en y). Medidas de las fotos (~15 cm de diámetro): SUPUESTO hasta
 * que Xhavi las confirme. Solo dibujo: la física usa el radio y el ancho de `RobotSpec.wheel`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WheelSpec } from '../config/robot';

const rubber = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.92 });
const plastic = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55 });
const alu = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.85 });

/** Cilindro con el eje a lo largo de z, centrado en `z`. */
const cyl = (r: number, len: number, z: number, seg = 32): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
  return g.translate(0, 0, z);
};

export function buildCadWheel(w: WheelSpec): THREE.Group {
  const R = w.r;
  const W = w.width;
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // Llanta: anillo liso y encima dos hileras de bloques escalonados
  const tread = 0.014;
  const ringR = R - tread;
  const ring = new THREE.Shape().absarc(0, 0, ringR, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path().absarc(0, 0, ringR - 0.012, 0, Math.PI * 2, true));
  add(new THREE.ExtrudeGeometry(ring, { depth: W, bevelEnabled: false, curveSegments: 48 }).translate(0, 0, -W / 2), rubber);
  const n = 30;
  const blocks: THREE.BufferGeometry[] = [];
  const bz = (W - 0.004) / 2;
  for (const [row, off] of [[-1, 0], [1, 0.5]] as const)
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      const b = new THREE.BoxGeometry(tread * 1.05, (2 * Math.PI * (R - tread / 2) * 0.8) / n, bz * 0.98);
      b.translate(R - tread / 2, 0, row * (bz / 2 + 0.001));
      b.rotateZ(a);
      blocks.push(b);
    }
  add(mergeGeometries(blocks)!, rubber);
  // Disco negro con 6 ventanas de esquinas redondeadas y el hueco del buje
  const disc = new THREE.Shape().absarc(0, 0, ringR - 0.001, 0, Math.PI * 2, false);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const r0 = 0.032;
    const r1 = ringR - 0.013;
    const half0 = 0.2;
    const half1 = 0.34;
    const p = (r: number, da: number) => new THREE.Vector2(Math.cos(a + da) * r, Math.sin(a + da) * r);
    const hole = new THREE.Path();
    const pts = [p(r0, -half0), p(r1, -half1), p(r1, half1), p(r0, half0)];
    hole.moveTo(pts[0].x, pts[0].y);
    for (const q of pts.slice(1)) hole.lineTo(q.x, q.y);
    hole.closePath();
    disc.holes.push(hole);
  }
  disc.holes.push(new THREE.Path().absarc(0, 0, 0.0095, 0, Math.PI * 2, true));
  add(new THREE.ExtrudeGeometry(disc, { depth: 0.012, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, 0.004), plastic);
  // Buje de aluminio por afuera, con el eje hexagonal y tres tornillos
  add(cyl(0.0255, 0.012, W / 2 + 0.002), alu);
  add(cyl(0.0105, 0.016, W / 2 + 0.004, 6), plastic);
  const screws: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    screws.push(cyl(0.0032, 0.008, W / 2 + 0.01, 12).translate(Math.cos(a) * 0.0185, Math.sin(a) * 0.0185, 0));
  }
  add(mergeGeometries(screws)!, alu);
  // Polea dentada negra del lado de adentro, con su brida y tornillos
  const inner = -W / 2;
  add(cyl(0.0265, 0.03, inner - 0.012, 40), plastic);
  add(cyl(0.034, 0.003, inner - 0.027, 40), plastic);
  const bolts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    bolts.push(cyl(0.0035, 0.024, inner - 0.016, 10).translate(Math.cos(a) * 0.0235, Math.sin(a) * 0.0235, 0));
  }
  add(mergeGeometries(bolts)!, alu);
  return g;
}
