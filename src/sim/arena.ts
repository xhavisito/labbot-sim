/**
 * Arena de la IA (sin render ni navegador): matches con los robots CAD que usa el juego
 * (`ai/lineup.ts`) y la configuración que arma el menú (`App.sessionOptions`), para medir la IA
 * como se juega de verdad. La corre `scripts/arena.mjs` (`npm run arena`).
 *
 * Cada robot lleva su tipo, su AUTO y sus opciones de IA; `impl` elige qué IA lo maneja
 * (`new` = la de `ai/Bot.ts`, `old` = la anterior, congelada en `sim/oldai/`), así se pueden enfrentar.
 */
import type { BotOptions } from '../ai/Bot';
import { SECRET_AUTOS, SECRET_PERSONAS, SECRET_STRATEGIES, STRATEGY_OPTIONS, weighted } from '../ai/strategy';
import { AUTO_ROUTINES, LEAVE_ZONE } from '../auto/AutoRoutine';
import { CAD_ROBOT_SPECS } from '../cad/cadRobots';
import { GAME } from '../config/game';
import { entriesFromMatch, entryPoints } from '../core/scouting';
import { rng } from '../core/rng';
import { ALLIANCES, type Alliance } from '../core/types';
import { GameSession, type BotDriver, type SessionOptions } from '../game/GameSession';

export type BotImpl = 'new' | 'old';

export interface ArenaRobot {
  /** Id del robot CAD (`robots/<id>.robot.json`). */
  type: string;
  auto: string;
  bot: Partial<BotOptions>;
  impl: BotImpl;
}

export interface ArenaRobotResult {
  type: string;
  impl: BotImpl;
  label: string;
  points: number;
  samples: number;
  platform: boolean;
  critical: boolean;
  foulPts: number;
  stuck: number;
  modes: Record<string, number>;
  /** Faltas que cometió (regla y segundo del match). */
  fouls: string[];
}

export interface ArenaAllianceResult {
  total: number;
  own: number;
  samples: number;
  penaltiesOut: number;
  rp: number;
  win: 0 | 0.5 | 1;
  robots: ArenaRobotResult[];
}

export interface ArenaResult {
  seed: number;
  scenario: string;
  red: ArenaAllianceResult;
  blue: ArenaAllianceResult;
}

export const CAD_TYPES = (): string[] => Object.keys(CAD_ROBOT_SPECS);

