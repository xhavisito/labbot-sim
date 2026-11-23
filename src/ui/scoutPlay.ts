/** Partido del torneo que se juega en el simulador (equipos, robots y quién maneja). */
export interface ScoutPlay {
  match: string;
  teams: string[];
  /** Robot de cada estación (`RobotId`: los CAD del torneo, `cad:<nombre>`). */
  robots: string[];
  /** Robot que manejas (0–3); −1 = solo ver (la IA maneja los 4). */
  player: number;
  /** Match del modo torneo (`ui/TournamentScreen.ts`): el resultado va al torneo. */
  tour?: boolean;
  /** Semilla del torneo del match: el resultado solo se guarda en ese torneo (no en uno nuevo). */
  tourSeed?: number;
}
