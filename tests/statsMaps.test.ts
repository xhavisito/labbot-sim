import { beforeAll, describe, expect, it } from 'vitest';
import { COLLECT_HOME } from '../src/auto/AutoRoutine';
import { PIVOT_ROBOT } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { Recorder } from '../src/replay/Recorder';
import type { Replay } from '../src/replay/format';
import { robotStats } from '../src/replay/stats';
import { drawHeatmap, drawScoreSpots } from '../src/ui/StatsPanel';

beforeAll(async () => {
  await initRapier();
});

/** Lienzo falso que cuenta lo que se dibuja con colores de robot (rgba) y los puntos (arc). */
function fakeCanvas(): { cv: HTMLCanvasElement; cells: () => number; dots: () => number } {
  let cells = 0;
  let dots = 0;
  let fill = '';
  const g = new Proxy({} as Record<string, unknown>, {
    get: (o, k) => {
      if (k === 'fillRect') return () => void (fill.startsWith('rgba(') && /,0\.\d+\)$/.test(fill) && (cells += 1));
      if (k === 'arc') return () => void (dots += 1);
      return typeof o[k as string] === 'undefined' ? () => undefined : o[k as string];
    },
    set: (o, k, v) => {
      if (k === 'fillStyle') fill = String(v);
      o[k as string] = v;
      return true;
    },
  });
  return { cv: { width: 720, height: 560, getContext: () => g } as unknown as HTMLCanvasElement, cells: () => cells, dots: () => dots };
}

function recordMatch(): Replay {
  const g = new GameSession({ player: -1, preload: true, ai: true, specs: [PIVOT_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT], autos: [COLLECT_HOME, COLLECT_HOME, COLLECT_HOME, COLLECT_HOME] });
  g.startMatch();
  const rec = new Recorder(g, ['R1', 'R2', 'B1', 'B2']);
  g.tap = rec;
  for (let i = 0; i < 40 * 120; i++) g.step();
  g.match!.t = 149.95;
  g.match!.tick(0);
  for (let i = 0; i < 24 && !g.match!.finished; i++) g.step();
  return rec.build(g);
}

describe('mapas de las estadísticas', () => {
  let replay: Replay;
  beforeAll(() => {
    replay = recordMatch();
  }, 120_000);

  it('el mapa de calor y el de dónde anotó dibujan a cada robot (y a todos)', () => {
    const stats = robotStats(replay);
    for (const only of [0, 1, 2, 3, null]) {
      const h = fakeCanvas();
      drawHeatmap(h.cv, replay, stats, only);
      expect(h.cells()).toBeGreaterThan(0);
      const s = fakeCanvas();
      drawScoreSpots(s.cv, replay, stats, only);
      expect(s.dots()).toBeGreaterThan(0);
    }
  });

  it('con un solo robot en la lista (práctica) el filtro es por lugar, no por número de robot', () => {
    const all = robotStats(replay);
    const pos = 2;
    expect(all[pos].index).toBe(replay.header.robots[pos].index);
    // Lista de un solo robot cuyo número de robot (2) no es su lugar (0), como en una práctica en solitario
    const solo = { ...replay, header: { ...replay.header, robots: [replay.header.robots[pos]] } } as Replay;
    const stats = [all[pos]];
    expect(stats[0].index).not.toBe(0);
    const h = fakeCanvas();
    drawHeatmap(h.cv, solo, stats, 0);
    expect(h.cells()).toBeGreaterThan(0);
    const s = fakeCanvas();
    drawScoreSpots(s.cv, solo, stats, 0);
    expect(s.dots()).toBe(stats[0].scoreSpots.length);
    expect(s.dots()).toBeGreaterThan(0);
  });
});
