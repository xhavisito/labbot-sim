/**
 * Simulación por lotes (sin render ni navegador): matches de solo IA entre estrategias de alianza
 * para medir el meta. Cada robot tiene un plan (tipo de robot, AUTO y papel de la IA); una alianza
 * son dos planes. La corre `scripts/batch.mjs` (`npm run batch`).
 *
 * La IA maneja "perfecto" dentro de sus límites (velocidades SUPUESTAS de `config/robot.ts`), así
 * que los puntos son un techo para cada estrategia: sirven para comparar, no como pronóstico.
 */
import type { BotOptions } from '../ai/Bot';
import { COLLECT_HOME, LEAVE_ZONE, SCORE_PRELOAD, type AutoRoutine } from '../auto/AutoRoutine';
import { GAME } from '../config/game';
import { FIRST_ROBOTS, type FirstRobot } from '../config/firstRobots';
import { CHASSIS_ROBOT, DEFAULT_ROBOT, ELEVATOR_ROBOT, PIVOT_ROBOT, TOWER_ROBOT, type RobotSpec } from '../config/robot';
import { entriesFromMatch, entryPoints } from '../core/scouting';
import { rng } from '../core/rng';
import { ALLIANCES, type Alliance } from '../core/types';
import { GameSession } from '../game/GameSession';

export interface RobotPlan {
  id: string;
  name: string;
  spec: RobotSpec;
  auto: AutoRoutine;
  bot: Partial<BotOptions>;
}

export interface AlliancePlan {
  id: string;
  name: string;
  robots: [RobotPlan, RobotPlan];
}

/** Chasis tanque sin mecanismo (base común de las sugerencias en MDF): solo cruza la línea y sube a la Plataforma. */
const CHASSIS: RobotSpec = CHASSIS_ROBOT;

/**
 * Variantes de un robot con mecanismo (`p` = prefijo del id): N3 base, + Crítica, solo del HP, solo del
 * Laboratorio, a Nivel 2, AUTO solo con la precarga y sin ENDGAME. `torren3` es lo mismo que `torre`
 * (y `pivn3` que `pivote`): se repiten con ids parejos para el conjunto `mech`.
 */
function mechVariants(p: string, name: string, spec: RobotSpec): Record<string, RobotPlan> {
  const v = (suffix: string, label: string, auto: AutoRoutine, bot: Partial<BotOptions>): [string, RobotPlan] => [
    `${p}${suffix}`,
    { id: `${p}${suffix}`, name: `${name} ${label}`, spec, auto, bot },
  ];
  return Object.fromEntries([
    v('n3', 'N3', COLLECT_HOME, { level: 3 }),
    v('crit3', 'N3 + Muestra Crítica', COLLECT_HOME, { level: 3, endgame: 'critical' }),
    v('hp3', 'N3 desde el HP', COLLECT_HOME, { level: 3, source: 'hp' }),
    v('lab3', 'N3 solo del Laboratorio', COLLECT_HOME, { level: 3, source: 'lab' }),
    v('n2', 'a Nivel 2', COLLECT_HOME, { level: 2 }),
    v('pre3', 'N3, AUTO solo precarga', SCORE_PRELOAD, { level: 3 }),
    v('sin3', 'N3 sin ENDGAME', COLLECT_HOME, { level: 3, endgame: 'none' }),
  ]);
}

