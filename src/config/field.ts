/**
 * Medidas de la cancha de LabBot Rescue 2026 en METROS. Fuente: manual del reto (§3, §4.1.1);
 * la medida original va en el comentario. Lo que el texto no da se midió sobre la vista superior
 * de §3.2 (pág. 7, a escala ≈14.5 mm/px) y se marca [fig.]; ver docs/reglas-reto.md.
 *
 * Coordenadas: origen en el centro, +Y arriba, +X hacia la Driver Station ROJA (eje de 9 m),
 * +Z a la derecha viendo con rojo arriba (eje de 7 m). Todo se define para ROJO y azul es la
 * rotación de 180° (x, z) → (−x, −z).
 */
import type { Alliance, Level } from '../core/types';

/** Milímetros a metros. */
export const mm = (v: number): number => v / 1000;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- Cancha (§3.1)
export const FIELD_LENGTH = mm(9000); // 900 cm (eje X)
export const FIELD_WIDTH = mm(7000); // 700 cm (eje Z)
export const HALF_L = FIELD_LENGTH / 2;
export const HALF_W = FIELD_WIDTH / 2;
/** Ancho de la cinta de las marcas. SUPUESTO (no se da): 2 in. */
export const TAPE_WIDTH = mm(50.8);
/**
 * Pared perimetral (pedido de Xhavi, 29-oct: "van a poner paredes para que no nos salgamos").
 * El manual solo habla de "límites definidos" (§3.1) y no da medidas de pared: SUPUESTO tomado del
 * guardrail de los campos FRC (policarbonato con perfil de aluminio arriba y abajo, ≈20 in de alto).
 * Va por fuera de la alfombra de 9 × 7 m (la cancha queda completa) y se interrumpe donde está la
 * pared de cada Campana (§3.2.4), que ya cierra ese tramo. Tiene colisión para robots y piezas.
 */
export const WALL_HEIGHT = mm(508); // 20 in (guardrail FRC, SUPUESTO)
/** Grosor de la pared (policarbonato + perfil). SUPUESTO: 2 in. */
export const WALL_THICKNESS = mm(50.8);
/**
 * Detrás de la pared perimetral queda una barrera invisible a este margen (para que una pieza que
 * salte la pared no se pierda). Salir del límite es Tech Foul (§4.6): ver `fullyOutOfField`.
 */
export const OUT_OF_BOUNDS_MARGIN = 0.6;

/**
 * ¿Un robot está COMPLETAMENTE fuera de la cancha? (Xhavi, 29-oct; §4.6 y §6.1 solo dicen "sale de
 * los límites", sin aclarar si basta una parte: SUPUESTO, D33). Recibe el contorno del robot en el
 * piso (chasis y mecanismos, en orden alrededor del robot) y revisa con ejes separadores que ese
 * polígono convexo no toque el rectángulo de 9 × 7 m: con cualquier parte encima de la cancha, no
 * está fuera.
 */
export function fullyOutOfField(poly: ReadonlyArray<{ x: number; z: number }>, halfL = HALF_L, halfW = HALF_W): boolean {
  if (poly.length === 0) return false;
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  // Ejes de la cancha
  if (Math.min(...xs) > halfL || Math.max(...xs) < -halfL || Math.min(...zs) > halfW || Math.max(...zs) < -halfW) return true;
  // Ejes de las aristas del robot
  const corners = [
    [halfL, halfW],
    [halfL, -halfW],
    [-halfL, halfW],
    [-halfL, -halfW],
  ];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const nx = -(b.z - a.z);
    const nz = b.x - a.x;
    if (nx === 0 && nz === 0) continue;
    const proj = poly.map((p) => p.x * nx + p.z * nz);
    const lo = Math.min(...proj);
    const hi = Math.max(...proj);
    const f = corners.map(([x, z]) => x * nx + z * nz);
    if (Math.min(...f) > hi || Math.max(...f) < lo) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Zonas de Inicio (§3.2.1)
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/**
 * Cinta roja en escalón [fig.]: tramo en X 3.92 (Z −0.99→0), tramo en Z 0 (X 3.92→2.91) y tramo
 * en X 2.91 (Z 0→0.99). Cada "L" encierra una zona de ≈1.0 × 1.0 m (SUPUESTO).
 * La línea de autónomo es esta misma cinta: se cruza al salir por completo de la zona (D1, resuelto).
 */
export const START_TAPE_RED: ReadonlyArray<[number, number, number, number]> = [
  // [x0, z0, x1, z1]
  [3.92, -0.99, 3.92, 0],
  [3.92, 0, 2.91, 0],
  [2.91, 0, 2.91, 0.99],
];
export const START_ZONES_RED: readonly Rect[] = [
  { x0: 2.91, x1: 3.92, z0: -0.99, z1: 0 },
  { x0: 2.91, x1: 3.92, z0: 0, z1: 0.99 },
];

// ---------------------------------------------------------------- Línea central (§4.2)
export const CENTER_LINE_X = 0;

// ---------------------------------------------------------------- Laboratorio (§3.2.2)
/** 16 Muestras en rejilla 4×4 [fig.]: X ∈ {±0.46, ±1.46}, Z ∈ {±1.40, ±2.40}. */
export const LAB_X = [0.46, 1.46] as const;
export const LAB_Z = [1.4, 2.4] as const;
export function labSpots(): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const sx of [1, -1]) for (const x of LAB_X) for (const sz of [-1, 1]) for (const z of LAB_Z) out.push({ x: sx * x, z: sz * z });
  return out;
}

