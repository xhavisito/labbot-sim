/**
 * Post-proceso opcional del Modo Director (motion blur ligero, bloom, viñeta). Solo se crea al
 * activar un efecto dentro del estudio; el juego normal sigue sin post-proceso (ver Renderer).
 */
import * as THREE from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface FxOptions {
  motionBlur: boolean;
  bloom: boolean;
  vignette: boolean;
}

export const NO_FX: FxOptions = { motionBlur: false, bloom: false, vignette: false };
export const anyFx = (o: FxOptions): boolean => o.motionBlur || o.bloom || o.vignette;

const VignetteShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, strength: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.78, 0.18, length(d * vec2(1.0, 0.85)));
      c.rgb *= mix(1.0 - strength, 1.0, v); gl_FragColor = c; }`,
};

export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private blur: AfterimagePass;
  private vignette: ShaderPass;
  private opts: FxOptions = { ...NO_FX };

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Buffer de media precisión con MSAA para conservar el antialias del render normal
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.6, 0.85);
    this.blur = new AfterimagePass(0.55);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.blur);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
    this.set(this.opts);
  }

  set(o: FxOptions): void {
    this.opts = { ...o };
    this.bloom.enabled = o.bloom;
    this.blur.enabled = o.motionBlur;
    this.vignette.enabled = o.vignette;
  }

  /** Tamaño del buffer de dibujo (en píxeles reales). */
  resize(w: number, h: number, pixelRatio = 1): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
