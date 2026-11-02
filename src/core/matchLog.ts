/**
 * Registro de un match para exportar como JSON (pantalla de resultados): desglose y RP de cada
 * alianza, Muestras con su nivel y periodo, faltas y tarjetas con su regla (§ del manual), eventos
 * con su tiempo y la curva de puntos. Puro: sin DOM.
 */
import { RULES } from './fouls';
import type { Breakdown, Match, MatchEvent } from './match';
import { ALLIANCES, type Alliance } from './types';

export type TimedEvent = MatchEvent & { t: number };

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
