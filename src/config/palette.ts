/**
 * Paletas de color (accesibilidad): la normal del simulador y dos para daltonismo. Pura: sin DOM ni
 * Three.js (se prueba en tests/palette.test.ts); `render/palette.ts` la aplica a la cancha y los
 * robots y `ui/a11y.ts` a la interfaz (variables CSS).
 *
 * El manual pide las piezas y la cinta en rojo/azul por alianza (pág. 15, §3.2); cambiar el tono solo
 * cambia el dibujo, no las reglas. Las de daltonismo se basan en la paleta de Okabe e Ito
 * (https://jfly.uni-koeln.de/color/), que se distingue con protanopia, deuteranopia y tritanopia.
 *
 * - rojo-verde (protanopia y deuteranopia, lo más común): el rojo pasa a naranja y lo "bien" (verde)
 *   pasa a azul cielo; el morado del robot propio se veía azul, así que va en blanco.
 * - azul-amarillo (tritanopia): rojo y azul se distinguen, pero el morado se veía rojo; el robot
 *   propio va en blanco y la Muestra Crítica azul en cian.
 */
import type { Alliance } from '../core/types';

export const COLOR_MODES = ['normal', 'redgreen', 'blueyellow'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** Colores de la escena 3D (hex de Three.js) y de los dibujos en canvas (CSS). */
export interface Palette {
  /** Cinta, LEDs y placas de cada alianza. */
  alliance: Record<Alliance, number>;
  /** Tu robot (para encontrarlo entre los demás). */
  own: number;
  /** Muestra Crítica de cada alianza. */
  critical: Record<Alliance, number>;
  /** LEDs de un robot con falla. */
  fault: number;
  /** Fondo de la placa R1/A2 del robot y de la pantalla del marcador (CSS). */
  plate: Record<Alliance, string>;
  /** Mapa de calor y marcas de las estadísticas (RGB). */
  heat: Record<Alliance, readonly [number, number, number]>;
  /** Variables CSS que se cambian en la interfaz (vacío = las de `styles.css`). */
  css: Readonly<Record<string, string>>;
}

export const PALETTES: Readonly<Record<ColorMode, Palette>> = {
  normal: {
    alliance: { red: 0xc0262d, blue: 0x1d4fd6 },
    own: 0x8a2ba3,
    // Por pedido del equipo la Crítica azul va en el morado del branding (como el robot propio)
    critical: { red: 0xc0262d, blue: 0x8a2ba3 },
    fault: 0xff8a1c,
    plate: { red: '#a01e24', blue: '#173f9e' },
    heat: { red: [229, 65, 58], blue: [47, 125, 246] },
    css: {},
  },
  redgreen: {
    alliance: { red: 0xe07b00, blue: 0x1c6fd1 },
    own: 0xf2f2f2,
    critical: { red: 0xe07b00, blue: 0x56b4e9 },
    fault: 0xf0e442,
    plate: { red: '#a85a00', blue: '#0f4c99' },
    heat: { red: [240, 140, 0], blue: [47, 125, 246] },
    css: {
      '--red': '#f08c00',
      '--red-deep': '#a85a00',
      '--red-ink': '#ffb547',
      '--red-tint': '#ffd9a3',
      '--blue': '#2f7df6',
      '--blue-deep': '#1747a8',
      '--blue-ink': '#8fb6ff',
      '--blue-tint': '#bcd5ff',
      '--ok': '#56b4e9',
      '--ok-tint': '#c9e8fa',
      '--warn': '#f0e442',
    },
  },
  blueyellow: {
    alliance: { red: 0xd1245a, blue: 0x0a7fb0 },
    own: 0xf2f2f2,
    critical: { red: 0xd1245a, blue: 0x2ad4e0 },
    fault: 0xffffff,
    plate: { red: '#9c1842', blue: '#08587a' },
    heat: { red: [232, 54, 104], blue: [20, 150, 200] },
    css: {
      '--red': '#e8366a',
      '--red-deep': '#9c1842',
      '--red-ink': '#ff8fb0',
      '--red-tint': '#ffc6d6',
      '--blue': '#1496c8',
      '--blue-deep': '#08587a',
      '--blue-ink': '#7fd3f5',
      '--blue-tint': '#c2ecfb',
      '--ok': '#3ddc84',
      '--ok-tint': '#c4f5d8',
      '--warn': '#ff9a3c',
    },
  },
};

export const isColorMode = (v: unknown): v is ColorMode => COLOR_MODES.some((m) => m === v);

export const paletteFor = (mode: ColorMode): Palette => PALETTES[mode] ?? PALETTES.normal;

/** Tamaños de texto de la interfaz (multiplica todos los tamaños de letra de `styles.css`). */
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/** El tamaño permitido más cercano (lo guardado en el navegador puede venir raro). */
export function nearestTextScale(v: unknown): TextScale {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return TEXT_SCALES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), TEXT_SCALES[1] as TextScale);
}

/** Luminancia relativa (WCAG 2.x) de un color 0xRRGGBB; para las pruebas de contraste. */
export function luminance(hex: number): number {
  const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Razón de contraste WCAG entre dos colores (1 a 21). */
export function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Simulación de daltonismo (matrices de Machado, Oliveira y Fernandes 2009, severidad 1) sobre RGB
 * lineal; para comprobar en las pruebas que los colores que importan siguen separados.
 */
const CVD: Record<'protan' | 'deutan' | 'tritan', number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const toLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Color como lo ve una persona con ese tipo de daltonismo (RGB lineal 0–1). */
export function simulateCvd(hex: number, kind: keyof typeof CVD): [number, number, number] {
  const rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(toLin);
  const m = CVD[kind];
  const out = [0, 1, 2].map((i) => Math.max(0, Math.min(1, m[i * 3] * rgb[0] + m[i * 3 + 1] * rgb[1] + m[i * 3 + 2] * rgb[2])));
  return out as [number, number, number];
}

/**
 * Diferencia de color aproximada (distancia en Oklab ×100) entre dos colores en RGB lineal. Arriba de
 * ~15 se distinguen de un vistazo.
 */
export function colorDistance(a: readonly number[], b: readonly number[]): number {
  const lab = ([r, g, bl]: readonly number[]) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [x, y] = [lab(a), lab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Hex CSS (#rrggbb) a número. */
export const cssHex = (s: string): number => parseInt(s.replace('#', ''), 16);

let activeMode: ColorMode = 'normal';

/** Paleta en uso (la fija `applyColorMode`; los dibujos la leen al armarse). */
export const activePalette = (): Palette => PALETTES[activeMode];
export const activeColorMode = (): ColorMode => activeMode;
export function setActiveColorMode(mode: ColorMode): void {
  activeMode = isColorMode(mode) ? mode : 'normal';
}
