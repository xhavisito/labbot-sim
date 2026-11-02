/**
 * Historial de partidas: cada match terminado guarda fecha, modo, robots, marcador y RP.
 * Puro (sin DOM): el almacenamiento se inyecta para poder probarlo.
 */
import type { Match } from './match';
import { ALLIANCES, type Alliance } from './types';

export const MATCH_HISTORY_KEY = 'labbot.matchHistory';
export const MATCH_HISTORY_MAX = 50;

export interface MatchHistoryEntry {
  /** ISO 8601 */
  date: string;
  /** Modo de juego (match, versus, torneo, scouting…) */
  mode: string;
  /** Robot que manejaste (0–3: rojo 1, rojo 2, azul 1, azul 2) */
  player: number;
  /** Id del robot que usaste y del de los demás */
  playerRobot: string;
  botRobot: string;
  score: Record<Alliance, number>;
  rp: Record<Alliance, number>;
}

export interface MatchHistoryStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function entry(raw: unknown): MatchHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  if (typeof o.date !== 'string' || Number.isNaN(Date.parse(o.date))) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : '');
  const pair = (v: any): Record<Alliance, number> => ({ red: num(v?.red), blue: num(v?.blue) });
  return {
    date: o.date,
    mode: str(o.mode) || 'match',
    player: Math.min(3, Math.max(-1, Math.round(num(o.player)))),
    playerRobot: str(o.playerRobot),
    botRobot: str(o.botRobot),
    score: pair(o.score),
    rp: pair(o.rp),
  };
}

/** Limpia lo leído del almacenamiento: descarta basura, ordena del más reciente al más antiguo y recorta. */
export function sanitizeMatchHistory(raw: unknown): MatchHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry)
    .filter((e): e is MatchHistoryEntry => e !== null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, MATCH_HISTORY_MAX);
}

export function loadMatchHistory(store: MatchHistoryStore | undefined = safeStorage()): MatchHistoryEntry[] {
  try {
    return sanitizeMatchHistory(JSON.parse(store?.getItem(MATCH_HISTORY_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

/** Agrega un match al historial guardado y devuelve la lista nueva. */
export function addMatchHistory(e: MatchHistoryEntry, store: MatchHistoryStore | undefined = safeStorage()): MatchHistoryEntry[] {
  const list = sanitizeMatchHistory([e, ...loadMatchHistory(store)]);
  try {
    store?.setItem(MATCH_HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
  return list;
}

export function matchHistoryEntry(m: Match, player: number, playerRobot: string, botRobot: string, mode = 'match', now = new Date()): MatchHistoryEntry {
  const score = {} as Record<Alliance, number>;
  const rp = {} as Record<Alliance, number>;
  for (const a of ALLIANCES) {
    score[a] = m.breakdown(a).total;
    rp[a] = m.rankingPoints(a).total;
  }
  return { date: now.toISOString(), mode, player, playerRobot, botRobot, score, rp };
}

function safeStorage(): MatchHistoryStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function clearMatchHistory(store: MatchHistoryStore & { removeItem?(k: string): void } | undefined = safeStorage()): void {
  try {
    store?.removeItem?.(MATCH_HISTORY_KEY);
  } catch {
    /* sin almacenamiento */
  }
}
