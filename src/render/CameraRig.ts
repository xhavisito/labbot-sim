/**
 * Cámaras: libre (órbita con mouse), superior, desde la Driver Station de cada alianza y de
 * seguimiento del robot propio.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as F from '../config/field';
import { driverEye, cornerEye, onboardMount, ONBOARD_PITCH, FOV } from '../config/cameras';
import type { Alliance } from '../core/types';

export type CameraMode = 'free' | 'top' | 'driverRed' | 'driverBlue' | 'follow' | 'driverEye' | 'corner' | 'onboard';
export const CAMERA_MODES: readonly CameraMode[] = ['driverBlue', 'driverEye', 'corner', 'onboard', 'follow', 'top', 'driverRed', 'free'];

/** Quién mira: su alianza, estación y medidas (para las cámaras de conductor, esquina y a bordo). */
export interface Viewer {
  alliance: Alliance;
  station: 0 | 1;
  spec: { length: number; baseHeight: number; arm?: { pickBack?: boolean } };
}

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
  update(dt: number, target?: { x: number; y: number; z: number; heading: number }, viewer?: Viewer): void {
    if (this.mode === 'free') this.orbit.update();
    if (!target) return;
    const fov = this.mode === 'onboard' ? FOV.onboard : this.mode === 'driverEye' ? FOV.driver : FOV.default;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (viewer && (this.mode === 'driverEye' || this.mode === 'corner')) {
      // Fija en su puesto (conductor de pie o poste de esquina) y gira para seguir al robot propio
      const e = this.mode === 'driverEye' ? driverEye(viewer.alliance, viewer.station) : cornerEye(viewer.alliance, viewer.station);
      this.camera.position.set(e.x, e.y, e.z);
      this.look.set(target.x, target.y + 0.3, target.z);
      this.lookSet = true;
      this.camera.lookAt(this.look);
      return;
    }
    // El frente es el lado del intake: con la garra atrás (Pivote 180°) Seguir y A bordo miran hacia allá
    if (viewer?.spec.arm?.pickBack) target = { ...target, heading: target.heading + Math.PI };
    if (viewer && this.mode === 'onboard') {
      const m = onboardMount(viewer.spec);
      const c = Math.cos(target.heading);
      const sn = Math.sin(target.heading);
      this.camera.position.set(target.x + c * m.forward, target.y + m.up, target.z - sn * m.forward);
      this.camera.lookAt(this.camera.position.x + c * 5, this.camera.position.y - Math.tan(ONBOARD_PITCH) * 5, this.camera.position.z - sn * 5);
      return;
    }
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
