/**
 * Registro de un match para exportar como JSON (pantalla de resultados): desglose y RP de cada
 * alianza, Muestras con su nivel y periodo, faltas y tarjetas con su regla (§ del manual), eventos
 * con su tiempo y la curva de puntos. Puro: sin DOM.
 */
import { RULES } from './fouls';
import type { Breakdown, Match, MatchEvent } from './match';
import { ALLIANCES, opponent, type Alliance } from './types';

export type TimedEvent = MatchEvent & { t: number };

/** Un Ranking Point (o el RP de victoria/empate) con el motivo de por qué se ganó o se perdió. */
export interface RpReason {
  key: 'win' | 'autoLine' | 'critical' | 'dominance';
  earned: number;
  possible: number;
  /** Sección del manual (§4.4). */
  section: string;
  /** Explicación en español con las cifras del match. */
  why: string;
  /** Segundo del match en que se logró (si aplica y se conoce). */
  at?: number;
}

export interface MatchLog {
  format: 'labbot-rescue-match';
  version: 1;
  createdAt: string;
  meta: Record<string, unknown>;
  alliances: Record<
    Alliance,
    {
      /** Desglose como se muestra: la Línea de Autónomo va dentro de `auto` (Puntos de AUTO). */
      breakdown: Omit<Breakdown, 'autoLine' | 'samplesAuto'>;
      rankingPoints: ReturnType<Match['rankingPoints']>;
      samples: Match['state']['red']['samples'];
      platformRobots: number;
      critical: boolean;
      /** Por qué se ganó o perdió cada RP (§4.4). */
      rpReasons: RpReason[];
    }
  >;
  fouls: Array<Match['fouls'][number] & { section: string; description: string }>;
  cards: Match['cards'];
  events: TimedEvent[];
  scoreHistory: Match['history'];
}

/** Quita la Línea de Autónomo y las Muestras del AUTO por separado: ya suman en `auto`. */
function shownBreakdown(b: Breakdown): Omit<Breakdown, 'autoLine' | 'samplesAuto'> {
  const { autoLine: _line, samplesAuto: _auto, ...rest } = b;
  return rest;
}

/** Explica cada RP de la alianza `a` con cifras (§4.4). `events` sirve para fechar la línea de AUTO. */
export function explainRp(m: Match, a: Alliance, events: readonly TimedEvent[] = []): RpReason[] {
  const R = m.cfg.rp;
  const rp = m.rankingPoints(a);
  const s = m.state[a];
  const mine = m.score(a);
  const other = m.score(opponent(a));
  const redCard = m.breakdown(a).redCard;
  const out: RpReason[] = [];

  let win: string;
  if (redCard) win = `Red Card: la alianza pierde todos sus puntos y sus RP (${mine} contra ${other}).`;
  else if (mine > other) win = `Ganó ${mine} a ${other}.`;
  else if (mine === other) win = `Empate ${mine} a ${other}.`;
  else win = `Perdió ${mine} a ${other} (faltaron ${other - mine + 1} para ganar).`;
  out.push({ key: 'win', earned: redCard ? 0 : rp.win, possible: R.win, section: '§4.4', why: win });

  const crossed = s.autoLine.size;
  const need = m.robotsPerAlliance;
  const lastLine = events.filter((e) => e.type === 'autoLine' && e.alliance === a).map((e) => e.t).sort((x, y) => x - y)[need - 1];
  out.push({
    key: 'autoLine', earned: rp.autoLine && !redCard ? R.autoLine : 0, possible: R.autoLine, section: '§4.4',
    why: rp.autoLine ? `Cruzaron la línea en AUTO ${crossed} de ${need} robots.` : `Solo cruzaron la línea en AUTO ${crossed} de ${need} robots.`,
    ...(rp.autoLine && lastLine !== undefined ? { at: lastLine } : {}),
  });

  out.push({
    key: 'critical', earned: rp.critical && !redCard ? R.critical : 0, possible: R.critical, section: '§4.4',
    why: rp.critical ? 'La Muestra Crítica quedó en la Repisa al sonar la bocina.' : 'La Muestra Crítica no estaba en la Repisa al sonar la bocina.',
  });

  const n = m.samplesIn(a);
  const tenth = [...s.samples].sort((x, y) => x.time - y.time)[R.dominanceSamples - 1];
  out.push({
    key: 'dominance', earned: rp.dominance && !redCard ? R.dominance : 0, possible: R.dominance, section: '§4.4',
    why: rp.dominance ? `${n} Muestras en la Cámara (mínimo ${R.dominanceSamples}).` : `${n} Muestras en la Cámara; faltaron ${R.dominanceSamples - n} para el mínimo de ${R.dominanceSamples}.`,
    ...(rp.dominance && tenth ? { at: Math.round(tenth.time * 1000) / 1000 } : {}),
  });
  return out;
}

/** Arma el registro. `t` de cada evento = segundos desde el inicio del match. */
export function buildMatchLog(m: Match, events: readonly TimedEvent[], meta: Record<string, unknown> = {}, now = new Date()): MatchLog {
  const alliances = {} as MatchLog['alliances'];
  for (const a of ALLIANCES) {
    const s = m.state[a];
    alliances[a] = {
      breakdown: shownBreakdown(m.breakdown(a)),
      rankingPoints: m.rankingPoints(a),
      samples: s.samples.map((x) => ({ ...x })),
      platformRobots: s.platformRobots,
      critical: s.critical,
      rpReasons: explainRp(m, a, events),
    };
  }
  return {
    format: 'labbot-rescue-match',
    version: 1,
    createdAt: now.toISOString(),
    meta,
    alliances,
    fouls: m.fouls.map((f) => ({ ...f, section: RULES[f.rule].section, description: RULES[f.rule].es })),
    cards: m.cards.map((c) => ({ ...c })),
    events: events.map((e) => ({ ...e })),
    scoreHistory: m.history.map((h) => ({ ...h })),
  };
}
