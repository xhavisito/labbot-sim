import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { buildMatchLog, explainRp, type TimedEvent } from '../src/core/matchLog';
import { Match } from '../src/core/match';

function play(setup: (m: Match, ev: TimedEvent[]) => void): { m: Match; ev: TimedEvent[] } {
  const m = new Match(GAME, 2);
  const ev: TimedEvent[] = [];
  const pump = () => m.tick(0.1).forEach((e) => ev.push({ ...e, t: m.t }));
  m.start();
  pump();
  setup(m, ev);
  pump();
  return { m, ev };
}

describe('registro del match', () => {
  it('explica los RP con cifras', () => {
    const { m, ev } = play((m) => {
      m.crossAutoLine('red', 1);
      m.crossAutoLine('red', 2);
      for (let i = 0; i < 10; i++) m.scoreSample('red', 1);
      m.scoreSample('blue', 1);
      m.finish({ red: 0, blue: 0 }, { red: false, blue: false });
    });
    const r = explainRp(m, 'red', ev);
    expect(r.map((x) => x.earned)).toEqual([2, 1, 0, 1]);
    expect(r[0]!.why).toMatch(/^Ganó/);
    const b = explainRp(m, 'blue', ev);
    expect(b[0]!.earned).toBe(0);
    expect(b[0]!.why).toMatch(/Perdió/);
    expect(b[1]!.why).toMatch(/0 de 2/);
    expect(b[3]!.why).toMatch(/faltaron 9/);
  });

  it('el JSON incluye razones, eventos con tiempo y total consistente', () => {
    const { m, ev } = play((m) => {
      m.scoreSample('red', 2);
      m.finish({ red: 1, blue: 0 }, { red: false, blue: false });
    });
    const log = JSON.parse(JSON.stringify(buildMatchLog(m, ev, { player: 'x' })));
    expect(log.format).toBe('labbot-rescue-match');
    expect(log.alliances.red.rpReasons).toHaveLength(4);
    const sum = log.alliances.red.rpReasons.reduce((s: number, x: { earned: number }) => s + x.earned, 0);
    expect(sum).toBe(log.alliances.red.rankingPoints.total);
    expect(log.events.every((e: { t: number }) => typeof e.t === 'number')).toBe(true);
  });
});
