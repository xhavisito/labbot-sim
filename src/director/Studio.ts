/**
 * Reveal Studio — edición de un clip (sin DOM, salvo el canvas que se graba). Reproduce el clip con
 * el `ReplayPlayer` de la repetición (sesión "títere" con los robots reales, CAD incluido), mueve la
 * cámara cinematográfica y aplica velocidad y efectos. La física NO corre mientras está abierto.
 */
import * as THREE from 'three';
import { REPLAY_HZ, robotFrame } from '../replay/format';
import type { ReplayPlayer } from '../replay/ReplayPlayer';
import type { Renderer } from '../render/Renderer';
import type { Clip } from './clip';
import { startRecording, type VideoFormat } from './exportClip';
import { anyFx, NO_FX, PostFx, type FxOptions } from './PostFx';
import { RevealCamera, type Subject } from './RevealCamera';
import { advance, DEFAULT_RAMP, type SpeedRamp } from './speedRamp';

export interface ExportOptions {
  format: VideoFormat;
  /** Alto del video en píxeles; 0 = el del canvas en pantalla. */
  height: number;
  onProgress?: (pct: number) => void;
}

export class Studio {
  clip: Clip | null = null;
  /** Segundo del clip que se muestra. */
  t = 0;
  playing = false;
  trimIn = 0;
  trimOut = 0;
  ramp: SpeedRamp = DEFAULT_RAMP(0);
  /** Robot protagonista (posición en `header.robots`). */
  focus = 0;
  fx: FxOptions = { ...NO_FX };
  readonly cam: RevealCamera;
  /** Entrada de la cámara libre: adelante, derecha, arriba (−1…1). */
  readonly move = { f: 0, r: 0, u: 0 };
  private post: PostFx | null = null;
  private subject: Subject = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), speed: 0 };
  private exporting: { done: () => void } | null = null;

  constructor(
    private player: ReplayPlayer,
    private renderer: Renderer,
    camera: THREE.PerspectiveCamera,
  ) {
    this.cam = new RevealCamera(camera);
  }

  get isExporting(): boolean {
    return this.exporting !== null;
  }

  open(clip: Clip): void {
    this.clip = clip;
    if (this.player.replay !== clip.replay) this.player.load(clip.replay);
    this.player.playing = false;
    this.trimIn = 0;
    this.trimOut = clip.duration;
    this.ramp = DEFAULT_RAMP(clip.trigger);
    this.focus = Math.min(clip.focus, clip.replay.header.robots.length - 1);
    this.t = 0;
    this.playing = true;
    this.cam.reset();
    this.player.seek(0);
  }

  seek(t: number): void {
    if (!this.clip) return;
    this.t = Math.min(Math.max(t, 0), this.clip.duration);
    this.cam.reset();
  }

  setFocus(i: number): void {
    this.focus = i;
    this.cam.reset();
  }

  setFx(o: FxOptions): void {
    this.fx = { ...o };
    this.post?.set(this.fx);
  }

  /** Avanza `dt` segundos reales y pone la escena en el cuadro; la cámara y el render van aparte. */
  update(dt: number): void {
    const c = this.clip;
    if (!c) return;
    const exp = this.exporting;
    let finished = false;
    if (this.playing || exp) {
      this.t = advance(this.ramp, this.t, dt);
      if (this.t >= this.trimOut) {
        if (exp) {
          this.t = this.trimOut;
          finished = true;
        } else this.t = this.trimIn;
      }
    }
    this.player.seek(this.t);
    this.placeCamera(dt);
    if (finished && exp) {
      // El cuadro final se dibuja antes de cerrar la grabación
      this.pendingDone = exp.done;
      this.exporting = null;
    }
  }

  private pendingDone: (() => void) | null = null;

  /** Cámara según el robot protagonista en este cuadro. */
  private placeCamera(dt: number): void {
    const c = this.clip!;
    const body = this.player.session.robots[this.focus]?.phys.body;
    if (body) {
      const p = body.translation();
      const q = body.rotation();
      this.subject.pos.set(p.x, p.y, p.z);
      this.subject.quat.set(q.x, q.y, q.z, q.w);
    }
    this.subject.speed = this.speedAt();
    if (this.cam.preset === 'free' && (this.move.f || this.move.r || this.move.u)) this.cam.move(this.move.f, this.move.r, this.move.u, dt);
    const span = Math.max(1e-3, this.trimOut - this.trimIn);
    this.cam.update(this.subject, this.t, Math.min(1, Math.max(0, (this.t - this.trimIn) / span)), dt);
    void c;
  }

  /** Rapidez (m/s) del protagonista, de la diferencia de posición entre dos cuadros grabados. */
  private speedAt(): number {
    const r = this.player.replay;
    const hz = Number(r.header.meta.hz) || REPLAY_HZ;
    const f = Math.min(r.header.frames - 1, Math.max(1, Math.round(this.t * hz)));
    if (r.header.frames < 2) return 0;
    const a = robotFrame(r, f - 1, this.focus);
    const b = robotFrame(r, f, this.focus);
    return Math.hypot(b.x - a.x, b.z - a.z) * hz;
  }

  /** Dibuja el cuadro (con o sin efectos). Llamar después de `update`. */
  render(dt: number): void {
    if (anyFx(this.fx)) {
      if (!this.post) {
        this.post = new PostFx(this.renderer.renderer, this.renderer.scene, this.cam.camera);
        this.post.set(this.fx);
      }
      this.post.render(dt);
    } else this.renderer.render(this.cam.camera);
    if (this.pendingDone) {
      const d = this.pendingDone;
      this.pendingDone = null;
      d();
    }
  }

  /** Redimensiona el post-proceso al tamaño del canvas (ventana). */
  resize(): void {
    if (!this.post) return;
    const gl = this.renderer.renderer;
    this.post.resize(gl.domElement.clientWidth || window.innerWidth, gl.domElement.clientHeight || window.innerHeight, gl.getPixelRatio());
  }

  /**
   * Graba el tramo recortado (con velocidad y efectos) en tiempo real y devuelve el video. La
   * resolución sube temporalmente al alto pedido (con el mismo aspecto de la ventana).
   */
  async export(opts: ExportOptions): Promise<{ blob: Blob; mime: string }> {
    if (!this.clip) throw new Error('Sin clip');
    const gl = this.renderer.renderer;
    const el = gl.domElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    if (opts.height > 0) this.renderer.pixelRatioOverride = Math.min(opts.height / h, gl.capabilities.maxTextureSize / Math.max(w, h));
    else this.renderer.pixelRatioOverride = gl.getPixelRatio();
    this.renderer.resize(this.cam.camera);
    this.resize();
    this.playing = false;
    this.seek(this.trimIn);
    this.update(0);
    this.render(0);
    const rec = startRecording(el, opts.format, 60);
    const total = Math.max(1e-3, this.trimOut - this.trimIn);
    const prog = setInterval(() => opts.onProgress?.(Math.round(Math.min(1, (this.t - this.trimIn) / total) * 100)), 200);
    try {
      await new Promise<void>((done) => {
        this.exporting = { done };
      });
      // Deja que el último cuadro llegue al grabador
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      clearInterval(prog);
      this.exporting = null;
      this.pendingDone = null;
    }
    const blob = await rec.stop();
    this.renderer.pixelRatioOverride = null;
    this.renderer.resize(this.cam.camera);
    this.resize();
    opts.onProgress?.(100);
    return { blob, mime: rec.mime };
  }

  dispose(): void {
    this.post?.dispose();
    this.post = null;
    this.clip = null;
  }
}
