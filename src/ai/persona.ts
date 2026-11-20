/**
 * Personalidades de la IA rival: estilos de juego para entrenar contra rivales distintos. Se montan
 * SOBRE la dificultad (`ai/difficulty.ts`): la dificultad dice qué tan bien juega el robot y la
 * personalidad en qué se enfoca. Las reglas no cambian: el árbitro cobra igual y ninguna personalidad
 * desactiva los filtros de faltas de `Bot` (no empuja a nadie, §4.5; no obstruye las zonas rivales,
 * §4.6; no pisa la Plataforma ni toma la Crítica antes del ENDGAME, §4.3.1; §6.1 "no hay defensa").
 * Todos los números son SUPUESTOS de diseño del simulador (el manual no habla de IA).
 */
import type { AiProfile } from './difficulty';

export type AiPersona = 'balanced' | 'aggressive' | 'defensive' | 'fast';
export const AI_PERSONAS: readonly AiPersona[] = ['balanced', 'aggressive', 'defensive', 'fast'];
export const isPersona = (v: unknown): v is AiPersona => AI_PERSONAS.includes(v as AiPersona);

/**
 * - balanced: la IA de siempre.
 * - aggressive (Agresiva): arriesga por puntos. Entra a la Cámara más rápido y desde más cerca, junta
 *   lotes grandes, sube a la Plataforma justo y roba las Muestras del Human Player rival cuando nadie
 *   las cuida (D38, legal: sólo la falta si toca a un robot). Más tolerante al error al anotar.
 * - defensive (Defensiva): juega seguro. Nunca roba, deja margen de sobra para la Plataforma y la
 *   Crítica, se alinea con calma en la Cámara (no la ocupa mal) y avanza más despacio cerca de todo.
 *   "Defensiva" no es bloquear (§6.1 "no hay defensa"): es proteger sus puntos y evitar faltas.
 * - fast (Ciclos rápidos): lotes chicos y viajes cortos: anota apenas junta 1–2 Muestras, entra a la
 *   Cámara sin frenar y no pierde tiempo dudando; sube a la Plataforma con margen justo.
 */
export interface PersonaMod {
  speedMul: number;
  /** Se suma al tolerancia de alineación (m). */
  sloppyAdd: number;
  dockSpeedMul: number;
  /** Distancia de alineación frente a la Cámara (se multiplica). */
  dockStageMul: number;
  /** Se suma al margen (s) antes de la Plataforma. */
  climbAdd: number;
  /** Tope de Muestras por viaje (0 = el de la dificultad). */
  batch: number;
  /** Se suma (s) a la reacción. */
  reactionAdd: number;
  steal: 'keep' | 'on' | 'off';
}

export const PERSONA_MODS: Record<AiPersona, PersonaMod> = {
  balanced: { speedMul: 1, sloppyAdd: 0, dockSpeedMul: 1, dockStageMul: 1, climbAdd: 0, batch: 0, reactionAdd: 0, steal: 'keep' },
  aggressive: { speedMul: 1, sloppyAdd: 0.015, dockSpeedMul: 1.25, dockStageMul: 0.8, climbAdd: -1, batch: 10, reactionAdd: 0, steal: 'on' },
  defensive: { speedMul: 0.85, sloppyAdd: -0.01, dockSpeedMul: 0.85, dockStageMul: 1.2, climbAdd: 3, batch: 3, reactionAdd: 0.1, steal: 'off' },
  fast: { speedMul: 1, sloppyAdd: 0.005, dockSpeedMul: 1.3, dockStageMul: 0.75, climbAdd: -0.5, batch: 2, reactionAdd: 0, steal: 'keep' },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** El perfil de la dificultad con la personalidad encima (no modifica el original). */
export function applyPersona(base: AiProfile, persona: AiPersona = 'balanced'): AiProfile {
  const m = PERSONA_MODS[persona];
  if (persona === 'balanced') return base;
  return {
    ...base,
    speed: clamp(base.speed * m.speedMul, 0.3, 1),
    sloppy: Math.max(0, base.sloppy + m.sloppyAdd),
    dockSpeed: base.dockSpeed * m.dockSpeedMul,
    dockStage: clamp(base.dockStage * m.dockStageMul, 0.25, 1),
    climbMargin: Math.max(1, base.climbMargin + m.climbAdd),
    batch: m.batch > 0 ? Math.min(base.batch, m.batch) || m.batch : base.batch,
    reaction: base.reaction + m.reactionAdd,
    steal: m.steal === 'keep' ? base.steal : m.steal === 'on',
  };
}
