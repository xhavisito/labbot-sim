import { describe, expect, it } from 'vitest';
import { PIVOT_ROBOT } from '../src/config/robot';
import { FRAME_HEAD, frameSize, PIECE_VALUES, ROBOT_VALUES, type Replay, type ReplayHeader } from '../src/replay/format';
import { clipFromReplay } from '../src/director/clip';

/** Repetición mínima de 150 s (2 cuadros) con los eventos que se le pasen. */
function fake(events: Replay['events'], matchEvents: Replay['matchEvents'], endgame: Partial<ReplayHeader['endgame']> = {}): Replay {
  const header: ReplayHeader = {
    format: 'labbot-rescue-replay',
    version: 1,
    createdAt: '2026-11-02T00:00:00Z',
    player: 0,
    robots: [
      { index: 0, alliance: 'red', station: 0, spec: PIVOT_ROBOT, label: 'R1' },
      { index: 1, alliance: 'red', station: 1, spec: PIVOT_ROBOT, label: 'R2' },
      { index: 2, alliance: 'blue', station: 0, spec: PIVOT_ROBOT, label: 'A1' },
      { index: 3, alliance: 'blue', station: 1, spec: PIVOT_ROBOT, label: 'A2' },
    ],
    pieces: [],
    frames: 2,
    final: { red: 0, blue: 0 },
    endgame: { platform: [], critical: { red: false, blue: false }, autoLine: [], ...endgame },
    meta: {},
  };
  const n = frameSize(header);
  expect(n).toBe(FRAME_HEAD + 4 * ROBOT_VALUES + 0 * PIECE_VALUES);
  const data = new Int16Array(2 * n);
  data[n] = 15000; // segundo cuadro en t = 150 s
  return { header, events, matchEvents, data };
}


describe('clipFromReplay (Director con repeticiones ★)', () => {
  it('dura todo el match, enfoca al jugador y marca la primera Muestra', () => {
    const r = fake([{ t: 42, type: 'score', robot: 1, alliance: 'red', level: 1, points: 5, period: 'TELEOP' }], []);
    r.header.player = 1;
    const c = clipFromReplay(r);
    expect(c.duration).toBe(150);
    expect(c.focus).toBe(1);
    expect(c.trigger).toBe(42);
    expect(c.replay).toBe(r);
  });
  it('sin jugadas ni robot propio: foco en el primero y marca al inicio', () => {
    const r = fake([], []);
    r.header.player = -1;
    const c = clipFromReplay(r);
    expect(c.focus).toBe(0);
    expect(c.trigger).toBe(0);
  });
});
