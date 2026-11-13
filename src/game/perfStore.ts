/** Rendimiento acumulado por robot (práctica y matches) en el navegador (localStorage, `core/robotCompare.ts`). */
import { emptyPerf, parsePerf, type PerfData } from '../core/robotCompare';

const KEY = 'labbot.perf.v1';

export function loadPerf(): PerfData {
  try {
    return parsePerf(localStorage.getItem(KEY));
  } catch {
    return emptyPerf();
  }
}

export function savePerf(d: PerfData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* sin almacenamiento: dura lo que la pestaña */
  }
}
