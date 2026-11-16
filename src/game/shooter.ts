/**
 * Tiro balístico del robot lanzador (Phoenix). La Muestra sale de la boca del carro con un ángulo fijo
 * (`ShooterSpec.pitch`) y la velocidad que pide la distancia a la Cámara, como una tabla de distancias de un
 * robot real. El manual no habla de lanzar (§7.2 solo limita tamaño, extensión y altura): todo es SUPUESTO
 * de diseño (Xhavi, 16-nov: "si no lo dice, se puede hacer, y hazlo realista").
 */
import type { ShooterSpec } from '../config/robot';

/** Gravedad del mundo (m/s²), la misma de `PhysicsWorld`. */
export const GRAVITY = 9.81;

/**
 * Velocidad de salida (m/s) para pasar por un punto a `dist` m al frente y `dh` m más arriba de la boca
 * (negativo = más abajo), con el ángulo `pitch`. null si con ese ángulo no llega (el punto queda sobre la parábola).
 */
export function solveSpeed(dist: number, dh: number, pitch: number): number | null {
  const c = Math.cos(pitch);
  const den = 2 * c * c * (dist * Math.tan(pitch) - dh);
  if (den <= 1e-9 || dist <= 0) return null;
  return Math.sqrt((GRAVITY * dist * dist) / den);
}

/**
 * Tiro: velocidad de salida respecto al robot, con el azar del tiro (`rand` devuelve 0…1).
 * El rumbo es el del robot (el jugador tiene que apuntar); la velocidad se acomoda a la distancia.
 */
export function shotVelocity(
  spec: ShooterSpec,
  dist: number,
  dh: number,
  rand: () => number,
): { speed: number; pitch: number; yaw: number; clipped: boolean } {
  const need = solveSpeed(dist, dh, spec.pitch) ?? spec.maxSpeed;
  const clipped = need > spec.maxSpeed;
  // Los dos azares son una campana aproximada (suma de 3 uniformes): ruedas que no giran exactamente a las mismas rpm
  const g = () => (rand() + rand() + rand() - 1.5) / 0.7071;
  const speed = Math.min(need, spec.maxSpeed) * (1 + spec.speedSigma * g());
  return { speed, pitch: spec.pitch, yaw: spec.yawSigma * g(), clipped };
}
