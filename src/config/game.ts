/**
 * Parámetros del juego (tiempos, puntos, faltas, RP) con la sección del manual de donde salen.
 * Si el manual cambia (§11.2: "puede sufrir modificaciones"; §4.4: "las puntuaciones pueden variar"),
 * se ajusta aquí.
 */
import type { Level } from '../core/types';

export interface GameConfig {
  times: {
    /** AUTO: 15 s (§2, §4.2). */
    auto: number;
    /** TELEOP: 135 s (§2, §4.3: "2 minutos y 15 segundos"). */
    teleop: number;
    /** ENDGAME: últimos 30 s del TELEOP (§4.3.1). */
    endgame: number;
    /** Pausa entre AUTO y TELEOP: el manual solo menciona la señal de sonido (D9). SUPUESTO 0 s. */
    autoToTeleopPause: number;
  };
  points: {
    /** Línea de Autónomo: 5 por cada robot que la cruza (§4.4; D2). */
    autoLine: number;
    /** Muestras por nivel: AUTO 5/10/18, TELEOP y ENDGAME 2/6/15 (§4.4). */
    sampleAuto: Record<Level, number>;
    sampleTeleop: Record<Level, number>;
    /** Robot en Plataforma 10; Alianza en Plataforma (2 robots) 20, no acumulable (§4.4, nota). */
    platformOne: number;
    platformTwo: number;
    /** Muestra Crítica en la Repisa: 15 (§4.4). */
    critical: number;
  };
  fouls: {
    /** Foul: 4 puntos al equipo contrario (§4.5). */
    foul: number;
    /** Tech Foul: 8 puntos al equipo contrario (§4.6). */
    tech: number;
    /** Yellow Cards que hacen una Red Card (§4.3.3: "acumular 2 Yellow Cards"). */
    yellowsForRed: number;
  };
  rp: {
    /** Victoria 2, empate 1 (§4.4). */
    win: number;
    tie: number;
    /** Ambos robots cruzan la línea 1, Muestra Crítica 1, Dominio de Cámara 1 (§4.4). */
    autoLine: number;
    critical: number;
    dominance: number;
    /** Dominio de Cámara: ≥ 10 Muestras en su Cámara al final del match (§4.4). */
    dominanceSamples: number;
  };
}

/**
 * Duración total del match en 1 contra 1 / 2 jugadores (SUPUESTO del simulador: el manual fija 15 s
 * + 135 s = 150 s, §2 y §4.3; aquí se puede acortar o alargar el TELEOP). El AUTO sigue en 15 s y el
 * ENDGAME en los últimos 30 s. 150 s = el reglamento.
 */
export const MATCH_DURATIONS = [60, 90, 120, 150, 180, 240] as const;
export const DEFAULT_DURATION = 150;

/** Config del juego con otra duración total (el TELEOP es lo que cambia); 150 s devuelve `GAME` tal cual. */
export function gameWithDuration(total: number, base: GameConfig = GAME): GameConfig {
  const d = MATCH_DURATIONS.find((x) => x === total) ?? DEFAULT_DURATION;
  if (d === base.times.auto + base.times.autoToTeleopPause + base.times.teleop) return base;
  return { ...base, times: { ...base.times, teleop: d - base.times.auto - base.times.autoToTeleopPause } };
}

export const GAME: GameConfig = {
  times: { auto: 15, teleop: 135, endgame: 30, autoToTeleopPause: 0 },
  points: {
    autoLine: 5,
    sampleAuto: { 1: 5, 2: 10, 3: 18 },
    sampleTeleop: { 1: 2, 2: 6, 3: 15 },
    platformOne: 10,
    platformTwo: 20,
    critical: 15,
  },
  fouls: { foul: 4, tech: 8, yellowsForRed: 2 },
  rp: { win: 2, tie: 1, autoLine: 1, critical: 1, dominance: 1, dominanceSamples: 10 },
};
