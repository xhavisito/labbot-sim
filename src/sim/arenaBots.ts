/**
 * Qué IA maneja cada robot de la arena (`sim/arena.ts`): `new` = la del juego (`ai/Bot.ts`, la crea
 * la sesión), `old` = la anterior congelada en `sim/oldai/` (cada alianza con su propio `Team`).
 */
import { ALLIANCES, opponent, type Alliance } from '../core/types';
import type { BotDriver, GameSession, SessionOptions } from '../game/GameSession';
import type { BotImpl } from './arena';
import { Bot as OldBot } from './oldai/Bot';
import { Team as OldTeam } from './oldai/Team';

type MakeBot = NonNullable<SessionOptions['makeBot']>;

/** Fábrica por match: `session()` da la sesión ya creada (el Human Player y el marcador). */
export function botFactory(session: () => GameSession): (impl: BotImpl) => MakeBot | undefined {
  let teams: Record<Alliance, OldTeam> | null = null;
  const oldTeam = (a: Alliance): OldTeam => {
    if (!teams) {
      const g = session();
      const need = g.game.rp.dominanceSamples;
      teams = { red: new OldTeam('red', g.hps.red), blue: new OldTeam('blue', g.hps.blue) };
      for (const x of ALLIANCES)
        teams[x].situation = () => {
          const m = g.match;
          return m ? { lead: m.score(x) - m.score(opponent(x)), samples: m.samplesIn(x), need } : { lead: 0, samples: 0, need };
        };
    }
    return teams[a];
  };
  return (impl) => {
    if (impl !== 'old') return undefined;
    return (r, o, all, pieces) => new OldBot(r, pieces, all, o, oldTeam(r.alliance)) as unknown as BotDriver;
  };
}
