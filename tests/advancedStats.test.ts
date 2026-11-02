/** Estadísticas avanzadas: OPR/DPR/CCWM, desempeño por robot (niveles, ciclos) e historial entre eventos. */
import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import type { MechanismKind } from '../src/config/robot';
import { addEvent, byRobotKind, careers, emptyHistory, eventFromScouting, eventFromTournament, MAX_EVENTS, sanitizeHistory, seasons, teamEventRows } from '../src/core/history';
import { Match } from '../src/core/match';
import { computeOpr, leastSquares, oprError, oprMatchesFromEntries, oprMatchesFromTournament, type AllianceScore, type OprMatch } from '../src/core/opr';
import { rng } from '../src/core/rng';
import { cycleStats, entriesFromMatch, summarize, type ScoutEntry } from '../src/core/scouting';
import { advancePlayoffs, aiAccepts, aiPick, beginSelection, createTournament, finishSelection, respondInvite, selectionTurn, simulateMatch, type TeamEntry, type Tournament } from '../src/core/tournament';

const sc = (score: number, o: Partial<AllianceScore> = {}): AllianceScore => ({ score, noFoul: score, auto: 0, teleop: score, endgame: 0, samples: 0, ...o });

describe('OPR por mínimos cuadrados', () => {
  // Equipos con aporte fijo: el marcador de cada alianza es la suma exacta
  const truth: Record<string, number> = { A: 40, B: 30, C: 20, D: 10, E: 25, F: 15 };
  const ids = Object.keys(truth);
  const pairs: Array<[string[], string[]]> = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const rest = ids.filter((x) => x !== ids[i] && x !== ids[j]);
      pairs.push([[ids[i], ids[j]], [rest[0], rest[1]]]);
    }
  const matches: OprMatch[] = pairs.map(([red, blue], k) => ({ id: `Q${k + 1}`, red, blue, redScore: sc(truth[red[0]] + truth[red[1]]), blueScore: sc(truth[blue[0]] + truth[blue[1]]) }));

  it('recupera el aporte de cada equipo cuando los datos son exactos', () => {
    const rows = computeOpr(matches, 1e-9);
    for (const r of rows) expect(r.opr).toBeCloseTo(truth[r.team], 4);
    expect(rows[0].team).toBe('A');
    expect(oprError(matches, rows)).toBeLessThan(1e-3);
  });

  it('CCWM = OPR − DPR, y DPR mide lo que anota el rival', () => {
    const rows = computeOpr(matches);
    for (const r of rows) expect(r.ccwm).toBeCloseTo(r.opr - r.dpr, 9);
    // El que más aporta juega contra rivales más débiles (todos los demás menos él): su DPR es el menor
    const a = rows.find((r) => r.team === 'A')!;
    expect(Math.min(...rows.map((r) => r.dpr))).toBeCloseTo(a.dpr, 9);
  });

  it('con un solo match no explota: se regulariza hacia el promedio por robot', () => {
    const one = leastSquares([{ teams: ['A', 'B'], y: 60 }, { teams: ['C', 'D'], y: 20 }], ['A', 'B', 'C', 'D']);
    for (const v of one.values()) expect(Number.isFinite(v)).toBe(true);
    // Promedio por robot = 20; A y B arriba, C y D abajo, simétricos
    expect(one.get('A')).toBeGreaterThan(20);
    expect(one.get('C')).toBeLessThan(20);
    expect(one.get('A')! + one.get('C')!).toBeCloseTo(40, 6);
  });

  it('sin matches no hay filas', () => {
    expect(computeOpr([])).toEqual([]);
  });
});

