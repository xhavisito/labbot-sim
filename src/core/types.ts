/** Tipos compartidos de la lógica pura del juego (sin Three.js ni Rapier). */

export type Alliance = 'red' | 'blue';
export const ALLIANCES: readonly Alliance[] = ['red', 'blue'];
export const opponent = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

/** Niveles de la Cámara de Seguridad (§3.2.3). */
export type Level = 1 | 2 | 3;
export const LEVELS: readonly Level[] = [1, 2, 3];
