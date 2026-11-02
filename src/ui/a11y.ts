/**
 * Accesibilidad de la interfaz: aplica el modo daltónico (paleta de la cancha, robots y variables CSS)
 * y el tamaño del texto. Hay que llamarla antes de armar la escena (`boot.ts`) y al guardar Ajustes;
 * lo ya dibujado en 3D toma el color nuevo al reabrir la página (Ajustes la recarga solo).
 */
import { PALETTES, setActiveColorMode, type ColorMode, type TextScale } from '../config/palette';
import { ALLIANCE_COLOR } from '../render/FieldView';
import { CRITICAL_COLOR } from '../render/PieceView';
import { ROBOT_STYLE } from '../render/RobotView';

const CSS_KEYS = [...new Set(Object.values(PALETTES).flatMap((p) => Object.keys(p.css)))];

export function applyAccessibility(mode: ColorMode, scale: TextScale, root: HTMLElement = document.documentElement): void {
  setActiveColorMode(mode);
  const p = PALETTES[mode] ?? PALETTES.normal;
  Object.assign(ALLIANCE_COLOR, p.alliance);
  Object.assign(CRITICAL_COLOR, p.critical);
  ROBOT_STYLE.own = p.own;
  ROBOT_STYLE.fault = p.fault;
  Object.assign(ROBOT_STYLE.plate, p.plate);
  for (const k of CSS_KEYS) {
    const v = p.css[k];
    if (v) root.style.setProperty(k, v);
    else root.style.removeProperty(k);
  }
  root.style.setProperty('--ts', String(scale));
  root.dataset.colorMode = mode;
}
