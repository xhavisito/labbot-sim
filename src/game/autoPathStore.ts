/**
 * Rutinas de AUTO dibujadas, guardadas en el navegador (localStorage, `labbot.autoPaths`): funcionan
 * sin conexión y aparecen en la lista de rutinas de AUTO (Ajustes y Preparar match) como
 * `path:<id>`. Todo pasa por `sanitizePaths` (`core/autoPath.ts`).
 */
import { PATH_PREFIX, sanitizePaths, type AutoPath } from '../core/autoPath';
import type { AutoRoutine } from '../auto/AutoRoutine';

const KEY = 'labbot.autoPaths';

export function loadPaths(): AutoPath[] {
  try {
    return sanitizePaths(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function savePaths(list: readonly AutoPath[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento (modo privado): vive mientras siga abierta la página */
  }
}

/** Rutina de AUTO que sigue la trayectoria dibujada. */
export const pathRoutine = (p: AutoPath): AutoRoutine => ({ id: PATH_PREFIX + p.id, name: p.name, steps: [], path: p });

/** La rutina dibujada de un id de rutina (`path:<id>`), si existe. */
export function pathByRoutineId(id: string): AutoPath | undefined {
  if (!id.startsWith(PATH_PREFIX)) return undefined;
  const pid = id.slice(PATH_PREFIX.length);
  return loadPaths().find((p) => p.id === pid);
}
