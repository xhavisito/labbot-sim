/**
 * Vibración del control (gamepad) al anotar y cuando el árbitro marca una falta a tu alianza.
 * Usa `vibrationActuator.playEffect('dual-rumble')` cuando el navegador lo soporta (Chrome, Edge);
 * donde no existe, no hace nada. Los patrones son SUPUESTOS de diseño (no vienen del manual).
 */
export type RumbleKind = 'score' | 'foul';

interface Pulse {
  /** Duración en milisegundos. */
  duration: number;
  /** Motor grave (0–1) y motor agudo (0–1). */
  strong: number;
  weak: number;
}

/** Anotar: un tirón corto. Falta: uno largo y fuerte, para que no pase desapercibido. */
export const RUMBLE_PULSES: Record<RumbleKind, Pulse> = {
  score: { duration: 120, strong: 0.35, weak: 0.6 },
  foul: { duration: 450, strong: 1, weak: 0.5 },
};

/** Vibra un control si su navegador soporta la API; los errores del navegador se ignoran. */
export function rumblePad(pad: Gamepad | null | undefined, kind: RumbleKind): void {
  const actuator = pad?.vibrationActuator;
  if (!actuator || typeof actuator.playEffect !== 'function') return;
  const p = RUMBLE_PULSES[kind];
  try {
    actuator.playEffect('dual-rumble', { startDelay: 0, duration: p.duration, strongMagnitude: p.strong, weakMagnitude: p.weak }).catch(() => {});
  } catch {
    /* el navegador rechazó el efecto: seguimos sin vibración */
  }
}
