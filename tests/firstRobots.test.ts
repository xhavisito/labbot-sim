import { beforeAll, describe, expect, it } from 'vitest';
import { AUTO_ROUTINES } from '../src/auto/AutoRoutine';
import { Bot } from '../src/ai/Bot';
import { FIRST_ROBOTS, ROBOT_IDS, robotSpec } from '../src/config/firstRobots';
import { MECHANISM_KINDS, ROBOT_PRESETS, validateRobot } from '../src/config/robot';
import { sanitizeSettings } from '../src/config/settings';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { ALLIANCE_PLANS, runMatch } from '../src/sim/batch';

beforeAll(async () => {
  await initRapier();
});

describe('robots de referencia de FIRST', () => {
  it('todos cumplen los límites de LabBot (§7.2, §4.1) y citan su fuente', () => {
    for (const r of FIRST_ROBOTS) {
      expect(validateRobot(r.spec), r.id).toEqual([]);
      expect(r.spec.label, r.id).toBeTruthy();
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      expect(r.strategy.level).toBeLessThanOrEqual(r.spec.maxLevel ?? 3);
    }
  });

  it('se pueden elegir y guardar como tu robot o el de los demás', () => {
    expect(ROBOT_IDS).toEqual([...MECHANISM_KINDS, ...FIRST_ROBOTS.map((r) => r.id)]);
    const ids = AUTO_ROUTINES.map((r) => r.id);
    expect(sanitizeSettings({ robotType: 'skyfire254', botRobotType: 'everybot23' }, ids)).toMatchObject({ robotType: 'skyfire254', botRobotType: 'everybot23' });
    expect(sanitizeSettings({ robotType: 'r2d2' }, ids).robotType).toBe('generic');
    expect(robotSpec('pivot')).toBe(ROBOT_PRESETS.pivot);
    expect(robotSpec('lockdown254').label).toBe('254 Lockdown');
  });

  it('la IA de un robot que no llega a N3 anota en su nivel más alto', () => {
    const spec = robotSpec('everybot18');
    const g = new GameSession({ player: -1, preload: true, specs: [spec, spec, spec, spec] });
    const b = new Bot(g.robots[0], g.pieces, g.robots, { level: 3 });
    expect(b.opts.level).toBe(2);
  });

  it('una alianza de Everybot 2023 anota y no comete faltas de ENDGAME (§4.6)', () => {
    const plan = ALLIANCE_PLANS.find((p) => p.id === 'everybot23+everybot23')!;
    const r = runMatch(plan, plan, 1);
    expect(r.red.samples).toBeGreaterThan(0);
    expect(r.red.fouls.PLATFORM_EARLY ?? 0).toBe(0);
  }, 60_000);
});
