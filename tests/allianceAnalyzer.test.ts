import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { MECHANISM_KINDS, type MechanismKind } from '../src/config/robot';
import { comboTable, eventObservations, kindCombos, observations, otherOf, PLAY_STYLES, styleCombos, styleOf, teamAdvice } from '../src/core/allianceAnalyzer';
import { addEvent, emptyHistory, type HistoryData, type HistoryEvent } from '../src/core/history';
import { oprMatchesFromEntries } from '../src/core/opr';
import type { LevelCounts, ScoutEntry } from '../src/core/scouting';

const entry = (match: string, team: string, alliance: 'red' | 'blue', o: Partial<ScoutEntry> = {}): ScoutEntry => ({
  id: `${match}-${team}`,
  match,
  team,
  alliance,
  source: 'manual',
  autoLine: true,
  samplesAuto: [0, 0, 0],
  samplesTeleop: [0, 0, 0],
  platform: false,
  critical: false,
  fouls: 0,
  techFouls: 0,
  yellow: 0,
  red: false,
  createdAt: '2026-10-25T00:00:00Z',
  ...o,
});

const n3 = (k: number): Partial<ScoutEntry> => ({ samplesTeleop: [0, 0, k] as LevelCounts });

/** Evento armado con registros: el marcador sale de los registros (`oprMatchesFromEntries`). */
function event(id: string, teams: Record<string, MechanismKind>, entries: ScoutEntry[], season = '2026'): HistoryEvent {
  return {
    id,
    name: id,
    season,
    date: `${season}-10-${String(10 + id.length).padStart(2, '0')}T00:00:00Z`,
    source: 'scouting',
    teams: Object.entries(teams).map(([tid, robot]) => ({ id: tid, name: tid, robot })),
    entries,
    matches: oprMatchesFromEntries(entries, GAME),
    ranking: Object.keys(teams),
    place: {},
  };
}

describe('estilo de un robot en un match', () => {
  it('Crítica primero; luego el nivel donde más anotó (empate: el más alto); park y none', () => {
    expect(styleOf(entry('Q', 'A', 'red', { critical: true, ...n3(4) }))).toBe('critical');
    expect(styleOf(entry('Q', 'A', 'red', { samplesAuto: [0, 1, 0], samplesTeleop: [0, 2, 1] }))).toBe('n2');
    expect(styleOf(entry('Q', 'A', 'red', { samplesTeleop: [2, 0, 2] }))).toBe('n3');
    expect(styleOf(entry('Q', 'A', 'red', { samplesTeleop: [3, 0, 0] }))).toBe('n1');
    expect(styleOf(entry('Q', 'A', 'red', { platform: true }))).toBe('park');
    expect(styleOf(entry('Q', 'A', 'red'))).toBe('none');
  });
});

describe('alianzas de un evento', () => {
  const ev = event('E', { A: 'pivot', B: 'pivot180', C: 'pivot', D: 'pivot' }, [
    entry('Q1', 'A', 'red', { ...n3(4), critical: true, platform: true }),
    entry('Q1', 'B', 'red', { ...n3(6), platform: true }),
    entry('Q1', 'C', 'blue', { ...n3(2) }),
    entry('Q1', 'D', 'blue', { autoLine: false, fouls: 1 }),
  ]);

  it('puntos sin faltas, victoria y RP como §4.4 (línea, Crítica, Dominio ≥10)', () => {
    const [red, blue] = eventObservations(ev, GAME);
    // Rojo: línea 5+5, 10 N3 en TELEOP = 150, Plataforma con dos = 20, Crítica 15
    expect(red.points).toBe(10 + 150 + 20 + 15);
    expect(red.score).toBe(red.points + 4); // Foul de D: 4 para el contrario (§4.5)
    expect(red.win).toBe(1);
    expect(red.rp).toBe(2 + 1 + 1 + 1);
    expect(red.kinds).toEqual(['pivot', 'pivot180']);
    expect(red.styles).toEqual(['critical', 'n3']);
    // Azul: D no cruzó → sin RP de línea; perdió
    expect(blue.win).toBe(0);
    expect(blue.rp).toBe(0);
    expect(blue.styles).toEqual(['n3', 'none']);
  });

  it('Red Card: la alianza se queda sin RP (§4.6)', () => {
    const e2 = event('R', { A: 'pivot', B: 'pivot', C: 'pivot', D: 'pivot' }, [
      entry('Q1', 'A', 'red', { ...n3(6), red: true }),
      entry('Q1', 'B', 'red', { ...n3(6) }),
      entry('Q1', 'C', 'blue'),
      entry('Q1', 'D', 'blue'),
    ]);
    expect(eventObservations(e2, GAME)[0].rp).toBe(0);
  });

  it('ignora matches sin registro de los dos robots', () => {
    const e3: HistoryEvent = { ...ev, entries: ev.entries.filter((e) => e.team !== 'B') };
    expect(eventObservations(e3, GAME).map((o) => o.teams)).toEqual([['C', 'D']]);
  });
});

