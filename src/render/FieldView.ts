/**
 * Vista 3D de la cancha: alfombra, cintas (Zonas de Inicio, línea central, límite), estructuras
 * de `fieldSolids()` y mesas de las Driver Stations (decorativas).
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import * as F from '../config/field';
import { fieldSolids, startTape, type FieldMaterial } from '../config/fieldLayout';
import { ALLIANCES, type Alliance } from '../core/types';

export const ALLIANCE_COLOR: Record<Alliance, number> = { red: 0xc0262d, blue: 0x1d4fd6 };

const MATERIALS: Record<Exclude<FieldMaterial, 'invisible'>, THREE.MeshStandardMaterial> = {
  mdf: new THREE.MeshStandardMaterial({ color: 0xc8b49a, roughness: 0.85 }),
  mdfDark: new THREE.MeshStandardMaterial({ color: 0xa8957c, roughness: 0.85 }),
  gray: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6 }),
};

/** Segmento de cinta en el piso. */
function tape(x0: number, z0: number, x1: number, z1: number, color: number, w = F.TAPE_WIDTH): THREE.Mesh {
  const len = Math.hypot(x1 - x0, z1 - z0) + w;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(z1 - z0, x1 - x0);
  m.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
  m.receiveShadow = true;
  return m;
}

export function buildFieldView(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'field';

  // Piso alrededor y alfombra de 9 × 7 m (§3.1)
  const around = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 1 }));
  around.rotation.x = -Math.PI / 2;
  around.position.y = -0.002;
  around.receiveShadow = true;
  g.add(around);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(F.FIELD_LENGTH, F.FIELD_WIDTH), new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.95 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.receiveShadow = true;
  g.add(carpet);

  // Límite de la cancha (cinta blanca)
  const L = F.HALF_L;
  const W = F.HALF_W;
  for (const [x0, z0, x1, z1] of [
    [-L, -W, L, -W],
    [-L, W, L, W],
    [-L, -W, -L, W],
    [L, -W, L, W],
  ]) g.add(tape(x0, z0, x1, z1, 0xe8e8e8));

  // Línea central (§4.2): roja del lado −Z y azul del lado +Z, interrumpida por la Plataforma (fig. §3.2)
  const pz = F.PLATFORM_WIDTH / 2;
  g.add(tape(0, -W, 0, -pz, ALLIANCE_COLOR.red));
  g.add(tape(0, pz, 0, W, ALLIANCE_COLOR.blue));

  // Zonas de Inicio = línea de autónomo (§3.2.1, D1)
  for (const a of ALLIANCES) for (const [x0, z0, x1, z1] of startTape(a)) g.add(tape(x0, z0, x1, z1, ALLIANCE_COLOR[a]));

  // Marcas del Laboratorio (§3.2.2)
  const markGeo = new THREE.PlaneGeometry(F.SAMPLE_SIZE + 0.04, F.SAMPLE_SIZE + 0.04);
  const markMat = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.9 });
  for (const s of F.labSpots()) {
    const m = new THREE.Mesh(markGeo, markMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, 0.001, s.z);
    g.add(m);
  }

  // Estructuras
  for (const s of fieldSolids()) {
    if (s.material === 'invisible') continue;
    const geo = new ConvexGeometry(s.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const mesh = new THREE.Mesh(geo, MATERIALS[s.material]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${s.part}${s.alliance ? `-${s.alliance}` : ''}`;
    g.add(mesh);
  }
  // Franja del color de la alianza en la pared trasera de cada Campana, para ubicarlas
  for (const a of ALLIANCES) {
    const p = F.forAlliance(a, { x: (F.CAMPANA_X_RED[0] + F.CAMPANA_X_RED[1]) / 2, z: -W - F.CAMPANA_DEPTH });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(F.CAMPANA_LENGTH, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[a] }));
    stripe.position.set(p.x, F.CAMPANA_HEIGHT + 0.01, p.z);
    g.add(stripe);
  }

  // Mesas de las Driver Stations (§3.2.6), decorativas
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.5 });
  for (const a of ALLIANCES) {
    const x = (a === 'red' ? 1 : -1) * (L + F.OUT_OF_BOUNDS_MARGIN + F.DRIVER_STATION_DEPTH / 2 + 0.2);
    const top = new THREE.Mesh(new THREE.BoxGeometry(F.DRIVER_STATION_DEPTH, 0.03, F.DRIVER_STATION_WIDTH), tableMat);
    top.position.set(x, 0.75, 0);
    top.castShadow = true;
    g.add(top);
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), tableMat);
        leg.position.set(x + dx * (F.DRIVER_STATION_DEPTH / 2 - 0.05), 0.375, dz * (F.DRIVER_STATION_WIDTH / 2 - 0.05));
        g.add(leg);
      }
  }
  return g;
}
