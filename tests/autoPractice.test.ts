import { beforeAll, describe, expect, it } from 'vitest';
import { AutoScorer, AUTO_STEPS, autoSession, randomOffsets, runRoutine, summarize } from '../src/auto/practice';
import { routeRoutine, rle, sanitizeRoute, TrackRecorder, unrle, type SavedRoute } from '../src/auto/recorded';
import { DEFAULT_ROBOT } from '../src/config/robot';
import { PHYSICS_HZ } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

/** Graba 15 s manejando: `forward` los primeros `secs` segundos, prende el intake en el paso 10. */
function record(player: number, forward: number, secs: number): { route: SavedRoute; final: { x: number; z: number }; points: number } {
  const s = autoSession(player, DEFAULT_ROBOT);
  const rec = new TrackRecorder(PHYSICS_HZ, AUTO_STEPS);
  const sc = new AutoScorer(s);
  s.inputTap = rec.push;
  s.tap = sc;
  for (let i = 0; i < AUTO_STEPS; i++) {
    s.setInput({ ...emptyInput(), forward: i < secs * PHYSICS_HZ ? forward : 0, toggleIntake: i === 10 });
    s.step();
  }
  const r = sc.result(s);
  s.dispose();
  return { route: { id: 'test', name: 'Prueba', createdAt: '', robot: '', station: 0, track: rec.track }, final: r.final, points: r.points };
}

describe('práctica de AUTO', () => {
  it('RLE ida y vuelta', () => {
    const a = [0, 0, 0, 500, 500, -1000, 0];
    expect(rle(a)).toEqual([0, 3, 500, 2, -1000, 1, 0, 1]);
    expect(unrle(rle(a))).toEqual(a);
  });

  it('la ruta grabada se repite igual y cruza la línea (§4.4, D1)', () => {
    const rec = record(0, 0.5, 1);
    expect(rec.route.track.forward.length).toBe(AUTO_STEPS);
    expect(rec.route.track.actions).toEqual([{ i: 10, intake: true }]);
    const res = runRoutine(0, DEFAULT_ROBOT, routeRoutine(rec.route));
    expect(res.line).toBe(true);
    expect(res.points).toBe(5);
    expect(res.center).toBe(false);
    expect(res.startOk).toBe(true);
    expect(Math.hypot(res.final.x - rec.final.x, res.final.z - rec.final.z)).toBeLessThan(0.01);
  });

  it('también sirve para azul (cancha simétrica) y se guarda/lee', () => {
    const rec = record(2, 0.5, 1);
    const back = sanitizeRoute(JSON.parse(JSON.stringify({ ...rec.route, track: { ...rec.route.track, forward: rle(rec.route.track.forward), turn: rle(rec.route.track.turn) } })));
    expect(back?.track.forward).toEqual(rec.route.track.forward);
    const res = runRoutine(2, DEFAULT_ROBOT, routeRoutine(back!));
    expect(res.final.x).toBeCloseTo(rec.final.x, 2);
    expect(sanitizeRoute({ id: '../x', track: {} })).toBeNull();
  });

  it('marca la línea central (§4.2) y la salida fuera de la zona (§4.1)', () => {
    const rec = record(0, 1, 3);
    // Desde su zona choca con la rampa de la Plataforma; 65 cm a la derecha pasa junto a ella
    const base = runRoutine(0, DEFAULT_ROBOT, routeRoutine(rec.route));
    expect(base.center).toBe(false);
    const off = runRoutine(0, DEFAULT_ROBOT, routeRoutine(rec.route), { forward: 0, right: 0.65, turn: 0 });
    expect(off.startOk).toBe(false);
    expect(off.center).toBe(true);
  });

  it('variaciones de unos cm: resumen', () => {
    const rec = record(0, 0.5, 1);
    const routine = routeRoutine(rec.route);
    const base = runRoutine(0, DEFAULT_ROBOT, routine);
    const offs = randomOffsets(3, 3, 2);
    expect(offs.every((o) => Math.abs(o.forward) <= 0.03 && Math.abs(o.right) <= 0.03)).toBe(true);
    const sum = summarize(base, offs.map((o) => runRoutine(0, DEFAULT_ROBOT, routine, o)));
    expect(sum.runs.length).toBe(3);
    expect(sum.sameRate).toBe(1);
    expect(sum.maxDrift).toBeLessThan(0.3);
  });
});