/**
 * Historial de prueba: 4 equipos, todas las parejas. Los pivote 180° (B, D) anotan más cuando juegan
 * con un pivote (A, C) que lleva la Crítica.
 */
function history(): HistoryData {
  const kinds = { A: 'pivot', B: 'pivot180', C: 'pivot', D: 'pivot180' } as const;
  const es: ScoutEntry[] = [];
  const pairs: Array<[[string, string], [string, string]]> = [
    [['A', 'B'], ['C', 'D']],
    [['A', 'C'], ['B', 'D']],
    [['A', 'D'], ['B', 'C']],
  ];
  let q = 0;
  for (let rep = 0; rep < 3; rep++)
    for (const [red, blue] of pairs) {
      const id = `Q${++q}`;
      for (const [side, al] of [
        [red, 'red'],
        [blue, 'blue'],
      ] as const) {
        const mixed = kinds[side[0] as keyof typeof kinds] !== kinds[side[1] as keyof typeof kinds];
        for (const t of side) {
          const isPivot = kinds[t as keyof typeof kinds] === 'pivot';
          es.push(entry(id, t, al, { ...n3(mixed ? (isPivot ? 2 : 6) : 3), critical: mixed && isPivot, platform: true }));
        }
      }
    }
  return addEvent(emptyHistory(), event('T', kinds, es));
}

describe('combinaciones del historial', () => {
  const h = history();
  const obs = observations(h, GAME);

  it('junta todas las alianzas de los eventos (y filtra por temporada)', () => {
    expect(obs.length).toBe(18);
    expect(observations(h, GAME, '2025').length).toBe(0);
  });

  it('pareja de robots: pivote + pivote 180° es la mejor', () => {
    const rows = kindCombos(obs, MECHANISM_KINDS);
    expect(rows[0].pair).toEqual(['pivot', 'pivot180']);
    expect(rows[0].matches).toBe(12);
    // 10 de línea + 8 N3 (120) + Plataforma 20 + Crítica 15; la pareja igual: 10 + 90 + 20
    expect(rows[0].points).toBe(165);
    expect(rows.find((r) => r.pair.join() === 'pivot,pivot')!.points).toBe(120);
    expect(rows[0].lift).toBeGreaterThan(0);
    expect(rows.map((r) => r.pair.join('+')).sort()).toEqual(['pivot+pivot', 'pivot+pivot180', 'pivot180+pivot180']);
  });

  it('pareja de estilos: Crítica + N3 arriba de N3 + N3', () => {
    const rows = styleCombos(obs);
    expect(rows[0].pair).toEqual(['critical', 'n3']);
    expect(rows.find((r) => r.pair.join() === 'n3,n3')!.points).toBe(120);
    expect(otherOf(rows[0].pair, 'critical')).toBe('n3');
  });

  it('el promedio encogido acerca al promedio general a las combinaciones con pocos matches', () => {
    const few = comboTable([obs[0]], (o) => o.styles, PLAY_STYLES, 3);
    const many = comboTable(Array(30).fill(obs[0]), (o) => o.styles, PLAY_STYLES, 3);
    expect(few[0].rating).toBe(obs[0].points); // un solo dato: el promedio general es él mismo
    expect(many[0].rating).toBeCloseTo(obs[0].points);
    const mixed = comboTable([obs[0], obs[1]], (o) => o.styles, PLAY_STYLES, 3);
    const all = (obs[0].points + obs[1].points) / 2;
    for (const r of mixed) expect(Math.abs(r.rating - all)).toBeLessThan(Math.abs(r.points - all) + 1e-9);
  });
});

describe('consejo para un equipo', () => {
  const h = history();

  it('B (pivote 180°): compañero pivote que lleve la Crítica; mejores compañeros A y C', () => {
    const a = teamAdvice(h, 'B', GAME, MECHANISM_KINDS);
    expect(a.kind).toBe('pivot180');
    expect(a.style).toBe('n3');
    expect(a.matches).toBe(9);
    expect(otherOf(a.partnerKind!.pair, 'pivot180')).toBe('pivot');
    expect(otherOf(a.partnerStyle!.pair, 'n3')).toBe('critical');
    expect(a.partners.map((p) => p.team).slice(0, 2).sort()).toEqual(['A', 'C']);
    expect(a.partners[0].together).toBe(3);
    expect(a.partners[0].togetherPoints).toBe(165);
    expect(a.partners[2].team).toBe('D');
  });

  it('A (pivote): su mejor estilo es llevar la Crítica', () => {
    const a = teamAdvice(h, 'A', GAME, MECHANISM_KINDS);
    expect(a.styles).toEqual({ critical: 6, n3: 3 });
    expect(a.style).toBe('critical');
    expect(a.ownStyle!.pair[0]).toBe('critical');
  });

  it('sin historial: sin consejo ni compañeros', () => {
    const a = teamAdvice(emptyHistory(), 'A', GAME, MECHANISM_KINDS);
    expect(a).toMatchObject({ matches: 0, kind: null, style: null, partnerKind: null, partnerStyle: null, ownStyle: null, partners: [] });
  });
});
