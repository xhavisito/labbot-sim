/**
 * Texturas procedurales en canvas (sin archivos externos), como en rebuilt-sim: alfombra, MDF,
 * hule espuma de las Muestras, duela del gimnasio y letreros. Sin DOM (pruebas y simulación por
 * lotes en Node) devuelven null y los materiales quedan con su color liso.
 */
import * as THREE from 'three';

const hasDom = (): boolean => typeof document !== 'undefined';

/** Números pseudoaleatorios repetibles (mulberry32): la misma textura en cada carga. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ruido gris por pixel sobre un color base (con manchas ocasionales). */
function speckle(g: CanvasRenderingContext2D, n: number, base: string, amp: number, seed: number, dark = 0.02): void {
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  const img = g.getImageData(0, 0, n, n);
  for (let i = 0; i < n * n; i++) {
    const v = (r() + r() + r() - 1.5) * amp + (r() < dark ? -amp * 2 : 0);
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v;
  }
  g.putImageData(img, 0, 0);
}

export interface MapPair {
  map: THREE.Texture;
  bump: THREE.Texture;
}

/** Alfombra gris oscuro de pelo bajo (§3.1), con moteado y relieve. `repeat` = repeticiones en 9 m. */
export function carpetTexture(): MapPair | null {
  if (!hasDom()) return null;
  const n = 256;
  const [c, g] = canvas(n, n);
  const [cb, gb] = canvas(n, n);
  speckle(g, n, '#33363b', 14, 7);
  speckle(gb, n, '#808080', 60, 8, 0);
  const map = tex(c, 1);
  map.repeat.set(18, 14);
  const bump = tex(cb, 1, false);
  bump.repeat.set(70, 54);
  return { map, bump };
}

/** MDF: fibra café clara con vetas finas y poros (UV en metros, se repite cada 0.6 m). */
export function mdfTexture(seed = 3): MapPair | null {
  if (!hasDom()) return null;
  const n = 256;
  const [c, g] = canvas(n, n);
  const [cb, gb] = canvas(n, n);
  speckle(g, n, '#c4ab88', 10, seed, 0.01);
  speckle(gb, n, '#808080', 30, seed + 1, 0);
  const r = rng(seed + 2);
  // Fibras alargadas (el MDF no tiene veta real, pero sí un moteado alargado)
  for (let k = 0; k < 420; k++) {
    const x = r() * n;
    const y = r() * n;
    const len = 6 + r() * 26;
    g.strokeStyle = r() < 0.5 ? 'rgba(120,88,52,0.18)' : 'rgba(235,214,180,0.2)';
    g.lineWidth = 0.6 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (r() - 0.5) * 2);
    g.stroke();
  }
  const map = tex(c, 1);
  map.repeat.set(1 / 0.6, 1 / 0.6);
  const bump = tex(cb, 1, false);
  bump.repeat.set(1 / 0.6, 1 / 0.6);
  return { map, bump };
}

/** Hule espuma de las Muestras: beige con poros (relieve fuerte). */
export function foamTexture(): MapPair | null {
  if (!hasDom()) return null;
  const n = 128;
  const [c, g] = canvas(n, n);
  const [cb, gb] = canvas(n, n);
  speckle(g, n, '#ddcdaa', 9, 21, 0.03);
  gb.fillStyle = '#9a9a9a';
  gb.fillRect(0, 0, n, n);
  const r = rng(22);
  for (let k = 0; k < 700; k++) {
    const x = r() * n;
    const y = r() * n;
    const rad = 0.6 + r() * 1.8;
    gb.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.4})`;
    gb.beginPath();
    gb.arc(x, y, rad, 0, Math.PI * 2);
    gb.fill();
  }
  return { map: tex(c, 1), bump: tex(cb, 1, false) };
}

/** Duela del gimnasio (piso alrededor de la cancha): tablas de maple con barniz. */
export function gymFloorTexture(): MapPair | null {
  if (!hasDom()) return null;
  const w = 512;
  const h = 512;
  const [c, g] = canvas(w, h);
  const [cb, gb] = canvas(w, h);
  const r = rng(31);
  gb.fillStyle = '#808080';
  gb.fillRect(0, 0, w, h);
  const board = 32; // 8 tablas por textura (≈ 7 cm c/u con repeat 1 cada 2.2 m)
  for (let y = 0; y < h; y += board) {
    let x = -r() * 200;
    while (x < w) {
      const len = 140 + r() * 220;
      const tone = 150 + r() * 40;
      g.fillStyle = `rgb(${tone + 40},${tone + 10},${tone - 40})`;
      g.fillRect(x, y, len, board);
      for (let k = 0; k < 10; k++) {
        g.strokeStyle = `rgba(110,70,30,${0.08 + r() * 0.12})`;
        g.lineWidth = 1;
        const yy = y + r() * board;
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len / 3, yy + (r() - 0.5) * 4, x + (2 * len) / 3, yy + (r() - 0.5) * 4, x + len, yy);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,25,10,0.5)';
      g.fillRect(x, y, 1.5, board);
      gb.fillStyle = '#404040';
      gb.fillRect(x, y, 1.5, board);
      x += len;
    }
    g.fillStyle = 'rgba(40,25,10,0.45)';
    g.fillRect(0, y, w, 1.5);
    gb.fillStyle = '#404040';
    gb.fillRect(0, y, w, 1.5);
  }
  const map = tex(c, 1);
  map.repeat.set(12, 12);
  const bump = tex(cb, 1, false);
  bump.repeat.set(12, 12);
  return { map, bump };
}

/** Aluminio cepillado (rayas finas). */
export function brushedTexture(): THREE.Texture | null {
  if (!hasDom()) return null;
  const n = 128;
  const [c, g] = canvas(n, n);
  const r = rng(41);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, n, n);
  for (let y = 0; y < n; y++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.18})`;
    g.fillRect(0, y, n, 1);
  }
  return tex(c, 4, false);
}

/** Texto sobre fondo (placas de los robots, letreros, pantalla). */
export function textTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}): THREE.CanvasTexture | null {
  if (!hasDom()) return null;
  const w = opts.w ?? 256;
  const h = opts.h ?? 96;
  const [c, g] = canvas(w, h);
  g.fillStyle = opts.bg ?? '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = opts.fg ?? '#fff';
  g.font = opts.font ?? `800 ${Math.floor(h * 0.7)}px "Chakra Petch", "Arial Black", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * UVs por caja según la normal dominante (para ConvexGeometry, que no trae UVs): las texturas
 * quedan en metros y no se estiran en las piezas largas.
 */
export function boxUV(geo: THREE.BufferGeometry, scale = 1): void {
  const p = geo.getAttribute('position');
  geo.computeVertexNormals();
  const n = geo.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
