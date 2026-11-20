/**
 * Cámaras cinematográficas del Modo Director. Reciben la pose grabada del robot protagonista (nunca
 * tocan la física) y mueven una `PerspectiveCamera`.
 *  - chase:  tercera persona baja con retraso (lag) y FOV dinámico según la velocidad.
 *  - orbit:  órbita lenta alrededor del robot (hero shot).
 *  - low:    contrapicado a ras de piso mirando hacia arriba.
 *  - free:   cámara libre (WASD + mouse) con 2–3 keyframes para travellings suaves.
 */
import * as THREE from 'three';

export type CamPreset = 'chase' | 'orbit' | 'low' | 'free';
export const CAM_PRESETS: readonly CamPreset[] = ['chase', 'orbit', 'low', 'free'];
export const MAX_KEYFRAMES = 3;

export interface Subject {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** m/s */
  speed: number;
}

export interface Keyframe {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

/** FOV según la rapidez: 52° quieto → 74° a la velocidad de referencia. */
export function dynamicFov(speed: number, ref = 2.5): number {
  return 52 + 22 * Math.min(1, Math.max(0, speed / ref));
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

/**
 * Posición en el travelling: `u` 0–1 a lo largo de los keyframes, con aceleración y frenado suaves
 * en cada tramo (interpolación esférica de la orientación).
 */
export function travel(keys: readonly Keyframe[], u: number, pos: THREE.Vector3, quat: THREE.Quaternion): number {
  const n = keys.length;
  const x = Math.min(Math.max(u, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const a = smooth(x - i);
  pos.lerpVectors(keys[i].pos, keys[i + 1].pos, a);
  quat.slerpQuaternions(keys[i].quat, keys[i + 1].quat, a);
  return keys[i].fov + (keys[i + 1].fov - keys[i].fov) * a;
}

const FWD = new THREE.Vector3();
const TMP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class RevealCamera {
  preset: CamPreset = 'chase';
  readonly keys: Keyframe[] = [];
  /** Con ≥2 keyframes: la cámara libre recorre el travelling durante el clip. */
  useTravel = true;
  /** Pose de la cámara libre (y yaw/pitch para el mouse). */
  readonly freePos = new THREE.Vector3(-4, 2.2, 4);
  yaw = 0;
  pitch = -0.3;
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private fov = 52;
  private ready = false;
  private anchor = new THREE.Vector3();
  private anchorSet = false;
  private orbitPhase = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Reinicia el suavizado (al saltar en la línea de tiempo o cambiar de clip/cámara). */
  reset(): void {
    this.ready = false;
    this.anchorSet = false;
  }

  setPreset(p: CamPreset): void {
    this.preset = p;
    this.reset();
    if (p === 'free') this.fromCamera();
  }

  /** La cámara libre arranca donde está la cámara actual. */
  fromCamera(): void {
    this.freePos.copy(this.camera.position);
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.003;
    this.pitch = Math.min(1.5, Math.max(-1.5, this.pitch - dy * 0.003));
  }

  /** Mueve la cámara libre: adelante/derecha/arriba en m/s por `dt`. */
  move(fwd: number, right: number, up: number, dt: number, speed = 3): void {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    FWD.set(0, 0, -1).applyQuaternion(q);
    TMP.set(1, 0, 0).applyQuaternion(q);
    this.freePos.addScaledVector(FWD, fwd * speed * dt).addScaledVector(TMP, right * speed * dt);
    this.freePos.y = Math.max(0.05, this.freePos.y + up * speed * dt);
  }

  addKeyframe(): boolean {
    if (this.keys.length >= MAX_KEYFRAMES) return false;
    this.keys.push({ pos: this.camera.position.clone(), quat: this.camera.quaternion.clone(), fov: this.camera.fov });
    return true;
  }

  clearKeyframes(): void {
    this.keys.length = 0;
  }

  /**
   * Coloca la cámara. `t` = segundo del clip, `u` = avance 0–1 por el tramo recortado (travelling),
   * `dt` = segundos reales del cuadro (suavizado).
   */
  update(s: Subject, t: number, u: number, dt: number): void {
    const cam = this.camera;
    cam.up.copy(UP);
    let fov = 52;
    if (this.preset === 'free') {
      if (this.keys.length >= 2 && this.useTravel) {
        fov = travel(this.keys, u, cam.position, cam.quaternion);
      } else {
        cam.position.copy(this.freePos);
        cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        fov = 55;
      }
    } else {
      FWD.set(1, 0, 0).applyQuaternion(s.quat);
      FWD.y = 0;
      if (FWD.lengthSq() < 1e-6) FWD.set(1, 0, 0);
      FWD.normalize();
      const k = this.ready ? 1 - Math.exp(-dt * 5) : 1;
      if (this.preset === 'chase') {
        // Detrás y bajo; el retraso hace que la cámara "arrastre" en las aceleraciones
        TMP.copy(s.pos).addScaledVector(FWD, -2.4);
        TMP.y = s.pos.y + 0.75;
        this.smoothPos.lerp(TMP, k);
        TMP.copy(s.pos).addScaledVector(FWD, 0.9);
        TMP.y = s.pos.y + 0.3;
        this.smoothLook.lerp(TMP, this.ready ? 1 - Math.exp(-dt * 9) : 1);
        cam.position.copy(this.smoothPos);
        cam.lookAt(this.smoothLook);
        const target = dynamicFov(s.speed);
        this.fov += (target - this.fov) * (this.ready ? 1 - Math.exp(-dt * 4) : 1);
        fov = this.fov;
      } else if (this.preset === 'orbit') {
        // Órbita lenta (0.4 rad/s) dependiente del tiempo del clip: reproducible al arrastrar la línea
        if (!this.ready) this.orbitPhase = Math.atan2(-FWD.z, FWD.x) + Math.PI * 0.75;
        const a = this.orbitPhase + t * 0.4;
        cam.position.set(s.pos.x + Math.cos(a) * 1.9, s.pos.y + 1.0 + 0.15 * Math.sin(t * 0.6), s.pos.z - Math.sin(a) * 1.9);
        TMP.copy(s.pos);
        TMP.y += 0.35;
        this.smoothLook.lerp(TMP, k);
        cam.lookAt(this.smoothLook);
        fov = 45;
      } else {
        // Contrapicado: cámara fija a ras de piso, a un lado y adelante del robot; si se aleja mucho, se re-ancla
        if (!this.anchorSet || this.anchor.distanceTo(s.pos) > 4.5) {
          this.anchor.set(s.pos.x + FWD.x * 1.8 - FWD.z * 1.3, 0.12, s.pos.z + FWD.z * 1.8 + FWD.x * 1.3);
          this.anchorSet = true;
        }
        cam.position.copy(this.anchor);
        TMP.copy(s.pos);
        TMP.y += 0.4;
        this.smoothLook.lerp(TMP, k);
        cam.lookAt(this.smoothLook);
        fov = 68;
      }
      this.ready = true;
    }
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
