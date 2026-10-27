/**
 * Estrategias que se eligen para cada robot de la IA antes de un match (pantalla de configuración
 * del match, como el selector de estrategia de rebuilt-sim). Cada una es un juego de opciones de la
 * IA (`BotOptions`): a qué nivel anota (§4.4: N3 vale más), de dónde junta Muestras (Laboratorio
 * §3.2.2 o Human Player §3.2.4) y qué hace en el ENDGAME (Muestra Crítica a la Repisa o Plataforma,
 * §4.3.1). Las reglas no cambian: el árbitro cobra igual.
 */
import type { BotOptions } from './Bot';

export type StrategyId = 'auto' | 'n3' | 'n2' | 'n1' | 'critical' | 'hp' | 'lab' | 'noEndgame' | 'park';

export const STRATEGIES: readonly StrategyId[] = ['auto', 'n3', 'n2', 'n1', 'critical', 'hp', 'lab', 'noEndgame', 'park'];

/**
 * - auto: la IA de su alianza reparte todo (`ai/Team.ts`): quién va por la Crítica y quién atiende al Human Player.
 * - n3 / n2 / n1: junta de donde convenga y anota en ese nivel; sube a la Plataforma.
 * - critical: anota en N3 y en el ENDGAME lleva la Muestra Crítica a la Repisa.
 * - hp: junta solo lo que mete su Human Player.
 * - lab: junta solo del Laboratorio (deja la Campana a su compañero).
 * - noEndgame: anota hasta la bocina, sin subir a la Plataforma.
 * - park: no anota; cruza la línea en AUTO y sube a la Plataforma en el ENDGAME.
 */
export const STRATEGY_OPTIONS: Record<StrategyId, Partial<BotOptions>> = {
  auto: {},
  n3: { level: 3, endgame: 'platform' },
  n2: { level: 2, endgame: 'platform' },
  n1: { level: 1, endgame: 'platform' },
  critical: { level: 3, endgame: 'critical' },
  hp: { level: 3, source: 'hp' },
  lab: { level: 3, source: 'lab' },
  noEndgame: { level: 3, endgame: 'none' },
  park: { role: 'park', endgame: 'platform' },
};

export const isStrategy = (v: unknown): v is StrategyId => STRATEGIES.includes(v as StrategyId);
