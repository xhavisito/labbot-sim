/**
 * Manejo centrado en el campo (opcional) para un chasis tipo tanque (§7.2: swerve y otras
 * tracciones prohibidas). El chasis sigue siendo tanque: no hay desplazamiento lateral. El stick
 * indica una dirección del CAMPO y el robot gira hacia ella (por el lado más corto, y si queda
 * más cerca de espaldas, avanza en reversa) y avanza con la magnitud del stick. El manual no
 * dice nada sobre el software de control, así que esto solo cambia cómo se leen los sticks.
 *
 * SUPUESTO: "arriba" en el stick = hacia la ALLIANCE WALL contraria, o sea, lejos de la Driver
 * Station propia (§3.2.6): la azul mira hacia +X y la roja hacia −X, como ve el conductor.
 */
import type { Alliance } from '../core/types';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Dirección del campo (rad, 0 = +X) a la que apunta "arriba" para esta alianza. */
export const fieldUpAngle = (alliance: Alliance): number => (alliance === 'red' ? Math.PI : 0);

/**
 * @param up    stick arriba (+) / abajo (−), −1…1
 * @param left  stick izquierda (+) / derecha (−), −1…1 (como `PlayerInput.turn`)
 * @param heading rumbo actual del robot (rad, `RobotPhysics.heading`)
 * @param upAngle dirección del campo que representa "arriba" (`fieldUpAngle`)
 */
export function fieldCentricDrive(up: number, left: number, heading: number, upAngle: number): { forward: number; turn: number } {
  const mag = Math.min(1, Math.hypot(up, left));
  if (mag < 1e-3) return { forward: 0, turn: 0 };
  const want = upAngle + Math.atan2(left, up);
  let err = wrap(want - heading);
  let sign = 1;
  if (Math.abs(err) > Math.PI / 2) {
    err = wrap(err - Math.PI);
    sign = -1;
  }
  const align = Math.max(0, Math.cos(err));
  return { forward: sign * mag * align * align, turn: Math.max(-1, Math.min(1, err * 2.2)) };
}
