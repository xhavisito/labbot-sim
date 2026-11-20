import * as F from '../src/config/field';
import type { Alliance } from '../src/core/types';

/**
 * Pose (x, z, rumbo) de un robot de `a` de frente a SU Cámara (la de la mitad rival, ver
 * `F.camaraOwnerFrame`), dadas las coordenadas de la huella ROJA original de la Cámara (+X, +Z).
 */
export const camPose = (a: Alliance, x: number, z: number): [number, number, number] => {
  const p = F.forCamara(a, { x, z });
  return [p.x, p.z, F.camaraHeading(a)];
};