export const ROBOT_PLANS = {
  chasis: { id: 'chasis', name: 'Chasis (línea + Plataforma)', spec: CHASSIS, auto: LEAVE_ZONE, bot: { role: 'park' } },
  n1: { id: 'n1', name: 'Genérico a Nivel 1', spec: DEFAULT_ROBOT, auto: SCORE_PRELOAD, bot: { level: 1 } },
  n2: { id: 'n2', name: 'Genérico a Nivel 2', spec: DEFAULT_ROBOT, auto: SCORE_PRELOAD, bot: { level: 2 } },
  n3: { id: 'n3', name: 'Genérico (elevador) a Nivel 3', spec: DEFAULT_ROBOT, auto: COLLECT_HOME, bot: { level: 3 } },
  n3pre: { id: 'n3pre', name: 'Genérico N3, AUTO solo precarga', spec: DEFAULT_ROBOT, auto: SCORE_PRELOAD, bot: { level: 3 } },
  n3sin: { id: 'n3sin', name: 'Genérico N3 sin ENDGAME', spec: DEFAULT_ROBOT, auto: COLLECT_HOME, bot: { level: 3, endgame: 'none' } },
  n3hp: { id: 'n3hp', name: 'Genérico N3 desde el HP', spec: DEFAULT_ROBOT, auto: COLLECT_HOME, bot: { level: 3, source: 'hp' } },
  n3crit: { id: 'n3crit', name: 'Genérico N3 + Muestra Crítica', spec: DEFAULT_ROBOT, auto: COLLECT_HOME, bot: { level: 3, endgame: 'critical' } },
  torre: { id: 'torre', name: 'Torre N3', spec: TOWER_ROBOT, auto: COLLECT_HOME, bot: { level: 3 } },
  torrehp: { id: 'torrehp', name: 'Torre N3 desde el HP', spec: TOWER_ROBOT, auto: COLLECT_HOME, bot: { level: 3, source: 'hp' } },
  torrelab: { id: 'torrelab', name: 'Torre N3 solo del Laboratorio', spec: TOWER_ROBOT, auto: COLLECT_HOME, bot: { level: 3, source: 'lab' } },
  torrecrit: { id: 'torrecrit', name: 'Torre N3 + Muestra Crítica', spec: TOWER_ROBOT, auto: COLLECT_HOME, bot: { level: 3, endgame: 'critical' } },
  pivote: { id: 'pivote', name: 'Pivote N3', spec: PIVOT_ROBOT, auto: COLLECT_HOME, bot: { level: 3 } },
  pivcrit: { id: 'pivcrit', name: 'Pivote N3 + Muestra Crítica', spec: PIVOT_ROBOT, auto: COLLECT_HOME, bot: { level: 3, endgame: 'critical' } },
  bloqueo: { id: 'bloqueo', name: 'Chasis que bloquea la Cámara rival', spec: CHASSIS, auto: LEAVE_ZONE, bot: { role: 'block' } },
  ...mechVariants('torre', 'Torre', TOWER_ROBOT),
  ...mechVariants('piv', 'Pivote', PIVOT_ROBOT),
  ...mechVariants('elev', 'Elevador', ELEVATOR_ROBOT),
} satisfies Record<string, RobotPlan>;

/** Plan de un robot de FIRST: recolecta en AUTO y juega con la estrategia que le funcionó en su juego. */
export const firstPlan = (r: FirstRobot): RobotPlan => ({ id: r.id, name: r.spec.label ?? r.spec.name, spec: r.spec, auto: COLLECT_HOME, bot: r.strategy });

type PlanId = keyof typeof ROBOT_PLANS;
const pair = (id: string, name: string, a: PlanId, b: PlanId): AlliancePlan => ({ id, name, robots: [ROBOT_PLANS[a], ROBOT_PLANS[b]] });

