/**
 * Robot fijo del torneo: se elige al crearlo (queda en `TeamEntry.specId`) y todos sus matches
 * lo usan, sin importar el robot que se elija después en Singleplayer (`settings.robotType`).
 */
export interface TourPlayLike {
  tour?: boolean;
  /** Robot de cada estación (el del torneo para cada equipo). */
  robots: readonly string[];
}

/** Robot que maneja el jugador: el del torneo si el match es de torneo; si no, el de los ajustes. */
export function playerRobotFor<T extends string>(play: TourPlayLike | undefined, player: number, settingsRobot: T): T | string {
  if (play?.tour && player >= 0) return play.robots[player] ?? settingsRobot;
  return settingsRobot;
}
