/**
 * Rutinas de AUTO (§4.2: 15 s con instrucciones preprogramadas, sin cruzar la línea central).
 * Una rutina es una lista de pasos de duración fija; se escriben para el robot en su Zona de Inicio
 * viendo hacia el centro, así que sirven igual para rojo y azul.
 */
import type { ElevatorPos } from '../config/robot';

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
  elevator?: ElevatorPos;
  intake?: boolean;
  release?: boolean;
}

/** Ejecuta una rutina paso a paso (fracciones de velocidad −1…1). */
export class AutoRunner {
  private i = 0;
  private t = 0;
  private started = -1;

  constructor(readonly routine: AutoRoutine) {}

  get done(): boolean {
    return this.i >= this.routine.steps.length;
  }

  step(dt: number): AutoOutput {
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
}
