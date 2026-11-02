import { beforeAll, describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { DEFAULT_ROBOT } from '../src/config/robot';
import { Match } from '../src/core/match';
import {
  applyScenario,
  evaluate,
  parseScenarioProgress,
  recordScenario,
  scenarioBest,
  emptyScenarioProgress,
  scenarioById,
  scenarioMedal,
  SCENARIOS,
  seedFor,
  seedPoints,
} from '../src/core/scenarios';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';

describe('escenarios (lógica pura)', () => {
  it('los marcadores de arranque son los descritos (§4.4)', () => {
    const pts = (id: string, a: 'red' | 'blue') => seedPoints(GAME, seedFor(scenarioById(id)!, a, 'red'));
    expect([pts('tieLast20', 'red'), pts('tieLast20', 'blue')]).toEqual([87, 87]);
    expect([pts('platformPending', 'red'), pts('platformPending', 'blue')]).toEqual([66, 75]);
    expect([pts('criticalRace', 'red'), pts('criticalRace', 'blue')]).toEqual([60, 60]);
    expect([pts('dominanceChase', 'red'), pts('dominanceChase', 'blue')]).toEqual([34, 45]);
    expect([pts('comeback', 'red'), pts('comeback', 'blue')]).toEqual([45, 81]);
  });

  it('empiezan dentro del TELEOP y con cortes en orden', () => {
    for (const s of SCENARIOS) {
      expect(s.at).toBeGreaterThanOrEqual(GAME.times.auto);
      expect(s.at).toBeLessThan(GAME.times.auto + GAME.times.teleop);
      expect(s.medals[0]).toBeLessThanOrEqual(s.medals[1]);
      expect(s.medals[1]).toBeLessThanOrEqual(s.medals[2]);
    }
    expect(scenarioById('criticalRace')!.at).toBe(GAME.times.auto + GAME.times.teleop - GAME.times.endgame);
    expect(scenarioById('tieLast20')!.at).toBe(150 - 20);
  });

  it('applyScenario arma el marcador y la fase, también para azul', () => {
    for (const me of ['red', 'blue'] as const) {
      const m = new Match(GAME, 2);
      m.start();
      m.tick(0);
      applyScenario(m, scenarioById('dominanceChase')!, me);
      expect(m.phase).toBe('TELEOP');
      expect(m.t).toBe(105);
      expect(m.score(me)).toBe(34);
      expect(m.samplesIn(me)).toBe(9);
      expect(m.rankingPoints(me).dominance).toBe(false);
      m.scoreSample(me, 1);
      expect(m.rankingPoints(me).dominance).toBe(true);
    }
  });

  it('el ENDGAME empieza en criticalRace', () => {
    const m = new Match(GAME, 2);
    m.start();
    applyScenario(m, scenarioById('criticalRace')!, 'red');
    expect(m.phase).toBe('ENDGAME');
  });

  it('medalla: sin la meta nada; con ella, por margen', () => {
    const s = scenarioById('tieLast20')!;
    expect(scenarioMedal(s, { diff: 30, met: false })).toBeNull();
    expect(scenarioMedal(s, { diff: 1, met: true })).toBe('bronze');
    expect(scenarioMedal(s, { diff: 12, met: true })).toBe('silver');
    expect(scenarioMedal(s, { diff: 25, met: true })).toBe('gold');
    const d = scenarioById('dominanceChase')!;
    expect(scenarioMedal(d, { diff: -11, met: true })).toBe('bronze');
    expect(scenarioMedal(d, { diff: 0, met: true })).toBe('silver');
  });

  it('evaluate: ganar y Dominio', () => {
    const m = new Match(GAME, 2);
    m.start();
    applyScenario(m, scenarioById('tieLast20')!, 'red');
    expect(evaluate(m, scenarioById('tieLast20')!, 'red')).toEqual({ diff: 0, met: false });
    m.scoreSample('red', 3);
    expect(evaluate(m, scenarioById('tieLast20')!, 'red')).toEqual({ diff: 15, met: true });
    expect(evaluate(m, scenarioById('tieLast20')!, 'blue').met).toBe(false);
  });

  it('récords: mejor margen, intentos y lectura segura', () => {
    const p = emptyScenarioProgress();
    const s = scenarioById('comeback')!;
    expect(recordScenario(p, s, 'pivot', { diff: -5, met: false }).improved).toBe(false);
    expect(scenarioBest(p, 'comeback', 'pivot')).toBeNull();
    expect(recordScenario(p, s, 'pivot', { diff: 4, met: true }).improved).toBe(true);
    expect(recordScenario(p, s, 'pivot', { diff: 2, met: true }).improved).toBe(false);
    expect(recordScenario(p, s, 'pivot', { diff: 11, met: true })).toEqual({ medal: 'silver', improved: true });
    const b = scenarioBest(p, 'comeback', 'pivot')!;
    expect([b.best, b.runs, b.wins]).toEqual([11, 4, 3]);
    expect(scenarioBest(parseScenarioProgress(JSON.stringify(p)), 'comeback', 'pivot')?.best).toBe(11);
    expect(parseScenarioProgress('basura').records).toEqual({});
  });
});

describe('escenarios sobre la física', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('startScenario deja el match a mitad con el robot frente a la Cámara', () => {
    const s = new GameSession({ player: 0, preload: true, ai: true, specs: [DEFAULT_ROBOT, DEFAULT_ROBOT, DEFAULT_ROBOT, DEFAULT_ROBOT] });
    const sc = scenarioById('tieLast20')!;
    const z0 = s.player.phys.position().z;
    s.startScenario(sc);
    expect(s.match!.phase).toBe('ENDGAME');
    expect(s.match!.t).toBe(130);
    expect(s.match!.score('red')).toBe(87);
    expect(s.player.phys.position().z).not.toBe(z0);
    for (let i = 0; i < 120; i++) s.step();
    expect(s.match!.t).toBeCloseTo(131, 1);
    s.dispose();
  });
});
