import { describe, expect, it } from 'vitest';
import { GAME } from '../src/config/game';
import { PIVOT_ROBOT } from '../src/config/robot';
import { FRAME_HEAD, frameSize, PIECE_VALUES, ROBOT_VALUES, type Replay, type ReplayHeader } from '../src/replay/format';
import { buildMoments, highlightTime, highlightWindows, jumpTime, LEAD_IN, matchesFilter, momentTotals, nextMoment, prevMoment } from '../src/replay/moments';

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

const foul = (t: number, rule: 'CONTACT' | 'OBSTRUCT', kind: 'FOUL' | 'TECH', offender: 'red' | 'blue', robot: number) =>
  ({ t, type: 'foul', foul: { rule, kind, offender, robot, time: t } }) as const;

describe('jugadas clave de la repetición', () => {
  const r = fake(
    [
      { t: 9, type: 'score', robot: 2, alliance: 'blue', level: 3, points: 18, period: 'AUTO' },
      { t: 60, type: 'score', robot: 0, alliance: 'red', level: 1, points: 2, period: 'TELEOP' },
      { t: 130, type: 'grabCritical', robot: 3 },
      { t: 138, type: 'release', robot: 3, kind: 'critical' },
      { t: 140, type: 'release', robot: 1, kind: 'critical' },
    ],
    [
      { t: 0, type: 'phase', phase: 'AUTO', prev: 'PRE' },
      { t: 3, type: 'autoLine', alliance: 'red', robot: 0 },
      { t: 15, type: 'phase', phase: 'TELEOP', prev: 'AUTO' },
      // Duplicado del registro: no debe salir dos veces (ya viene en los eventos de la grabación)
      { t: 60, type: 'sample', alliance: 'red', level: 1, points: 2 },
      foul(70, 'CONTACT', 'FOUL', 'red', 1),
      foul(71, 'OBSTRUCT', 'TECH', 'blue', 2),
      { t: 71, type: 'card', card: { type: 'YELLOW', robot: 2, alliance: 'blue', time: 71, reason: 'x' } },
      { t: 120, type: 'phase', phase: 'ENDGAME', prev: 'TELEOP' },
    ],
    { platform: [2, 3, 0], critical: { red: false, blue: true } },
  );
  const ms = buildMoments(r);

  it('ordena todo por tiempo y no duplica las Muestras del registro', () => {
    for (let i = 1; i < ms.length; i++) expect(ms[i].t).toBeGreaterThanOrEqual(ms[i - 1].t);
    expect(ms.filter((m) => m.kind === 'score')).toHaveLength(2);
    // El inicio del AUTO no es jugada (el match empieza ahí); TELEOP y ENDGAME sí
    expect(ms.filter((m) => m.kind === 'phase').map((m) => m.phase)).toEqual(['TELEOP', 'ENDGAME']);
  });

  it('las faltas dan sus puntos a la alianza contraria (§4.5 Foul 4, §4.6 Tech Foul 8)', () => {
    const f = ms.filter((m) => m.kind === 'foul');
    expect(f.map((m) => [m.alliance, m.pointsTo, m.points, m.section])).toEqual([
      ['red', 'blue', GAME.fouls.foul, '§4.5'],
      ['blue', 'red', GAME.fouls.tech, '§4.6, §6.1'],
    ]);
    const card = ms.find((m) => m.kind === 'card')!;
    expect(card.points).toBeUndefined();
    expect(card.section).toBe('§4.3.2');
  });

  it('Muestra Crítica y Plataforma se valen al sonar la bocina (§4.3.1, §4.4)', () => {
    const crit = ms.filter((m) => m.kind === 'critical');
    // Azul la dejó en la Repisa: 15. Rojo la soltó pero al final no estaba: jugada sin puntos
    expect(crit.map((m) => [m.alliance, m.points])).toEqual([
      ['blue', GAME.points.critical],
      ['red', undefined],
    ]);
    const plat = ms.filter((m) => m.kind === 'platform');
    expect(plat.map((m) => [m.alliance, m.robots, m.points, m.t])).toEqual([
      ['blue', 2, GAME.points.platformTwo, 150],
      ['red', 1, GAME.points.platformOne, 150],
    ]);
  });

  it('el total de las jugadas es el marcador (puntos, línea, Crítica, Plataforma y faltas)', () => {
    const tot = momentTotals(ms);
    // Rojo: línea 5 + N1 2 + Tech Foul azul 8 + 1 robot en Plataforma 10
    expect(tot.red).toBe(5 + 2 + 8 + 10);
    // Azul: N3 en AUTO 18 + Foul rojo 4 + Crítica 15 + Alianza en Plataforma 20
    expect(tot.blue).toBe(18 + 4 + 15 + 20);
  });

  it('filtros: Puntos no incluye faltas; Faltas solo faltas y tarjetas', () => {
    expect(ms.filter((m) => matchesFilter(m, 'fouls')).map((m) => m.kind)).toEqual(['foul', 'foul', 'card']);
    const pts = ms.filter((m) => matchesFilter(m, 'points'));
    expect(pts.some((m) => m.kind === 'foul' || m.kind === 'card' || m.kind === 'phase')).toBe(false);
    expect(pts).toHaveLength(2 + 1 + 2 + 2);
  });

  it('siguiente y anterior saltan con unos segundos de entrada', () => {
    const pts = ms.filter((m) => matchesFilter(m, 'points'));
    // Desde el inicio, la primera aunque su entrada (t = 3 − 3) caiga justo en 0
    const first = nextMoment(pts, 0)!;
    expect(first.kind).toBe('autoLine');
    expect(nextMoment(pts, jumpTime(first), LEAD_IN, first)!.t).toBe(9);
    // Muestra Crítica (138) y Plataforma (150) tienen entradas separadas; con `last` no se repite
    const crit = pts.find((m) => m.kind === 'critical')!;
    expect(nextMoment(pts, jumpTime(crit), LEAD_IN, crit)!.alliance).toBe('red');
    expect(prevMoment(pts, jumpTime(crit), LEAD_IN, crit)!.t).toBe(60);
    expect(jumpTime(pts[1])).toBe(9 - LEAD_IN);
    // Desde donde se ve la N1 (t = 57), la anterior es la N3 del AUTO
    expect(prevMoment(pts, jumpTime(pts[2]))!.t).toBe(9);
    expect(prevMoment(pts, 0)).toBeNull();
    expect(nextMoment(pts, 149)).toBeNull();
  });

  it('el Resumen une jugadas cercanas y salta los huecos', () => {
    const w = highlightWindows(ms.filter((m) => matchesFilter(m, 'fouls')), 150);
    // Faltas en 70 y 71 (y la tarjeta en 71) quedan en una sola ventana
    expect(w).toEqual([[67, 73]]);
    expect(highlightTime(w, 10)).toBe(67);
    expect(highlightTime(w, 70)).toBe(70);
    expect(highlightTime(w, 80)).toBeNull();
    // Las de la bocina no pasan del final
    const end = highlightWindows(ms.filter((m) => m.kind === 'platform'), 150);
    expect(end).toEqual([[147, 150]]);
  });

  it('sin eventos de la grabación usa las Muestras del registro del match', () => {
    const old = fake([], [{ t: 20, type: 'sample', alliance: 'blue', level: 2, points: 6 }]);
    const m = buildMoments(old);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'score', alliance: 'blue', points: 6, level: 2 });
  });
});
