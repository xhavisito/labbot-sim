/** Pruebas del modo torneo: calendario 2 vs 2, ranking, selección (§8.2.1) y PlayOffs (§8.2.2). */
import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import type { MechanismKind } from '../src/config/robot';
import { rng } from '../src/core/rng';
import type { ScoutEntry } from '../src/core/scouting';
import {
  advancePlayoffs,
  aiAccepts,
  aiPick,
  allianceIndexOf,
  availableTeams,
  beginSelection,
  createTournament,
  finalsWins,
  finishSelection,
  mustAccept,
  placements,
  playoffWinner,
  rankings,
  respondInvite,
  resultFromEntries,
  roundRobin,
  sanitizeTournament,
  selectionTurn,
  seriesState,
  simulateMatch,
  standings,
  tournamentSummaries,
  type PlayoffFormat,
  type TeamEntry,
  type Tournament,
} from '../src/core/tournament';

const KINDS: MechanismKind[] = ['pivotHopper', 'pivotHopper180', 'pivotHopper', 'pivotHopper180', 'pivotHopper', 'pivotHopper180', 'pivotHopper', 'pivotHopper180'];
const teams = (n = 8): TeamEntry[] => Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, name: `Equipo ${i + 1}`, robot: KINDS[i % KINDS.length], strength: 0.3 + ((i * 37) % n) / n / 1.6, isPlayer: i === 0 }));

const withQuals = (seed = 1, format: PlayoffFormat = 'manual', n = 8): Tournament => {
  const t = createTournament(teams(n), 5, format, seed);
  const r = rng(seed + 1);
  for (const m of t.quals) m.result = simulateMatch(t, m, r);
  return t;
};
const runSelection = (t: Tournament, seed = 5) => {
  const r = rng(seed);
  beginSelection(t);
  for (let g = 0; g < 50; g++) {
    const a = selectionTurn(t);
    if (a === null) break;
    const team = aiPick(t, a);
    respondInvite(t, team, a, aiAccepts(t, team, a, r));
  }
  finishSelection(t);
};
const playOut = (t: Tournament, seed = 9) => {
  const r = rng(seed);
  for (let k = 0; k < 200 && t.champion === null; k++) {
    const m = t.playoffs.find((x) => !x.result);
    if (m) m.result = simulateMatch(t, m, r);
    advancePlayoffs(t);
  }
};

const entry = (team: string, o: Partial<ScoutEntry> = {}): ScoutEntry => ({
  id: team,
  match: 'Q1',
  team,
  alliance: 'red',
  source: 'sim',
  autoLine: false,
  samplesAuto: [0, 0, 0],
  samplesTeleop: [0, 0, 0],
  platform: false,
  critical: false,
  fouls: 0,
  techFouls: 0,
  yellow: 0,
  red: false,
  createdAt: '',
  ...o,
});

