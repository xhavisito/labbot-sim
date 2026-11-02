/**
 * Escenarios de entrenamiento (lógica pura): situaciones prefabricadas de match para practicar
 * decisiones bajo presión (p. ej. los últimos 20 s empatados con la Plataforma pendiente). El match
 * arranca en el segundo `at` con el marcador ya armado; se juega lo que falta contra la IA y al sonar
 * la bocina se evalúa: ganar (o el RP pedido) da la medalla de bronce y el margen de puntos sube a
 * plata u oro. Los puntos y las reglas son los de §4.4–§4.6 (`config/game.ts`); las situaciones, los
 * tiempos y los cortes de medalla son SUPUESTOS de diseño del simulador (el manual no los trae).
 */
import type { GameConfig } from '../config/game';
import type { Match } from './match';
import { MEDALS, type Medal } from './training';
import { opponent, type Alliance, type Level } from './types';

export type ScenarioId = 'tieLast20' | 'platformPending' | 'criticalRace' | 'dominanceChase' | 'comeback';
export type ScenarioStart = 'zone' | 'camara';

/** Muestras ya anotadas en TELEOP (por nivel) con las que arranca la situación. */
export type SeedSamples = Partial<Record<Level, number>>;

export interface Scenario {
  id: ScenarioId;
  /** Sección del manual de la que salen los puntos o la regla en juego. */
  section: string;
  /** Segundo del match en que arranca (AUTO 0–15, TELEOP 15–150, ENDGAME desde 120; §4.3.1). */
  at: number;
  /** Marcador de arranque, Muestras de TELEOP por alianza. */
  seed: Record<Alliance, SeedSamples>;
  /** Dónde empieza tu robot: tu Zona de Inicio o frente a tu Cámara. */
  start: ScenarioStart;
  /** Lo que hay que lograr: ganar el match o juntar el Dominio de Cámara (RP, §4.4). */
  goal: 'win' | 'dominance';
  /** Diferencia de puntos mínima [bronce, plata, oro] (tu alianza menos el rival) una vez cumplida la meta. */
  medals: readonly [number, number, number];
}

