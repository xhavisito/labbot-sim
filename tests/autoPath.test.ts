import { beforeAll, describe, expect, it } from 'vitest';
import { runVsAi, summarizeVsAi } from '../src/auto/pathTest';
import { runRoutine } from '../src/auto/practice';
import { posTip, ROBOT_PRESETS, type RobotSpec } from '../src/config/robot';
import { AUTO_MIN_X } from '../src/core/plan';
import { backOffPoint, estimatePath, newPath, newPoint, pathIssues, pickupPoints, sanitizePath, sanitizePaths, scoringPoint, type AutoPath } from '../src/core/autoPath';
import { loadSettings, sanitizeSettings } from '../src/config/settings';
import { pathRoutine } from '../src/game/autoPathStore';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

const tip = (s: RobotSpec, l: 0 | 1 | 2 | 3) => Math.abs(posTip(s, l).x);

/** Anota la precarga en N3, recoge una Muestra del Laboratorio y la anota. */
function twoSamples(spec: RobotSpec, station: 0 | 1): AutoPath {
  const p = newPath('Dos', station, 't1');
  const sp = scoringPoint(3, tip(spec, 3), spec.length / 2);
  const bo = backOffPoint(sp, 0.6);
  p.points.push(sp, bo, ...pickupPoints(1.46, 2.4, bo, tip(spec, 0), !!spec.arm.pickBack), { ...sp, intake: null });
  return p;
}

describe('rutinas de AUTO dibujadas (core/autoPath)', () => {
  it('sanea lo guardado: dentro de la cancha, de tu lado de la línea central (§4.2), límites', () => {
    const p = sanitizePath({
      id: 'ok-1',
      name: '  Mi AUTO ',
      station: 1,
      points: [{ x: -3, z: 99, speed: 5, wait: 99, arm: 9, face: 10 }, 'basura', { x: 2, z: 0, arm: 3, release: true }],
    })!;
    expect(p.name).toBe('Mi AUTO');
    expect(p.station).toBe(1);
    expect(p.points.length).toBe(2);
    expect(p.points[0].x).toBe(AUTO_MIN_X);
    expect(p.points[0].z).toBeLessThan(3.5);
    expect(p.points[0].speed).toBe(1);
    expect(p.points[0].wait).toBe(5);
    expect(p.points[0].arm).toBeNull();
    expect(Math.abs(p.points[0].face!)).toBeLessThanOrEqual(Math.PI);
    expect(p.points[1].release).toBe(true);
    expect(sanitizePath({ name: 'sin id' })).toBeNull();
    expect(sanitizePath({ id: 'a b' })).toBeNull();
    expect(sanitizePaths([{ id: 'a' }, { id: 'a' }, null]).length).toBe(1);
    expect(sanitizePath({ id: 'z', points: Array.from({ length: 40 }, () => ({ x: 2, z: 0 })) })!.points.length).toBe(16);
  });

  it('avisa lo que el manual prohíbe o no da puntos', () => {
    const spec = ROBOT_PRESETS.pivot;
    const empty = newPath('x');
    expect(pathIssues(empty, spec).map((i) => i.code)).toEqual(['noPoints']);
    const stay = newPath('x', 0, 'a');
    stay.points.push(newPoint(3.4, -0.5));
    expect(pathIssues(stay, spec).map((i) => i.code)).toContain('noLeave'); // §4.4, D1
    const plat = newPath('x', 0, 'b');
    plat.points.push(newPoint(0.5, 0.2)); // sobre la rampa de la Plataforma (§4.6)
    expect(pathIssues(plat, spec).map((i) => i.code)).toContain('platform');
    const long = newPath('x', 0, 'c');
    for (let i = 0; i < 8; i++) long.points.push({ ...newPoint(i % 2 ? 1 : 2.5, 1), wait: 5 });
    expect(pathIssues(long, spec).map((i) => i.code)).toContain('tooLong'); // §4.2: 15 s
    const ok = newPath('x', 0, 'd');
    ok.points.push(newPoint(2.2, 1.2));
    expect(pathIssues(ok, spec)).toEqual([]);
  });

  it('estima el tiempo con esperas y crece con más puntos', () => {
    const spec = ROBOT_PRESETS.pivot;
    const p = twoSamples(spec, 1);
    const e = estimatePath(p, spec);
    expect(e.at.length).toBe(p.points.length);
    expect(e.total).toBeGreaterThan(3);
    expect(e.total).toBeLessThan(15);
    expect([...e.at].sort((a, b) => a - b)).toEqual(e.at);
  });
});

describe('seguidor de trayectoria en la física', () => {
  for (const kind of ['pivot', 'pivot180'] as const) {
    it(`${kind}: anota la precarga y una Muestra del Laboratorio en N3 (§4.4: 18 + 18... AUTO)`, () => {
      const spec = ROBOT_PRESETS[kind];
      for (const station of [0, 1] as const) {
        const r = runRoutine(station, spec, pathRoutine(twoSamples(spec, station)));
        expect(r.samples[3]).toBe(2);
        expect(r.line).toBe(true);
        expect(r.center).toBe(false);
        expect(r.points).toBe(5 + 2 * 18);
      }
    });
  }

  it('también para azul (cancha simétrica) y aguanta salir unos cm movido', () => {
    const spec = ROBOT_PRESETS.pivot;
    const p = newPath('Línea', 0, 'l');
    p.points.push(newPoint(2.0, 0.5));
    for (const player of [0, 2]) {
      const r = runRoutine(player, spec, pathRoutine(p), { forward: 0.03, right: -0.04, turn: 0.1 });
      expect(r.line).toBe(true);
      expect(r.center).toBe(false);
      expect(Math.abs(r.final.x)).toBeGreaterThan(1.9);
      expect(Math.abs(r.final.x)).toBeLessThan(2.3);
    }
  });
});

describe('probar contra la IA', () => {
  it('corre el AUTO de un match completo y cuenta puntos y faltas', () => {
    const spec = ROBOT_PRESETS.pivot;
    const run = runVsAi(twoSamples(spec, 0), spec, 1);
    expect(run.line).toBe(true);
    // La IA de tu compañero también juega: la Muestra del Laboratorio puede ganársela él
    expect(run.samples).toBeGreaterThanOrEqual(1);
    expect(run.mine).toBeGreaterThanOrEqual(5 + 18);
    expect(run.fouls).toBe(0);
    const s = summarizeVsAi([{ ...run, rival: 0 }, { ...run, mine: 0, rival: 10, line: false }]);
    expect(s.wins).toBe(1);
    expect(s.lineRate).toBe(0.5);
  });

  it('la rutina elegida es una opción válida en Ajustes', () => {
    const id = pathRoutine(newPath('x', 0, 'abc')).id;
    expect(sanitizeSettings({ playerAuto: id }, [id]).playerAuto).toBe(id);
    expect(loadSettings([id])).toBeTruthy();
  });
});
