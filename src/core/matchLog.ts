/**
 * Registro de un match para exportar como JSON (pantalla de resultados): desglose y RP de cada
 * alianza, Muestras con su nivel y periodo, faltas y tarjetas con su regla (§ del manual), eventos
 * con su tiempo y la curva de puntos. Puro: sin DOM.
 */
import { RULES } from './fouls';
import type { Match, MatchEvent } from './match';
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
      breakdown: ReturnType<Match['breakdown']>;
      rankingPoints: ReturnType<Match['rankingPoints']>;
      samples: Match['state']['red']['samples'];
      autoLineRobots: number[];
      platformRobots: number;
      critical: boolean;
    }
  >;
  fouls: Array<Match['fouls'][number] & { section: string; description: string }>;
  cards: Match['cards'];
  events: TimedEvent[];
  scoreHistory: Match['history'];
}

/** Arma el registro. `t` de cada evento = segundos desde el inicio del match. */
export function buildMatchLog(m: Match, events: readonly TimedEvent[], meta: Record<string, unknown> = {}, now = new Date()): MatchLog {
  const alliances = {} as MatchLog['alliances'];
  for (const a of ALLIANCES) {
    const s = m.state[a];
    alliances[a] = {
      breakdown: m.breakdown(a),
      rankingPoints: m.rankingPoints(a),
      samples: s.samples.map((x) => ({ ...x })),
      autoLineRobots: [...s.autoLine].sort((x, y) => x - y),
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
