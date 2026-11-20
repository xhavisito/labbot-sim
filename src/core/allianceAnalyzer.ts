/**
 * Analizador de alianzas (lógica pura): con los torneos guardados en el historial (`core/history.ts`)
 * mira cada alianza de dos que jugó junta y responde qué combina mejor: qué pareja de tipos de robot,
 * qué pareja de estilos de juego y, para un equipo, qué compañero y qué estrategia le conviene.
 *
 * - Puntos de alianza = puntos propios sin faltas del rival (§4.4; las faltas son del otro, §4.5–§4.6).
 * - RP como en Qualifications (§4.4): victoria 2, empate 1, ambos cruzan la línea 1, Muestra Crítica 1,
 *   Dominio (≥10 Muestras) 1; con Red Card, 0 (§4.6, D10). En PlayOffs no cuentan (§8.2.2), pero aquí
 *   se calculan igual para comparar combinaciones con la misma vara (SUPUESTO).
 * - Estilo de un robot en un match (SUPUESTO, el manual no los define): "critical" si dejó la Muestra
 *   Crítica (§4.3.1); si no, el nivel donde anotó más Muestras (empate: el más alto); "park" si no anotó
 *   pero subió a la Plataforma; "none" si no hizo nada de eso. Los estilos se llaman como las
 *   estrategias de la IA (`ai/strategy.ts`) para poder aplicarlos.
 * - Sinergia (SUPUESTO): cuánto anotó la alianza por encima de la suma del OPR sin faltas de sus dos
 *   robots en ese evento (`core/opr.ts`). Positiva = juntos rinden más de lo que se esperaba de cada uno.
 * - Con pocos matches un promedio engaña: para ordenar se usa el promedio "encogido" hacia el promedio
 *   general con `PRIOR` matches ficticios (SUPUESTO).
 */
import type { GameConfig } from '../config/game';
import type { MechanismKind } from '../config/robot';
import type { HistoryData, HistoryEvent } from './history';
import { computeOpr } from './opr';
import { predictAlliance, summarize, type AlliancePrediction, type ScoutEntry } from './scouting';

export type PlayStyle = 'critical' | 'n3' | 'n2' | 'n1' | 'park' | 'none';
export const PLAY_STYLES: readonly PlayStyle[] = ['critical', 'n3', 'n2', 'n1', 'park', 'none'];

/** Matches ficticios con el promedio general que se suman a cada combinación al ordenar (SUPUESTO). */
export const PRIOR = 3;

/** Estilo de juego de un robot en un match (ver arriba). */
export function styleOf(e: Pick<ScoutEntry, 'critical' | 'platform' | 'samplesAuto' | 'samplesTeleop'>): PlayStyle {
  if (e.critical) return 'critical';
  const lv = [0, 1, 2].map((i) => e.samplesAuto[i] + e.samplesTeleop[i]);
  const top = Math.max(...lv);
  if (top > 0) return (['n1', 'n2', 'n3'] as const)[lv.lastIndexOf(top)];
  return e.platform ? 'park' : 'none';
}

/** Una alianza de dos en un match del historial. */
export interface AllianceObs {
  event: string;
  match: string;
  teams: [string, string];
  kinds: [MechanismKind, MechanismKind];
  styles: [PlayStyle, PlayStyle];
  /** Puntos propios (sin faltas del rival). */
  points: number;
  score: number;
  oppScore: number;
  /** 1 victoria, 0.5 empate, 0 derrota. */
  win: number;
  rp: number;
  /** Puntos propios − (OPR sin faltas de los dos en el evento). */
  synergy: number;
}