describe('modo torneo: Qualifications', () => {
  it('8 equipos, 5 matches cada uno, 2 vs 2 sin repetir equipo en un match (§8.2)', () => {
    const t = createTournament(teams(), 5, 'manual', 3);
    expect(t.quals.length).toBe(10);
    const count = new Array(8).fill(0);
    for (const m of t.quals) {
      expect(m.red.length).toBe(2);
      expect(m.blue.length).toBe(2);
      expect(new Set([...m.red, ...m.blue]).size).toBe(4);
      for (const i of [...m.red, ...m.blue]) count[i]++;
    }
    expect(count.every((c) => c === 5)).toBe(true);
  });

  it('marcador con los puntos de §4.4: Plataforma no acumulable, una Crítica, faltas al rival, RP', () => {
    const red = [
      entry('A', { autoLine: true, samplesAuto: [0, 0, 1], samplesTeleop: [0, 0, 4], platform: true, critical: true }),
      entry('B', { autoLine: true, samplesTeleop: [2, 1, 2], platform: true }),
    ];
    const blue = [entry('C', { autoLine: true, fouls: 2, techFouls: 1, platform: true }), entry('D')];
    const r = resultFromEntries(red, blue, GAME);
    // AUTO 5+5+18, TELEOP 60 + 4+6+30, ENDGAME 20 + 15
    expect(r.red.auto).toBe(28);
    expect(r.red.endgame).toBe(35);
    expect(r.red.noFoul).toBe(28 + 100 + 35);
    expect(r.red.score).toBe(163 + 2 * 4 + 8);
    expect(r.red.samples).toBe(10);
    // victoria 2 + línea 1 + Crítica 1 + Dominio 1
    expect(r.red.rp).toBe(5);
    expect(r.blue.score).toBe(5 + 10);
    expect(r.blue.rp).toBe(0);
    // Red Card: la alianza se queda en 0 y sin RP (D10)
    const rc = resultFromEntries([{ ...red[0], red: true }, red[1]], blue, GAME);
    expect(rc.red.score).toBe(0);
    expect(rc.red.rp).toBe(0);
    expect(rc.blue.rp).toBe(2);
  });

  it('la simulación estadística da marcadores del orden de los de la física', () => {
    const t = withQuals(2);
    const scores = t.quals.flatMap((m) => [m.result!.red.score, m.result!.blue.score]);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avg).toBeGreaterThan(100);
    expect(avg).toBeLessThan(400);
    expect(tournamentSummaries(t).size).toBe(8);
  });

  it('ranking por RS (RP promedio, 2 decimales) y desempates', () => {
    const t = withQuals(4);
    const rk = rankings(t);
    for (let i = 1; i < rk.length; i++) expect(rk[i - 1].rs > rk[i].rs || (rk[i - 1].rs === rk[i].rs && rk[i - 1].avgNoFoul >= rk[i].avgNoFoul)).toBe(true);
    for (const r of rk) expect(Math.round(r.rs * 100) / 100).toBe(r.rs);
    // reproducible
    expect(rankings(t).map((r) => r.team)).toEqual(rk.map((r) => r.team));
  });
});

describe('modo torneo: selección de alianzas (§8.2.1)', () => {
  it('4 alianzas de 2 con los 8 equipos; el Rank 1 no puede elegir al Rank 2', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = withQuals(seed);
      const rk = rankings(t);
      beginSelection(t);
      expect(availableTeams(t)).not.toContain(rk[1].team);
      expect(availableTeams(t)).toContain(rk[2].team);
      runSelection(t, seed);
      expect(t.alliances!.length).toBe(4);
      expect(t.alliances!.every((a) => a.length === 2)).toBe(true);
      expect(new Set(t.alliances!.flat()).size).toBe(8);
      expect(t.alliances![0]).not.toContain(rk[1].team);
      expect(t.alliances![0][0]).toBe(rk[0].team);
    }
  });

  it('sin equipos de sobra los libres tienen que aceptar; un capitán puede rechazar y sigue de capitán', () => {
    const t = withQuals(6);
    const rk = rankings(t);
    beginSelection(t);
    expect(mustAccept(t, rk[5].team)).toBe(true);
    expect(mustAccept(t, rk[2].team)).toBe(false);
    respondInvite(t, rk[2].team, 0, false);
    const s = t.selection!;
    expect(s.alliances[2][0]).toBe(rk[2].team);
    expect(availableTeams(t)).not.toContain(rk[2].team);
    // un libre que "rechaza" acepta igual
    respondInvite(t, rk[5].team, 0, false);
    expect(s.alliances[0]).toEqual([rk[0].team, rk[5].team]);
  });

  it('un capitán que acepta deja su alianza: las de abajo suben y entra el siguiente del ranking', () => {
    const t = withQuals(7);
    const rk = rankings(t);
    beginSelection(t);
    respondInvite(t, rk[2].team, 0, true);
    const s = t.selection!;
    expect(s.alliances[0]).toEqual([rk[0].team, rk[2].team]);
    expect(s.alliances.map((a) => a[0])).toEqual([rk[0].team, rk[1].team, rk[3].team, rk[4].team]);
    for (let g = 0; g < 20 && selectionTurn(t) !== null; g++) {
      const a = selectionTurn(t)!;
      respondInvite(t, aiPick(t, a), a, true);
    }
    finishSelection(t);
    expect(new Set(t.alliances!.flat()).size).toBe(8);
    expect(t.alliances!.every((a) => a.length === 2)).toBe(true);
  });
});