/** Tipos al azar sin repetir mientras haya (como `aiLineup`). */
function lineup(rand: () => number): string[] {
  const deck = [...CAD_TYPES()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return [0, 1, 2, 3].map((i) => deck[i % deck.length]);
}

/**
 * Escenarios:
 * - `shipped:<impl>`: como el juego por defecto con el jugador en el rojo 1 (lo maneja la IA de
 *   `impl` en Experto, como un piloto bueno), su compañero con los ajustes por defecto y los rivales
 *   con estrategia, AUTO y personalidad secretas al azar (`ai/strategy.ts`).
 * - `mirror:<impl>`: los 4 iguales (por defecto); debe salir parejo.
 * - `vs:<a>:<b>`: rojo con la IA `a`, azul con la IA `b`, mismos ajustes y tipos cruzados.
 */
export function scenarioRobots(scenario: string, seed: number): { robots: ArenaRobot[]; swap: boolean } {
  const rand = rng(seed * 7 + 3);
  const types = lineup(rand);
  const parts = scenario.split(':');
  const kind = parts[0];
  if (kind === 'shipped' || kind === 'shippedfix') {
    const impl = (parts[1] ?? 'new') as BotImpl;
    const robots = [0, 1, 2, 3].map((i): ArenaRobot => {
      if (i === 0) return { type: types[i], auto: 'collect', bot: { ai: 'expert' }, impl };
      if (i === 1) return { type: types[i], auto: 'preload', bot: { ai: 'hard' }, impl };
      if (kind === 'shippedfix') return { type: types[i], auto: 'preload', bot: { ai: 'hard' }, impl };
      const strategy = weighted(SECRET_STRATEGIES, rand);
      const auto = weighted(SECRET_AUTOS, rand);
      const persona = weighted(SECRET_PERSONAS, rand);
      return { type: types[i], auto: strategy === 'park' ? 'leave' : auto, bot: { ...STRATEGY_OPTIONS[strategy], ai: 'hard', persona }, impl };
    });
    return { robots, swap: false };
  }
  if (kind === 'mirror') {
    const impl = (parts[1] ?? 'new') as BotImpl;
    return { robots: types.map((type) => ({ type, auto: 'collect', bot: { ai: 'hard' }, impl })), swap: false };
  }
  if (kind === 'vs') {
    const a = parts[1] as BotImpl;
    const b = parts[2] as BotImpl;
    const lvl = (parts[3] ?? 'hard') as BotOptions['ai'];
    // Semillas pares: `a` de rojo; impares: `a` de azul (mismo lineup por par)
    const swap = seed % 2 === 1;
    const t = lineup(rng(Math.floor(seed / 2) * 7 + 3));
    const robots = [0, 1, 2, 3].map((i): ArenaRobot => ({ type: t[i], auto: 'collect', bot: { ai: lvl }, impl: (i < 2) !== swap ? a : b }));
    return { robots, swap };
  }
  throw new Error(`escenario desconocido: ${scenario}`);
}

type MakeBot = (impl: BotImpl) => NonNullable<SessionOptions['makeBot']> | undefined;

export function runArena(scenario: string, seed: number, factory?: (session: () => GameSession) => MakeBot): ArenaResult {
  const { robots } = scenarioRobots(scenario, seed);
  const rand = rng(seed);
  const specs = robots.map((r) => CAD_ROBOT_SPECS[r.type]);
  const autos = robots.map((r) => AUTO_ROUTINES.find((a) => a.id === r.auto) ?? LEAVE_ZONE);
  // eslint-disable-next-line prefer-const
  let g: GameSession;
  const makeBotFor = factory?.(() => g);
  g = new GameSession({
    player: -1,
    preload: true,
    ai: true,
    specs,
    autos,
    bots: robots.map((r) => r.bot),
    hp: { enabled: true, interval: 2.5 + rand() * 1.5, smart: true },
    seed,
    makeBot: (r, o, all, pieces) => {
      const mk = makeBotFor?.(robots[r.index].impl);
      return (mk?.(r, o, all, pieces) ?? null) as BotDriver | null;
    },
  });
  try {
    g.startMatch();
    for (const r of g.robots) {
      const p = r.phys.position();
      r.phys.teleport(p.x + (rand() - 0.5) * 0.06, p.z + (rand() - 0.5) * 0.06, r.phys.heading() + (rand() - 0.5) * 0.1);
    }
    const m = g.match!;
    const stuck = g.robots.map(() => 0);
    const modes = g.robots.map((): Record<string, number> => ({}));
    const dt = 1 / 120;
    for (let i = 0; i < 152 * 120 && !m.finished; i++) {
      g.step();
      for (const r of g.robots) {
        const mode = (g.bots[r.index] as { mode?: string } | null)?.mode;
        if (mode) modes[r.index][mode] = (modes[r.index][mode] ?? 0) + dt;
        const c = r.phys.lastCmd;
        const v = r.phys.body.linvel();
        const w = r.phys.body.angvel();
        if ((Math.abs(c.forward) > 0.15 || Math.abs(c.turn) > 0.3) && Math.hypot(v.x, v.z) < 0.05 && Math.abs(w.y) < 0.15) stuck[r.index] += dt;
      }
    }
    const scout = entriesFromMatch(m, robots.map((r) => r.type), 'arena');
    const per: ArenaRobotResult[] = scout.map((e, k) => {
      const pt = entryPoints(e, GAME);
      const b = robots[k].bot;
      return {
        type: robots[k].type,
        impl: robots[k].impl,
        label: [b.ai, b.persona, b.level && `N${b.level}`, b.endgame, b.source, robots[k].auto].filter(Boolean).join('/'),
        points: pt.total,
        samples: e.samplesAuto.reduce((x, y) => x + y, 0) + e.samplesTeleop.reduce((x, y) => x + y, 0),
        platform: e.platform,
        critical: e.critical,
        foulPts: pt.foulPts,
        stuck: Math.round(stuck[k] * 10) / 10,
        modes: Object.fromEntries(Object.entries(modes[k]).map(([a, b]) => [a, Math.round(b * 10) / 10])),
        fouls: m.fouls.filter((f) => f.robot === k).map((f) => `${f.rule}@${Math.round(f.time)}`),
      };
    });
    const res = {} as Record<Alliance, ArenaAllianceResult>;
    for (const a of ALLIANCES) {
      const b = m.breakdown(a);
      const other = a === 'red' ? 'blue' : 'red';
      res[a] = {
        total: b.total,
        own: b.subtotal - b.penalties,
        samples: m.samplesIn(a),
        penaltiesOut: m.breakdown(other).penalties,
        rp: m.rankingPoints(a).total,
        win: m.score(a) > m.score(other) ? 1 : m.score(a) === m.score(other) ? 0.5 : 0,
        robots: a === 'red' ? per.slice(0, 2) : per.slice(2, 4),
      };
    }
    return { seed, scenario, red: res.red, blue: res.blue };
  } finally {
    g.dispose();
  }
}
