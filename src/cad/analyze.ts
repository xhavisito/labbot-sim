/**
 * Convierte las cajas de un STEP (step.ts) en la configuración numérica del robot (`RobotFile`).
 * Todo lo que el CAD no dice con certeza (masa, velocidades, posición del pivote) se marca como
 * SUPUESTO en `supuestos` y se puede corregir con `overrides` sin tocar el código.
 */
import type { Box, StepModel, StepPart, Vec3 } from './step.ts';

/** Mismos nombres que `MechanismKind` (src/config/robot.ts); aquí no se importa para correr en Node. */
export type MechanismName = 'pivot' | 'pivot180' | 'longarm' | 'elevator' | 'dual';
export type Axis = 'x' | 'y' | 'z';
export interface AnalyzeOptions {
  name?: string;
  /** Eje vertical del CAD. SolidWorks exporta normalmente Y arriba. 'auto' = el más delgado del chasis. */
  up?: Axis | 'auto';
  /** Eje hacia el frente del robot, con signo ('+x', '-z'…) o 'auto' (hacia donde sale la garra). */
  forward?: `${'+' | '-'}${Axis}` | 'auto';
  mechanism?: MechanismName;
  massKg?: number;
  /** Se mezclan al final sobre la especificación (rutas con punto: "arm.pivotY"). */
  overrides?: Record<string, number>;
}

/** Subconjunto numérico de `RobotSpec` que produce el CAD (sin tipos del simulador, para correr en Node). */
export interface RobotFileSpec {
  length: number;
  width: number;
  baseHeight: number;
  massKg?: number;
  capacity?: number;
  elevatorSpeed?: number;
  elevatorHeights?: number[];
  arm?: { pivotX: number; pivotY: number; length: number; speed?: number; stowAngle?: number };
  maxSpeed?: number;
  maxAccel?: number;
  maxOmega?: number;
  traction?: number;
}

export interface RobotFile {
  schema: 'labbot-robot/1';
  name: string;
  mechanism: MechanismName;
  spec: RobotFileSpec;
  source: { file?: string; parts: number; up: Axis; forward: string; unitScale: number; bboxM: [number, number, number] };
  supuestos: string[];
}

const IDX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
const ext = (b: Box, i: number): number => b.max[i] - b.min[i];
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// Se clasifica por el NOMBRE de la pieza (los equipos nombran "Chasis-Lateral", "Garra-Superior"…);
// la ruta no sirve: los tornillos de una caja de engranes también pueden llamarse "…Base".
const RE_CHASSIS = /^(chasis|chassis|frame|marco)/i;
const RE_ARM = /^(pivote|pivot|brazo|arm)/i;
const RE_CLAW = /garr|claw|gripper|intake|pinza/i;
const RE_ELEV = /^(elevador|elevator|lift)/i;
/** Eje sobre el que gira el brazo. */
const RE_SHAFT = /^(flecha|shaft|eje|axle)/i;

function union(parts: StepPart[]): Box | null {
  if (!parts.length) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p.box.min[i]);
      max[i] = Math.max(max[i], p.box.max[i]);
    }
  return { min, max };
}

/** Una pieza pertenece a un grupo si su nombre empieza (o, para la garra, contiene) la palabra clave. */
const inGroup = (p: StepPart, re: RegExp): boolean => re.test(p.name);