// ---------------------------------------------------------------- Cámara de Seguridad (§3.2.3)
export const CAMARA_LENGTH = mm(2150); // largo total
export const CAMARA_WIDTH = mm(600); // ancho
export const CAMARA_HEIGHT = mm(800); // altura máxima
/** Largo interior y altura de la apertura de cada nivel (§3.2.3). */
export const CAMARA_LEVELS: Record<Level, { length: number; rim: number }> = {
  1: { length: mm(789), rim: mm(200) },
  2: { length: mm(689), rim: mm(500) },
  3: { length: mm(639), rim: mm(800) },
};
/** 2150 − (789 + 689 + 639) = 33 mm en 4 paredes (extremos y 2 divisiones). SUPUESTO. */
export const CAMARA_WALL = (CAMARA_LENGTH - mm(789 + 689 + 639)) / 4;
/** Distancia del extremo del Nivel 1 a la línea de la Driver Station [fig.: 0.80 m]. */
export const CAMARA_GAP_TO_WALL = 0.8;
/** Extremo del Nivel 1 (X) para rojo; la Cámara va de aquí hacia el centro. */
export const CAMARA_X_END_RED = HALF_L - CAMARA_GAP_TO_WALL; // 3.70
/** Pegada al lado +Z [fig.]: Z ∈ [2.90, 3.50]. */
export const CAMARA_Z_RED: readonly [number, number] = [HALF_W - CAMARA_WIDTH, HALF_W];

/** Interior (pozo) de cada nivel para ROJO: rectángulo y altura de la apertura. */
export function camaraWells(): Record<Level, Rect & { rim: number }> {
  const out = {} as Record<Level, Rect & { rim: number }>;
  let x = CAMARA_X_END_RED - CAMARA_WALL;
  for (const l of [1, 2, 3] as Level[]) {
    const { length, rim } = CAMARA_LEVELS[l];
    out[l] = { x0: x - length, x1: x, z0: CAMARA_Z_RED[0] + CAMARA_WALL, z1: CAMARA_Z_RED[1] - CAMARA_WALL, rim };
    x -= length + CAMARA_WALL;
  }
  return out;
}

// ---------------------------------------------------------------- Campana (§3.2.4)
export const CAMPANA_LENGTH = mm(2000); // pared principal 2000 mm
export const CAMPANA_HEIGHT = mm(610); // 610 mm de alto
export const CAMPANA_SLOT_WIDTH = mm(1850.8); // ranura inferior 1850.80 mm
export const CAMPANA_SLOT_HEIGHT = mm(160); // 160 mm de alto
export const CAMPANA_SLOT_Y = mm(200); // a 200 mm del suelo
/** Fondo de la estructura, por fuera de la cancha [fig.: ≈0.40 m]. */
export const CAMPANA_DEPTH = 0.4;
/** Lado −Z, desde la línea de la Driver Station roja hacia el centro [fig.]: X ∈ [2.5, 4.5]. */
export const CAMPANA_X_RED: readonly [number, number] = [HALF_L - CAMPANA_LENGTH, HALF_L];
/** Barra lateral de obstáculo: 1250 × 50.80 mm (§3.2.4), perpendicular a la pared en el extremo de la Campana [fig.]. */
export const BARRIER_LENGTH = mm(1250);
export const BARRIER_WIDTH = mm(50.8);
/** Altura de la barra: no se da. SUPUESTO 200 mm (debe impedir el paso, "obliga a dar la vuelta"). */
export const BARRIER_HEIGHT = mm(200);
/**
 * Muestra Crítica en la rendija deslizable de la parte superior (§3.2.4). Posición [fig.]:
 * X ≈ 3.92, sobresale ≈0.16 m hacia la cancha. SUPUESTO: apoyada a la altura de la pared (610 mm).
 */
