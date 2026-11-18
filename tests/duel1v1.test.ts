import { beforeAll, describe, expect, it } from 'vitest';
import { LEAVE_ZONE, DO_NOTHING } from '../src/auto/AutoRoutine';
import { DEFAULT_DURATION, GAME, gameWithDuration, MATCH_DURATIONS } from '../src/config/game';
import { allRobotIds, robotSpec } from '../src/config/robotIds';
import { sanitizeVersus } from '../src/config/settings';
import { bounds } from '../src/core/clock';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';
import { lineup, partnerStation } from '../src/ui/versus';

beforeAll(async () => {
  await initRapier();
});

const run = (g: GameSession, s: number) => {
  for (let i = 0; i < s * 120; i++) {
    g.setInput(emptyInput());
    g.setInput2(emptyInput());
    g.step();
  }
};

describe('1 contra 1: duración del match', () => {
  it('150 s es el reglamento (15 s + 135 s) y devuelve GAME tal cual', () => {
    expect(DEFAULT_DURATION).toBe(GAME.times.auto + GAME.times.teleop);
    expect(gameWithDuration(150)).toBe(GAME);
  });

  it('otra duración cambia solo el TELEOP: AUTO 15 s y ENDGAME los últimos 30 s', () => {
    for (const d of MATCH_DURATIONS) {
      const g = gameWithDuration(d);
      const b = bounds(g);
      expect(b.autoEnd).toBe(15);
      expect(b.teleopEnd).toBe(d);
      expect(b.teleopEnd - b.endgameStart).toBe(30);
      expect(b.endgameStart).toBeGreaterThanOrEqual(b.teleopStart);
    }
    expect(gameWithDuration(7)).toBe(GAME);
  });

  it('lo guardado se sanea: duración rara vuelve a 150 y "duel" es un modo válido', () => {
    expect(sanitizeVersus({ duration: 999 }, ['leave']).duration).toBe(150);
    expect(sanitizeVersus({ duration: 90, team: 'duel' }, ['leave'])).toMatchObject({ duration: 90, team: 'duel' });
    expect(partnerStation(0, 'duel')).toBe(2);
    expect(lineup(0, 'duel')).toEqual(['p1', 'ai', 'p2', 'ai']);
  });
});

describe('1 contra 1: match con dos robots', () => {
  const ids = allRobotIds();
  const make = (stations: [number, number], duration = 60) =>
    new GameSession({
      player: stations[0],
      player2: stations[1],
      preload: true,
      ai: false,
      stations,
      game: gameWithDuration(duration),
      autos: [LEAVE_ZONE, DO_NOTHING, DO_NOTHING, DO_NOTHING],
      specs: Object.assign([], { [stations[0]]: robotSpec(ids[0]), [stations[1]]: robotSpec(ids[ids.length - 1]) }),
    });

  it('solo existen los dos robots, uno por alianza, cada uno con su robot', () => {
    const g = make([0, 2]);
    expect(g.robots.map((r) => r.index)).toEqual([0, 2]);
    expect(g.robots.map((r) => r.alliance)).toEqual(['red', 'blue']);
    expect(g.player2?.index).toBe(2);
    expect(g.robots[0].spec.name).toBe(robotSpec(ids[0]).name);
    expect(g.robots[1].spec.name).toBe(robotSpec(ids[ids.length - 1]).name);
  });

  it('el match corre con la duración elegida y la línea de AUTO cuenta con un robot por alianza', () => {
    const g = make([0, 2], 60);
    g.startMatch();
    expect(g.match!.autoLineNeeded).toBe(1);
    run(g, 16); // AUTO: el rojo sale de su zona, el azul no
    expect(g.match!.state.red.autoLine.size).toBe(1);
    expect(g.match!.state.blue.autoLine.size).toBe(0);
    expect(g.match!.rankingPoints('red').autoLine).toBe(true);
    expect(g.match!.rankingPoints('blue').autoLine).toBe(false);
    run(g, 60); // pasa de 60 s en total
    expect(g.match!.finished).toBe(true);
    expect(g.match!.t).toBeLessThan(62);
  }, 60000); // simula 76 s de match: con el CI cargado pasaba de los 5 s por defecto

  it('también con las estaciones 1 y 3 (en 2 contra 2 siguen los 4)', () => {
    const g = make([1, 3]);
    g.startMatch();
    expect(g.robots.map((r) => r.index)).toEqual([1, 3]);
    run(g, 1);
    const full = new GameSession({ player: 0, preload: true });
    expect(full.robots).toHaveLength(4);
  });
});
