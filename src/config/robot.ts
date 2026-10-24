/**
 * Especificación de un robot y sus límites según el manual (§7.2, §4.1). El manual no da
 * velocidad, masa ni mecanismos: esos números son SUPUESTOS configurables.
 */
import { mm } from './field';

/** Límites del manual. */
export const ROBOT_LIMITS = {
  /** Perímetro máximo del chasis 65 × 65 cm (§7.2). */
  maxChassis: mm(650),
  /** Extensión de mecanismos fuera del perímetro: hasta 40 cm en cualquier dirección (§7.2). */
  maxExtension: mm(400),
  /** Altura máxima 100 cm (§7.2). */
  maxHeight: mm(1000),
} as const;

export interface RobotSpec {
  name: string;
  /** Chasis (m): largo (adelante) y ancho. Tanque obligatorio, sin bumpers (§7.2). */
  length: number;
  width: number;
  /** Altura de la estructura fija (sin el elevador extendido). */
  baseHeight: number;
  /** SUPUESTO: sin límite de peso en el manual (§7.2). */
  massKg: number;
  /** SUPUESTOS de manejo. */
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  /** Coeficiente de tracción rueda–alfombra. */
  traction: number;
  intake: {
    /** Cuánto sale la intake del frente del chasis al desplegarse (≤ 0.40 m). */
    extension: number;
    width: number;
  };
  /** Muestras que puede guardar. El manual no pone límite de posesión: SUPUESTO de diseño. */
  capacity: number;
  /** Alcance del depósito más allá del frente del chasis (≤ 0.40 m). */
  reach: number;
  /** Velocidad del elevador (m/s). */
  elevatorSpeed: number;
  /**
   * Alturas (m, sobre la base del robot) del fondo de la pieza al soltarla, por posición.
   * 0 = guardado; 1–3 = niveles de la Cámara (aperturas a 200/500/800 mm, §3.2.3);
   * 4 = Repisa / rendija de la Campana (≈568 mm sobre el piso desde la plataforma; 610 mm).
   */
  elevatorHeights: [number, number, number, number, number];
}

/** Posiciones del elevador. */
export type ElevatorPos = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_ROBOT: RobotSpec = {
  name: 'LabBot',
  length: mm(650),
  width: mm(650),
  baseHeight: mm(450),
  massKg: 40,
  maxSpeed: 3.0,
  maxAccel: 6.0,
  maxOmega: 5.5,
  traction: 1.0,
  intake: { extension: mm(250), width: mm(500) },
  capacity: 5,
  reach: mm(300),
  elevatorSpeed: 1.4,
  elevatorHeights: [mm(100), mm(260), mm(560), mm(850), mm(640)],
};

/** Revisa los límites de §7.2. Devuelve la lista de problemas (vacía si cumple). */
export function validateRobot(s: RobotSpec, pieceSize = mm(200)): string[] {
  const out: string[] = [];
  if (s.length > ROBOT_LIMITS.maxChassis + 1e-9 || s.width > ROBOT_LIMITS.maxChassis + 1e-9) out.push('chasis mayor a 65 × 65 cm (§7.2)');
  if (s.intake.extension > ROBOT_LIMITS.maxExtension + 1e-9) out.push('intake sale más de 40 cm (§7.2)');
  if (s.reach > ROBOT_LIMITS.maxExtension + 1e-9) out.push('depósito sale más de 40 cm (§7.2)');
  if (s.baseHeight > ROBOT_LIMITS.maxHeight + 1e-9) out.push('más alto que 100 cm (§7.2)');
  // Con el elevador arriba y una Muestra (150 mm) el robot no puede pasar de 100 cm
  if (s.elevatorHeights[3] + mm(150) > ROBOT_LIMITS.maxHeight + 1e-9) out.push('elevador + Muestra pasa de 100 cm (§7.2)');
  if (s.elevatorHeights[4] + pieceSize > ROBOT_LIMITS.maxHeight + 1e-9) out.push('elevador + Muestra Crítica pasa de 100 cm (§7.2)');
  if (s.capacity < 1) out.push('capacidad mínima 1 (precarga, §4.1)');
  return out;
}
