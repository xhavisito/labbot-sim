/**
 * Geometría estática de la cancha como lista de sólidos convexos (puntos), generada desde
 * `field.ts`. La usan tanto la física (colisionadores convexos) como el render (mallas), así
 * que lo que se ve es exactamente lo que choca. Sin Three.js ni Rapier: se puede probar.
 */
import type { Alliance } from '../core/types';
import * as F from './field';

export type Vec3 = [number, number, number];

export type FieldPart = 'camara' | 'campana' | 'barrier' | 'criticalHolder' | 'ramp' | 'platform' | 'repisa' | 'wall' | 'boundary';
export type FieldMaterial = 'mdf' | 'mdfDark' | 'gray' | 'wall' | 'invisible';

export interface Solid {
  part: FieldPart;
  alliance?: Alliance;
  material: FieldMaterial;
  points: Vec3[];
}

/** Caja alineada a los ejes: [x0,x1] × [y0,y1] × [z0,z1]. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}

/** Rotación de 180° alrededor de Y (rojo → azul). */
const mirror = (pts: Vec3[]): Vec3[] => pts.map(([x, y, z]) => [-x, y, -z]);

/** Grosor de MDF de las estructuras. SUPUESTO (no se da para la cancha): 18 mm. */
export const STRUCT_THICKNESS = F.mm(18);

function camara(): Solid[] {
  const s: Solid[] = [];
  const w = F.camaraWells();
  const [z0, z1] = F.CAMARA_Z_RED;
  const t = F.CAMARA_WALL;
  const add = (pts: Vec3[]) => s.push({ part: 'camara', material: 'mdf', points: pts });
  // Paredes largas (lado de la cancha y lado del borde) de cada nivel, a la altura de su apertura
  for (const l of [1, 2, 3] as const) {
    const { x0, x1, rim } = w[l];
    add(box(x0 - t, x1 + t, 0, rim, z0, z0 + t));
    add(box(x0 - t, x1 + t, 0, rim, z1 - t, z1));
  }
  // Extremos y divisiones: cada una a la altura del nivel más alto que toca
  add(box(w[1].x1, w[1].x1 + t, 0, w[1].rim, z0, z1)); // extremo del Nivel 1
  add(box(w[2].x1, w[2].x1 + t, 0, w[2].rim, z0, z1)); // N1 | N2
  add(box(w[3].x1, w[3].x1 + t, 0, w[3].rim, z0, z1)); // N2 | N3
  add(box(w[3].x0 - t, w[3].x0, 0, w[3].rim, z0, z1)); // extremo del Nivel 3
  return s;
}

function campana(): Solid[] {
  const s: Solid[] = [];
  const [xa, xb] = F.CAMPANA_X_RED;
  const zf = -F.HALF_W; // cara hacia la cancha
  const t = STRUCT_THICKNESS;
  const h = F.CAMPANA_HEIGHT;
  const ys0 = F.CAMPANA_SLOT_Y;
  const ys1 = F.CAMPANA_SLOT_Y + F.CAMPANA_SLOT_HEIGHT;
  const post = (F.CAMPANA_LENGTH - F.CAMPANA_SLOT_WIDTH) / 2;
  const add = (pts: Vec3[], material: FieldMaterial = 'mdf') => s.push({ part: 'campana', material, points: pts });
  // Pared principal con la ranura inferior (§3.2.4)
  add(box(xa, xb, 0, ys0, zf - t, zf));
  add(box(xa, xb, ys1, h, zf - t, zf));
  add(box(xa, xa + post, ys0, ys1, zf - t, zf));
  add(box(xb - post, xb, ys0, ys1, zf - t, zf));
  // Repisa interior por donde el HP desliza las Muestras (a la altura de la ranura) y caja trasera
  add(box(xa, xb, ys0 - t, ys0, zf - F.CAMPANA_DEPTH, zf - t), 'mdfDark');
  add(box(xa, xb, 0, h, zf - F.CAMPANA_DEPTH - t, zf - F.CAMPANA_DEPTH));
  add(box(xa, xa + t, 0, h, zf - F.CAMPANA_DEPTH - t, zf - t));
  add(box(xb - t, xb, 0, h, zf - F.CAMPANA_DEPTH - t, zf - t));
  // Barra lateral de obstáculo, perpendicular a la pared en el extremo de la Campana
  s.push({ part: 'barrier', material: 'mdf', points: box(xa - F.BARRIER_WIDTH, xa, 0, F.BARRIER_HEIGHT, -F.HALF_W, -F.HALF_W + F.BARRIER_LENGTH) });
  // Soporte de la rendija deslizable de la Muestra Crítica (arriba de la pared)
  const c = F.CRITICAL_HOLDER_RED;
  const half = F.CRITICAL_SIZE / 2 + 0.03;
  s.push({ part: 'criticalHolder', material: 'gray', points: box(c.x - half, c.x + half, c.y - t, c.y, zf - t, c.z + half) });
  return s;
}

