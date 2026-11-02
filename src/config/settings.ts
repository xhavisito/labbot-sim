/**
 * Ajustes del simulador que elige el usuario (se guardan en localStorage). No cambian las reglas:
 * los puntos y tiempos viven en `game.ts`. Todo pasa por `sanitizeSettings`, que recorta a rangos
 * válidos (un valor raro guardado en el navegador no rompe el juego).
 */
import { AI_LEVELS, type AiLevel } from '../ai/difficulty';
import { isPersona, type AiPersona } from '../ai/persona';
import { isStrategy, type StrategyId } from '../ai/strategy';
import { DEFAULT_DAMAGE, sanitizeDamage, type DamageSettings } from '../core/damage';
import { DEFAULT_ROBOT, GRIP_MODES, MECHANISM_KINDS, type GripMode, type MechanismKind } from './robot';
import { allRobotIds, type RobotId } from './robotIds';
import { COLOR_MODES, nearestTextScale, type ColorMode, type TextScale } from './palette';
import { CENTER_SPOT, sanitizeSpot, type StartSpot } from './startSpot';

/** Un robot en la configuración del match (los de la IA; del tuyo solo cuenta tu rutina de AUTO). */
export interface MatchRobot {
  /** Tipo de robot de la IA ('random' = al azar en cada match, `ai/lineup.ts`). */
  kind: MechanismKind | 'random';
  /** Estrategia de la IA (`ai/strategy.ts`). */
  strategy: StrategyId;
  /** Dificultad de la IA (`ai/difficulty.ts`). */
  ai: AiLevel;
  /** Personalidad de la IA (`ai/persona.ts`). */
  persona: AiPersona;
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

/**
 * Rival de la práctica 1 contra 1 (`GameSession` opción `rival`): nadie, uno quieto, uno de la IA o
 * otra persona en la misma pantalla (pantalla dividida, como el modo 2 jugadores; SUPUESTO).
 */
export const RIVALS = ['none', 'passive', 'ai', 'human'] as const;
export type RivalKind = (typeof RIVALS)[number];
/** Duración de la práctica 1 contra 1 en segundos (0 = libre, hasta que tú termines). */
export const PRACTICE_LIMITS = [0, 60, 120, 180, 300] as const;

/** Ajustes de la práctica 1 contra 1 (`ui/Practice1v1.ts`). */
export interface PracticeSettings {
  rival: RivalKind;
  /** Personalidad del rival de la IA. */
  persona: AiPersona;
  limit: number;
}

export const HUD_KEYS = ['hudScore', 'hudRobot', 'hudToasts', 'hudFouls', 'hudButtons', 'hudHelp'] as const;
export type HudKey = (typeof HUD_KEYS)[number];

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
  /** Partes del HUD del match que se ven (solo visual: el árbitro y los puntos no cambian). */
  hudScore: boolean;
  hudRobot: boolean;
  hudToasts: boolean;
  hudFouls: boolean;
  hudButtons: boolean;
  hudHelp: boolean;
  /** Calidad gráfica (`render/Renderer.ts`): automática según el equipo y los FPS, o fija. */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** Mostrar FPS y tiempos en pantalla durante el match (también con F3 o `?fps=1`). */
  showFps: boolean;
  /** Práctica 1 contra 1: dibuja el ghost (tu mejor ciclo guardado). Apagado, sigue grabando pero no lo muestra. */
  showGhost: boolean;
  /** Vibración del control al anotar y con faltas en tu contra (`input/rumble.ts`). */
  rumble: boolean;
  /**
   * Agarre de la garra (`game/Mechanisms.ts`): con compliants (agarra de cualquier ángulo con la
   * garra abajo), preciso (alinear y entrar despacio) o fácil (el de antes).
   */
  grip: GripMode;
  /** Fallas por golpes y al azar (`core/damage.ts`). */
  damage: DamageSettings;
  /** Práctica 1 contra 1: rival y duración (también se cambian en su panel). */
  practice: PracticeSettings;
  /** Volumen de los sonidos del campo (`audio/FieldAudio.ts`), 0–100 %; 0 = silencio. */
  volume: number;
  /** Avisos del árbitro (`core/refCalls.ts`): silbato y voz, solo silbato, o sin sonido (el cartel siempre sale). */
  refAudio: RefAudioMode;
  /**
   * Pizarra de la estrategia de alianza en el match (`render/PlanView.ts` y la tarjeta del HUD):
   * líneas en la cancha y tarjeta, solo la tarjeta, o nada.
   */
  planBoard: PlanBoard;
  /** Accesibilidad: paleta para daltonismo (`config/palette.ts`) y tamaño del texto de la interfaz. */
  colorMode: ColorMode;
  textScale: TextScale;
  /** Multijugador local (2 jugadores): equipos y lo que elige cada persona (`ui/VersusSetup.ts`). */
  versus: VersusSettings;
}

/** Con qué controla una persona en 2 jugadores: el teclado de WASD, el de flechas, o el 1.º o 2.º control. */
export const VERSUS_DEVICES = ['keys1', 'keys2', 'pad1', 'pad2'] as const;
export type VersusDevice = (typeof VERSUS_DEVICES)[number];

/** Lo que elige cada persona en 2 jugadores: su robot, su AUTO, su lugar en la Zona de Inicio y sus controles. */
export interface VersusSide {
  robot: RobotId;
  auto: string;
  start: StartSpot;
  device: VersusDevice;
}

