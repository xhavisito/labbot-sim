/**
 * Rutinas de AUTO (§4.2: 15 s con instrucciones preprogramadas, sin cruzar la línea central).
 * Una rutina es una lista de pasos de duración fija; se escriben para el robot en su Zona de Inicio
 * viendo hacia el centro, así que sirven igual para rojo y azul.
 */
import type { ElevatorPos } from '../config/robot';

/**
 * Velocidad de referencia de las rutinas (m/s): `forward` de un paso 'drive' es fracción de esto, no
 * de la velocidad máxima del robot, para que la rutina recorra lo mismo con cualquier robot.
 */
export const AUTO_REF_SPEED = 3.0;

export type AutoStep =
  | { do: 'drive'; forward: number; turn?: number; seconds: number }
  | { do: 'wait'; seconds: number }
  | { do: 'elevator'; pos: ElevatorPos }
  | { do: 'intake'; on: boolean }
  | { do: 'release' };

export interface AutoRoutine {
  id: string;
  name: string;
  steps: AutoStep[];
  /** La maneja la IA (`ai/Bot`) en lugar de pasos fijos. */
  bot?: { scoreOnly: boolean };
  /** Ruta grabada en la práctica de AUTO (`auto/recorded.ts`): los controles de cada paso, en lugar de `steps`. */
  track?: AutoTrack;
}

/** Acción de un solo disparo en el paso `i` de una ruta grabada. */
export interface AutoAction {
  i: number;
  intake?: boolean;
  elevator?: ElevatorPos;
  release?: boolean;
  grabCritical?: boolean;
  releaseCritical?: boolean;
}

/**
 * Ruta grabada: adelante y giro de cada paso de física (×1000, fracción de la velocidad máxima del
 * robot con el que se grabó, ya con el modo fino) y las acciones de un disparo.
 */
export interface AutoTrack {
  hz: number;
  forward: number[];
  turn: number[];
  actions: AutoAction[];
}

/** Por defecto: avanzar ~0.9 m y detenerse: sale de la Zona de Inicio (= cruza la línea, D1) sin llegar a la rampa (§4.6). */
export const LEAVE_ZONE: AutoRoutine = {
  id: 'leave',
  name: 'Salir de la zona',
  steps: [{ do: 'drive', forward: 0.3, seconds: 1.0 }],
};

export const DO_NOTHING: AutoRoutine = { id: 'none', name: 'Quedarse quieto', steps: [] };

/** La IA lleva la precarga a su Cámara (Nivel 3) sin salir de su mitad (§4.2); al salir de la zona también cruza la línea. */
export const SCORE_PRELOAD: AutoRoutine = { id: 'preload', name: 'Anotar precarga', steps: [], bot: { scoreOnly: true } };

/** La IA anota la precarga y recolecta Muestras de su mitad. */
export const COLLECT_HOME: AutoRoutine = { id: 'collect', name: 'Anotar y recolectar', steps: [], bot: { scoreOnly: false } };

export const AUTO_ROUTINES: readonly AutoRoutine[] = [LEAVE_ZONE, SCORE_PRELOAD, COLLECT_HOME, DO_NOTHING];

export interface AutoOutput {
  forward: number;
  turn: number;
  /** `forward` ya es fracción de la velocidad máxima del robot (ruta grabada), no de `AUTO_REF_SPEED`. */
  raw?: boolean;
  elevator?: ElevatorPos;
  intake?: boolean;
  release?: boolean;
  grabCritical?: boolean;
  releaseCritical?: boolean;
}

/** Ejecuta una rutina paso a paso (fracciones de velocidad −1…1). */
export class AutoRunner {
  private i = 0;
  private t = 0;
  private started = -1;

  constructor(readonly routine: AutoRoutine) {}

  /** Siguiente acción de la ruta grabada. */
  private a = 0;

  get done(): boolean {
    return this.i >= (this.routine.track?.forward.length ?? this.routine.steps.length);
  }

  step(dt: number): AutoOutput {
    const tr = this.routine.track;
    if (tr) return this.trackStep(tr);
    const out: AutoOutput = { forward: 0, turn: 0 };
    while (!this.done) {
      const s = this.routine.steps[this.i];
      if (s.do === 'drive' || s.do === 'wait') {
        if (this.started !== this.i) {
          this.started = this.i;
          this.t = 0;
        }
        this.t += dt;
        if (this.t >= s.seconds) {
          this.i++;
          continue;
        }
        if (s.do === 'drive') {
          out.forward = s.forward;
          out.turn = s.turn ?? 0;
        }
        return out;
      }
      if (s.do === 'elevator') out.elevator = s.pos;
      else if (s.do === 'intake') out.intake = s.on;
      else out.release = true;
      this.i++;
    }
    return out;
  }

  /** Un paso de la ruta grabada (un paso de física por llamada). */
  private trackStep(tr: AutoTrack): AutoOutput {
    const i = this.i;
    const out: AutoOutput = { forward: (tr.forward[i] ?? 0) / 1000, turn: (tr.turn[i] ?? 0) / 1000, raw: true };
    while (this.a < tr.actions.length && tr.actions[this.a].i <= i) {
      const { i: _, ...act } = tr.actions[this.a++];
      Object.assign(out, act);
    }
    this.i++;
    return out;
  }
}