// La alianza del jugador es la roja en las definiciones; para azul se invierten (`seedFor`).
export const SCENARIOS: readonly Scenario[] = [
  // 20 s finales, empate 87–87; falta la Plataforma (10) y la Crítica (15)
  { id: 'tieLast20', section: '§4.3.1 · §4.4', at: 130, seed: { red: { 3: 5, 2: 2 }, blue: { 3: 5, 2: 2 } }, start: 'camara', goal: 'win', medals: [1, 10, 25] },
  // 20 s finales, abajo 9 (66–75): la Plataforma sola da la vuelta; desde tu Zona de Inicio
  { id: 'platformPending', section: '§4.4', at: 130, seed: { red: { 3: 4, 2: 1 }, blue: { 3: 5 } }, start: 'zone', goal: 'win', medals: [1, 10, 25] },
  // Empieza el ENDGAME empatado 60–60 con las dos Críticas todavía en su Campana
  { id: 'criticalRace', section: '§3.2.5 · §4.3.1', at: 120, seed: { red: { 3: 4 }, blue: { 3: 4 } }, start: 'zone', goal: 'win', medals: [1, 10, 25] },
  // 45 s: 9 Muestras en tu Cámara (falta 1 para el Dominio) y el rival arriba 34–45
  { id: 'dominanceChase', section: '§4.4', at: 105, seed: { red: { 1: 5, 2: 4 }, blue: { 3: 3 } }, start: 'zone', goal: 'dominance', medals: [-1000, 0, 15] },
  // 50 s, abajo 45–81: remontar
  { id: 'comeback', section: '§4.4 · §4.5', at: 100, seed: { red: { 3: 3 }, blue: { 3: 5, 2: 1 } }, start: 'zone', goal: 'win', medals: [1, 10, 25] },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

/** Muestras de arranque de `alliance` cuando el jugador es `me` (las definiciones están hechas para el rojo). */
export function seedFor(s: Scenario, alliance: Alliance, me: Alliance): SeedSamples {
  return alliance === me ? s.seed.red : s.seed.blue;
}

/** Puntos de TELEOP de unas Muestras (§4.4). */
export function seedPoints(g: GameConfig, seed: SeedSamples): number {
  return (['1', '2', '3'] as const).reduce((sum, k) => sum + (seed[Number(k) as Level] ?? 0) * g.points.sampleTeleop[Number(k) as Level], 0);
}

/** Arma el marcador del escenario en un match recién empezado y lo lleva al segundo `at`. */
export function applyScenario(m: Match, s: Scenario, me: Alliance): void {
  for (const a of [me, opponent(me)] as const) {
    const seed = seedFor(s, a, me);
    for (const lv of [1, 2, 3] as const) m.seedSamples(a, lv, seed[lv] ?? 0, s.at);
  }
  m.jumpTo(s.at);
}

export interface ScenarioOutcome {
  /** Puntos de tu alianza menos los del rival. */
  diff: number;
  /** Cumplió la meta del escenario. */
  met: boolean;
}

/** Resultado de un match terminado visto desde la alianza `me`. */
export function evaluate(m: Match, s: Scenario, me: Alliance): ScenarioOutcome {
  const diff = m.score(me) - m.score(opponent(me));
  const met = s.goal === 'win' ? diff > 0 : m.rankingPoints(me).dominance;
  return { diff, met };
}

/** Medalla del resultado (sin la meta, ninguna). */
export function scenarioMedal(s: Scenario, o: ScenarioOutcome): Medal | null {
  if (!o.met) return null;
  let best: Medal | null = null;
  MEDALS.forEach((m, i) => {
    if (o.diff >= s.medals[i]) best = m;
  });
  return best;
}

// ------------------------------------------------------------------ progreso (récords)

export interface ScenarioRecord {
  /** Mejor diferencia de puntos con la meta cumplida. */
  best: number;
  medal: Medal | null;
  runs: number;
  wins: number;
  at: string;
}

export interface ScenarioProgress {
  v: 1;
  records: Record<string, ScenarioRecord>;
}

export const emptyScenarioProgress = (): ScenarioProgress => ({ v: 1, records: {} });

/** Registra un intento; devuelve si es récord nuevo. */
export function recordScenario(p: ScenarioProgress, s: Scenario, robot: string, o: ScenarioOutcome, now = new Date()): { medal: Medal | null; improved: boolean } {
  const medal = scenarioMedal(s, o);
  const key = `${s.id}:${robot}`;
  const prev = p.records[key];
  const improved = o.met && (!prev || prev.medal === null || o.diff > prev.best);
  const runs = (prev?.runs ?? 0) + 1;
  const wins = (prev?.wins ?? 0) + (o.met ? 1 : 0);
  if (improved) p.records[key] = { best: o.diff, medal, runs, wins, at: now.toISOString() };
  else p.records[key] = { best: prev?.best ?? 0, medal: prev?.medal ?? null, runs, wins, at: prev?.at ?? '' };
  return { medal, improved };
}

export function scenarioBest(p: ScenarioProgress, id: ScenarioId, robot: string): ScenarioRecord | null {
  const r = p.records[`${id}:${robot}`];
  return r && r.wins > 0 ? r : null;
}

export function parseScenarioProgress(raw: string | null): ScenarioProgress {
  if (!raw) return emptyScenarioProgress();
  try {
    const o = JSON.parse(raw) as Partial<ScenarioProgress>;
    if (o?.v !== 1 || !o.records || typeof o.records !== 'object') return emptyScenarioProgress();
    const records: Record<string, ScenarioRecord> = {};
    for (const [k, r] of Object.entries(o.records)) {
      if (!scenarioById(k.split(':')[0]) || typeof r?.best !== 'number' || typeof r.runs !== 'number') continue;
      const medal = MEDALS.includes(r.medal as Medal) ? (r.medal as Medal) : null;
      records[k] = { best: r.best, medal, runs: r.runs, wins: typeof r.wins === 'number' ? r.wins : 0, at: typeof r.at === 'string' ? r.at : '' };
    }
    return { v: 1, records };
  } catch {
    return emptyScenarioProgress();
  }
}
