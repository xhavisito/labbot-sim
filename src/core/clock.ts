/**
 * Reloj del match (§2, §4.2, §4.3, §4.3.1). `t` = segundos desde el inicio (0 = arranca AUTO).
 * AUTO 15 s → (pausa, SUPUESTO 0 s) → TELEOP 135 s, cuyos últimos 30 s son el ENDGAME.
 */
import type { GameConfig } from '../config/game';

export type Phase = 'PRE' | 'AUTO' | 'PAUSE' | 'TELEOP' | 'ENDGAME' | 'DONE';

export interface Bounds {
  autoEnd: number;
  teleopStart: number;
  endgameStart: number;
  teleopEnd: number;
}

export function bounds(g: GameConfig): Bounds {
  const autoEnd = g.times.auto;
  const teleopStart = autoEnd + g.times.autoToTeleopPause;
  const teleopEnd = teleopStart + g.times.teleop;
  return { autoEnd, teleopStart, endgameStart: teleopEnd - g.times.endgame, teleopEnd };
}

export function phaseAt(t: number, g: GameConfig): Phase {
  const b = bounds(g);
  if (t < 0) return 'PRE';
  if (t < b.autoEnd) return 'AUTO';
  if (t < b.teleopStart) return 'PAUSE';
  if (t < b.endgameStart) return 'TELEOP';
  if (t < b.teleopEnd) return 'ENDGAME';
  return 'DONE';
}

export const isTeleop = (p: Phase): boolean => p === 'TELEOP' || p === 'ENDGAME';
export const robotsEnabled = (p: Phase): boolean => p === 'AUTO' || isTeleop(p);

/** Segundos que muestra el timer: AUTO 0:15→0:00 y TELEOP 2:15→0:00. */
export function timerSeconds(t: number, g: GameConfig): number {
  const b = bounds(g);
  const p = phaseAt(t, g);
  if (p === 'PRE') return g.times.auto;
  if (p === 'AUTO') return b.autoEnd - t;
  if (p === 'PAUSE') return g.times.teleop;
  if (isTeleop(p)) return b.teleopEnd - t;
  return 0;
}

/** Formato m:ss, redondeado hacia arriba como un timer de arena. */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
