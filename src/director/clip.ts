/** Tipos del Modo Director: motivo del highlight y el clip guardado (una `Replay` corta que se reproduce con `ReplayPlayer`). */
import { replayDuration, type Replay } from '../replay/format';
import { buildMoments } from '../replay/moments';

export type HighlightKind = 'rapid' | 'topLevel' | 'maneuver' | 'endgame' | 'platform' | 'critical' | 'clutch' | 'manual' | 'match';

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

/**
 * Un match guardado (con ★ en Repeticiones) como clip del Director: dura todo el match y se recorta en el
 * estudio. Foco = tu robot (o el primero si fue solo IA); el marcador amarillo cae en la primera Muestra anotada
 * (o al inicio si no hubo). `matchStart` = 0: el tiempo del clip es el del match.
 */
export function clipFromReplay(replay: Replay, id = 1): Clip {
  const h = replay.header;
  const focus = Math.max(0, h.robots.findIndex((r) => r.index === h.player));
  const duration = replayDuration(replay);
  const first = buildMoments(replay).find((m) => m.kind === 'score');
  return { id, kind: 'match', tags: [], focus, trigger: Math.min(first?.t ?? 0, duration), duration, matchStart: 0, replay };
}