const entry = (team: string, match: string, alliance: 'red' | 'blue', o: Partial<ScoutEntry> = {}): ScoutEntry => ({
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

describe('matches para el OPR desde el Scouting', () => {
  it('solo usa matches con las dos alianzas completas y calcula el marcador con §4.4', () => {
    const es = [
      entry('A', 'Q1', 'red', { samplesTeleop: [0, 0, 2], platform: true }),
      entry('B', 'Q1', 'red', { platform: true, critical: true }),
      entry('C', 'Q1', 'blue', { fouls: 1 }),
      entry('D', 'Q1', 'blue'),
      entry('A', 'Q2', 'red'), // incompleto
    ];
    const ms = oprMatchesFromEntries(es, GAME);
    expect(ms).toHaveLength(1);
    const red = ms[0].redScore;
    // Línea 5+5, 2 N3 en TELEOP (2×15), Plataforma con 2 = 20 (no acumulable), Crítica 15, + Foul del rival 4
    expect(red.noFoul).toBe(10 + 30 + 20 + 15);
    expect(red.score).toBe(10 + 30 + 20 + 15 + GAME.fouls.foul);
    expect(red.teleop).toBe(30);
    expect(red.endgame).toBe(35);
  });

  it('si un registro trae el marcador real, se usa ese', () => {
    const es = [entry('A', 'Q1', 'red', { allianceScore: 99 }), entry('B', 'Q1', 'red'), entry('C', 'Q1', 'blue'), entry('D', 'Q1', 'blue')];
    expect(oprMatchesFromEntries(es, GAME)[0].redScore.score).toBe(99);
  });
});

describe('desempeño por robot', () => {
  it('ciclos: ráfagas separadas por más de 2.5 s y tiempo de ciclo promedio', () => {
    expect(cycleStats([])).toEqual({ cycles: 0 });
    expect(cycleStats([30])).toEqual({ cycles: 1 });
    // Ráfagas en 30, 50 y 80 (31 y 51.5 son parte de su ráfaga): ciclos de 20 y 30 → 25
    expect(cycleStats([30, 31, 50, 51.5, 80])).toEqual({ cycles: 3, cycleAvg: 25 });
  });

  it('el registro del simulador trae los ciclos del TELEOP de cada robot', () => {
    const m = new Match(GAME, 2);
    m.start();
    m.tick(40);
    m.scoreSample('red', 3, 0);
    m.tick(1);
    m.scoreSample('red', 3, 0);
    m.tick(19);
    m.scoreSample('red', 3, 0);
    const es = entriesFromMatch(m, ['A', 'B', 'C', 'D'], 'Q1');
    expect(es[0].cycles).toBe(2);
    expect(es[0].cycleAvg).toBe(20);
    expect(es[1].cycles).toBe(0);
  });

  it('resumen: Muestras por nivel, nivel principal, ciclos y tendencia', () => {
    const es = [
      entry('A', 'Q1', 'red', { samplesAuto: [0, 0, 1], samplesTeleop: [1, 0, 3], cycles: 4, cycleAvg: 20 }),
      entry('A', 'Q2', 'red', { samplesTeleop: [1, 2, 1], cycles: 2, cycleAvg: 30 }),
    ];
    const [s] = summarize(es, GAME);
    expect(s.levels).toEqual([1, 1, 2.5]);
    expect(s.levelsAuto).toEqual([0, 0, 0.5]);
    expect(s.topLevel).toBe(3);
    expect(s.cycles).toBe(3);
    expect(s.cycle).toBe(25);
    expect(s.bestCycle).toBe(20);
    expect(s.trend).toHaveLength(2);
    // Sin datos de ciclo → null (no 0)
    expect(summarize([entry('B', 'Q1', 'red')], GAME)[0].cycle).toBeNull();
  });

  it('por tipo de robot: promedio pesado por matches', () => {
    const es = [entry('A', 'Q1', 'red', { samplesTeleop: [0, 0, 2] }), entry('A', 'Q2', 'red', { samplesTeleop: [0, 0, 2] }), entry('B', 'Q1', 'red')];
    const kinds: Record<string, MechanismKind> = { A: 'pivot180', B: 'pivot180' };
    const [k] = byRobotKind(summarize(es, GAME), (t) => kinds[t]);
    expect(k.robot).toBe('pivot180');
    expect(k.teams).toBe(2);
    expect(k.matches).toBe(3);
    expect(k.n3).toBeCloseTo(4 / 3, 9);
  });
});

const KINDS: MechanismKind[] = ['pivot', 'pivot180', 'pivot', 'pivot180', 'pivot', 'pivot180', 'pivot', 'pivot180'];
const teams = (): TeamEntry[] => KINDS.map((robot, i) => ({ id: `E${i + 1}`, name: `Equipo ${i + 1}`, robot, strength: 0.3 + i * 0.07, isPlayer: i === 0 }));

function fullTournament(seed: number): Tournament {
  const t = createTournament(teams(), 5, 'manual', seed);
  const r = rng(seed + 1);
  for (const m of t.quals) m.result = simulateMatch(t, m, r);
  beginSelection(t);
  for (let g = 0; g < 50; g++) {
    const a = selectionTurn(t);
    if (a === null) break;
    const team = aiPick(t, a);
    respondInvite(t, team, a, aiAccepts(t, team, a, r));
  }
  finishSelection(t);
  for (let k = 0; k < 200 && t.champion === null; k++) {
    const m = t.playoffs.find((x) => !x.result);
    if (m) m.result = simulateMatch(t, m, r);
    advancePlayoffs(t);
  }
  return t;
}

describe('OPR del modo torneo', () => {
  it('un OPR por equipo con los marcadores de Qualifications; los fuertes salen arriba', () => {
    const t = fullTournament(3);
    const rows = computeOpr(oprMatchesFromTournament(t, 'quals'));
    expect(rows).toHaveLength(8);
    // En promedio, el OPR suma lo que anotan las alianzas
    const ms = oprMatchesFromTournament(t, 'quals');
    const avgAlliance = ms.reduce((a, m) => a + m.redScore.score + m.blueScore.score, 0) / (2 * ms.length);
    const avgOpr = rows.reduce((a, r) => a + r.opr * r.matches, 0) / rows.reduce((a, r) => a + r.matches, 0);
    expect(2 * avgOpr).toBeCloseTo(avgAlliance, 0);
  });
});

describe('historial entre eventos y temporadas', () => {
  it('guarda un torneo terminado con ranking, lugares y campeón; el mismo torneo no se duplica', () => {
    const t = fullTournament(7);
    const ev = eventFromTournament(t, 'Torneo 1', new Date('2026-01-20T12:00:00Z'));
    expect(ev.season).toBe('2026');
    expect(ev.ranking).toHaveLength(8);
    expect(Object.values(ev.place).filter((p) => p === 1)).toHaveLength(2); // alianza de 2 campeona
    expect(ev.player).toBe('E1');
    let h = addEvent(emptyHistory(), ev);
    h = addEvent(h, eventFromTournament(t, 'Otra vez', new Date('2026-01-21T12:00:00Z')));
    expect(h.events).toHaveLength(1);
    expect(h.events[0].name).toBe('Otra vez');
  });

  it('carrera por equipo y por temporada: eventos, títulos, OPR promedio', () => {
    let h = emptyHistory();
    h = addEvent(h, eventFromTournament(fullTournament(11), 'T1', new Date('2025-11-01T00:00:00Z')));
    h = addEvent(h, eventFromTournament(fullTournament(12), 'T2', new Date('2026-02-01T00:00:00Z')));
    h = addEvent(h, eventFromTournament(fullTournament(13), 'T3', new Date('2026-03-01T00:00:00Z')));
    expect(seasons(h)).toEqual(['2026', '2025']);
    const all = careers(h, GAME);
    expect(all).toHaveLength(8);
    expect(all.every((c) => c.events === 3 && c.oprTrend.length === 3)).toBe(true);
    expect(all.reduce((a, c) => a + c.titles, 0)).toBe(6); // 2 campeones por evento
    const s26 = careers(h, GAME, '2026');
    expect(s26.every((c) => c.events === 2)).toBe(true);
    expect(teamEventRows(h, GAME)).toHaveLength(24);
  });

  it('foto del Scouting: ranking por puntos netos y OPR de los matches completos', () => {
    const es = [entry('A', 'Q1', 'red', { samplesTeleop: [0, 0, 3] }), entry('B', 'Q1', 'red'), entry('C', 'Q1', 'blue'), entry('D', 'Q1', 'blue')];
    const tm = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: id, robot: 'pivot' as MechanismKind }));
    const ev = eventFromScouting(tm, es, 'Regional', GAME, new Date('2026-05-01T00:00:00Z'));
    expect(ev.ranking[0]).toBe('A');
    expect(ev.matches).toHaveLength(1);
    expect(ev.place).toEqual({});
  });

  it('se queda con los eventos más nuevos y sanea lo guardado', () => {
    let h = emptyHistory();
    const tm = [{ id: 'A', name: 'A', robot: 'pivot' as MechanismKind }];
    for (let i = 0; i < MAX_EVENTS + 5; i++) h = addEvent(h, eventFromScouting(tm, [], `E${i}`, GAME, new Date(Date.UTC(2026, 0, 1 + i))));
    expect(h.events).toHaveLength(MAX_EVENTS);
    expect(h.events[0].name).toBe('E5');
    const back = sanitizeHistory(JSON.parse(JSON.stringify(h)));
    expect(back.events).toHaveLength(MAX_EVENTS);
    expect(sanitizeHistory({ events: [{ teams: 'x' }, null, 5] }).events).toEqual([]);
    expect(sanitizeHistory('basura').events).toEqual([]);
    // Equipos que no existen en el evento se descartan de ranking y matches
    const bad = sanitizeHistory({ events: [{ id: 'X', teams: [{ id: 'A' }], entries: [], matches: [{ red: ['A', 'Z'], blue: ['Z'] }], ranking: ['Z', 'A'], place: { A: 1, Z: 2 } }] });
    expect(bad.events[0].ranking).toEqual(['A']);
    expect(bad.events[0].matches).toEqual([]);
    expect(bad.events[0].place).toEqual({ A: 1 });
  });
});
