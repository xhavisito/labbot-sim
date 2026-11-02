/**
 * Práctica libre: el "vacío" al fondo de cada nivel de las Cámaras (las Muestras anotadas
 * desaparecen y regresan al Human Player, ver `GameSession.drainSink`). Un hoyo oscuro con borde
 * brillante que gira despacio para que se note que se traga las piezas.
 */
import * as THREE from 'three';
import * as F from '../config/field';
import { ALLIANCES, LEVELS } from '../core/types';

/** Textura del remolino (null sin DOM, p. ej. en las pruebas). */
function sinkTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,1)');
  r.addColorStop(0.55, 'rgba(10,6,24,0.95)');
  r.addColorStop(0.82, 'rgba(140,90,255,0.75)');
  r.addColorStop(1, 'rgba(140,90,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  // Brazos del remolino
  g.strokeStyle = 'rgba(190,160,255,0.45)';
  g.lineWidth = 3;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let a = 0; a < Math.PI * 1.6; a += 0.1) {
      const rr = 10 + a * 14;
      const t = a + (k * Math.PI * 2) / 3;
      g.lineTo(64 + Math.cos(t) * rr, 64 + Math.sin(t) * rr);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SinkView {
  readonly group = new THREE.Group();
  private discs: THREE.Mesh[] = [];

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: sinkTexture(), transparent: true, depthWrite: false });
    for (const a of ALLIANCES)
      for (const l of LEVELS) {
        const w = F.rectFor(a, F.camaraWells()[l]);
        const size = Math.min(w.x1 - w.x0, w.z1 - w.z0) * 0.95;
        const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 40), mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set((w.x0 + w.x1) / 2, 0.006, (w.z0 + w.z1) / 2);
        m.renderOrder = 1;
        this.discs.push(m);
        this.group.add(m);
      }
  }

  update(time: number): void {
    for (const d of this.discs) d.rotation.z = -time * 1.5;
  }
}