export function analyzeStep(model: StepModel, opts: AnalyzeOptions = {}, file?: string): RobotFile {
  const supuestos: string[] = [];
  const parts = model.parts;
  const arm = parts.filter((p) => inGroup(p, RE_ARM));
  const shafts = parts.filter((p) => inGroup(p, RE_SHAFT));
  const claw = parts.filter((p) => inGroup(p, RE_CLAW) && !inGroup(p, RE_ARM));
  const elev = parts.filter((p) => inGroup(p, RE_ELEV));
  const chassisByName = parts.filter((p) => inGroup(p, RE_CHASSIS) && !arm.includes(p) && !claw.includes(p));
  const moving = new Set([...arm, ...claw, ...elev]);
  const chassisParts = chassisByName.length ? chassisByName : parts.filter((p) => !moving.has(p));
  if (!chassisByName.length) supuestos.push('no hay piezas cuyo nombre empiece con "Chasis": el chasis es todo lo que no es garra/brazo/elevador');
  const chassis = union(chassisParts) ?? model.box;

  // Eje vertical
  let up: Axis;
  if (opts.up && opts.up !== 'auto') up = opts.up;
  else if (opts.up === 'auto') {
    const e = [0, 1, 2].map((i) => ext(chassis, i));
    up = (['x', 'y', 'z'] as Axis[])[e.indexOf(Math.min(...e))];
    supuestos.push(`eje vertical detectado como ${up} (el más delgado del chasis)`);
  } else {
    up = 'y';
    supuestos.push('eje vertical y (convención de SolidWorks); usa --up para cambiarlo');
  }
  const u = IDX[up];
  const horiz = [0, 1, 2].filter((i) => i !== u);

  // Frente
  let f: number;
  let fSign: 1 | -1;
  const fwd = opts.forward ?? 'auto';
  if (fwd !== 'auto') {
    f = IDX[fwd[1] as Axis];
    fSign = fwd[0] === '-' ? -1 : 1;
    if (f === u) throw new Error('el frente no puede ser el eje vertical');
  } else {
    f = ext(chassis, horiz[0]) >= ext(chassis, horiz[1]) ? horiz[0] : horiz[1];
    const ref = union(claw.length ? claw : arm);
    const cc = (chassis.min[f] + chassis.max[f]) / 2;
    fSign = ref && (ref.min[f] + ref.max[f]) / 2 < cc ? -1 : 1;
    supuestos.push(`frente detectado como ${fSign < 0 ? '-' : '+'}${'xyz'[f]}; usa --forward para fijarlo`);
  }
  const l = horiz.find((i) => i !== f) as number;

  // Coordenadas del robot: a = adelante desde el centro del chasis, h = altura sobre el piso, s = lateral
  const cF = (chassis.min[f] + chassis.max[f]) / 2;
  const floor = model.box.min[u];
  const fwdOf = (v: number): number => fSign * (v - cF);
  const range = (b: Box, i: number): [number, number] => {
    if (i === f) {
      const a = fwdOf(b.min[i]);
      const c = fwdOf(b.max[i]);
      return [Math.min(a, c), Math.max(a, c)];
    }
    return [b.min[i] - floor, b.max[i] - floor];
  };

  const length = ext(chassis, f);
  const width = ext(chassis, l);
  // Estructura fija: todo menos la garra y el brazo móvil ("Brazo-…"); incluye la torre del pivote
  const fixedBox = union(parts.filter((p) => !claw.includes(p) && !/brazo|^arm/i.test(p.name))) ?? chassis;
  const baseHeight = fixedBox.max[u] - floor;

  const mech: MechanismName = opts.mechanism ?? (elev.length && !arm.length ? 'elevator' : 'pivot');
  if (!opts.mechanism) supuestos.push(`mecanismo "${mech}" deducido de los nombres de las piezas`);

  const spec: RobotFileSpec = { length: r4(length), width: r4(width), baseHeight: r4(baseHeight) };

  const clawBox = union(claw);

  if (mech !== 'elevator') {
    const armBox = union(arm);
    const shaft = union(shafts);
    if (shaft && clawBox) {
      // Pivote = centro de la flecha; el largo llega al centro de la garra (donde queda la pieza)
      const [s0, s1] = range(shaft, f);
      const [t0, t1] = range(shaft, u);
      const [c0, c1] = range(clawBox, f);
      const [d0, d1] = range(clawBox, u);
      const px = (s0 + s1) / 2;
      const py = (t0 + t1) / 2;
      const len = Math.hypot((c0 + c1) / 2 - px, (d0 + d1) / 2 - py);
      // El CAD está en la pose guardada: el ángulo del brazo ahí es el de guardado (§4.1)
      const stow = Math.atan2((d0 + d1) / 2 - py, (c0 + c1) / 2 - px);
      spec.arm = { pivotX: r4(px), pivotY: r4(py), length: r4(len), speed: 4, stowAngle: r4(stow) };
      supuestos.push('pivote = centro de la flecha; largo del brazo = del pivote al centro de la garra; ángulo de guardado = el del CAD; velocidad angular 4 rad/s (SUPUESTO)');
    } else if (armBox) {
      const [a0, a1] = range(armBox, f);
      const [h0, h1] = range(armBox, u);
      const ef = a1 - a0;
      const eh = h1 - h0;
      // Sin flecha: el brazo guardado suele quedar horizontal o inclinado; su largo es la dimensión mayor
      const len = ef >= eh * 3 || eh >= ef * 3 ? Math.max(ef, eh) : Math.hypot(ef, eh);
      spec.arm = { pivotX: r4(a0), pivotY: r4(Math.max(h0, 0.05)), length: r4(len), speed: 4 };
      supuestos.push('sin flecha: pivote = extremo trasero del brazo; velocidad angular 4 rad/s (SUPUESTO)');
    } else {
      supuestos.push('mecanismo pivot pero sin piezas de brazo: se usará el brazo del preset');
    }
  } else if (mech === 'elevator') {
    const eb = union(elev);
    if (eb) {
      const [, top] = range(eb, u);
      supuestos.push(`altura del elevador guardado ${r4(top)} m; las alturas de los niveles son las del preset (SUPUESTO)`);
    }
  }

  // Masa: el STEP casi nunca la trae
  if (opts.massKg !== undefined) spec.massKg = opts.massKg;
  else supuestos.push('masa del preset (el STEP no la trae); pásala con --mass');
  supuestos.push('velocidades y tracción del preset (el manual no las fija, §7.2)');

  for (const [k, v] of Object.entries(opts.overrides ?? {})) setPath(spec as unknown as Record<string, unknown>, k, v);
  if (opts.overrides && Object.keys(opts.overrides).length) supuestos.push(`valores fijados a mano: ${Object.keys(opts.overrides).join(', ')}`);

  return {
    schema: 'labbot-robot/1',
    name: opts.name ?? file?.replace(/^.*[\\/]/, '').replace(/\.(step|stp)$/i, '') ?? 'Robot CAD',
    mechanism: mech,
    spec,
    source: {
      file,
      parts: parts.length,
      up,
      forward: `${fSign < 0 ? '-' : '+'}${'xyz'[f]}`,
      unitScale: model.unitScale,
      bboxM: [r4(ext(model.box, 0)), r4(ext(model.box, 1)), r4(ext(model.box, 2))],
    },
    supuestos,
  };
}

function setPath(o: Record<string, unknown>, path: string, v: number): void {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[ks[ks.length - 1]] = v;
}
