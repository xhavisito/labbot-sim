/**
 * Vista 3D de la cancha: alfombra, cintas (Zonas de Inicio, línea central, límite), estructuras
 * de `fieldSolids()` y mesas de las Driver Stations (decorativas).
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import * as F from '../config/field';
import { fieldSolids, startTape, type FieldMaterial } from '../config/fieldLayout';
import { ALLIANCES, type Alliance } from '../core/types';
import { boxUV, carpetTexture, mdfTexture, textTexture } from './textures';

export const ALLIANCE_COLOR: Record<Alliance, number> = { red: 0xc0262d, blue: 0x1d4fd6 };

type Mats = Record<Exclude<FieldMaterial, 'invisible'>, THREE.MeshStandardMaterial> & { carpet: THREE.MeshStandardMaterial };
let mats: Mats | null = null;

/** Materiales de la cancha (se crean una vez; las texturas de canvas solo existen con DOM). */
function materials(): Mats {
  if (mats) return mats;
  const mdf = mdfTexture(3);
  const mdf2 = mdfTexture(9);
  const carpet = carpetTexture();
  const tint = (t: unknown, c: number) => (t ? 0xffffff : c);
  mats = {
    mdf: new THREE.MeshStandardMaterial({ color: tint(mdf, 0xc8b49a), map: mdf?.map ?? null, bumpMap: mdf?.bump ?? null, bumpScale: 0.5, roughness: 0.78 }),
    mdfDark: new THREE.MeshStandardMaterial({ color: mdf2 ? 0xd9cbb6 : 0xa8957c, map: mdf2?.map ?? null, bumpMap: mdf2?.bump ?? null, bumpScale: 0.5, roughness: 0.8 }),
    // Aluminio anodizado de los marcos y la Plataforma
    gray: new THREE.MeshStandardMaterial({ color: 0xa4abb4, roughness: 0.38, metalness: 0.7 }),
    carpet: new THREE.MeshStandardMaterial({ color: tint(carpet, 0x2b2d31), map: carpet?.map ?? null, bumpMap: carpet?.bump ?? null, bumpScale: 0.8, roughness: 0.97 }),
  };
  return mats;
}

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

  const MATERIALS = materials();
  // Alfombra de 9 × 7 m (§3.1) sobre una base gris un poco más grande (la duela es del gimnasio, Arena)
  const around = new THREE.Mesh(new THREE.PlaneGeometry(F.FIELD_LENGTH + 2 * F.OUT_OF_BOUNDS_MARGIN, F.FIELD_WIDTH + 1.2), new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.95 }));
  around.rotation.x = -Math.PI / 2;
  around.position.y = -0.002;
  around.receiveShadow = true;
  g.add(around);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(F.FIELD_LENGTH, F.FIELD_WIDTH), MATERIALS.carpet);
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
    boxUV(geo);
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
    // Franja LED sobre la Campana (brilla con el bloom)
    const led = new THREE.Mesh(new THREE.BoxGeometry(F.CAMPANA_LENGTH, 0.012, 0.02), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: ALLIANCE_COLOR[a], emissiveIntensity: 2.4 }));
    led.position.set(p.x, F.CAMPANA_HEIGHT + 0.03, p.z);
    g.add(led);
  }

  // Mesas de las Driver Stations (§3.2.6), decorativas
  const tableMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.4, metalness: 0.5 });
  const laptopMat = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.5, metalness: 0.4 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3a6fd8, emissiveIntensity: 0.9 });
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
    // Faldón con el color de la alianza, laptop y control en cada mesa
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.55, F.DRIVER_STATION_WIDTH), new THREE.MeshStandardMaterial({ color: ALLIANCE_COLOR[a], roughness: 0.8 }));
    skirt.position.set(x - Math.sign(x) * (F.DRIVER_STATION_DEPTH / 2), 0.45, 0);
    g.add(skirt);
    const label = textTexture(a === 'red' ? 'RED' : 'BLUE', { w: 256, h: 64, bg: '#00000000', fg: '#ffffff' });
    if (label) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshBasicMaterial({ map: label, transparent: true }));
      sign.position.set(x - Math.sign(x) * (F.DRIVER_STATION_DEPTH / 2 + 0.006), 0.55, 0);
      sign.rotation.y = -Math.sign(x) * Math.PI / 2;
      g.add(sign);
    }
    for (const dz of [-0.3, 0.3]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.3), laptopMat);
      base.position.set(x, 0.775, dz);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.2, 0.3), screenMat);
      screen.position.set(x - Math.sign(x) * 0.11, 0.88, dz);
      screen.rotation.z = -Math.sign(x) * 0.25;
      g.add(base, screen);
    }
  }
  return g;
}
