import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { Match } from '../src/core/match';
import { bestPartners, entriesFromMatch, entryPoints, predictAlliance, summarize, type ScoutEntry } from '../src/core/scouting';
import { DEFAULT_FORMAT, makeSchedule, predictPlayoffs, rankTeams, suggestDraft } from '../src/core/tournament';

const entry = (team: string, o: Partial<ScoutEntry> = {}): ScoutEntry => ({
  id: `${team}-${Math.random()}`,
  match: 'Q1',
  team,
  alliance: 'red',
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

describe('puntos de un registro (§4.4–§4.6)', () => {
  it('línea 5, N3 en AUTO 18 y en TELEOP 15, Plataforma 10 por robot, Crítica 15', () => {
    const p = entryPoints(entry('A', { samplesAuto: [0, 0, 1], samplesTeleop: [1, 1, 2], platform: true, critical: true }), GAME);
    expect(p.auto).toBe(5 + 18);
    expect(p.teleop).toBe(2 + 6 + 30);
    expect(p.endgame).toBe(25);
    expect(p.total).toBe(23 + 38 + 25);
  });

  it('faltas: 4 por Foul y 8 por Tech Foul (puntos que regala)', () => {
    expect(entryPoints(entry('A', { fouls: 2, techFouls: 1 }), GAME).foulPts).toBe(16);
  });
});

describe('registro desde un match del simulador', () => {
  it('reparte Muestras, línea, Plataforma, Crítica y faltas por robot', () => {
    const m = new Match(GAME);
    m.start();
    m.crossAutoLine('red', 0);
    m.scoreSample('red', 3, 0); // AUTO, robot 0
    m.tick(16);
    m.scoreSample('red', 3, 1); // TELEOP, robot 1
    m.scoreSample('red', 2); // empujada: de nadie
    m.foul('CONTACT', 'blue', 3);
    m.foul('OUT_OF_BOUNDS', 'blue', 3);
    m.finish({ red: 2, blue: 0 }, { red: true, blue: false }, { onPlatform: [0, 1], criticalBy: { red: 1, blue: undefined } });
    const es = entriesFromMatch(m, ['A', 'B', 'C', 'D'], 'Sim 1');
    expect(es.map((e) => e.team)).toEqual(['A', 'B', 'C', 'D']);
    expect(es[0]).toMatchObject({ alliance: 'red', autoLine: true, samplesAuto: [0, 0, 1], samplesTeleop: [0, 0, 0], platform: true, critical: false });
    expect(es[1]).toMatchObject({ autoLine: false, samplesTeleop: [0, 0, 1], platform: true, critical: true });
    expect(es[3]).toMatchObject({ alliance: 'blue', fouls: 1, techFouls: 1 });
    expect(es[0].allianceScore).toBe(m.score('red'));
  });
});

describe('resumen y predicción de alianzas', () => {
  const entries = [
    entry('torre', { samplesTeleop: [0, 0, 5], platform: true }),
    entry('torre', { samplesTeleop: [0, 0, 7], platform: true }),
    entry('pivote', { samplesTeleop: [0, 1, 2], platform: true, critical: true }),
    entry('pivote', { samplesTeleop: [0, 1, 2], platform: true, critical: true }),
    entry('lento', { autoLine: false, samplesTeleop: [2, 0, 0], fouls: 3 }),
  ];
  const sum = summarize(entries, GAME);

  it('promedios por equipo, ordenados por puntos netos', () => {
    const t = sum.find((s) => s.team === 'torre')!;
    expect(t.matches).toBe(2);
    expect(t.samples).toBe(6);
    expect(t.n3).toBe(6);
    expect(t.platformPct).toBe(1);
    expect(t.sd).toBeCloseTo(15);
    expect(sum[0].team).toBe('torre');
    expect(sum[sum.length - 1].team).toBe('lento');
  });

  it('una sola Crítica por alianza y Plataforma no acumulable', () => {
    const t = sum.find((s) => s.team === 'torre')!;
    const p = sum.find((s) => s.team === 'pivote')!;
    const pr = predictAlliance(t, p, GAME);
    // torre 5 + 90; pivote 5 + 6 + 30; Plataforma 20; Crítica 15
    expect(pr.points).toBeCloseTo(95 + 41 + 20 + 15);
    expect(pr.roles).toEqual(['n3', 'critical']);
    expect(pr.pCriticalRp).toBe(1);
    expect(pr.pAutoLineRp).toBe(1);
    // 6 + 3 = 9 Muestras en promedio: Dominio (≥10) posible pero menos de la mitad de las veces
    expect(pr.pDominanceRp).toBeGreaterThan(0.1);
    expect(pr.pDominanceRp).toBeLessThan(0.5);
    expect(predictAlliance(t, t, GAME).pDominanceRp).toBeGreaterThan(0.5);
    const two = predictAlliance(p, p, GAME);
    expect(two.points).toBeCloseTo(41 * 2 + 20 + 15);
  });

  it('el mejor compañero de la torre es el pivote', () => {
    expect(bestPartners('torre', sum, GAME)[0].teams[1]).toBe('pivote');
  });
});

describe('torneo (formato SUPUESTO)', () => {
  const teams = ['1', '2', '3', '4', '5', '6', '7', '8'];

  it('calendario: 8 equipos × 5 matches = 10 matches de 2 vs 2, todos juegan 5', () => {
    const s = makeSchedule(teams, 5, 7);
    expect(s).toHaveLength(10);
    const count = new Map<string, number>();
    for (const m of s) {
      const all = [...m.red, ...m.blue];
      expect(new Set(all).size).toBe(4);
      for (const t of all) count.set(t, (count.get(t) ?? 0) + 1);
    }
    for (const t of teams) expect(count.get(t)).toBe(5);
    expect(makeSchedule(teams, 5, 7)).toEqual(s);
  });

  it('selección: cada equipo en una sola alianza; capitán = mejor libre del ranking', () => {
    const entries = teams.map((t, i) => entry(t, { samplesTeleop: [0, 0, i], platform: i % 2 === 0, critical: i === 1, rp: i }));
    const sum = summarize(entries, GAME);
    const ranked = rankTeams(sum, DEFAULT_FORMAT);
    expect(ranked[0].team).toBe('8');
    const d = suggestDraft(sum, DEFAULT_FORMAT, GAME);
    expect(d).toHaveLength(4);
    expect(d[0].captain).toBe('8');
    const all = d.flatMap((a) => [a.captain, ...a.picks]);
    expect(new Set(all).size).toBe(8);
    const po = predictPlayoffs(d);
    expect(po).toHaveLength(3);
    expect(po[0].a.seed).toBe(1);
    expect(po[0].b.seed).toBe(4);
    expect(po[2].round).toBe(2);
  });

  it('con 3 por alianza hay segunda ronda (serpentina) y sobra nadie con 8 equipos y 2 alianzas', () => {
    const entries = teams.map((t, i) => entry(t, { samplesTeleop: [0, 0, i] }));
    const d = suggestDraft(summarize(entries, GAME), { ...DEFAULT_FORMAT, alliances: 2, allianceSize: 3 }, GAME);
    expect(d.map((a) => a.picks.length)).toEqual([2, 2]);
  });
});
