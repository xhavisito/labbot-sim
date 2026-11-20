import { beforeAll, describe, expect, it } from 'vitest';
import { COLLECT_HOME } from '../src/auto/AutoRoutine';
import { PIVOT_ROBOT } from '../src/config/robot';
import { GameSession } from '../src/game/GameSession';
import { initRapier } from '../src/physics/PhysicsWorld';
import { decodeReplay, encodeReplay, frameScore, frameTime, REPLAY_HZ, robotFrame, type Replay } from '../src/replay/format';
import { Recorder } from '../src/replay/Recorder';
import { ReplayPlayer } from '../src/replay/ReplayPlayer';
import { buildMoments, matchesFilter, momentTotals } from '../src/replay/moments';
import { frameAt, robotStats, totalSamples } from '../src/replay/stats';
import * as F from '../src/config/field';
import { distToRect } from '../src/core/scoreMap';

beforeAll(async () => {
  await initRapier();
});

/** Match de solo IA: 40 s simulados de verdad y luego el reloj salta al final. */
function recordMatch(): { replay: Replay; g: GameSession } {
  const g = new GameSession({ player: -1, preload: true, ai: true, specs: [PIVOT_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT, PIVOT_ROBOT], autos: [COLLECT_HOME, COLLECT_HOME, COLLECT_HOME, COLLECT_HOME] });
  g.startMatch();
  const rec = new Recorder(g, ['R1', 'R2', 'B1', 'B2']);
  g.tap = rec;
  for (let i = 0; i < 40 * 120; i++) g.step();
  g.match!.t = 149.95;
  g.match!.tick(0);
  for (let i = 0; i < 24 && !g.match!.finished; i++) g.step();
  expect(g.match!.finished).toBe(true);
  return { replay: rec.build(g), g };
}

