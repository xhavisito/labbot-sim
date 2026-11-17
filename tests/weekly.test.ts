import { describe, expect, it } from 'vitest';
import { addEntry, BOARD_SIZE, emptyBoard, entriesOf, isoWeek, KEEP_WEEKS, parseBoard, weekId, weeklyChallenge, weeksCleared, WEEKLY_POOL } from '../src/core/weekly';

const at = (iso: string) => new Date(`${iso}T12:00:00`);
const E = (points: number, robot = 'Pivote') => ({ points, robot, at: '2026-11-02T00:00:00Z' });

describe('semana ISO', () => {
  it('casos borde del cambio de año', () => {
    expect(isoWeek(at('2026-01-01'))).toEqual({ year: 2026, week: 1 }); // jueves
    expect(isoWeek(at('2021-01-03'))).toEqual({ year: 2020, week: 53 }); // domingo
    expect(isoWeek(at('2024-12-30'))).toEqual({ year: 2025, week: 1 });
    expect(weekId(at('2026-11-02'))).toBe('2026-W45');
  });
});

describe('desafío de la semana', () => {
  it('es el mismo toda la semana (lunes a domingo) y cambia el lunes', () => {
    const mon = weeklyChallenge(at('2026-11-02'));
    expect(weeklyChallenge(at('2026-11-08')).week).toBe(mon.week);
    expect(weeklyChallenge(at('2026-11-05')).def.id).toBe(mon.def.id);
    expect(weeklyChallenge(at('2026-11-09')).week).toBe('2026-W46');
    expect(mon.start.getDay()).toBe(1);
    expect(mon.end.getTime() - mon.start.getTime()).toBeGreaterThanOrEqual(6.9 * 86400000);
  });
  it('rota por todo el catálogo y usa la duración del desafío', () => {
    const ids = new Set<string>();
    for (let w = 0; w < 8; w++) ids.add(weeklyChallenge(new Date(2026, 0, 5 + 7 * w, 12)).def.id);
    expect(ids.size).toBe(WEEKLY_POOL.length);
    const ch = weeklyChallenge(at('2026-11-02'));
    expect(ch.drill.limit).toBe(ch.def.limit);
    expect(ch.drill.kind).toBe('points');
    expect(ch.goal).toBe(ch.def.goal);
  });
});

describe('marcador local', () => {
  const ch = { week: '2026-W45', goal: 60 };
  it('ordena de mayor a menor, da el lugar y marca la mejor y la meta', () => {
    const b = emptyBoard();
    expect(addEntry(b, ch, E(50))).toEqual({ rank: 1, isBest: true, metGoal: false, prevBest: null });
    expect(addEntry(b, ch, E(70))).toMatchObject({ rank: 1, isBest: true, metGoal: true, prevBest: 50 });
    expect(addEntry(b, ch, E(60))).toMatchObject({ rank: 2, isBest: false, metGoal: true });
    expect(entriesOf(b, ch.week).map((e) => e.points)).toEqual([70, 60, 50]);
  });
  it('un empate queda debajo de la marca anterior', () => {
    const b = emptyBoard();
    addEntry(b, ch, E(40, 'A'));
    expect(addEntry(b, ch, E(40, 'B')).rank).toBe(2);
    expect(entriesOf(b, ch.week).map((e) => e.robot)).toEqual(['A', 'B']);
  });
  it('guarda solo las mejores y no entra quien queda fuera', () => {
    const b = emptyBoard();
    for (let i = 0; i < BOARD_SIZE; i++) addEntry(b, ch, E(100 - i));
    expect(addEntry(b, ch, E(1)).rank).toBeNull();
    expect(entriesOf(b, ch.week)).toHaveLength(BOARD_SIZE);
    expect(addEntry(b, ch, E(0)).metGoal).toBe(false);
  });
  it('descarta las semanas viejas', () => {
    const b = emptyBoard();
    for (let w = 1; w <= KEEP_WEEKS + 3; w++) addEntry(b, { week: `2026-W${String(w).padStart(2, '0')}`, goal: 1 }, E(5));
    expect(Object.keys(b.weeks)).toHaveLength(KEEP_WEEKS);
    expect(b.weeks['2026-W01']).toBeUndefined();
  });
  it('lee lo guardado y descarta lo malformado', () => {
    const b = emptyBoard();
    addEntry(b, ch, E(30));
    expect(parseBoard(JSON.stringify(b))).toEqual(b);
    expect(parseBoard(null)).toEqual(emptyBoard());
    expect(parseBoard('{no')).toEqual(emptyBoard());
    expect(parseBoard(JSON.stringify({ v: 2, weeks: {} }))).toEqual(emptyBoard());
    const bad = { v: 1, weeks: { 'x': [E(1)], '2026-W45': [{ points: 'a', robot: 'x' }, E(9), { points: 12, robot: 'y' }] } };
    expect(parseBoard(JSON.stringify(bad)).weeks).toEqual({ '2026-W45': [{ points: 12, robot: 'y', at: '' }, E(9)] });
  });
  it('cuenta semanas con la meta cumplida', () => {
    const b = emptyBoard();
    const w = weeklyChallenge(at('2026-11-02'));
    addEntry(b, w, E(w.goal));
    const w2 = weeklyChallenge(at('2026-11-09'));
    addEntry(b, w2, E(w2.goal - 1));
    expect(weeksCleared(b)).toBe(1);
  });
});