/** Alianzas de dos de un evento que tienen marcador y registro de sus dos robots. */
export function eventObservations(ev: HistoryEvent, cfg: GameConfig): AllianceObs[] {
  const kind = new Map(ev.teams.map((t) => [t.id, t.robot]));
  const opr = new Map(computeOpr(ev.matches).map((r) => [r.team, r.noFoul]));
  const entry = new Map<string, ScoutEntry>();
  for (const e of ev.entries) entry.set(`${e.match}|${e.team}`, e);
  const out: AllianceObs[] = [];
  for (const m of ev.matches) {
    const sides = [
      { teams: m.red, me: m.redScore, op: m.blueScore },
      { teams: m.blue, me: m.blueScore, op: m.redScore },
    ];
    for (const s of sides) {
      if (s.teams.length !== 2) continue;
      const es = s.teams.map((t) => entry.get(`${m.id}|${t}`));
      if (!es[0] || !es[1]) continue;
      const [a, b] = es as [ScoutEntry, ScoutEntry];
      const redCard = a.red || b.red;
      const win = s.me.score > s.op.score ? 1 : s.me.score === s.op.score ? 0.5 : 0;
      const rp = redCard
        ? 0
        : (win === 1 ? cfg.rp.win : win === 0.5 ? cfg.rp.tie : 0) +
          (a.autoLine && b.autoLine ? cfg.rp.autoLine : 0) +
          (a.critical || b.critical ? cfg.rp.critical : 0) +
          (s.me.samples >= cfg.rp.dominanceSamples ? cfg.rp.dominance : 0);
      out.push({
        event: ev.id,
        match: m.id,
        teams: [a.team, b.team],
        kinds: [kind.get(a.team)!, kind.get(b.team)!],
        styles: [styleOf(a), styleOf(b)],
        points: s.me.noFoul,
        score: s.me.score,
        oppScore: s.op.score,
        win,
        rp,
        synergy: s.me.noFoul - (opr.get(a.team) ?? 0) - (opr.get(b.team) ?? 0),
      });
    }
  }
  return out;
}

/** Todas las alianzas del historial (de una temporada si se da). */
export function observations(h: HistoryData, cfg: GameConfig, season?: string): AllianceObs[] {
  return h.events.filter((e) => !season || e.season === season).flatMap((e) => eventObservations(e, cfg));
}

