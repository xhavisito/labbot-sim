/** Tipos del Modo Director: motivo del highlight y el clip guardado (una `Replay` corta que se reproduce con `ReplayPlayer`). */
import type { Replay } from '../replay/format';

export type HighlightKind = 'rapid' | 'topLevel' | 'maneuver' | 'endgame' | 'platform' | 'critical' | 'clutch' | 'manual';

/** Un tramo guardado. El tiempo del clip va de 0 a `duration` (s). */
export interface Clip {
  id: number;
  kind: HighlightKind;
  /** Otras razones que se juntaron en el mismo clip. */
  tags: HighlightKind[];
  /** Robot protagonista: posición en `replay.header.robots` (lo que usa la cámara). */
  focus: number;
  /** Segundo del clip en que ocurre el momento (anotación, impacto…). */
  trigger: number;
  duration: number;
  /** Segundos del match al inicio del clip (NaN en práctica). */
  matchStart: number;
  /** El clip como repetición: mismos robots y piezas que la sesión, cuadros a 30 Hz con tiempo relativo. */
  replay: Replay;
}
