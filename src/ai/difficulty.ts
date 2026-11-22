/**
 * Dificultad de la IA. Las reglas no cambian (el árbitro cobra igual); cambia qué tan rápido y qué
 * tan bien juega cada robot de la computadora. Todos los números son SUPUESTOS de diseño del
 * simulador (el manual no habla de IA); se calibraron con la arena: `npm run arena -- --scenario lvl:expert:hard` (y
 * `lvl:hard:normal`, `lvl:normal:easy`), una dificultad por alianza con los mismos robots.
 */
import type { Level } from '../core/types';

export type AiLevel = 'easy' | 'normal' | 'hard' | 'expert';
export const AI_LEVELS: readonly AiLevel[] = ['easy', 'normal', 'hard', 'expert'];

export interface AiProfile {
  /** Fracción del mando máximo de avance (1 = todo lo que da el robot). */
  speed: number;
  /** Nivel de la Cámara al que prefiere anotar (§4.4: N3 vale más). */
  level: Level;
  /** Lleva la Muestra Crítica a la Repisa en el ENDGAME (§4.3.1) si su alianza le da ese papel. */
  critical: boolean;
  /** Se reparte con su compañero de IA las Muestras, el Human Player y la Cámara. */
  teamwork: boolean;
  /** Segundos que tarda en reaccionar cuando cambia de objetivo (un piloto que duda). */
  reaction: number;
  /** Margen (s) que se deja para subir a la Plataforma antes de la bocina. */
  climbMargin: number;
  /** Muestras que junta como máximo antes de ir a anotar (además lo limita su capacidad). */
  batch: number;
  /** Tolerancia de alineación al anotar (m): más grande = más rápido pero falla más. */
  sloppy: number;
  /**
   * Roba las Muestras que el Human Player rival deja en su ranura cuando ningún rival las cuida
   * (SUPUESTO: el manual §3.2.4 no prohíbe tomar Muestras sueltas; el contacto con robots en esa
   * zona sí es falta, §4.6, y la IA lo evita).
   */
  steal: boolean;
  /**
   * Arrimándose a la Cámara: factor de la velocidad con la que entra (1 = la de siempre) y a cuántos
   * metros de su punto de anotación se alinea antes de entrar. Un piloto fino se alinea más cerca y
   * entra sin frenar tanto: menos tiempo ocupando el Nivel 3 (su compañero espera su turno).
   */
  dockSpeed: number;
  dockStage: number;
  /** Segundos extra (al azar entre 0 y esto) sobre `reaction`: un piloto no duda siempre igual. */
  jitter: number;
  /** Error de puntería (rad, al azar ± esto, nuevo por Muestra) al encarar una Muestra para tomarla. */
  aim: number;
  /** Pausa (s) al recoger una Muestra, antes de seguir (el piloto confirma que la tiene). */
  pickPause: number;
  /** 0–1: cuánto evita las Muestras a las que un rival llega antes (no se pelea una que va perdida). */
  contest: number;
  /**
   * 0–1: decide según el reloj y el marcador (`Team.situation`): lotes chicos al final, asegura el
   * Dominio de Cámara (RP, §4.4) cuando le faltan pocas Muestras y ajusta el margen de la Plataforma
   * (más holgura si va ganando, menos si va perdiendo).
   */
  clutch: number;
  /**
   * Manejo humano: segundos que tarda el mando de avance en subir de 0 a 1 (un piloto no pega el
   * stick de golpe) y lo mismo para el giro. Frenar es varias veces más rápido. SUPUESTO de diseño.
   */
  ramp: number;
  turnRamp: number;
  /**
   * Distancia (m, entre contornos) a la que empieza a soltar el acelerador al acercarse a otro robot
   * por donde va: llega despacio (menos golpes, §4.5) en vez de frenar hasta tocarlo.
   */
  courtesy: number;
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  // Fácil: lento, anota en N2, no va por la Crítica ni se coordina; sube temprano a la Plataforma
  easy: { speed: 0.55, level: 2, critical: false, teamwork: false, reaction: 0.9, climbMargin: 14, batch: 2, sloppy: 0.06, steal: false, dockSpeed: 1, dockStage: 0.55, jitter: 0.4, aim: 0.12, pickPause: 0.5, contest: 0, clutch: 0, ramp: 0.4, turnRamp: 0.22, courtesy: 0.5 },
  // Normal: N3 y la Crítica, a dos tercios de velocidad, dudando y arrimándose a la Cámara con cuidado (a 0.75 le
  // ganaba a Difícil 46 % de los matches: el campo se queda sin Muestras y la velocidad de más casi no se notaba)
  normal: { speed: 0.68, level: 3, critical: true, teamwork: true, reaction: 0.55, climbMargin: 8, batch: 2, sloppy: 0.03, steal: false, dockSpeed: 0.7, dockStage: 0.65, jitter: 0.25, aim: 0.07, pickPause: 0.45, contest: 0.3, clutch: 0.3, ramp: 0.32, turnRamp: 0.18, courtesy: 0.6 },
  // Difícil: casi todo lo que da el robot y lee el partido, pero duda como una persona (≈0.2 s) y se arrima con margen
  hard: { speed: 0.9, level: 3, critical: true, teamwork: true, reaction: 0.18, climbMargin: 3, batch: 10, sloppy: 0.01, steal: false, dockSpeed: 1.2, dockStage: 0.45, jitter: 0.1, aim: 0.02, pickPause: 0.15, contest: 1, clutch: 1, ramp: 0.2, turnRamp: 0.12, courtesy: 0.7 },
  // Experto: un piloto de Einstein. Todo lo que da el robot, casi sin dudar, entra a la Cámara rápido y desde cerca,
  // roba Muestras de la Campana rival y deja el margen justo para la Plataforma
  expert: { speed: 1, level: 3, critical: true, teamwork: true, reaction: 0.06, climbMargin: 1.8, batch: 10, sloppy: 0, steal: true, dockSpeed: 1.5, dockStage: 0.4, jitter: 0.04, aim: 0, pickPause: 0.03, contest: 1, clutch: 1, ramp: 0.12, turnRamp: 0.07, courtesy: 0.7 },
};