/** Resultado promedio de una combinación (pareja sin orden). */
export interface ComboRow<T extends string> {
  pair: [T, T];
  matches: number;
  points: number;
  winRate: number;
  rp: number;
  synergy: number;
  /** Puntos encogidos hacia el promedio general (para ordenar). */
  rating: number;
  /** `rating` − promedio general. */
  lift: number;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sortPair = <T extends string>(a: T, b: T, order: readonly T[]): [T, T] => (order.indexOf(a) <= order.indexOf(b) ? [a, b] : [b, a]);

/** Agrupa las alianzas por pareja (sin orden) y ordena por `rating`. */
export function comboTable<T extends string>(obs: readonly AllianceObs[], pick: (o: AllianceObs) => [T, T], order: readonly T[], prior = PRIOR): ComboRow<T>[] {
  const all = mean(obs.map((o) => o.points));
  const by = new Map<string, { pair: [T, T]; os: AllianceObs[] }>();
  for (const o of obs) {
    const pair = sortPair(...pick(o), order);
    const k = pair.join('+');
    if (!by.has(k)) by.set(k, { pair, os: [] });
    by.get(k)!.os.push(o);
  }
  return [...by.values()]
    .map(({ pair, os }): ComboRow<T> => {
      const rating = (os.reduce((a, o) => a + o.points, 0) + prior * all) / (os.length + prior);
      return { pair, matches: os.length, points: mean(os.map((o) => o.points)), winRate: mean(os.map((o) => o.win)), rp: mean(os.map((o) => o.rp)), synergy: mean(os.map((o) => o.synergy)), rating, lift: rating - all };
    })
    .sort((a, b) => b.rating - a.rating || b.matches - a.matches);
}

export const kindCombos = (obs: readonly AllianceObs[], kinds: readonly MechanismKind[]): ComboRow<MechanismKind>[] => comboTable(obs, (o) => o.kinds, kinds);
export const styleCombos = (obs: readonly AllianceObs[]): ComboRow<PlayStyle>[] => comboTable(obs, (o) => o.styles, PLAY_STYLES);

/** Lo que el historial dice de un equipo y de con quién le conviene jugar. */
export interface TeamAdvice {
  team: string;
  matches: number;
  /** Tipo de robot del evento más reciente. */
  kind: MechanismKind | null;
  /** Estilo que más usó (null sin registros). */
  style: PlayStyle | null;
  /** Veces por estilo. */
  styles: Partial<Record<PlayStyle, number>>;
  /** Mejor tipo de robot para su compañero (combinaciones con su tipo). */
  partnerKind: ComboRow<MechanismKind> | null;
  /** Mejor estilo para su compañero cuando él juega su estilo de siempre. */
  partnerStyle: ComboRow<PlayStyle> | null;
  /** Mejor estilo para él mismo (de las alianzas donde jugó, encogido). */
  ownStyle: ComboRow<PlayStyle> | null;
  /** Compañeros ordenados: predicción con su historial y lo que hicieron cuando jugaron juntos. */
  partners: PartnerRow[];
}

export interface PartnerRow {
  team: string;
  kind: MechanismKind;
  prediction: AlliancePrediction;
  /** Matches juntos en el historial y sus puntos promedio. */
  together: number;
  togetherPoints: number | null;
  togetherWin: number | null;
  /** Puntos esperados (predicción) mezclada con lo real juntos, para ordenar. */
  rating: number;
}

/**
 * Consejo para `team`: su estilo, el mejor tipo de robot y estilo para su compañero y los mejores
 * compañeros. Los compañeros se ordenan por la predicción con todos sus registros del historial
 * (`predictAlliance`, puntos menos faltas) mezclada con lo que anotaron juntos, si jugaron juntos.
 */
export function teamAdvice(h: HistoryData, team: string, cfg: GameConfig, kinds: readonly MechanismKind[], season?: string, prior = PRIOR): TeamAdvice {
  const evs = h.events.filter((e) => !season || e.season === season);
  const obs = evs.flatMap((e) => eventObservations(e, cfg));
  const entries = evs.flatMap((e) => e.entries.map((x) => ({ ...x, match: `${e.id}|${x.match}` })));
  const kindOf = new Map<string, MechanismKind>();
  for (const e of evs) for (const t of e.teams) kindOf.set(t.id, t.robot);
  const mine = entries.filter((e) => e.team === team);
  const styles: Partial<Record<PlayStyle, number>> = {};
  for (const e of mine) styles[styleOf(e)] = (styles[styleOf(e)] ?? 0) + 1;
  const style = (Object.entries(styles) as Array<[PlayStyle, number]>).sort((a, b) => b[1] - a[1] || PLAY_STYLES.indexOf(a[0]) - PLAY_STYLES.indexOf(b[0]))[0]?.[0] ?? null;
  const kind = kindOf.get(team) ?? null;
  const has = <T>(p: [T, T], x: T) => p[0] === x || p[1] === x;
  const partnerKind = kind ? (kindCombos(obs, kinds).find((r) => has(r.pair, kind)) ?? null) : null;
  const partnerStyle = style ? (styleCombos(obs).find((r) => has(r.pair, style)) ?? null) : null;
  // Su propio estilo: de sus alianzas, agrupadas por el estilo que jugó él
  const myObs = obs.filter((o) => o.teams.includes(team));
  const ownStyle =
    comboTable(
      myObs,
      (o) => {
        const s = o.styles[o.teams.indexOf(team)];
        return [s, s];
      },
      PLAY_STYLES,
      prior,
    )[0] ?? null;
  const sums = summarize(entries, cfg);
  const me = sums.find((s) => s.team === team);
  const partners: PartnerRow[] = me
    ? sums
        .filter((s) => s.team !== team)
        .map((s): PartnerRow => {
          const prediction = predictAlliance(me, s, cfg);
          const tog = myObs.filter((o) => o.teams.includes(s.team));
          const pred = prediction.points - prediction.foulPts;
          const togetherPoints = tog.length ? mean(tog.map((o) => o.points)) : null;
          return {
            team: s.team,
            kind: kindOf.get(s.team)!,
            prediction,
            together: tog.length,
            togetherPoints,
            togetherWin: tog.length ? mean(tog.map((o) => o.win)) : null,
            rating: (pred * prior + (togetherPoints ?? 0) * tog.length) / (prior + tog.length),
          };
        })
        .sort((a, b) => b.rating - a.rating)
    : [];
  return { team, matches: mine.length, kind, style, styles, partnerKind, partnerStyle, ownStyle, partners };
}

/** El estilo del compañero dentro de una pareja que incluye `mine` (el otro, o el mismo si se repite). */
export const otherOf = <T>(pair: [T, T], mine: T): T => (pair[0] === mine ? pair[1] : pair[0]);
