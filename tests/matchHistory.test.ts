import { describe, expect, it } from 'vitest';
import { addMatchHistory, filterMatchHistory, historyFacets, MATCH_HISTORY_MAX, loadMatchHistory, sanitizeMatchHistory, type MatchHistoryEntry, type MatchHistoryStore } from '../src/core/matchHistory';

const mem = (): MatchHistoryStore => {
  const d: Record<string, string> = {};
  return { getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const e = (date: string, red = 10, blue = 5): MatchHistoryEntry => ({
  date, mode: 'match', player: 0, playerRobot: 'generic', botRobot: 'pivot', score: { red, blue }, rp: { red: 2, blue: 0 },
});

describe('historial', () => {
  it('basura → lista vacía; descarta entradas inválidas', () => {
    expect(sanitizeMatchHistory(null)).toEqual([]);
    expect(sanitizeMatchHistory([1, { date: 'x' }, e('2026-01-01T00:00:00Z')])).toHaveLength(1);
    expect(loadMatchHistory(mem())).toEqual([]);
  });

  it('ordena del más reciente al más antiguo', () => {
    const s = mem();
    addMatchHistory(e('2026-01-02T00:00:00Z'), s);
    addMatchHistory(e('2026-01-03T00:00:00Z'), s);
    const l = addMatchHistory(e('2026-01-01T00:00:00Z'), s);
    expect(l.map((x) => x.date)).toEqual(['2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z']);
    expect(loadMatchHistory(s)).toEqual(l);
  });

  it('guarda como máximo MATCH_HISTORY_MAX partidas', () => {
    const s = mem();
    for (let i = 0; i < MATCH_HISTORY_MAX + 5; i++) addMatchHistory(e(new Date(2026, 0, 1, 0, i).toISOString()), s);
    expect(loadMatchHistory(s)).toHaveLength(MATCH_HISTORY_MAX);
  });
});

describe('filtro del historial', () => {
  const l = [{ ...e('2026-01-01T00:00:00Z'), mode: 'practice' }, { ...e('2026-01-02T00:00:00Z'), playerRobot: 'pivot' }];
  it('filtra por modo y por robot', () => {
    expect(filterMatchHistory(l, {})).toHaveLength(2);
    expect(filterMatchHistory(l, { mode: 'practice' })).toHaveLength(1);
    expect(filterMatchHistory(l, { robot: 'pivot' })).toHaveLength(1);
    expect(filterMatchHistory(l, { mode: 'practice', robot: 'pivot' })).toHaveLength(0);
  });
  it('lista modos y robots presentes', () => {
    expect(historyFacets(l)).toEqual({ modes: ['match', 'practice'], robots: ['generic', 'pivot'] });
  });
});
