import { describe, expect, it } from 'vitest';
import { playerRobotFor } from '../src/core/tourRobot';

describe('robot fijo del torneo', () => {
  const play = { tour: true, robots: ['cad:A', 'cad:B', 'cad:C', 'cad:D'] };
  it('un match de torneo usa el robot del torneo aunque Singleplayer tenga otro', () => {
    let settingsRobot = 'cad:A'; // elegido al crear el torneo
    expect(playerRobotFor(play, 0, settingsRobot)).toBe('cad:A');
    settingsRobot = 'cad:Z'; // cambia en Singleplayer
    expect(playerRobotFor(play, 0, settingsRobot)).toBe('cad:A');
  });
  it('fuera del torneo (o solo viendo) manda el robot de los ajustes', () => {
    expect(playerRobotFor(undefined, 0, 'cad:Z')).toBe('cad:Z');
    expect(playerRobotFor({ ...play, tour: false }, 0, 'cad:Z')).toBe('cad:Z');
    expect(playerRobotFor(play, -1, 'cad:Z')).toBe('cad:Z');
  });
});
