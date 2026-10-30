/**
 * Geometría de contacto entre robots en el piso (polígonos convexos x, z): qué tan separados están
 * dos contornos (`RobotPhysics.outline`) y por dónde se tocan. La IA lo usa para no empujar a otro
 * robot (§4.5: contacto y pinning con rivales son Foul; con su compañero el manual no dice nada, pero
 * empujarlo lo arrima a la Plataforma o fuera de la cancha y los golpes dañan, D36) y el lote
 * (`sim/batch.ts`) para medir cuánto empuja cada robot.
 */
import type { Robot } from '../game/Robot';

export interface XZ {
  x: number;
  z: number;
}

/** ¿Los polígonos convexos se traslapan? (ejes separadores) */
function overlap(a: readonly XZ[], b: readonly XZ[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q.z - p.z);
      const nz = q.x - p.x;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.z * nz;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const v of b) {
        const d = v.x * nx + v.z * nz;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      if (a1 < b0 || b1 < a0) return false;
    }
  return true;
}

/** Punto del segmento p–q más cercano a v. */
function closestOnSegment(v: XZ, p: XZ, q: XZ): XZ {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((v.x - p.x) * dx + (v.z - p.z) * dz) / l2));
  return { x: p.x + dx * t, z: p.z + dz * t };
}

/**
 * Separación (m) entre dos polígonos convexos y el punto de `b` más cercano a `a` (por dónde lo
 * tocaría). Traslapados: separación 0 y el punto es el centro de la zona en común (aprox.: el promedio
 * de los vértices de cada uno que quedan dentro del otro).
 */
export function polyGap(a: readonly XZ[], b: readonly XZ[]): { gap: number; at: XZ } {
  if (overlap(a, b)) {
    const inside = [...a.filter((v) => overlap([v, v, v], b)), ...b.filter((v) => overlap([v, v, v], a))];
    const pts = inside.length ? inside : b;
    return { gap: 0, at: { x: pts.reduce((s, v) => s + v.x, 0) / pts.length, z: pts.reduce((s, v) => s + v.z, 0) / pts.length } };
  }
  let gap = Infinity;
  let at: XZ = b[0];
  // Vértices de a contra lados de b (el punto ya está en b) y vértices de b contra lados de a
  for (const v of a)
    for (let i = 0; i < b.length; i++) {
      const c = closestOnSegment(v, b[i], b[(i + 1) % b.length]);
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      if (d < gap) {
        gap = d;
        at = c;
      }
    }
  for (const v of b)
    for (let i = 0; i < a.length; i++) {
      const c = closestOnSegment(v, a[i], a[(i + 1) % a.length]);
      const d = Math.hypot(c.x - v.x, c.z - v.z);
      if (d < gap) {
        gap = d;
        at = v;
      }
    }
  return { gap, at };
}

/** Un robot que toca (o casi) a `r`: dónde, en el marco local de `r` (+lx al frente). */
export interface Touch {
  other: Robot;
  gap: number;
  lx: number;
  lz: number;
}

/** Robots a menos de `maxGap` m del contorno de `r` (chasis y garra). */
export function touches(r: Robot, others: readonly Robot[], maxGap = 0.05): Touch[] {
  const pos = r.phys.position();
  const mine = r.phys.outline(r.mech.angle);
  const out: Touch[] = [];
  for (const o of others) {
    if (o === r) continue;
    const op = o.phys.position();
    // Lejos de sobra (dos robots largos con la garra estirada no pasan de ~2 m)
    if (Math.hypot(op.x - pos.x, op.z - pos.z) > 2.2) continue;
    const c = polyGap(mine, o.phys.outline(o.mech.angle));
    if (c.gap > maxGap) continue;
    const l = r.phys.worldToLocalFlat(c.at.x, c.at.z);
    out.push({ other: o, gap: c.gap, lx: l.lx, lz: l.lz });
  }
  return out;
}

/**
 * ¿`r` empuja a otro robot? Lo toca por delante (o por detrás) y su mando lo lleva hacia ese lado.
 * Un toque de costado no cuenta: avanzar ahí solo lo roza.
 */
export function pushTouch(r: Robot, forward: number, list: readonly Touch[]): Touch | null {
  if (Math.abs(forward) < 0.05) return null;
  const k = r.phys.halfL * 0.4;
  return list.find((t) => (forward > 0 ? t.lx > k : t.lx < -k)) ?? null;
}
