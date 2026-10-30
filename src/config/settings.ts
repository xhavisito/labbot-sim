/**
 * Ajustes del simulador que elige el usuario (se guardan en localStorage). No cambian las reglas:
 * los puntos y tiempos viven en `game.ts`. Todo pasa por `sanitizeSettings`, que recorta a rangos
 * válidos (un valor raro guardado en el navegador no rompe el juego).
 */
import { AI_LEVELS, type AiLevel } from '../ai/difficulty';
import { isStrategy, type StrategyId } from '../ai/strategy';
import { DEFAULT_DAMAGE, sanitizeDamage, type DamageSettings } from '../core/damage';
import { DEFAULT_ROBOT, GRIP_MODES, MECHANISM_KINDS, type GripMode, type MechanismKind } from './robot';
import { allRobotIds, type RobotId } from './robotIds';
import { CENTER_SPOT, sanitizeSpot, type StartSpot } from './startSpot';

/** Un robot en la configuración del match (los de la IA; del tuyo solo cuenta tu rutina de AUTO). */
export interface MatchRobot {
  /** Tipo de robot de la IA ('random' = al azar en cada match, `ai/lineup.ts`). */
  kind: MechanismKind | 'random';
  /** Estrategia de la IA (`ai/strategy.ts`). */
  strategy: StrategyId;
  /** Dificultad de la IA (`ai/difficulty.ts`). */
  ai: AiLevel;
  /** Rutina de AUTO (id de `AUTO_ROUTINES`). */
  auto: string;
  /**
   * Estrategia de alianza (id de `game/planStore.ts`, '' = ninguna): solo cuenta si este robot es tu
   * compañero; manda sobre `strategy` y `auto`.
   */
  plan: string;
}

/** Configuración del match que se elige antes de empezar ("Preparar match"); se recuerda para el siguiente. */
export interface MatchSetup {
  /** Por robot: 0–1 rojo, 2–3 azul. */
  robots: [MatchRobot, MatchRobot, MatchRobot, MatchRobot];
  /** Lugar de tu robot dentro de su Zona de Inicio (§3.2.1, §4.1; `config/startSpot.ts`). */
  start: StartSpot;
}

export interface Settings {
  /** La IA maneja los otros 3 robots en el TELEOP. */
  ai: boolean;
  /** Rutina de AUTO de tu robot (id de `AUTO_ROUTINES`). */
  playerAuto: string;
  /** Tipo, estrategia, dificultad y AUTO de cada robot de la IA, y tu posición inicial. */
  match: MatchSetup;
  /** Tipo de tu robot (`config/robot.ts`). */
  robotType: RobotId;
  /** Tu robot: velocidad máxima (m/s). El pivote lleva una pieza a la vez (no se ajusta). */
  maxSpeed: number;
  /** Human Player automático (§3.2.4) y cada cuántos segundos mete una Muestra (SUPUESTO). */
  hpEnabled: boolean;
  hpInterval: number;
  /** Human Player que piensa (`game/HumanPlayer.ts`): cuida sus Muestras de los rivales y alimenta a su robot; apagado = ritmo fijo. */
  hpSmart: boolean;
  /** Controles touch en pantalla: según el equipo, siempre o nunca. */
  touch: 'auto' | 'on' | 'off';
  /** Calidad gráfica (`render/Renderer.ts`): automática según el equipo y los FPS, o fija. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /**
   * Agarre de la garra (`game/Mechanisms.ts`): con compliants (agarra de cualquier ángulo con la
   * garra abajo), preciso (alinear y entrar despacio) o fácil (el de antes).
   */
  grip: GripMode;
  /** Fallas por golpes y al azar (`core/damage.ts`). */
  damage: DamageSettings;
  /** Volumen de los sonidos del campo (`audio/FieldAudio.ts`), 0–100 %; 0 = silencio. */
  volume: number;
}

const botDefault = (): MatchRobot => ({ kind: 'random', strategy: 'auto', ai: 'hard', auto: 'preload', plan: '' });

