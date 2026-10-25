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
import { DEFAULT_ROBOT, PIVOT_ROBOT, TOWER_ROBOT, type RobotSpec } from '../config/robot';
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

/** Chasis tanque sin mecanismo: solo cruza la línea y sube a la Plataforma. */
const CHASSIS: RobotSpec = { ...DEFAULT_ROBOT, name: 'Chasis', capacity: 1 };

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
} satisfies Record<string, RobotPlan>;

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
];

export interface AllianceResult {
  plan: string;
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

/** Generador pseudoaleatorio reproducible (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    for (const a of ALLIANCES) {
      const b = m.breakdown(a);
      const rp = m.rankingPoints(a);
      const fouls: Record<string, number> = {};
      for (const f of m.fouls) if (f.offender === a) fouls[f.rule] = (fouls[f.rule] ?? 0) + 1;
      const other = a === 'red' ? 'blue' : 'red';
      res[a] = {
        plan: a === 'red' ? red.id : blue.id,
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