export const ALLIANCE_PLANS: AlliancePlan[] = [
  pair('chasis+chasis', 'Dos chasis', 'chasis', 'chasis'),
  pair('n1+chasis', 'N1 + chasis', 'n1', 'chasis'),
  pair('n1+n1', 'Dos a N1', 'n1', 'n1'),
  pair('n2+n2', 'Dos a N2', 'n2', 'n2'),
  pair('n3+chasis', 'N3 + chasis', 'n3', 'chasis'),
  pair('n3+n1', 'N3 + N1', 'n3', 'n1'),
  pair('n3+n3', 'Dos genéricos N3', 'n3', 'n3'),
  pair('n3pre+n3pre', 'Dos N3, AUTO solo precarga', 'n3pre', 'n3pre'),
  pair('n3sin+n3sin', 'Dos N3 sin ENDGAME', 'n3sin', 'n3sin'),
  pair('n3crit+n3', 'N3 con Crítica + N3', 'n3crit', 'n3'),
  pair('n3+n3hp', 'N3 + N3 del HP', 'n3', 'n3hp'),
  pair('torre+torre', 'Dos torres', 'torre', 'torre'),
  pair('torrelab+torrehp', 'Torre Laboratorio + torre HP', 'torrelab', 'torrehp'),
  pair('torrecrit+torre', 'Torre con Crítica + torre', 'torrecrit', 'torre'),
  pair('torrecrit+torrehp', 'Torre con Crítica + torre HP', 'torrecrit', 'torrehp'),
  pair('torre+chasis', 'Torre + chasis', 'torre', 'chasis'),
  pair('torre+n1', 'Torre + N1', 'torre', 'n1'),
  pair('pivote+pivote', 'Dos pivotes', 'pivote', 'pivote'),
  pair('torre+pivote', 'Torre + pivote', 'torre', 'pivote'),
  pair('torre+pivcrit', 'Torre + pivote con Crítica', 'torre', 'pivcrit'),
  pair('torre+bloqueo', 'Torre + bloqueo', 'torre', 'bloqueo'),
  pair('n3+bloqueo', 'N3 + bloqueo', 'n3', 'bloqueo'),
  // Robots de referencia de FIRST (`config/firstRobots.ts`), en pareja consigo mismos
  ...FIRST_ROBOTS.map((r): AlliancePlan => ({ id: `${r.id}+${r.id}`, name: `Dos ${r.spec.label}`, robots: [firstPlan(r), firstPlan(r)] })),
];

/**
 * Solo robots con mecanismo (pivote, torre, elevador; sin chasis ni genérico): en el reto nadie va a
 * llevar un chasis solo. Cada tipo consigo mismo y con los otros dos, con el reparto de papeles
 * (quién va por la Crítica, quién junta del HP o del Laboratorio) y variantes de nivel, AUTO y ENDGAME.
 * `npm run batch -- --set mech`.
 */
