import { beforeAll, describe, expect, it } from 'vitest';
import { AutoExecutor } from '../src/auto/AutoExecutor';
import { DO_NOTHING, LEAVE_ZONE, type AutoRoutine } from '../src/auto/AutoRoutine';
import { BUILTIN_DESIGNS, designRoutine, mirrorWaypointZ, sanitizeDesign, toAlliance, type DesignedAuto } from '../src/auto/designed';
import { buildTrajectory, constraintsFor, pathIssues, sampleAt } from '../src/auto/Trajectory';
import * as F from '../src/config/field';
import { DEFAULT_ROBOT } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { emptyInput } from '../src/input/InputManager';
import { initRapier } from '../src/physics/PhysicsWorld';

beforeAll(async () => {
  await initRapier();
});

function run(player: number, routine: AutoRoutine, seconds: number) {
  const g = new GameSession({ player, preload: true, ai: false, autos: [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING].map((d, i) => (i === player ? routine : d)) });
  g.startMatch();
  for (let i = 0; i < seconds * 120; i++) {
    g.setInput(emptyInput());
    g.step();
  }
  return g;
}

describe('trayectoria (portada de rebuilt-sim)', () => {
  const c = constraintsFor(DEFAULT_ROBOT, 0.85);
  const SCORE_1 = BUILTIN_DESIGNS[0];
  const SCORE_2 = BUILTIN_DESIGNS[1];
  const wps = SCORE_1.waypoints;
  const tr = buildTrajectory({ x: -3.4, z: 0.5, heading: 0 }, wps, c);

  it('empieza y termina quieta, sin pasar de la velocidad máxima', () => {
    expect(tr.samples[0].v).toBe(0);
    expect(tr.samples[tr.samples.length - 1].v).toBe(0);
    expect(Math.max(...tr.samples.map((s) => s.v))).toBeLessThanOrEqual(c.maxVel + 1e-9);
    expect(tr.duration).toBeGreaterThan(2);
    expect(tr.duration).toBeLessThan(15);
  });
  it('sampleAt interpola y se queda en el final', () => {
    const mid = sampleAt(tr, tr.duration / 2);
    expect(mid.t).toBeCloseTo(tr.duration / 2);
    const end = sampleAt(tr, tr.duration + 5);
    expect(end.x).toBeCloseTo(wps[wps.length - 1].x, 1);
    expect(end.z).toBeCloseTo(wps[wps.length - 1].z, 1);
  });
  it('las rutinas incluidas no chocan con el campo', () => {
    for (const [r, z0] of [[SCORE_1, 0.495], [SCORE_2, -0.495]] as const) {
      const t = buildTrajectory({ x: -3.415, z: z0, heading: 0 }, r.waypoints, c);
      const issues = pathIssues(t.samples, 0.3);
      expect(issues.filter(Boolean), r.id).toEqual([]);
    }
  });
  it('detecta Plataforma, Cámaras, barras y paredes (y la línea central ya no estorba, §4.2)', () => {
    const at = (x: number, z: number) => pathIssues([{ x, z }], 0.3)[0];
    expect(at(-1, 0)).toBe('platform');
    expect(at(-2.5, -3.2)).toBe('camara');
    expect(at(2.5, 3.2)).toBe('camara');
    expect(at(-4.4, 0)).toBe('wall');
    expect(at(3, 0)).toBeNull();
    expect(at(0.2, 2)).toBeNull();
  });
});

describe('rutinas: guardado, importación y reflejo', () => {
  it('sanitizeDesign recorta valores raros y rechaza basura', () => {
    expect(sanitizeDesign({ nope: 1 })).toBeNull();
    expect(sanitizeDesign({ waypoints: [{ x: 'a', z: 0 }] })).toBeNull();
    const r = sanitizeDesign({ name: ' x '.repeat(40), speed: 9, waypoints: [{ x: 99, z: -99, heading: null, score: 3, wait: 99, intake: true, evil: 1 }] })!;
    expect(r.name.length).toBeLessThanOrEqual(48);
    expect(r.speed).toBe(1);
    expect(r.waypoints[0]).toEqual({ x: F.HALF_L, z: -F.HALF_W, heading: null, score: 3, wait: 15, intake: true });
    expect(sanitizeDesign({ waypoints: [{ x: 0, z: 0, score: 7, arm: 9 }] })!.waypoints[0]).toEqual({ x: 0, z: 0, heading: null });
  });
  it('mirrorWaypointZ y toAlliance son involuciones', () => {
    const w = { x: 1, z: 2, heading: 0.5, hout: { x: 0.1, z: 0.2 } };
    expect(mirrorWaypointZ(mirrorWaypointZ(w))).toEqual(w);
    expect(toAlliance('red', 1, 2, 0)).toEqual({ x: -1, z: -2, h: Math.PI });
    expect(toAlliance('blue', 1, 2, 0)).toEqual({ x: 1, z: 2, h: 0 });
  });
});

