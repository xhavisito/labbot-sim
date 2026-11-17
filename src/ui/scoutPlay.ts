import type { MechanismKind } from '../config/robot';

/** Partido del torneo que se juega en el simulador (equipos, tipos de robot y quién maneja). */
export interface ScoutPlay {
  match: string;
  teams: string[];
  kinds: MechanismKind[];
  /** Robot que manejas (0–3); −1 = solo ver (la IA maneja los 4). */
  player: number;
  /** Match del modo torneo (`ui/TournamentScreen.ts`): el resultado va al torneo. */
  tour?: boolean;
}
