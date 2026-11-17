/** Colores de los mapas del campo en canvas (Auto Designer): plano oscuro con contornos de color y
 *  rellenos tenues; los mismos tonos de la UI de labbot (rojo, azul y acento ámbar). */
export const FIELD_PAL = {
  bg: '#0d1015',
  floor: '#131820',
  edge: 'rgba(255,255,255,.25)',
  grid: 'rgba(150,175,220,.07)',
  center: 'rgba(255,255,255,.55)',
  blue: '#4f7bff',
  red: '#e0525a',
  accent: '#f2b632',
  struct: '#8a93a3',
  label: 'rgba(233,236,241,.8)',
};

/** Letra de las etiquetas dibujadas en canvas (la misma de la UI). */
export const CANVAS_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** `#rrggbb` con opacidad `a` (0–1). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Rectángulo con relleno y contorno opcionales (en píxeles). */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null = null, lw = 1): void {
  if (fill) {
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  }
}
