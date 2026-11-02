import { describe, expect, it } from 'vitest';
import { addHistory, HISTORY_MAX, loadHistory, sanitizeHistory, type HistoryEntry, type HistoryStore } from '../src/core/history';

const mem = (): HistoryStore => {
  const d: Record<string, string> = {};
  return { getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const e = (date: string, red = 10, blue = 5): HistoryEntry => ({
  date, mode: 'match', player: 0, playerRobot: 'generic', botRobot: 'pivot', score: { red, blue }, rp: { red: 2, blue: 0 },
});

describe('historial', () => {
  it('basura → lista vacía; descarta entradas inválidas', () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory([1, { date: 'x' }, e('2026-01-01T00:00:00Z')])).toHaveLength(1);
    expect(loadHistory(mem())).toEqual([]);
  });

  it('ordena del más reciente al más antiguo', () => {
    const s = mem();
    addHistory(e('2026-01-02T00:00:00Z'), s);
    addHistory(e('2026-01-03T00:00:00Z'), s);
    const l = addHistory(e('2026-01-01T00:00:00Z'), s);
    expect(l.map((x) => x.date)).toEqual(['2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z']);
    expect(loadHistory(s)).toEqual(l);
  });

  it('guarda como máximo HISTORY_MAX partidas', () => {
    const s = mem();
    for (let i = 0; i < HISTORY_MAX + 5; i++) addHistory(e(new Date(2026, 0, 1, 0, i).toISOString()), s);
    expect(loadHistory(s)).toHaveLength(HISTORY_MAX);
  });
});