describe('modo torneo: PlayOffs', () => {
  it('todos contra todos: cada alianza contra las otras 3, una vez', () => {
    const rr = roundRobin(4);
    expect(rr.length).toBe(6);
    expect(new Set(rr.map((p) => p.join('-'))).size).toBe(6);
    expect(rr.slice(0, 2)).toEqual([
      [0, 3],
      [1, 2],
    ]);
  });

  for (const seed of [1, 2, 3, 4, 5, 6])
    it(`formato del manual (semilla ${seed}): series a 2 de 3, los dos primeros a la final a 2 de 3`, () => {
      const t = withQuals(seed);
      runSelection(t, seed);
      playOut(t, seed * 13);
      expect(t.champion).not.toBeNull();
      const ss = seriesState(t);
      expect(ss.length).toBe(6);
      for (const s of ss) {
        expect(Math.max(s.winsA, s.winsB)).toBe(2);
        expect(Math.min(s.winsA, s.winsB)).toBeLessThanOrEqual(1);
      }
      const st = standings(t);
      const finals = t.playoffs.filter((m) => m.kind === 'final');
      expect(finals.length).toBeGreaterThanOrEqual(2);
      expect(new Set(finals.flatMap((m) => [allianceIndexOf(t, m.red), allianceIndexOf(t, m.blue)]))).toEqual(new Set([st[0].alliance, st[1].alliance]));
      expect(allianceIndexOf(t, finals[0].red)).toBe(st[0].alliance);
      expect(finalsWins(t).get(t.champion!)).toBe(2);
      const pl = placements(t);
      expect([...pl.values()].sort()).toEqual([1, 2, 3, 4]);
      expect(pl.get(st[3].alliance)).toBe(4);
    });

  it('doble eliminación (como rebuilt-sim): 5 matches del bracket y final', () => {
    const t = withQuals(3, 'doubleElim');
    runSelection(t, 3);
    expect(t.playoffs.map((m) => [allianceIndexOf(t, m.red) + 1, allianceIndexOf(t, m.blue) + 1])).toEqual([
      [1, 4],
      [2, 3],
    ]);
    playOut(t, 4);
    expect(t.champion).not.toBeNull();
    expect(new Set(t.playoffs.filter((x) => x.kind === 'playoff').map((m) => m.slot)).size).toBe(5);
    expect([...placements(t).values()].sort()).toEqual([1, 2, 3, 4]);
  });

  it('un empate total se repite; un empate en puntos se desempata con los puntos sin faltas', () => {
    const t = withQuals(5);
    runSelection(t, 5);
    const res = (score: number, noFoul: number) => ({ score, noFoul, auto: 10, endgame: 20, samples: 8, rp: 0 });
    const m1 = t.playoffs[0];
    m1.result = { red: res(100, 90), blue: res(100, 90) };
    expect(playoffWinner(m1)).toBeNull();
    advancePlayoffs(t);
    const again = t.playoffs.find((m) => m.slot === m1.slot && m !== m1 && !m.result)!;
    expect(again.id).toBe('P1-2');
    again.result = { red: res(100, 80), blue: res(100, 95) };
    expect(playoffWinner(again)).toBe('blue');
  });

  it('torneo guardado: se valida al cargar', () => {
    const t = withQuals(1);
    expect(sanitizeTournament(JSON.parse(JSON.stringify(t)))).not.toBeNull();
    expect(sanitizeTournament({ version: 2 })).toBeNull();
    expect(sanitizeTournament({ ...t, quals: [{ id: 'Q1', kind: 'qual', red: [0, 99], blue: [1, 2] }] })).toBeNull();
  });
});