const TYPES = [
  ['torre', 'Torre'],
  ['piv', 'Pivote'],
  ['elev', 'Elevador'],
] as const;
const mp = (a: string, b: string, name: string): AlliancePlan => {
  const plans = ROBOT_PLANS as Record<string, RobotPlan>;
  return { id: `${a}+${b}`, name, robots: [plans[a], plans[b]] };
};
export const MECH_ALLIANCE_PLANS: AlliancePlan[] = [
  ...TYPES.flatMap(([p, n]) => [
    mp(`${p}n3`, `${p}n3`, `Dos ${n} N3`),
    mp(`${p}crit3`, `${p}n3`, `${n} con Crítica + ${n}`),
    mp(`${p}lab3`, `${p}hp3`, `${n} Laboratorio + ${n} HP`),
    mp(`${p}crit3`, `${p}hp3`, `${n} con Crítica + ${n} HP`),
    mp(`${p}n2`, `${p}n3`, `${n} N2 + ${n} N3`),
    mp(`${p}pre3`, `${p}pre3`, `Dos ${n}, AUTO solo precarga`),
    mp(`${p}sin3`, `${p}sin3`, `Dos ${n} sin ENDGAME`),
  ]),
  ...([
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const).flatMap(([i, j]) => {
    const [a, an] = TYPES[i];
    const [b, bn] = TYPES[j];
    return [
      mp(`${a}n3`, `${b}n3`, `${an} + ${bn}`),
      mp(`${a}crit3`, `${b}n3`, `${an} con Crítica + ${bn}`),
      mp(`${a}n3`, `${b}crit3`, `${an} + ${bn} con Crítica`),
      mp(`${a}lab3`, `${b}hp3`, `${an} Laboratorio + ${bn} HP`),
      mp(`${a}hp3`, `${b}lab3`, `${an} HP + ${bn} Laboratorio`),
    ];
  }),
];

/** Conjuntos de estrategias para `npm run batch -- --set <id>`. */
export const PLAN_SETS: Record<string, AlliancePlan[]> = { all: ALLIANCE_PLANS, mech: MECH_ALLIANCE_PLANS };

/** Lo que hizo cada robot (del scouting del match, `core/scouting.ts`). */
export interface RobotResult {
  plan: string;
  points: number;
  auto: number;
  teleop: number;
  endgame: number;
  samples: number;
  n3: number;
  autoLine: boolean;
  platform: boolean;
  critical: boolean;
  foulPts: number;
}

export interface AllianceResult {
  plan: string;
  robots: [RobotResult, RobotResult];
  total: number;
  /** Puntos propios (sin los que regalan las faltas del rival). */
  own: number;
  autoLine: number;
  samplesAuto: number;
  samplesTeleop: number;
  samples: number;
  platform: number;
  critical: number;
  /** Puntos que recibe por faltas del rival. */
  penaltiesIn: number;
  /** Puntos que regala al rival con sus faltas. */
  penaltiesOut: number;
  fouls: Record<string, number>;
  rp: number;
  rpAutoLine: boolean;
  rpCritical: boolean;
  rpDominance: boolean;
  win: 0 | 0.5 | 1;
}

export interface MatchResult {
  seed: number;
  red: AllianceResult;
  blue: AllianceResult;
}

export { rng };

/**
 * Un match completo de solo IA. `seed` varía un poco la pose inicial (±3 cm, ±3°) y el ritmo del
 * Human Player (2.5–4 s entre Muestras, SUPUESTO) para que no todos los matches salgan idénticos.
 */
export function runMatch(red: AlliancePlan, blue: AlliancePlan, seed = 1): MatchResult {
  const plans = [...red.robots, ...blue.robots];
  const rand = rng(seed);
  const g = new GameSession({
    player: -1, // ningún robot del jugador: la IA maneja los 4
    preload: true,
    ai: true,
    specs: plans.map((p) => p.spec),
    autos: plans.map((p) => p.auto),
    bots: plans.map((p) => p.bot),
    hp: { enabled: true, interval: 2.5 + rand() * 1.5 },
  });
  try {
    g.startMatch();
    for (const r of g.robots) {
      const p = r.phys.position();
      r.phys.teleport(p.x + (rand() - 0.5) * 0.06, p.z + (rand() - 0.5) * 0.06, r.phys.heading() + (rand() - 0.5) * 0.1);
    }
    const m = g.match!;
    for (let i = 0; i < 152 * 120 && !m.finished; i++) g.step();
    const res = {} as Record<Alliance, AllianceResult>;
    const scout = entriesFromMatch(m, plans.map((p) => p.id), 'batch');
    const robots: RobotResult[] = scout.map((e) => {
      const pt = entryPoints(e, GAME);
      return {
        plan: e.team,
        points: pt.total,
        auto: pt.auto,
        teleop: pt.teleop,
        endgame: pt.endgame,
        samples: e.samplesAuto.reduce((x, y) => x + y, 0) + e.samplesTeleop.reduce((x, y) => x + y, 0),
        n3: e.samplesAuto[2] + e.samplesTeleop[2],
        autoLine: e.autoLine,
        platform: e.platform,
        critical: e.critical,
        foulPts: pt.foulPts,
      };
    });
    for (const a of ALLIANCES) {
      const b = m.breakdown(a);
      const rp = m.rankingPoints(a);
      const fouls: Record<string, number> = {};
      for (const f of m.fouls) if (f.offender === a) fouls[f.rule] = (fouls[f.rule] ?? 0) + 1;
      const other = a === 'red' ? 'blue' : 'red';
      res[a] = {
        plan: a === 'red' ? red.id : blue.id,
        robots: a === 'red' ? [robots[0], robots[1]] : [robots[2], robots[3]],
        total: b.total,
        own: b.subtotal - b.penalties,
        autoLine: b.autoLine,
        samplesAuto: b.samplesAuto,
        samplesTeleop: b.samplesTeleop,
        samples: m.samplesIn(a),
        platform: b.platform,
        critical: b.critical,
        penaltiesIn: b.penalties,
        penaltiesOut: m.breakdown(other).penalties,
        fouls,
        rp: rp.total,
        rpAutoLine: rp.autoLine,
        rpCritical: rp.critical,
        rpDominance: rp.dominance,
        win: m.score(a) > m.score(other) ? 1 : m.score(a) === m.score(other) ? 0.5 : 0,
      };
    }
    return { seed, red: res.red, blue: res.blue };
  } finally {
    g.dispose();
  }
}
