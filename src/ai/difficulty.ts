/**
 * Dificultad de la IA. Las reglas no cambian (el árbitro cobra igual); cambia qué tan rápido y qué
 * tan bien juega cada robot de la computadora. Todos los números son SUPUESTOS de diseño del
 * simulador (el manual no habla de IA); se calibraron con `npm run batch -- --set ai --a <nivel> --b old`.
 */
import type { Level } from '../core/types';

export type AiLevel = 'easy' | 'normal' | 'hard';
export const AI_LEVELS: readonly AiLevel[] = ['easy', 'normal', 'hard'];

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
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  // Fácil: lento, anota en N2, no va por la Crítica ni se coordina; sube temprano a la Plataforma
  easy: { speed: 0.55, level: 2, critical: false, teamwork: false, reaction: 0.9, climbMargin: 14, batch: 2, sloppy: 0.06 },
  // Normal: N3 y la Crítica, con algo de duda y margen
  normal: { speed: 0.8, level: 3, critical: true, teamwork: true, reaction: 0.35, climbMargin: 6, batch: 4, sloppy: 0.02 },
  // Difícil: todo lo que da el robot
  hard: { speed: 1, level: 3, critical: true, teamwork: true, reaction: 0, climbMargin: 2.5, batch: 10, sloppy: 0 },
};
