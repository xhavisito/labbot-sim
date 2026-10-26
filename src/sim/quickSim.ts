/**
 * Simular un match del calendario sin dibujarlo (pantalla de Scouting): los 4 robots con IA según
 * el tipo de robot de cada equipo; la IA de cada alianza se reparte los papeles (`allianceRoles`).
 * Corre en pedazos con `setTimeout` para no congelar la página.
 */
import type { BotOptions } from '../ai/Bot';
import { COLLECT_HOME, LEAVE_ZONE } from '../auto/AutoRoutine';
import { ROBOT_PRESETS, type MechanismKind } from '../config/robot';
import type { Match } from '../core/match';
import { rng } from '../core/rng';
import { GameSession } from '../game/GameSession';

/**
 * Papeles de una alianza de dos: el chasis solo cruza la línea y sube a la Plataforma; a los demás
 * la IA de su alianza (`ai/Team.ts`) les reparte las Muestras, el Human Player y la Muestra Crítica.
 */
export function allianceRoles(a: MechanismKind, b: MechanismKind): [Partial<BotOptions>, Partial<BotOptions>] {
  const role = (k: MechanismKind): Partial<BotOptions> => (k === 'chassis' ? { role: 'park' } : {});
  return [role(a), role(b)];
}

/** Opciones de la sesión para que la IA juegue los 4 robots (0–1 rojo, 2–3 azul). */
export function aiMatchOptions(kinds: readonly MechanismKind[], seed: number) {
  const rand = rng(seed);
  const roles = [...allianceRoles(kinds[0], kinds[1]), ...allianceRoles(kinds[2], kinds[3])];
  return {
    player: -1,
    preload: true,
    ai: true,
    specs: kinds.map((k) => ROBOT_PRESETS[k]),
    autos: kinds.map((k) => (k === 'chassis' ? LEAVE_ZONE : COLLECT_HOME)),
    bots: roles,
    hp: { enabled: true, interval: 2.5 + rand() * 1.5 },
  };
}

/** Corre un match completo de solo IA y devuelve el `Match` terminado. */
export function simulateMatch(kinds: readonly MechanismKind[], seed = 1, onProgress?: (f: number) => void): Promise<Match> {
  const g = new GameSession(aiMatchOptions(kinds, seed));
  g.startMatch();
  const m = g.match!;
  const total = 152 * 120;
  let i = 0;
  return new Promise((resolve, reject) => {
    const chunk = () => {
      try {
        const end = Math.min(total, i + 1200);
        for (; i < end && !m.finished; i++) g.step();
        onProgress?.(Math.min(1, i / (150 * 120)));
        if (m.finished || i >= total) {
          g.dispose();
          resolve(m);
        } else setTimeout(chunk, 0);
      } catch (e) {
        g.dispose();
        reject(e);
      }
    };
    setTimeout(chunk, 0);
  });
}
