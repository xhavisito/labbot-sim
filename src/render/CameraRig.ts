/**
 * Cámaras: libre (órbita con mouse), superior, desde la Driver Station de cada alianza y de
 * seguimiento del robot propio.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as F from '../config/field';

export type CameraMode = 'free' | 'top' | 'driverRed' | 'driverBlue' | 'follow';
export const CAMERA_MODES: readonly CameraMode[] = ['driverBlue', 'follow', 'top', 'driverRed', 'free'];

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
  readonly orbit: OrbitControls;
  mode: CameraMode = 'free';
  private followPos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private lookSet = false;

  constructor(dom: HTMLElement) {
    this.orbit = new OrbitControls(this.camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.setMode('free');
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.lookSet = false;
    this.orbit.enabled = m === 'free';
    const c = this.camera;
    if (m === 'free') {
      c.position.set(-7.5, 6.5, 6.5);
      this.orbit.target.set(0, 0, 0);
      this.orbit.update();
    } else if (m === 'top') {
      c.position.set(0, 12.5, 0.001);
      c.lookAt(0, 0, 0);
      // Rojo arriba en pantalla, como la figura del manual (§3.2)
      c.up.set(1, 0, 0);
      c.lookAt(0, 0, 0);
    } else {
      const s = m === 'driverRed' ? 1 : -1;
      c.up.set(0, 1, 0);
      c.position.set(s * (F.HALF_L + 1.4), 2.0, 0);
      c.lookAt(s * -1.0, 0, 0);
    }
    if (m !== 'top') c.up.set(0, 1, 0);
  }

  /** Actualiza la cámara de seguimiento (detrás del robot). */
  update(dt: number, target?: { x: number; y: number; z: number; heading: number }): void {
    if (this.mode === 'free') this.orbit.update();
    if (!target) return;
    if (this.mode === 'driverRed' || this.mode === 'driverBlue') {
      // Vista del driver: la cámara se queda en la Driver Station y gira para seguir al robot propio.
      const want = new THREE.Vector3(target.x, target.y + 0.3, target.z);
      if (this.lookSet) this.look.lerp(want, 1 - Math.exp(-dt * 8));
      else { this.look.copy(want); this.lookSet = true; }
      this.camera.lookAt(this.look);
      return;
    }
    if (this.mode !== 'follow') return;
    const back = 2.8;
    const want = new THREE.Vector3(target.x - Math.cos(target.heading) * back, target.y + 1.9, target.z + Math.sin(target.heading) * back);
    this.followPos.lerp(want, this.followPos.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 6));
    this.camera.position.copy(this.followPos);
    this.camera.lookAt(target.x + Math.cos(target.heading) * 0.8, target.y + 0.3, target.z - Math.sin(target.heading) * 0.8);
  }
}