/**
 * 2 jugadores: `opp` = alianzas contrarias (cada quien contra el otro); `same` = la misma alianza
 * (la IA rellena los otros dos robots). SUPUESTO del simulador: el manual no habla de controles.
 */
export interface VersusSettings {
  team: 'opp' | 'same';
  p1: VersusSide;
  p2: VersusSide;
}

/** Sonido de los avisos del árbitro: silbato y voz, solo silbato, o nada. */
export type RefAudioMode = 'voice' | 'whistle' | 'off';
export const REF_AUDIO_MODES: readonly RefAudioMode[] = ['voice', 'whistle', 'off'];

export type PlanBoard = 'all' | 'card' | 'off';
export const PLAN_BOARDS: readonly PlanBoard[] = ['all', 'card', 'off'];

const botDefault = (): MatchRobot => ({ kind: 'random', strategy: 'auto', ai: 'hard', persona: 'balanced', auto: 'preload', plan: '' });

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
  hudScore: true,
  hudRobot: true,
  hudToasts: true,
  hudFouls: true,
  hudButtons: true,
  hudHelp: true,
  quality: 'auto',
  showFps: false,
  showGhost: true,
  rumble: true,
  grip: 'compliant',
  damage: { ...DEFAULT_DAMAGE },
  // SUPUESTO: por defecto el rival está quieto, como un obstáculo que no te quita Muestras
  practice: { rival: 'passive', persona: 'balanced', limit: 0 },
  volume: 80,
  refAudio: 'whistle',
  planBoard: 'all',
  colorMode: 'normal',
  textScale: 1,
  versus: {
    team: 'opp',
    p1: { robot: DEFAULT_ROBOT.mechanism, auto: 'leave', start: { ...CENTER_SPOT }, device: 'keys1' },
    p2: { robot: DEFAULT_ROBOT.mechanism, auto: 'leave', start: { ...CENTER_SPOT }, device: 'keys2' },
  },
};

export const SETTINGS_RANGE = {
  maxSpeed: { min: 1, max: 4.5, step: 0.25 },
  hpInterval: { min: 1, max: 10, step: 0.5 },
  volume: { min: 0, max: 100, step: 5 },
} as const;

const KEY = 'labbot.settings';

const num = (v: unknown, def: number, r: { min: number; max: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(r.min, Math.min(r.max, v)) : def;

/** Ajustes de la práctica 1 contra 1 válidos (lo que no sirve toma el valor por defecto). */
export function sanitizePractice(raw: unknown): PracticeSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS.practice;
  return {
    rival: RIVALS.find((r) => r === o.rival) ?? d.rival,
    persona: isPersona(o.persona) ? o.persona : d.persona,
    limit: PRACTICE_LIMITS.find((l) => l === o.limit) ?? d.limit,
  };
}

const VERSUS_SIDE_DEFAULTS: [VersusDevice, StartSpot][] = [
  ['keys1', { ...CENTER_SPOT }],
  ['keys2', { ...CENTER_SPOT }],
];

/** Ajustes de 2 jugadores válidos (lo que no sirve toma el valor por defecto). */
export function sanitizeVersus(raw: unknown, autoIds: readonly string[]): VersusSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ids = allRobotIds();
  const side = (v: unknown, def: number): VersusSide => {
    const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const [dev, start] = VERSUS_SIDE_DEFAULTS[def];
    return {
      robot: ids.find((k) => k === r.robot) ?? DEFAULT_SETTINGS.robotType,
      auto: typeof r.auto === 'string' && autoIds.includes(r.auto) ? r.auto : 'leave',
      start: r.start === undefined ? { ...start } : sanitizeSpot(r.start),
      device: VERSUS_DEVICES.find((x) => x === r.device) ?? dev,
    };
  };
  return {
    team: o.team === 'same' ? 'same' : 'opp',
    p1: side(o.p1, 0),
    p2: side(o.p2, 1),
  };
}

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
      persona: isPersona(r.persona) ? r.persona : 'balanced',
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
    ...(Object.fromEntries(HUD_KEYS.map((k) => [k, typeof o[k] === 'boolean' ? o[k] : d[k]])) as Record<HudKey, boolean>),
    quality: o.quality === 'low' || o.quality === 'medium' || o.quality === 'high' ? o.quality : d.quality,
    showFps: typeof o.showFps === 'boolean' ? o.showFps : d.showFps,
    showGhost: typeof o.showGhost === 'boolean' ? o.showGhost : d.showGhost,
    rumble: typeof o.rumble === 'boolean' ? o.rumble : d.rumble,
    // 'real' (el agarre estricto del 29-oct, entonces por defecto) pasa a compliants
    grip: GRIP_MODES.find((g) => g === o.grip) ?? d.grip,
    damage: sanitizeDamage(o.damage),
    practice: sanitizePractice(o.practice),
    volume: num(o.volume, d.volume, SETTINGS_RANGE.volume),
    refAudio: REF_AUDIO_MODES.find((m) => m === o.refAudio) ?? d.refAudio,
    planBoard: PLAN_BOARDS.find((b) => b === o.planBoard) ?? d.planBoard,
    colorMode: COLOR_MODES.find((m) => m === o.colorMode) ?? d.colorMode,
    textScale: nearestTextScale(o.textScale ?? d.textScale),
    versus: sanitizeVersus(o.versus, autoIds),
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