describe('repeticiones', () => {
  let replay: Replay;
  let g: GameSession;
  beforeAll(() => {
    ({ replay, g } = recordMatch());
  });

  it('graba a REPLAY_HZ y termina con el marcador final', () => {
    const h = replay.header;
    // 40 s a 15 Hz (+ el cuadro del final)
    expect(h.frames).toBeGreaterThanOrEqual(40 * REPLAY_HZ);
    expect(h.frames).toBeLessThan(40 * REPLAY_HZ + 20);
    expect(frameTime(replay, 1) - frameTime(replay, 0)).toBeCloseTo(1 / REPLAY_HZ, 1);
    const last = frameScore(replay, h.frames - 1);
    expect(last.red).toBe(g.match!.score('red'));
    expect(last.blue).toBe(g.match!.score('blue'));
    expect(h.final).toEqual({ red: g.match!.score('red'), blue: g.match!.score('blue') });
  });

  it('cada Muestra anotada queda atribuida al robot que la soltó', () => {
    const scores = replay.events.filter((e) => e.type === 'score');
    const inMatch = g.match!.samplesIn('red') + g.match!.samplesIn('blue');
    expect(scores.length).toBe(inMatch);
    expect(inMatch).toBeGreaterThan(0);
    for (const e of scores) expect(e.robot).not.toBeNull();
    // Las estadísticas por robot suman lo mismo que el desglose del match (§4.4)
    const st = robotStats(replay);
    for (const a of ['red', 'blue'] as const) {
      const b = g.match!.breakdown(a);
      const mine = st.filter((s) => replay.header.robots[s.index].alliance === a);
      expect(mine.reduce((x, s) => x + s.samplePoints, 0)).toBe(b.samplesAuto + b.samplesTeleop);
      expect(mine.reduce((x, s) => x + totalSamples(s), 0)).toBe(g.match!.samplesIn(a));
    }
  });

  it('mapa de calor y distancia salen de las poses', () => {
    for (const s of robotStats(replay)) {
      const secs = s.heat.reduce((a, b) => a + b, 0);
      // Todo el tiempo grabado cae en alguna celda (el robot nunca sale de la cancha)
      expect(secs).toBeGreaterThan(35);
      expect(s.heatMax).toBeGreaterThan(0);
      expect(s.distance).toBeGreaterThan(1);
      expect(s.maxSpeed).toBeLessThanOrEqual(PIVOT_ROBOT.maxSpeed + 0.5);
    }
  });

  it('dónde anotó: un lugar por Muestra, cerca de su Cámara (§3.2.3)', () => {
    for (const s of robotStats(replay)) {
      expect(s.scoreSpots.length).toBe(s.scoreTimes.length);
      const cam = F.camaraRect(replay.header.robots[s.index].alliance);
      // El pivote suelta con el brazo estirado: el centro del robot queda a menos de ~1.5 m de la Cámara
      for (const p of s.scoreSpots) expect(distToRect(p.x, p.z, cam)).toBeLessThan(1.5);
    }
    expect(frameAt(replay, -5)).toBe(0);
    expect(frameAt(replay, 1e6)).toBe(replay.header.frames - 1);
    expect(frameTime(replay, frameAt(replay, 10))).toBeCloseTo(10, 0);
  });

  it('el archivo se lee igual que se escribió', () => {
    const back = decodeReplay(encodeReplay(replay));
    expect(back.header).toEqual(replay.header);
    expect(back.events).toEqual(replay.events);
    expect(Array.from(back.data)).toEqual(Array.from(replay.data));
    expect(() => decodeReplay(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });

  it('el reproductor pone a los robots donde estaban', () => {
    const p = new ReplayPlayer(replay);
    try {
      for (const f of [0, 100, 400]) {
        p.seek(frameTime(replay, f));
        p.session.robots.forEach((r, i) => {
          const want = robotFrame(replay, f, i);
          const at = r.phys.body.translation();
          expect(Math.hypot(at.x - want.x, at.z - want.z)).toBeLessThan(0.002);
          expect(r.mech.stored.length).toBe(want.stored);
        });
      }
      p.seek(1e9);
      expect(p.t).toBeCloseTo(p.duration);
      expect(p.scoreboard.red).toBe(replay.header.final.red);
    } finally {
      p.dispose();
    }
  });

  it('las jugadas clave suman el marcador final y el reproductor salta entre ellas', () => {
    const ms = buildMoments(replay);
    expect(ms.length).toBeGreaterThan(0);
    const tot = momentTotals(ms);
    for (const a of ['red', 'blue'] as const) {
      const b = g.match!.breakdown(a);
      if (!b.redCard) expect(tot[a]).toBe(b.total);
    }
    const p = new ReplayPlayer(replay);
    try {
      p.filter = 'points';
      const pts = ms.filter((m) => matchesFilter(m, 'points'));
      p.seek(0);
      const seen: number[] = [];
      for (let m = p.nextMoment(); m; m = p.nextMoment()) {
        seen.push(m.t);
        expect(p.t).toBeLessThanOrEqual(m.t);
        if (seen.length > 200) break;
      }
      // Recorre todas en orden, también las que pasan en el mismo instante (dos robots cruzan la línea a la vez)
      expect(seen).toEqual(pts.map((m) => m.t));
      expect(seen[seen.length - 1]).toBe(pts[pts.length - 1].t);
      const back = p.prevMoment();
      expect(back).not.toBeNull();
      expect(back!.t).toBeLessThan(seen[seen.length - 1]);
      // Resumen: al reproducir no se ve nada fuera de las ventanas
      p.seek(0);
      p.highlights = true;
      expect(p.t).toBeCloseTo(Math.max(0, pts[0].t - 3), 5);
      p.speed = 4;
      for (let i = 0; i < 2000 && p.playing; i++) {
        p.update(1 / 30);
        // (el Resumen une ventanas separadas por menos de 0.5 s: `highlightWindows`)
        if (p.playing) expect(pts.some((m) => p.t >= m.t - 3 - 0.5 && p.t <= m.t + 2 + 0.5)).toBe(true);
      }
      expect(p.playing).toBe(false);
      p.stepFrame(-1);
      expect(p.t).toBeCloseTo(p.duration - 1 / REPLAY_HZ, 5);
    } finally {
      p.dispose();
    }
  });
});