export const CRITICAL_HOLDER_RED = { x: 3.92, z: -HALF_W + 0.1, y: CAMPANA_HEIGHT };

// ---------------------------------------------------------------- Plataforma de Contención (§3.2.5)
export const RAMP_ANGLE = 15 * DEG; // 15°
export const RAMP_SLOPE_LENGTH = mm(1035.28); // superficie inclinada
export const RAMP_RUN = RAMP_SLOPE_LENGTH * Math.cos(RAMP_ANGLE); // 1000 mm horizontales
export const PLATFORM_HEIGHT = RAMP_SLOPE_LENGTH * Math.sin(RAMP_ANGLE); // ≈268 mm
export const PLATFORM_TOP_LENGTH = mm(800); // plataforma horizontal superior
export const RAMP_TOTAL_RUN = mm(1800); // longitud total horizontal de cada rampa
export const REPISA_STEP = mm(300); // escalón sobre la plataforma superior
export const REPISA_TOP = PLATFORM_HEIGHT + REPISA_STEP; // ≈568 mm del suelo
/** Fondo de la Repisa a lo largo de X [fig.: 4.0 m totales − 2 × 1.8 m]. Ver D6. */
export const REPISA_DEPTH = 0.4;
/** Ancho de la Plataforma (eje Z) [fig.: ≈1.49 m]; no está en el texto. */
export const PLATFORM_WIDTH = 1.49;
export const PLATFORM_LENGTH = 2 * RAMP_TOTAL_RUN + REPISA_DEPTH; // 4.0 m

// ---------------------------------------------------------------- Driver Station (§3.2.6)
/** Mesa en el lado corto, fuera de la cancha [fig.: ≈1.6 m de ancho]. Decorativa. */
export const DRIVER_STATION_WIDTH = 1.6;
export const DRIVER_STATION_DEPTH = 0.8;

// ---------------------------------------------------------------- Piezas (§4.1.1)
export const SAMPLE_SIZE = mm(150); // cubo 150 mm ±5
export const CRITICAL_SIZE = mm(200); // cubo 200 mm ±5
/** Masa: no se da. SUPUESTO espuma ≈30 kg/m³. */
export const SAMPLE_MASS = 0.1;
export const CRITICAL_MASS = 0.24;
export const LAB_SAMPLES = 16; // en el Laboratorio al inicio
export const HP_SAMPLES_PER_ALLIANCE = 10; // disponibles para el HP por alianza
export const PRELOAD_PER_ROBOT = 1; // §4.1 (opcional)
export const ROBOTS_PER_ALLIANCE = 2; // §8.2

// ---------------------------------------------------------------- Simetría
/** Lleva un punto definido para ROJO a la alianza pedida (rotación de 180° para azul). */
export function forAlliance(a: Alliance, p: { x: number; z: number }): { x: number; z: number } {
  return a === 'red' ? { x: p.x, z: p.z } : { x: -p.x, z: -p.z };
}
export function rectFor(a: Alliance, r: Rect): Rect {
  return a === 'red' ? { ...r } : { x0: -r.x1, x1: -r.x0, z0: -r.z1, z1: -r.z0 };
}
export const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
/** ¿El punto está dentro de alguna Cámara de Seguridad (las dos alianzas)? */
export const inCamara = (x: number, z: number): boolean =>
  (['red', 'blue'] as const).some((a) => inRect(rectFor(a, { x0: CAMARA_X_END_RED - CAMARA_LENGTH, x1: CAMARA_X_END_RED, z0: CAMARA_Z_RED[0], z1: CAMARA_Z_RED[1] }), x, z));
