/**
 * Fallas de los robots (pedido de Xhavi, 29-oct: "que por estamparme en una pared se dañe algo y pues
 * para empezar a practicar con más cuidado"). Lógica pura: cuándo un golpe es fuerte, qué tan probable
 * es que dañe algo, qué se daña y cuánto dura. Lo aplica a la física `game/Damage.ts`.
 *
 * El manual no habla de fallas (solo pide robots seguros y que no suelten partes, §4.5, §6.1): TODOS
 * los números son SUPUESTOS de diseño, ajustables con el nivel de daño en Ajustes.
 */

/** Qué se puede descomponer. */
export type FaultKind =
  /** La garra se atasca: no cierra (no agarra) hasta que se destraba. */
  | 'clawJam'
  /** El brazo queda lento (un engrane dañado / la cadena floja) el resto del match. */
  | 'armSlow'
  /** Un lado de la transmisión pierde potencia: más lento y jala hacia un lado. */
  | 'motorWeak'
  /** Pérdida de comunicación (un cable flojo o un brownout): el robot se desactiva unos segundos. */
  | 'commLoss';

export const FAULT_KINDS: readonly FaultKind[] = ['clawJam', 'armSlow', 'motorWeak', 'commLoss'];

/** Nivel de daño de Ajustes. 'off' = sin fallas. */
export type DamageLevel = 'off' | 'low' | 'normal' | 'high';
export const DAMAGE_LEVELS: readonly DamageLevel[] = ['off', 'low', 'normal', 'high'];

/** A qué robots les pasan las fallas. */
export type DamageTargets = 'all' | 'player';

export interface DamageSettings {
  level: DamageLevel;
  targets: DamageTargets;
  /** Fallas al azar sin golpe (un brownout, la garra que se atora sola), poco frecuentes. */
  random: boolean;
}

export const DEFAULT_DAMAGE: DamageSettings = { level: 'normal', targets: 'all', random: true };

/** SUPUESTOS (m/s, s, probabilidades). */
export const DAMAGE = {
  /**
   * Golpe = cambio de velocidad horizontal que NO vino de los motores, sumado en `window` s. Por
   * debajo de `threshold` no pasa nada (empujones, rozar la pared, chocar con una pieza).
   */
  window: 0.05,
  threshold: 1.4,
  /** Con este golpe (≈ chocar de frente a toda velocidad) la probabilidad llega a `maxChance`. */
  severe: 3.0,
  maxChance: 0.75,
  /** Un golpe solo se cuenta una vez: se rearma con el medidor bajo el umbral este tiempo. */
  rearm: 0.3,
  /** Con la pieza en la garra, un golpe fuerte puede tirarla (proporcional a la probabilidad de falla). */
  dropFactor: 1.2,
  /** Multiplicador de la probabilidad por nivel. */
  levelScale: { off: 0, low: 0.45, normal: 1, high: 1.7 } as Record<DamageLevel, number>,
  /** Fallas al azar: probabilidad por robot y por match (150 s) en nivel normal. */
  randomPerMatch: 0.2,
  /** Efectos. */
  armSlowScale: 0.5,
  motorWeakScale: 0.7,
  /** Giro (rad/s a toda velocidad) hacia el lado débil. */
  motorWeakPull: 0.9,
  /** Duración (s) [mín, máx] de las fallas que se quitan solas; armSlow y motorWeak duran el match. */
  duration: { clawJam: [5, 10], commLoss: [1.5, 3.5] } as Record<'clawJam' | 'commLoss', [number, number]>,
} as const;

/** Duración de las fallas permanentes (hasta reacomodar la cancha o acabar el match). */
export const PERMANENT = Infinity;

/** Probabilidad de que un golpe de `impact` m/s dañe algo, con el nivel de daño dado. */
export function faultChance(impact: number, level: DamageLevel): number {
  if (impact < DAMAGE.threshold) return 0;
  const k = Math.min(1, (impact - DAMAGE.threshold) / (DAMAGE.severe - DAMAGE.threshold));
  // Un golpe apenas arriba del umbral todavía puede dañar algo (10 % del máximo)
  const p = DAMAGE.maxChance * (0.1 + 0.9 * k);
  return Math.min(0.95, p * DAMAGE.levelScale[level]);
}

