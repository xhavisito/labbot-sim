/**
 * Planeador de caminos en una rejilla sobre la cancha (A* de 8 vecinos). La IA lo usa cuando otro
 * robot le cierra el paso (`Bot.noPush`): busca por dónde rodearlo en vez de insistir por la recta.
 * Puro (sin física): recibe qué celdas están ocupadas y cuánto cuesta pasar por cada una.
 */
export interface XZ {
  x: number;
  z: number;
}

export interface GridSpec {
  /** Medio largo y medio ancho del área (m), centrada en el origen. */
  halfL: number;
  halfW: number;
  /** Lado de la celda (m). */
  cell: number;
}

/**
 * Camino de `start` a `goal` (centros de celda, sin el punto de salida). `cost(p)` da el costo de
 * pasar por ese punto (1 = normal) o `Infinity` si está ocupado; la celda de salida siempre cuenta
 * como libre. Si no se llega a la meta (ocupada o encerrada), `reached` es false y el camino va a la
 * celda alcanzable más cercana a ella (vacío si ninguna).
 */
export function planPath(start: XZ, goal: XZ, cost: (p: XZ) => number, g: GridSpec, maxExpand = 6000): { path: XZ[]; reached: boolean } {
  const nx = Math.round((2 * g.halfL) / g.cell);
  const nz = Math.round((2 * g.halfW) / g.cell);
  const toI = (p: XZ) => Math.max(0, Math.min(nx - 1, Math.floor((p.x + g.halfL) / g.cell)));
  const toJ = (p: XZ) => Math.max(0, Math.min(nz - 1, Math.floor((p.z + g.halfW) / g.cell)));
  const center = (i: number, j: number): XZ => ({ x: -g.halfL + (i + 0.5) * g.cell, z: -g.halfW + (j + 0.5) * g.cell });
  const si = toI(start);
  const sj = toJ(start);
  const gi = toI(goal);
  const gj = toJ(goal);
  const n = nx * nz;
  const cellCost = new Float32Array(n).fill(-1);
  const costAt = (k: number): number => {
    if (cellCost[k] < 0) cellCost[k] = cost(center(k % nx, Math.floor(k / nx)));
    return cellCost[k];
  };
  const gScore = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number, j: number) => {
    const dx = Math.abs(i - gi);
    const dz = Math.abs(j - gj);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * g.cell;
  };
  // Montículo binario de [f, k]
  const heap: Array<[number, number]> = [];
  const push = (f: number, k: number) => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const s = sj * nx + si;
  gScore[s] = 0;
  push(h(si, sj), s);
  // La mejor celda alcanzada (por si la meta está ocupada)
  let best = s;
  let bestH = h(si, sj);
  let expanded = 0;
  let reached = false;
  while (heap.length && expanded < maxExpand) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    expanded++;
    const i = k % nx;
    const j = Math.floor(k / nx);
    const hk = h(i, j);
    if (hk < bestH) {
      bestH = hk;
      best = k;
    }
    if (i === gi && j === gj) {
      reached = true;
      break;
    }
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const q = b * nx + a;
        if (closed[q]) continue;
        const c = costAt(q);
        if (!Number.isFinite(c)) continue;
        // En diagonal, que no corte la esquina de una celda ocupada
        if (di && dj && (!Number.isFinite(costAt(j * nx + a)) || !Number.isFinite(costAt(b * nx + i)))) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * g.cell * c;
        const t = gScore[k] + step;
        if (t < gScore[q]) {
          gScore[q] = t;
          from[q] = k;
          push(t + h(a, b), q);
        }
      }
  }
  const path: XZ[] = [];
  for (let k = best; k !== s && k >= 0; k = from[k]) path.push(center(k % nx, Math.floor(k / nx)));
  return { path: path.reverse(), reached: reached || si === gi && sj === gj };
}
