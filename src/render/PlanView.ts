/**
 * Estrategia de alianza dibujada en la cancha durante el match (`core/plan.ts`): del paso en curso,
 * tu ruta (blanca), la de tu compañero (magenta, punteada) y su zona de trabajo. Solo la ve quien
 * juega: no se graba en la repetición.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { Phase } from '../core/clock';
import { activeStep, type PlanPoint, type StrategyPlan } from '../core/plan';
import type { Alliance } from '../core/types';

const Y = 0.025;
const ME = 0xffffff;
const MATE = 0xe9239d;

export class PlanView {
  readonly group = new THREE.Group();
  private plan: StrategyPlan | null = null;
  private alliance: Alliance = 'red';
  private key = '';

  constructor() {
    this.group.renderOrder = 2;
  }

  set(plan: StrategyPlan | null, alliance: Alliance): void {
    this.plan = plan;
    this.alliance = alliance;
    this.key = '';
    this.clear();
  }

  /** Redibuja al cambiar de paso. */
  update(phase: Phase, remaining: number): void {
    const a = this.plan ? activeStep(this.plan, phase, remaining) : null;
    const key = a?.key ?? '';
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!a) return;
    const s = a.step;
    this.line(s.me.route, ME, false);
    this.line(s.partner.route, MATE, true);
    const z = s.partner.zone;
    if (z) {
      const pts = [
        { x: z.x0, z: z.z0 },
        { x: z.x1, z: z.z0 },
        { x: z.x1, z: z.z1 },
        { x: z.x0, z: z.z1 },
        { x: z.x0, z: z.z0 },
      ];
      this.line(pts, MATE, false, 0.5, false);
    }
  }

  /** Cinta plana sobre la alfombra (las líneas de 1 px casi no se ven de lejos); `dashed` = a tramos. */
  private line(route: readonly PlanPoint[], color: number, dashed: boolean, opacity = 0.9, dots = true): void {
    if (!route.length) return;
    const pts = route.map((p) => F.forAlliance(this.alliance, p));
    const pos: number[] = [];
    const quad = (ax: number, az: number, bx: number, bz: number, w: number) => {
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / len) * w;
      const nz = ((bx - ax) / len) * w;
      pos.push(ax + nx, Y, az + nz, bx + nx, Y, bz + nz, bx - nx, Y, bz - nz, ax + nx, Y, az + nz, bx - nx, Y, bz - nz, ax - nx, Y, az - nz);
    };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dash = dashed ? 0.2 : len;
      for (let d = 0; d < len; d += dashed ? 0.32 : len) {
        const e = Math.min(len, d + dash);
        quad(a.x + ((b.x - a.x) * d) / len, a.z + ((b.z - a.z) * d) / len, a.x + ((b.x - a.x) * e) / len, a.z + ((b.z - a.z) * e) / len, 0.03);
      }
    }
    // Cada punto de la ruta, un cuadrito
    if (dots) for (const p of pts) quad(p.x - 0.07, p.z, p.x + 0.07, p.z, 0.07);
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this.group.add(new THREE.Mesh(geo, mat));
  }

  private clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const o = c as THREE.Mesh;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}
