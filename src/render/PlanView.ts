/**
 * Pizarra de la estrategia de alianza en la cancha durante el match (`core/plan.ts`): del paso en
 * curso, tu ruta (blanca), la de tu compañero (magenta, punteada) y su zona de trabajo, con flechas
 * hacia dónde va cada ruta y un anillo donde empieza. `PREVIEW_S` antes de cambiar de paso se dibuja
 * también el siguiente, tenue. Solo la ve quien juega (solo la de su alianza: la de los rivales no
 * llega aquí) y no se graba en la repetición. Se apaga en Ajustes (`Settings.planBoard`).
 */
import * as THREE from 'three';
import * as F from '../config/field';
import type { Phase } from '../core/clock';
import { activeStep, nextStep, PREVIEW_S, type PlanPoint, type PlanStep, type StrategyPlan } from '../core/plan';
import type { Alliance } from '../core/types';

const Y = 0.025;
const ME = 0xffffff;
const MATE = 0xe9239d;
/** Ancho de media cinta (m) y tamaño de las flechas. */
const W = 0.035;
const ARROW = 0.16;
/** Opacidad del paso siguiente (vista previa) respecto al actual. */
const DIM = 0.35;

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

  /** Pizarra apagada en Ajustes: no se dibuja (sigue sabiendo el paso para cuando se prenda). */
  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Redibuja al cambiar de paso y al entrar la vista previa del siguiente. */
  update(phase: Phase, remaining: number): void {
    const a = this.plan ? activeStep(this.plan, phase, remaining) : null;
    const n = this.plan ? nextStep(this.plan, phase, remaining) : null;
    const preview = n && n.in <= PREVIEW_S ? n : null;
    const key = `${a?.key ?? ''}>${preview?.key ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (preview) this.step(preview.step, DIM, Y - 0.004);
    if (a) this.step(a.step, 1, Y);
  }

  private step(s: PlanStep, alpha: number, y: number): void {
    this.route(s.me.route, ME, false, 0.9 * alpha, y);
    this.route(s.partner.route, MATE, true, 0.9 * alpha, y);
    const z = s.partner.zone;
    if (!z) return;
    const r = F.rectFor(this.alliance, z);
    // Relleno tenue y contorno: se ve de lejos sin tapar las Muestras
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2), mat(MATE, 0.12 * alpha));
    fill.position.set((r.x0 + r.x1) / 2, y - 0.002, (r.z0 + r.z1) / 2);
    this.group.add(fill);
    const pos: number[] = [];
    const corners = [
      { x: r.x0, z: r.z0 },
      { x: r.x1, z: r.z0 },
      { x: r.x1, z: r.z1 },
      { x: r.x0, z: r.z1 },
    ];
    for (let i = 0; i < 4; i++) quad(pos, corners[i], corners[(i + 1) % 4], W, y);
    this.mesh(pos, MATE, 0.6 * alpha);
  }

  /** Cinta plana sobre la alfombra (las líneas de 1 px casi no se ven de lejos); `dashed` = a tramos. */
  private route(route: readonly PlanPoint[], color: number, dashed: boolean, opacity: number, y: number): void {
    if (!route.length) return;
    const pts = route.map((p) => F.forAlliance(this.alliance, p));
    const pos: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      const at = (d: number) => ({ x: a.x + ((b.x - a.x) * d) / len, z: a.z + ((b.z - a.z) * d) / len });
      for (let d = 0; d < len; d += dashed ? 0.32 : len) quad(pos, at(d), at(Math.min(len, d + (dashed ? 0.2 : len))), W, y);
      // Flecha a media ruta (tramos largos) y al llegar a cada punto: hacia dónde se va
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      if (len > 1.2) arrow(pos, at(len / 2), ux, uz, y);
      arrow(pos, b, ux, uz, y);
    }
    // Donde empieza la ruta: anillo; los demás puntos, un cuadrito
    ring(pos, pts[0], 0.16, y);
    for (const p of pts.slice(1, pts.length > 1 ? -1 : undefined)) quad(pos, { x: p.x - 0.06, z: p.z }, { x: p.x + 0.06, z: p.z }, 0.06, y);
    this.mesh(pos, color, opacity);
  }

  private mesh(pos: number[], color: number, opacity: number): void {
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.group.add(new THREE.Mesh(geo, mat(color, opacity)));
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

const mat = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });

/** Rectángulo de `a` a `b` con media anchura `w`, como dos triángulos. */
function quad(pos: number[], a: PlanPoint, b: PlanPoint, w: number, y: number): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = (-(b.z - a.z) / len) * w;
  const nz = ((b.x - a.x) / len) * w;
  pos.push(a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz, a.x + nx, y, a.z + nz, b.x - nx, y, b.z - nz, a.x - nx, y, a.z - nz);
}

/** Punta de flecha (triángulo) en `p` apuntando a (ux, uz). */
function arrow(pos: number[], p: PlanPoint, ux: number, uz: number, y: number): void {
  const bx = p.x - ux * ARROW;
  const bz = p.z - uz * ARROW;
  const s = ARROW * 0.6;
  pos.push(p.x, y, p.z, bx - uz * s, y, bz + ux * s, bx + uz * s, y, bz - ux * s);
}

/** Anillo de radio `r` en `p`. */
function ring(pos: number[], p: PlanPoint, r: number, y: number): void {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    quad(pos, { x: p.x + Math.cos(a0) * r, z: p.z + Math.sin(a0) * r }, { x: p.x + Math.cos(a1) * r, z: p.z + Math.sin(a1) * r }, W, y);
  }
}