function platformRed(): Solid[] {
  const hz = F.PLATFORM_WIDTH / 2;
  const xr0 = F.PLATFORM_LENGTH / 2; // pie de la rampa (2.0)
  const xr1 = xr0 - F.RAMP_RUN; // inicio de la plataforma superior (1.0)
  const xr2 = xr1 - F.PLATFORM_TOP_LENGTH; // borde de la Repisa (0.2)
  const h = F.PLATFORM_HEIGHT;
  const ramp: Vec3[] = [
    [xr0, 0, -hz],
    [xr0, 0, hz],
    [xr1, 0, -hz],
    [xr1, 0, hz],
    [xr1, h, -hz],
    [xr1, h, hz],
  ];
  return [
    { part: 'ramp', alliance: 'red', material: 'mdf', points: ramp },
    { part: 'platform', alliance: 'red', material: 'mdf', points: box(xr2, xr1, 0, h, -hz, hz) },
  ];
}

/**
 * Pared perimetral baja (SUPUESTO: guardrail FRC de 20 in, `WALL_HEIGHT`) por fuera de la alfombra:
 * la pared de la Driver Station roja (+X) y el lado −Z hasta la Campana roja (que cierra el resto);
 * la otra mitad es la rotación de 180°.
 */
function wallsRed(): Solid[] {
  const t = F.WALL_THICKNESS;
  const h = F.WALL_HEIGHT;
  const L = F.HALF_L;
  const W = F.HALF_W;
  return [box(L, L + t, 0, h, -W - t, W + t), box(-L - t, F.CAMPANA_X_RED[0], 0, h, -W - t, -W)].map((points) => ({ part: 'wall' as const, material: 'wall' as const, points }));
}

function boundary(): Solid[] {
  const m = F.OUT_OF_BOUNDS_MARGIN;
  const L = F.HALF_L + m;
  const W = F.HALF_W + m;
  const H = 1.5;
  const t = 0.2;
  return [
    box(L, L + t, 0, H, -W - t, W + t),
    box(-L - t, -L, 0, H, -W - t, W + t),
    box(-L, L, 0, H, W, W + t),
    box(-L, L, 0, H, -W - t, -W),
  ].map((points) => ({ part: 'boundary' as const, material: 'invisible' as const, points }));
}

/** Todos los sólidos estáticos de la cancha (ambas alianzas). */
export function fieldSolids(): Solid[] {
  const red: Solid[] = [...camara(), ...campana(), ...platformRed()].map((s) => ({ ...s, alliance: 'red' }));
  const blue: Solid[] = red.map((s) => ({ ...s, alliance: 'blue', points: mirror(s.points) }));
  const hz = F.PLATFORM_WIDTH / 2;
  const repisa: Solid = {
    part: 'repisa',
    material: 'mdfDark',
    points: box(-F.REPISA_DEPTH / 2, F.REPISA_DEPTH / 2, 0, F.REPISA_TOP, -hz, hz),
  };
  const walls = wallsRed();
  return [...red, ...blue, repisa, ...walls, ...walls.map((s) => ({ ...s, points: mirror(s.points) })), ...boundary()];
}

/** Cinta de las Zonas de Inicio (segmentos en el piso) por alianza. */
export function startTape(a: Alliance): Array<[number, number, number, number]> {
  return F.START_TAPE_RED.map(([x0, z0, x1, z1]) => (a === 'red' ? [x0, z0, x1, z1] : [-x0, -z0, -x1, -z1]));
}
