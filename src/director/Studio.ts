/**
 * Reveal Studio — reproducción y edición de un clip (sin DOM, salvo el canvas que se graba).
 * Dibuja el clip con las mallas de la sesión (`GameSession.showFrame`), mueve la cámara
 * cinematográfica y aplica velocidad/efectos. La física NO corre mientras el estudio está abierto.
 */
import * as THREE from 'three';
import type { GameSession } from '../game/GameSession';
import type { Renderer } from '../render/Renderer';
import { robotOffset, R, sampleClip, type Clip } from './clipBuffer';
import { anyFx, NO_FX, PostFx, type FxOptions } from './PostFx';
import { RevealCamera, type Subject } from './RevealCamera';
import { startRecording, type VideoFormat } from './exportClip';
import { advance, DEFAULT_RAMP, type SpeedRamp } from './speedRamp';

export interface ExportOptions {
  format: VideoFormat;
  /** Altura del video en píxeles; 0 = la del canvas en pantalla. */
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
  focus = 0;
  fx: FxOptions = { ...NO_FX };
  readonly cam: RevealCamera;
  /** Entrada de la cámara libre: adelante, derecha, arriba (−1…1). */
  readonly move = { f: 0, r: 0, u: 0 };
  private post: PostFx | null = null;
  private frame: Float32Array = new Float32Array(0);
  private subject: Subject = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), speed: 0 };
  private exporting: { done: () => void } | null = null;

  constructor(
    private session: GameSession,
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
    this.frame = new Float32Array(clip.layout.stride);
    this.trimIn = 0;
    this.trimOut = clip.duration;
    this.ramp = DEFAULT_RAMP(clip.trigger);
    this.focus = clip.focus;
    this.t = 0;
    this.playing = true;
    this.cam.reset();
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

  /** Avanza `dt` segundos reales, dibuja y renderiza un cuadro. */
  tick(dt: number): void {
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
    this.draw(dt);
    if (exp && finished) {
      this.exporting = null;
      exp.done();
    }
  }

  /** Dibuja el cuadro actual (útil también en pausa y al arrastrar la línea de tiempo). */
  draw(dt: number): void {
    const c = this.clip;
    if (!c) return;
    sampleClip(c, this.t, this.frame);
    this.session.showFrame(this.frame, c.layout.nRobots);
    const o = robotOffset(c.layout, this.focus);
    const f = this.frame;
    this.subject.pos.set(f[o + R.x], f[o + R.y], f[o + R.z]);
    this.subject.quat.set(f[o + R.qx], f[o + R.qy], f[o + R.qz], f[o + R.qw]);
    this.subject.speed = f[o + R.speed];
    if (this.cam.preset === 'free' && (this.move.f || this.move.r || this.move.u)) this.cam.move(this.move.f, this.move.r, this.move.u, dt);
    const span = Math.max(1e-3, this.trimOut - this.trimIn);
    this.cam.update(this.subject, this.t, Math.min(1, Math.max(0, (this.t - this.trimIn) / span)), dt);
    this.render(dt);
  }

  private render(dt: number): void {
    if (anyFx(this.fx)) {
      if (!this.post) {
        this.post = new PostFx(this.renderer.renderer, this.renderer.scene, this.cam.camera);
        this.post.set(this.fx);
      }
      this.post.render(dt);
    } else this.renderer.render(this.cam.camera);
  }

  /** Redimensiona el post-proceso al tamaño del canvas (ventana). */
  resize(): void {
    if (!this.post) return;
    const el = this.renderer.renderer.domElement;
    this.post.resize(el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight, this.renderer.renderer.getPixelRatio());
  }

  /**
   * Graba el tramo recortado (con velocidad y efectos) en tiempo real y devuelve el video. La
   * resolución sube temporalmente al alto pedido (con el mismo aspecto de la ventana).
   */
  async export(opts: ExportOptions): Promise<{ blob: Blob; mime: string }> {
    const c = this.clip;
    if (!c) throw new Error('Sin clip');
    const gl = this.renderer.renderer;
    const el = gl.domElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    const prevRatio = gl.getPixelRatio();
    const maxTex = gl.capabilities.maxTextureSize;
    let ratio = prevRatio;
    if (opts.height > 0) ratio = Math.min(opts.height / h, maxTex / Math.max(w, h));
    gl.setPixelRatio(ratio);
    gl.setSize(w, h, false);
    this.post?.resize(w, h, ratio);
    this.playing = false;
    this.seek(this.trimIn);
    this.draw(0);
    const rec = startRecording(el, opts.format, 60);
    const total = this.trimOut - this.trimIn;
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
    }
    const blob = await rec.stop();
    gl.setPixelRatio(prevRatio);
    gl.setSize(w, h, false);
    this.post?.resize(w, h, prevRatio);
    opts.onProgress?.(100);
    return { blob, mime: rec.mime };
  }

  dispose(): void {
    this.post?.dispose();
    this.post = null;
    this.clip = null;
  }
}
