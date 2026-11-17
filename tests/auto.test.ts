import { beforeAll, describe, expect, it } from 'vitest';
import { AutoExecutor } from '../src/auto/AutoExecutor';
import { DO_NOTHING, LEAVE_ZONE, PATH_COLLECT_1, PATH_COLLECT_2, PATH_SCORE_1, PATH_SCORE_2, mirrorWaypointZ, sanitizeRoutine, toAlliance, type AutoRoutine } from '../src/auto/AutoRoutine';
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
  const wps = PATH_SCORE_1.waypoints;
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
    expect(end.x).toBeCloseTo(wps[3].x, 1);
    expect(end.z).toBeCloseTo(wps[3].z, 1);
  });
  it('las rutinas incluidas no chocan con el campo ni cruzan la línea central', () => {
    for (const [r, z0] of [[PATH_SCORE_1, 0.495], [PATH_SCORE_2, -0.495], [PATH_COLLECT_1, 0.495], [PATH_COLLECT_2, -0.495]] as const) {
      const t = buildTrajectory({ x: -3.415, z: z0, heading: 0 }, r.waypoints, c);
      const issues = pathIssues(t.samples, 0.3, DEFAULT_ROBOT.length / 2);
      expect(issues.filter(Boolean), r.id).toEqual([]);
    }
  });
  it('detecta Plataforma, Cámara y línea central', () => {
    const at = (x: number, z: number) => pathIssues([{ x, z }], 0.3, 0.325)[0];
    expect(at(-1, 0)).toBe('platform');
    expect(at(-2.5, -3.2)).toBe('camara');
    expect(at(1.5, 0)).toBe('center');
    expect(at(-4.4, 0)).toBe('wall');
    expect(at(-3, 1)).toBeNull();
  });
});

describe('rutinas: guardado, importación y reflejo', () => {
  it('sanitizeRoutine recorta valores raros y rechaza basura', () => {
    expect(sanitizeRoutine({ nope: 1 })).toBeNull();
    expect(sanitizeRoutine({ waypoints: [{ x: 'a', z: 0 }] })).toBeNull();
    const r = sanitizeRoutine({ name: ' x '.repeat(40), speed: 9, waypoints: [{ x: 99, z: -99, heading: null, score: 3, wait: 99, intake: true, evil: 1 }] })!;
    expect(r.name.length).toBeLessThanOrEqual(48);
    expect(r.speed).toBe(1);
    expect(r.waypoints[0]).toEqual({ x: F.HALF_L, z: -F.HALF_W, heading: null, score: 3, wait: 15, intake: true });
    expect(sanitizeRoutine({ waypoints: [{ x: 0, z: 0, score: 7 }] })!.waypoints[0].score).toBeUndefined();
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
  it('Ruta suave · Anotar Nivel 3: llega, sube el elevador y anota la precarga en AUTO (≥ 18) y sigue jugando', () => {
    for (const player of [2, 3, 0, 1]) {
      const g = run(player, player % 2 === 0 ? PATH_SCORE_1 : PATH_SCORE_2, 14.9);
      const a = g.player.alliance;
      expect(g.match!.breakdown(a).samplesAuto, `robot ${player}`).toBeGreaterThanOrEqual(18);
      expect(g.match!.fouls).toEqual([]);
    }
  });
  it('nunca cruza la línea central en AUTO aunque la ruta lo pida', () => {
    const bad: AutoRoutine = { id: 'x', name: 'x', spline: true, waypoints: [{ x: -2.8, z: 2, heading: null }, { x: 1.5, z: 2, heading: null }] };
    const g = run(2, bad, 14);
    const x = g.player.phys.position().x;
    expect(x).toBeLessThan(0.1);
    expect(g.match!.fouls).toEqual([]);
  });
  it('Ruta suave · Recolectar y anotar: recoge una Muestra y anota en el Nivel 2', () => {
    for (const [player, r] of [[2, PATH_COLLECT_1], [3, PATH_COLLECT_2]] as const) {
      const g = run(player, r, 14.9);
      expect(g.match!.breakdown('blue').samplesAuto, `robot ${player}`).toBeGreaterThanOrEqual(10);
      expect(g.match!.fouls).toEqual([]);
    }
  });
  it('el ejecutor construye la vista previa para la alianza roja (rotada 180°)', () => {
    const g = new GameSession({ player: 0, preload: true, autos: [PATH_SCORE_1, DO_NOTHING, DO_NOTHING, DO_NOTHING] });
    const red = new AutoExecutor(g.robots[0], PATH_SCORE_1, g.pieces, g.robots);
    const blue = new AutoExecutor(g.robots[2], PATH_SCORE_1, g.pieces, g.robots);
    expect(red.preview.length).toBeGreaterThan(5);
    const a = red.preview[red.preview.length - 1];
    const b = blue.preview[blue.preview.length - 1];
    expect(a.x).toBeCloseTo(-b.x, 1);
    expect(a.z).toBeCloseTo(-b.z, 1);
  });
});
