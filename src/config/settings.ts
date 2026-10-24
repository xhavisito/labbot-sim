/**
 * Ajustes del simulador que elige el usuario (se guardan en localStorage). No cambian las reglas:
 * los puntos y tiempos viven en `game.ts`. Todo pasa por `sanitizeSettings`, que recorta a rangos
 * válidos (un valor raro guardado en el navegador no rompe el juego).
 */
import { DEFAULT_ROBOT } from './robot';

export interface Settings {
  /** La IA maneja los otros 3 robots en el TELEOP. */
  ai: boolean;
  /** Rutina de AUTO de tu robot (id de `AUTO_ROUTINES`). */
  playerAuto: string;
  /** Rutina de AUTO de los otros robots. */
  botAuto: string;
  /** Tu robot: velocidad máxima (m/s) y Muestras que guarda. */
  maxSpeed: number;
  capacity: number;
  /** Human Player automático (§3.2.4) y cada cuántos segundos mete una Muestra (SUPUESTO). */
  hpEnabled: boolean;
  hpInterval: number;
}

export const DEFAULT_SETTINGS: Settings = {
  ai: true,
  playerAuto: 'leave',
  botAuto: 'preload',
  maxSpeed: DEFAULT_ROBOT.maxSpeed,
  capacity: DEFAULT_ROBOT.capacity,
  hpEnabled: true,
  hpInterval: 3,
};

export const SETTINGS_RANGE = {
  maxSpeed: { min: 1, max: 4.5, step: 0.25 },
  capacity: { min: 1, max: 10, step: 1 },
  hpInterval: { min: 1, max: 10, step: 0.5 },
} as const;

const KEY = 'labbot.settings';

const num = (v: unknown, def: number, r: { min: number; max: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(r.min, Math.min(r.max, v)) : def;

/** Ajustes válidos a partir de cualquier valor (lo que no sirve toma el valor por defecto). */
export function sanitizeSettings(raw: unknown, autoIds: readonly string[]): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const auto = (v: unknown, def: string) => (typeof v === 'string' && autoIds.includes(v) ? v : def);
  return {
    ai: typeof o.ai === 'boolean' ? o.ai : d.ai,
    playerAuto: auto(o.playerAuto, d.playerAuto),
    botAuto: auto(o.botAuto, d.botAuto),
    maxSpeed: num(o.maxSpeed, d.maxSpeed, SETTINGS_RANGE.maxSpeed),
    capacity: Math.round(num(o.capacity, d.capacity, SETTINGS_RANGE.capacity)),
    hpEnabled: typeof o.hpEnabled === 'boolean' ? o.hpEnabled : d.hpEnabled,
    hpInterval: num(o.hpInterval, d.hpInterval, SETTINGS_RANGE.hpInterval),
  };
}

export function loadSettings(autoIds: readonly string[]): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'), autoIds);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}
