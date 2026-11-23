/**
 * Integridad del modo torneo: una alianza eliminada nunca vuelve a jugar ni a aparecer como en juego
 * (§8.2.2; doble eliminación SUPUESTO, la de rebuilt-sim), el estado sale de una sola fuente
 * (`allianceStates`), recargar un torneo guardado no deja fantasmas y cada equipo lleva un robot CAD
 * (no los presets de LabBot que se quitaron del juego).
 */
import { describe, expect, it } from 'vitest';
import type { MechanismKind } from '../src/config/robot';
import { rng } from '../src/core/rng';
import {
  advancePlayoffs,
  aiAccepts,
  aiPick,
  aliveAlliances,
  allianceIndexOf,
  allianceStates,
  beginSelection,
  createTournament,
  dealRobots,
  ensureTeamRobots,
  finishSelection,
  playoffWinner,
  respondInvite,
  sanitizeTournament,
  selectionTurn,
  simulateMatch,
  type MatchResult,
  type PlayoffFormat,
  type TeamEntry,
  type Tournament,
} from '../src/core/tournament';

const CAD = ['cad:axiom', 'cad:phoenix', 'cad:psycho', 'cad:hazmat-704', 'cad:mentores-3478'];
const MECH: Record<string, MechanismKind> = { 'cad:axiom': 'pivot', 'cad:phoenix': 'pivot180', 'cad:psycho': 'longarm', 'cad:hazmat-704': 'elevator', 'cad:mentores-3478': 'dual' };
const KINDS: MechanismKind[] = ['pivot', 'pivot180', 'longarm', 'elevator', 'dual'];
const teams = (n: number): TeamEntry[] => Array.from({ length: n }, (_, i) => ({ id: `E${i + 1}`, name: `Equipo ${i + 1}`, robot: KINDS[i % KINDS.length], strength: ((i * 37) % 11) / 11, isPlayer: i === 0 }));

/** Empate exacto (marcador y desempates iguales): el match se repite. */
const TIE: MatchResult = {
  red: { score: 20, noFoul: 20, auto: 5, endgame: 10, samples: 3, rp: 0 },
  blue: { score: 20, noFoul: 20, auto: 5, endgame: 10, samples: 3, rp: 0 },
};

function toPlayoffs(n: number, format: PlayoffFormat, seed: number): Tournament {
  const t = createTournament(teams(n), 3, format, seed);
  const r = rng(seed * 3 + 1);
  for (const m of t.quals) m.result = simulateMatch(t, m, r);
  beginSelection(t);
  for (let g = 0; g < 80; g++) {
    const a = selectionTurn(t);
    if (a === null) break;
    const team = aiPick(t, a);
    respondInvite(t, team, a, aiAccepts(t, team, a, r));
  }
  finishSelection(t);
  return t;
}

/**
 * Juega los PlayOffs y revisa en cada paso que el siguiente match sea entre dos alianzas en juego, que
 * nadie marcado como eliminado reaparezca y que la lista de "en juego" solo se achique.
 */
function playChecked(t: Tournament, seed: number, ties = 0, reloadEvery = 0): void {
  const r = rng(seed);
  const out = new Set<number>();
  let prevAlive = aliveAlliances(t).length;
  let tiesLeft = ties;
  for (let k = 0; k < 400 && t.champion === null; k++) {
    if (reloadEvery && k % reloadEvery === 0) {
      const re = sanitizeTournament(JSON.parse(JSON.stringify(t)));
      expect(re).not.toBeNull();
      Object.assign(t, re);
    }
    const m = t.playoffs.find((x) => !x.result);
    if (!m) {
      advancePlayoffs(t);
      if (!t.playoffs.some((x) => !x.result)) break;
      continue;
    }
    const sides = [allianceIndexOf(t, m.red), allianceIndexOf(t, m.blue)];
    const states = allianceStates(t);
    for (const a of sides) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(out.has(a), `A${a + 1} eliminada aparece en ${m.id}`).toBe(false);
      expect(['alive', 'final']).toContain(states[a].status);
      expect(m.red === t.alliances![sides[0]] || JSON.stringify(m.red) === JSON.stringify(t.alliances![sides[0]])).toBe(true);
    }
    expect(sides[0]).not.toBe(sides[1]);
    m.result = tiesLeft-- > 0 ? TIE : simulateMatch(t, m, r);
    advancePlayoffs(t);
    for (const s of allianceStates(t)) if (s.status === 'out' || s.status === 'runnerUp') out.add(s.alliance);
    const alive = aliveAlliances(t).length;
    expect(alive).toBeLessThanOrEqual(prevAlive);
    prevAlive = alive;
  }
  expect(t.champion).not.toBeNull();
  // Al final: un campeón, un 2.º y las demás eliminadas, cada una con su lugar
  const st = allianceStates(t);
  expect(st.filter((s) => s.status === 'champion')).toHaveLength(1);
  expect(st.filter((s) => s.status === 'runnerUp')).toHaveLength(1);
  expect(st.every((s) => s.place !== undefined)).toBe(true);
  expect(new Set(st.map((s) => s.place)).size).toBe(st.length);
  expect(t.playoffs.every((m) => m.result)).toBe(true);
}

