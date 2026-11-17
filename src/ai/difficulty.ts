/**
 * Dificultad de la IA. Las reglas no cambian (el árbitro cobra igual); cambia qué tan rápido y qué
 * tan bien juega cada robot de la computadora. Todos los números son SUPUESTOS de diseño del
 * simulador (el manual no habla de IA); se calibraron con `npm run batch -- --set ai --a <nivel> --b old`.
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
  // Normal: N3 y la Crítica, con algo de duda y margen
  normal: { speed: 0.8, level: 3, critical: true, teamwork: true, reaction: 0.35, climbMargin: 6, batch: 4, sloppy: 0.02, steal: false, dockSpeed: 1, dockStage: 0.55, jitter: 0.15, aim: 0.05, pickPause: 0.25, contest: 0.5, clutch: 0.5, ramp: 0.28, turnRamp: 0.15, courtesy: 0.6 },
  // Difícil: todo lo que da el robot, y se arrima a la Cámara más rápido y desde más cerca
  hard: { speed: 1, level: 3, critical: true, teamwork: true, reaction: 0.15, climbMargin: 2.5, batch: 10, sloppy: 0, steal: false, dockSpeed: 1.5, dockStage: 0.4, jitter: 0.1, aim: 0.015, pickPause: 0.1, contest: 1, clutch: 1, ramp: 0.18, turnRamp: 0.1, courtesy: 0.7 },
  // Experto: como Difícil, más robar Muestras de la Campana rival y margen justo en la Plataforma
  expert: { speed: 1, level: 3, critical: true, teamwork: true, reaction: 0.1, climbMargin: 1.8, batch: 10, sloppy: 0, steal: true, dockSpeed: 1.5, dockStage: 0.4, jitter: 0.05, aim: 0, pickPause: 0.05, contest: 1, clutch: 1, ramp: 0.14, turnRamp: 0.08, courtesy: 0.7 },
};
