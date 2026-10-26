/**
 * Tipos de robot de la IA en un match: los robots de la computadora usan tipos DISTINTOS entre sí
 * (y distintos al tuyo si alcanza), para que cada match tenga variedad. Solo tipos con mecanismo
 * para anotar: el chasis sin mecanismo (`chassis`) no es un rival digno, así que la IA no lo usa.
 */
import type { MechanismKind } from '../config/robot';

export const AI_TYPES: readonly MechanismKind[] = ['generic', 'elevator', 'pivot', 'tower'];

/**
 * Tipo de cada uno de los 4 robots (0–1 rojo, 2–3 azul): `player` lleva `playerType` (−1 = ninguno,
 * la IA maneja los 4) y los demás salen al azar de `AI_TYPES`, sin repetir mientras haya.
 */
export function aiLineup(player: number, playerType: MechanismKind, rand: () => number = Math.random): MechanismKind[] {
  const bots = [0, 1, 2, 3].filter((i) => i !== player).length;
  let pool = AI_TYPES.filter((k) => k !== playerType);
  if (pool.length < bots) pool = [...AI_TYPES];
  // Fisher–Yates
  const deck = [...pool];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let k = 0;
  return [0, 1, 2, 3].map((i) => (i === player ? playerType : deck[k++ % deck.length]));
}