describe('eliminadas no reaparecen', () => {
  for (const format of ['manual', 'doubleElim'] as PlayoffFormat[])
    for (const n of [4, 6, 8, 10, 12])
      it(`${format}, ${n} equipos, 40 torneos`, () => {
        for (let seed = 1; seed <= 40; seed++) {
          const t = toPlayoffs(n, format, seed);
          const flat = t.alliances!.flat();
          expect(new Set(flat).size).toBe(flat.length);
          playChecked(t, seed * 17);
        }
      });

  it('con empates (se repite el match, nadie queda fuera por un empate)', () => {
    for (const format of ['manual', 'doubleElim'] as PlayoffFormat[])
      for (let seed = 1; seed <= 10; seed++) {
        const t = toPlayoffs(8, format, seed);
        const first = t.playoffs[0];
        playChecked(t, seed, 3);
        // El primer match empató: hay una repetición con las mismas alianzas
        const again = t.playoffs.filter((m) => m.slot === first.slot && m.kind === 'playoff');
        expect(again.length).toBeGreaterThan(1);
        expect(again.every((m) => m.red[0] === first.red[0] && m.blue[0] === first.blue[0])).toBe(true);
      }
  });

  it('doble eliminación: perder en la llave inferior elimina en ese momento (4.º y 3.º)', () => {
    const t = toPlayoffs(8, 'doubleElim', 3);
    const r = rng(5);
    const play = (slot: number) => {
      for (let g = 0; g < 10; g++) {
        const m = t.playoffs.find((x) => x.slot === slot && !x.result);
        if (!m) return;
        m.result = simulateMatch(t, m, r);
        advancePlayoffs(t);
      }
    };
    play(1);
    play(2);
    expect(allianceStates(t).every((s) => s.status === 'alive')).toBe(true);
    play(3);
    const m3 = t.playoffs.filter((m) => m.slot === 3).pop()!;
    const loser3 = allianceIndexOf(t, playoffWinner(m3) === 'red' ? m3.blue : m3.red);
    expect(allianceStates(t)[loser3]).toEqual({ alliance: loser3, status: 'out', place: 4 });
    expect(aliveAlliances(t)).not.toContain(loser3);
    expect(t.playoffs.filter((m) => !m.result).every((m) => ![m.red[0], m.blue[0]].includes(t.alliances![loser3][0]))).toBe(true);
  });

  it('formato del manual: al terminar el todos contra todos, 3.º y 4.º quedan eliminados y solo 2 van a la final (§8.2.2)', () => {
    const t = toPlayoffs(8, 'manual', 2);
    const r = rng(8);
    for (let g = 0; g < 100 && !t.playoffs.some((m) => m.kind === 'final'); g++) {
      const m = t.playoffs.find((x) => !x.result)!;
      m.result = simulateMatch(t, m, r);
      advancePlayoffs(t);
    }
    const st = allianceStates(t);
    expect(st.filter((s) => s.status === 'final')).toHaveLength(2);
    expect(st.filter((s) => s.status === 'out').map((s) => s.place).sort()).toEqual([3, 4]);
    const f = t.playoffs.find((m) => m.kind === 'final')!;
    expect([allianceIndexOf(t, f.red), allianceIndexOf(t, f.blue)].every((a) => st[a].status === 'final')).toBe(true);
  });
});

