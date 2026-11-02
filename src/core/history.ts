/**
 * Historial de partidas: cada match terminado guarda fecha, modo, robots, marcador y RP.
 * Puro (sin DOM): el almacenamiento se inyecta para poder probarlo.
 */
import { MECHANISM_KINDS } from '../config/robot';
import type { Match } from './match';
import { ALLIANCES, type Alliance } from './types';

export const HISTORY_KEY = 'labbot.history';
export const HISTORY_MAX = 50;

export interface HistoryEntry {
  /** ISO 8601 */
  date: string;
  mode: 'match';
  /** Robot que manejaste (0–3: rojo 1, rojo 2, azul 1, azul 2) */
  player: number;
  /** Tipo de mecanismo de tu robot y de los demás */
  playerRobot: string;
  botRobot: string;
  score: Record<Alliance, number>;
  rp: Record<Alliance, number>;
}

export interface HistoryStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function entry(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  if (typeof o.date !== 'string' || Number.isNaN(Date.parse(o.date))) return null;
  const kind = (v: unknown) => (typeof v === 'string' && (MECHANISM_KINDS as readonly string[]).includes(v) ? v : MECHANISM_KINDS[0]);
  const pair = (v: any): Record<Alliance, number> => ({ red: num(v?.red), blue: num(v?.blue) });
  return {
    date: o.date,
    mode: 'match',
    player: Math.min(3, Math.max(0, Math.round(num(o.player)))),
    playerRobot: kind(o.playerRobot),
    botRobot: kind(o.botRobot),
    score: pair(o.score),
    rp: pair(o.rp),
  };
}

/** Limpia lo leído del almacenamiento: descarta basura, ordena del más reciente al más antiguo y recorta. */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(entry)
    .filter((e): e is HistoryEntry => e !== null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, HISTORY_MAX);
}

export function loadHistory(store: HistoryStore | undefined = safeStorage()): HistoryEntry[] {
  try {
    return sanitizeHistory(JSON.parse(store?.getItem(HISTORY_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

/** Agrega un match al historial guardado y devuelve la lista nueva. */
export function addHistory(e: HistoryEntry, store: HistoryStore | undefined = safeStorage()): HistoryEntry[] {
  const list = sanitizeHistory([e, ...loadHistory(store)]);
  try {
    store?.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
  return list;
}

export function historyEntry(m: Match, player: number, playerRobot: string, botRobot: string, now = new Date()): HistoryEntry {
  const score = {} as Record<Alliance, number>;
  const rp = {} as Record<Alliance, number>;
  for (const a of ALLIANCES) {
    score[a] = m.breakdown(a).total;
    rp[a] = m.rankingPoints(a).total;
  }
  return { date: now.toISOString(), mode: 'match', player, playerRobot, botRobot, score, rp };
}

function safeStorage(): HistoryStore | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function clearHistory(store: HistoryStore & { removeItem?(k: string): void } | undefined = safeStorage()): void {
  try {
    store?.removeItem?.(HISTORY_KEY);
  } catch {
    /* sin almacenamiento */
  }
}
