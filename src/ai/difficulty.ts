/**
 * Dificultades de la IA para COMPARAR por lotes (`npm run ai-bench`). No cambian el comportamiento
 * normal: la IA del juego sigue usando las opciones por defecto de `Bot` (= "dificil").
 * SUPUESTO: el manual no define niveles de IA; estas tres son solo perfiles de prueba sobre las
 * opciones que ya tiene `Bot` (a qué Nivel anota y cuántas Muestras junta antes de ir a anotar).
 */
import type { BotOptions } from './Bot';

export type Difficulty = 'facil' | 'normal' | 'dificil';

export const DIFFICULTIES: Record<Difficulty, Partial<BotOptions>> = {
  facil: { level: 1, batch: 1 },
  normal: { level: 2, batch: 2 },
  dificil: { level: 3, batch: 3 }, // = valores por defecto de Bot
};

export function isDifficulty(x: string): x is Difficulty {
  return x in DIFFICULTIES;
}
