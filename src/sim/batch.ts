/**
 * Simulación por lotes (sin render ni navegador): matches de solo IA entre estrategias de alianza
 * para medir el meta. Cada robot tiene un plan (tipo de robot, AUTO y papel de la IA); una alianza
 * son dos planes. La corre `scripts/batch.mjs` (`npm run batch`).
 *
 * La IA maneja "perfecto" dentro de sus límites (velocidades SUPUESTAS de `config/robot.ts`), así
 * que los puntos son un techo para cada estrategia: sirven para comparar, no como pronóstico.
 */
import type { BotOptions } from '../ai/Bot';
import { AI_LEVELS, type AiLevel } from '../ai/difficulty';
import { COLLECT_HOME, LEAVE_ZONE, SCORE_PRELOAD, type AutoRoutine } from '../auto/AutoRoutine';
import { GAME } from '../config/game';
import { MECHANISM_KINDS, PIVOT_180_ROBOT, PIVOT_ROBOT, ROBOT_PRESETS, type RobotSpec } from '../config/robot';
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

/**
 * Variantes de un tipo de robot (`p` = prefijo del id): N3 base, + Crítica, solo del HP, solo del
 * Laboratorio, a Nivel 2, AUTO solo con la precarga, sin ENDGAME y solo Plataforma (sin anotar).
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
    v('park', 'solo línea y Plataforma', LEAVE_ZONE, { role: 'park' }),
  ]);
}

export const ROBOT_PLANS = {
  ...mechVariants('piv', 'Pivote', PIVOT_ROBOT),
  ...mechVariants('p180', 'Pivote 180°', PIVOT_180_ROBOT),
  bloqueo: { id: 'bloqueo', name: 'Pivote que bloquea la Cámara rival', spec: PIVOT_ROBOT, auto: LEAVE_ZONE, bot: { role: 'block' } },
} satisfies Record<string, RobotPlan>;

const mp = (a: string, b: string, name: string): AlliancePlan => {
  const plans = ROBOT_PLANS as Record<string, RobotPlan>;
  return { id: `${a}+${b}`, name, robots: [plans[a], plans[b]] };
};

/** Los dos tipos del simulador (`config/robot.ts`). */
const TYPES = [
  ['piv', 'Pivote'],
  ['p180', 'Pivote 180°'],
] as const;

/**
 * Cada tipo consigo mismo y con el otro, con el reparto de papeles (quién va por la Crítica, quién
 * junta del HP o del Laboratorio) y variantes de nivel, AUTO y ENDGAME. `npm run batch -- --set mech`.
 */
export const MECH_ALLIANCE_PLANS: AlliancePlan[] = [
  ...TYPES.flatMap(([p, n]) => [
    mp(`${p}n3`, `${p}n3`, `Dos ${n} N3`),
    mp(`${p}crit3`, `${p}n3`, `${n} con Crítica + ${n}`),
    mp(`${p}lab3`, `${p}hp3`, `${n} Laboratorio + ${n} HP`),
    mp(`${p}crit3`, `${p}hp3`, `${n} con Crítica + ${n} HP`),
    mp(`${p}n2`, `${p}n3`, `${n} N2 + ${n} N3`),
    mp(`${p}pre3`, `${p}pre3`, `Dos ${n}, AUTO solo precarga`),
    mp(`${p}sin3`, `${p}sin3`, `Dos ${n} sin ENDGAME`),
    mp(`${p}n3`, `${p}park`, `${n} N3 + ${n} solo Plataforma`),
  ]),
  mp('pivn3', 'p180n3', 'Pivote + Pivote 180°'),
  mp('pivcrit3', 'p180n3', 'Pivote con Crítica + Pivote 180°'),
  mp('pivn3', 'p180crit3', 'Pivote + Pivote 180° con Crítica'),
  mp('pivlab3', 'p180hp3', 'Pivote Laboratorio + Pivote 180° HP'),
  mp('pivhp3', 'p180lab3', 'Pivote HP + Pivote 180° Laboratorio'),
];

/** Estrategias de alianza de siempre (`--set all`): las de `mech` más el bloqueo (para medir cuánto cuesta, §4.6). */
export const ALLIANCE_PLANS: AlliancePlan[] = [...MECH_ALLIANCE_PLANS, mp('pivn3', 'bloqueo', 'Pivote + bloqueo')];

/**
 * Entre dificultades: alianzas de los dos tipos (como juegan los robots de la IA en el juego,
 * `ai/lineup.ts`). Ids `<dificultad>:<tipo>+<tipo>`.
 * `npm run batch -- --set ai --a hard --b normal` enfrenta cada alianza `hard:` con cada `normal:`.
 */
function aiPlans(): AlliancePlan[] {
  const out: AlliancePlan[] = [];
  const pairs = [
    [MECHANISM_KINDS[0], MECHANISM_KINDS[0]],
    [MECHANISM_KINDS[0], MECHANISM_KINDS[1]],
    [MECHANISM_KINDS[1], MECHANISM_KINDS[1]],
  ];
  for (const ks of pairs)
    for (const v of AI_LEVELS) {
      const robots = ks.map((k): RobotPlan => ({ id: `${v}:${k}`, name: `${k} (${v})`, spec: ROBOT_PRESETS[k], auto: COLLECT_HOME, bot: { ai: v as AiLevel } })) as [RobotPlan, RobotPlan];
      out.push({ id: `${v}:${ks[0]}+${ks[1]}`, name: `${ks[0]} + ${ks[1]} (${v})`, robots });
    }
  return out;
}
export const AI_ALLIANCE_PLANS = aiPlans();

/** Conjuntos de estrategias para `npm run batch -- --set <id>`. */
export const PLAN_SETS: Record<string, AlliancePlan[]> = { all: ALLIANCE_PLANS, mech: MECH_ALLIANCE_PLANS, ai: AI_ALLIANCE_PLANS };

/** Lo que hizo cada robot (del scouting del match, `core/scouting.ts`). */
export interface RobotResult {
  plan: string;
  points: number;
  auto: number;
  teleop: number;
  endgame: number;
  samples: number;
  n3: number;
  platform: boolean;
  critical: boolean;
  foulPts: number;
  /** Segundos con mando de avanzar o girar pero casi quieto (atorado contra algo). */
  stuck: number;
  /** Segundos en cada modo de la IA (`Bot.mode`). */
  modes: Record<string, number>;
}

export interface AllianceResult {
  plan: string;
  robots: [RobotResult, RobotResult];
  total: number;
  /** Puntos propios (sin los que regalan las faltas del rival). */
  own: number;
  /** Puntos de AUTO: Línea de Autónomo + Muestras del AUTO (§4.4). */
  auto: number;
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
    seed,
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
    const res = {} as Record<Alliance, AllianceResult>;
    const scout = entriesFromMatch(m, plans.map((p) => p.id), 'batch');
    const robots: RobotResult[] = scout.map((e, k) => {
      const pt = entryPoints(e, GAME);
      return {
        plan: e.team,
        points: pt.total,
        auto: pt.auto,
        teleop: pt.teleop,
        endgame: pt.endgame,
        samples: e.samplesAuto.reduce((x, y) => x + y, 0) + e.samplesTeleop.reduce((x, y) => x + y, 0),
        n3: e.samplesAuto[2] + e.samplesTeleop[2],
        platform: e.platform,
        critical: e.critical,
        foulPts: pt.foulPts,
        stuck: Math.round(stuck[k] * 10) / 10,
        modes: Object.fromEntries(Object.entries(modes[k]).map(([a, b]) => [a, Math.round(b * 10) / 10])),
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
        auto: b.auto,
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