export const DEFAULT_SETTINGS: Settings = {
  ai: true,
  playerAuto: 'leave',
  match: { robots: [botDefault(), botDefault(), botDefault(), botDefault()], start: { ...CENTER_SPOT } },
  robotType: DEFAULT_ROBOT.mechanism,
  maxSpeed: DEFAULT_ROBOT.maxSpeed,
  hpEnabled: true,
  hpInterval: 3,
  hpSmart: true,
  touch: 'auto',
  quality: 'auto',
  grip: 'compliant',
  damage: { ...DEFAULT_DAMAGE },
  volume: 80,
};

export const SETTINGS_RANGE = {
  maxSpeed: { min: 1, max: 4.5, step: 0.25 },
  hpInterval: { min: 1, max: 10, step: 0.5 },
  volume: { min: 0, max: 100, step: 5 },
} as const;

const KEY = 'labbot.settings';

const num = (v: unknown, def: number, r: { min: number; max: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(r.min, Math.min(r.max, v)) : def;

/** Ajustes válidos a partir de cualquier valor (lo que no sirve toma el valor por defecto). */
export function sanitizeSettings(raw: unknown, autoIds: readonly string[]): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const auto = (v: unknown, def: string) => (typeof v === 'string' && autoIds.includes(v) ? v : def);
  const ids = allRobotIds();
  const kind = (v: unknown, def: RobotId) => ids.find((k) => k === v) ?? def;
  // Ajustes de antes (una dificultad y una rutina para todos los robots de la IA) siguen valiendo
  const oldAi = AI_LEVELS.find((l) => l === o.aiLevel);
  const oldAuto = auto(o.botAuto, botDefault().auto);
  const m = (o.match && typeof o.match === 'object' ? o.match : {}) as Record<string, unknown>;
  const list = Array.isArray(m.robots) ? m.robots : [];
  const robot = (i: number): MatchRobot => {
    const r = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Record<string, unknown>;
    return {
      kind: r.kind === 'random' ? 'random' : (MECHANISM_KINDS.find((k) => k === r.kind) ?? 'random'),
      strategy: isStrategy(r.strategy) ? r.strategy : 'auto',
      ai: AI_LEVELS.find((l) => l === r.ai) ?? oldAi ?? botDefault().ai,
      auto: auto(r.auto, oldAuto),
      plan: typeof r.plan === 'string' ? r.plan.slice(0, 40) : '',
    };
  };
  return {
    ai: typeof o.ai === 'boolean' ? o.ai : d.ai,
    playerAuto: auto(o.playerAuto, d.playerAuto),
    match: { robots: [robot(0), robot(1), robot(2), robot(3)], start: m.start === undefined ? { ...CENTER_SPOT } : sanitizeSpot(m.start) },
    // Un tipo quitado (genérico, elevador, torre, chasis, pivote con hopper) vuelve al pivote
    robotType: kind(o.robotType, d.robotType),
    maxSpeed: num(o.maxSpeed, d.maxSpeed, SETTINGS_RANGE.maxSpeed),
    hpEnabled: typeof o.hpEnabled === 'boolean' ? o.hpEnabled : d.hpEnabled,
    hpInterval: num(o.hpInterval, d.hpInterval, SETTINGS_RANGE.hpInterval),
    hpSmart: typeof o.hpSmart === 'boolean' ? o.hpSmart : d.hpSmart,
    touch: o.touch === 'on' || o.touch === 'off' ? o.touch : d.touch,
    quality: o.quality === 'low' || o.quality === 'medium' || o.quality === 'high' ? o.quality : d.quality,
    // 'real' (el agarre estricto del 29-oct, entonces por defecto) pasa a compliants
    grip: GRIP_MODES.find((g) => g === o.grip) ?? d.grip,
    damage: sanitizeDamage(o.damage),
    volume: num(o.volume, d.volume, SETTINGS_RANGE.volume),
  };
}

export function loadSettings(autoIds: readonly string[]): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null'), autoIds);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}