describe('recargar sin fantasmas', () => {
  it('guardar y abrir a la mitad de los PlayOffs da el mismo torneo', () => {
    for (const format of ['manual', 'doubleElim'] as PlayoffFormat[])
      for (let seed = 1; seed <= 15; seed++) playChecked(toPlayoffs(8, format, seed), seed, 0, 2);
  });

  it('un match pendiente guardado con una alianza ya eliminada se quita al abrir', () => {
    const t = toPlayoffs(8, 'doubleElim', 4);
    const r = rng(1);
    for (let g = 0; g < 30 && !t.playoffs.some((m) => m.slot === 3 && m.result && playoffWinner(m)); g++) {
      const m = t.playoffs.find((x) => !x.result)!;
      m.result = simulateMatch(t, m, r);
      advancePlayoffs(t);
    }
    const m3 = t.playoffs.filter((m) => m.slot === 3).pop()!;
    const loser = playoffWinner(m3) === 'red' ? m3.blue : m3.red;
    const other = t.alliances!.find((a) => a[0] !== loser[0])!;
    // Lo que dejaría una versión anterior con un error: la eliminada programada otra vez
    t.playoffs.push({ id: 'X1', kind: 'playoff', slot: 5, red: loser, blue: other });
    const re = sanitizeTournament(JSON.parse(JSON.stringify(t)))!;
    expect(re.playoffs.some((m) => m.id === 'X1')).toBe(false);
    expect(re.playoffs.filter((m) => !m.result).some((m) => m.red[0] === loser[0] || m.blue[0] === loser[0])).toBe(false);
  });

  it('rechaza un guardado roto: ids repetidos, equipo en dos alianzas o match fuera de las alianzas', () => {
    const base = toPlayoffs(8, 'manual', 6);
    const copy = () => JSON.parse(JSON.stringify(base)) as Tournament;
    const dupId = copy();
    dupId.quals[1].id = dupId.quals[0].id;
    expect(sanitizeTournament(dupId)).toBeNull();
    const dupTeam = copy();
    dupTeam.alliances![1][1] = dupTeam.alliances![0][1];
    expect(sanitizeTournament(dupTeam)).toBeNull();
    const stray = copy();
    stray.playoffs.push({ id: 'Z', kind: 'playoff', slot: 1, red: [0, 1], blue: [2, 3] });
    if (!stray.alliances!.some((a) => a[0] === 0 && a[1] === 1)) expect(sanitizeTournament(stray)).toBeNull();
    expect(sanitizeTournament(copy())).not.toBeNull();
  });

  it('un torneo nuevo empieza limpio (sin alianzas, PlayOffs ni campeón del anterior)', () => {
    const old = toPlayoffs(8, 'doubleElim', 9);
    playChecked(old, 3);
    const fresh = createTournament(teams(8), 3, 'doubleElim', 10);
    expect(fresh.alliances).toBeNull();
    expect(fresh.playoffs).toEqual([]);
    expect(fresh.champion).toBeNull();
    expect(allianceStates(fresh)).toEqual([]);
  });
});

describe('robots del torneo: solo los CAD', () => {
  it('dealRobots: el jugador lleva el suyo y la IA los demás CAD sin repetir mientras alcance', () => {
    const r = dealRobots(8, 2, 'cad:psycho', CAD, rng(4));
    expect(r[2]).toBe('cad:psycho');
    const ai = r.filter((_, i) => i !== 2);
    expect(ai.every((k) => CAD.includes(k) && k !== 'cad:psycho')).toBe(true);
    // 4 robots de la IA para 7 equipos: cada uno sale 1 o 2 veces
    const counts = new Map<string, number>();
    for (const k of ai) counts.set(k, (counts.get(k) ?? 0) + 1);
    expect([...counts.values()].every((c) => c >= 1 && c <= 2)).toBe(true);
  });

  it('un torneo guardado con robots de LabBot (quitados) recibe robots CAD al abrir', () => {
    const t = createTournament(teams(8), 3, 'manual', 12);
    t.teams[0].specId = 'cad:phoenix';
    expect(ensureTeamRobots(t, CAD, (id) => MECH[id])).toBe(true);
    expect(t.teams[0].specId).toBe('cad:phoenix');
    expect(t.teams.every((x) => CAD.includes(x.specId!))).toBe(true);
    expect(t.teams.slice(1).every((x) => x.robot === MECH[x.specId!])).toBe(true);
    // Ya con robots, no cambia nada
    const before = JSON.stringify(t);
    expect(ensureTeamRobots(t, CAD, (id) => MECH[id])).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
  });
});