/** De dónde vino el golpe, visto desde el robot. */
export type ImpactSide = 'front' | 'back' | 'side';

/** Lado del golpe a partir del cambio de velocidad en el sistema del robot (x adelante, z a un lado). */
export function impactSide(dvx: number, dvz: number): ImpactSide {
  // Chocar de frente frena el avance: el cambio de velocidad apunta hacia atrás
  if (Math.abs(dvx) >= Math.abs(dvz)) return dvx < 0 ? 'front' : 'back';
  return 'side';
}

/**
 * Qué se daña con un golpe. La garra (al frente) sufre los golpes de frente; la transmisión, los de
 * lado y atrás; la comunicación (cables, batería) cualquiera. Ya dañado algo permanente, no se repite.
 */
export function pickFault(rand: () => number, side: ImpactSide, active: ReadonlySet<FaultKind>): FaultKind | null {
  const w: Record<FaultKind, number> =
    side === 'front' ? { clawJam: 4, armSlow: 2.5, motorWeak: 1, commLoss: 2 } : side === 'back' ? { clawJam: 0.5, armSlow: 1.5, motorWeak: 3, commLoss: 2 } : { clawJam: 1, armSlow: 1.5, motorWeak: 3, commLoss: 2 };
  const options = FAULT_KINDS.filter((k) => !active.has(k));
  const total = options.reduce((s, k) => s + w[k], 0);
  if (total <= 0) return null;
  let x = rand() * total;
  for (const k of options) {
    x -= w[k];
    if (x <= 0) return k;
  }
  return options[options.length - 1];
}

/** Cuánto dura una falla (s). */
export function faultDuration(kind: FaultKind, rand: () => number): number {
  if (kind === 'armSlow' || kind === 'motorWeak') return PERMANENT;
  const [a, b] = DAMAGE.duration[kind];
  return a + (b - a) * rand();
}

/** Probabilidad de una falla al azar en un paso de `dt` s. */
export function randomFaultChance(dt: number, level: DamageLevel): number {
  return (DAMAGE.randomPerMatch / 150) * dt * DAMAGE.levelScale[level];
}

/**
 * Medidor de golpes de un robot: suma el cambio de velocidad que no vino de los motores en la
 * ventana `DAMAGE.window` y avisa una vez por golpe (se rearma tras `DAMAGE.rearm` s tranquilo).
 */
export class ImpactMeter {
  private ring: number[];
  private i = 0;
  private sum = 0;
  private calm = Infinity;
  /** Golpe actual (m/s). */
  value = 0;

  constructor(readonly dt: number) {
    this.ring = new Array(Math.max(1, Math.round(DAMAGE.window / dt))).fill(0);
  }

  /** Agrega el cambio de velocidad de un paso; devuelve el golpe (m/s) si es uno nuevo, o null. */
  push(dv: number): number | null {
    this.sum += dv - this.ring[this.i];
    this.ring[this.i] = dv;
    this.i = (this.i + 1) % this.ring.length;
    this.value = Math.max(0, this.sum);
    if (this.value < DAMAGE.threshold) {
      this.calm += this.dt;
      return null;
    }
    const fresh = this.calm >= DAMAGE.rearm;
    this.calm = 0;
    return fresh ? this.value : null;
  }

  reset(): void {
    this.ring.fill(0);
    this.sum = 0;
    this.value = 0;
    this.calm = Infinity;
  }
}

export function sanitizeDamage(raw: unknown): DamageSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_DAMAGE;
  return {
    level: DAMAGE_LEVELS.find((l) => l === o.level) ?? d.level,
    targets: o.targets === 'player' || o.targets === 'all' ? o.targets : d.targets,
    random: typeof o.random === 'boolean' ? o.random : d.random,
  };
}
