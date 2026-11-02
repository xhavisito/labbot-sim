/**
 * Partículas al anotar (como las chispas del HUB en rebuilt-sim): un solo `Points` con un pool fijo
 * de partículas aditivas, sin crear objetos por ráfaga. La cantidad por ráfaga depende de la calidad.
 */
import * as THREE from 'three';
import type { Alliance } from '../core/types';

const MAX = 600;
const COLORS: Record<Alliance, THREE.Color> = { red: new THREE.Color(1, 0.35, 0.3), blue: new THREE.Color(0.35, 0.6, 1) };
const GOLD = new THREE.Color(1, 0.8, 0.3);

function spark(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private base = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private next = 0;
  /** 0–1 según la calidad. */
  amount = 1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 0.07, map: spark(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.pos.fill(-100);
  }

  /** Ráfaga en (x, y, z) con el color de la alianza y chispas doradas. */
  burst(x: number, y: number, z: number, alliance: Alliance): void {
    const n = Math.round(60 * this.amount);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const up = 1.6 + Math.random() * 2.2;
      const out = 0.4 + Math.random() * 1.1;
      this.pos.set([x, y + 0.05, z], i * 3);
      this.vel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      const c = Math.random() < 0.3 ? GOLD : COLORS[alliance];
      // Más brillante que 1 para que el bloom las haga resplandecer
      this.base.set([c.r * 2.2, c.g * 2.2, c.b * 2.2], i * 3);
      this.life[i] = 0.7 + Math.random() * 0.6;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= 6 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.01) {
        this.pos[j + 1] = 0.01;
        this.vel[j + 1] *= -0.3;
      }
      const f = Math.max(0, Math.min(1, this.life[i] / 0.5));
      this.col[j] = this.base[j] * f;
      this.col[j + 1] = this.base[j + 1] * f;
      this.col[j + 2] = this.base[j + 2] * f;
      if (this.life[i] <= 0) this.pos[j + 1] = -100;
    }
    this.points.visible = any;
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}