describe('AutoExecutor en el match', () => {
  it('Salir de la zona: cruza la línea desde cualquier Zona de Inicio, de cualquier alianza, y se queda', () => {
    for (const player of [0, 1, 2, 3]) {
      const g = run(player, LEAVE_ZONE, 8);
      expect(g.match!.breakdown(g.player.alliance).autoLine, `robot ${player}`).toBe(5);
      const x = g.player.phys.position().x;
      expect(Math.abs(x)).toBeLessThan(2.8);
      expect(Math.abs(x)).toBeGreaterThan(2.3);
    }
  });
  it('Ruta suave · Anotar Nivel 3: llega, sube el brazo y anota la precarga en AUTO (≥ 18) y sigue jugando', () => {
    for (const player of [2, 3, 0, 1]) {
      const g = run(player, designRoutine(player % 2 === 0 ? BUILTIN_DESIGNS[0] : BUILTIN_DESIGNS[1]), 14.9);
      const a = g.player.alliance;
      expect(g.match!.breakdown(a).samplesAuto, `robot ${player}`).toBeGreaterThanOrEqual(18);
      expect(g.match!.fouls).toEqual([]);
    }
  });
  it('puede cruzar la línea central en AUTO (el manual nuevo ya no la limita, §4.2)', () => {
    const far: DesignedAuto = { id: 'x', name: 'x', spline: true, speed: 1, waypoints: [{ x: -3.0, z: 1.4, heading: null }, { x: 1.5, z: 1.7, heading: null }] };
    const g = run(2, designRoutine(far), 8);
    expect(g.player.phys.position().x).toBeGreaterThan(0.3);
    expect(g.match!.fouls).toEqual([]);
  });
  it('una rutina "de cualquier lado" se refleja en z si el robot sale de la otra Zona de Inicio', () => {
    // Los waypoints están en z > 0 (salida 1); el robot 3 sale de la zona 2 (z < 0) y la rutina se refleja
    const r: DesignedAuto = { id: 'm', name: 'm', spline: true, mirrorToStart: true, waypoints: [{ x: -2.65, z: 0.495, heading: null }, { x: -2.9, z: 1.4, heading: null }] };
    const g = new GameSession({ player: 3, preload: true, ai: false, autos: [DO_NOTHING, DO_NOTHING, DO_NOTHING, designRoutine(r)] });
    g.startMatch();
    let minZ = 0;
    for (let i = 0; i < 3 * 120; i++) {
      g.setInput(emptyInput());
      g.step();
      minZ = Math.min(minZ, g.player.phys.position().z);
    }
    expect(minZ).toBeLessThan(-1.1);
  });
  it('el ejecutor construye la vista previa para la alianza roja (rotada 180°)', () => {
    const g = new GameSession({ player: 0, preload: true, autos: [DO_NOTHING, DO_NOTHING, DO_NOTHING, DO_NOTHING] });
    const red = new AutoExecutor(g.robots[0], BUILTIN_DESIGNS[0], g.pieces, g.robots);
    const blue = new AutoExecutor(g.robots[2], BUILTIN_DESIGNS[0], g.pieces, g.robots);
    expect(red.preview.length).toBeGreaterThan(5);
    const a = red.preview[red.preview.length - 1];
    const b = blue.preview[blue.preview.length - 1];
    expect(a.x).toBeCloseTo(-b.x, 1);
    expect(a.z).toBeCloseTo(-b.z, 1);
  });
});
