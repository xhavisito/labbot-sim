/**
 * WebGL2 con presets de calidad, como rebuilt-sim: reflejos del entorno (IBL con RoomEnvironment),
 * sombras suaves, bloom para las luces emisivas, antialias (MSAA o FXAA), niebla y resolución
 * según el equipo. Baja = render directo sin post-proceso (celulares lentos).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  /** Tope de devicePixelRatio y escala de resolución encima de él. */
  maxPixelRatio: number;
  renderScale: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Sombras suaves (PCFSoft) en lugar de PCF. */
  softShadows: boolean;
  bloom: boolean;
  aa: 'none' | 'fxaa' | 'msaa';
  /** Reflejos del entorno (IBL; barato, sin ellos los metales se ven negros). */
  ibl: boolean;
  /** Densidad del público en las gradas (0–1). */
  crowd: number;
  /** Partículas al anotar (0–1). */
  particles: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { maxPixelRatio: 1, renderScale: 0.8, shadows: false, shadowMapSize: 512, softShadows: false, bloom: false, aa: 'none', ibl: true, crowd: 0, particles: 0.4 },
  medium: { maxPixelRatio: 1.5, renderScale: 0.9, shadows: true, shadowMapSize: 1024, softShadows: false, bloom: true, aa: 'fxaa', ibl: true, crowd: 0.4, particles: 0.7 },
  high: { maxPixelRatio: 2, renderScale: 1, shadows: true, shadowMapSize: 2048, softShadows: true, bloom: true, aa: 'msaa', ibl: true, crowd: 1, particles: 1 },
};

/** Calidad inicial para "Automática": media en celulares y tabletas, alta en computadora. */
export function guessQuality(): Quality {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  if (coarse) return cores >= 8 ? 'medium' : 'low';
  return cores >= 4 ? 'high' : 'medium';
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  quality: Quality = 'high';
  preset: QualityPreset = QUALITY.high;
  /** Se llama al cambiar la calidad (público, partículas…). */
  readonly onQuality: Array<(p: QualityPreset) => void> = [];
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private envMap: THREE.Texture;

  constructor(readonly canvasHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    canvasHost.appendChild(this.renderer.domElement);

    // Gimnasio de noche: fondo azul muy oscuro y niebla lejana
    this.scene.background = new THREE.Color(0x0b0e15);
    this.scene.fog = new THREE.Fog(0x0b0e15, 26, 60);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.38;

    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 0.45);
    this.scene.add(this.hemi);
    // Luz principal (focos del techo) con sombras
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.1);
    this.sun.position.set(-2.5, 12, 4);
    const c = this.sun.shadow.camera;
    c.left = -6.5;
    c.right = 6.5;
    c.top = 5.2;
    c.bottom = -5.2;
    c.near = 2;
    c.far = 26;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    // Relleno frío del lado contrario (para que nada quede negro)
    const fill = new THREE.DirectionalLight(0xc8d6ff, 0.45);
    fill.position.set(5, 7, -8);
    this.scene.add(fill);
  }

  setQuality(q: Quality, camera: THREE.Camera): void {
    this.quality = q;
    const p = (this.preset = QUALITY[q]);
    const r = this.renderer;
    r.shadowMap.enabled = p.shadows;
    r.shadowMap.type = p.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.castShadow = p.shadows;
    if (p.shadows) {
      this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    r.shadowMap.needsUpdate = true;
    this.scene.environment = p.ibl ? this.envMap : null;
    this.hemi.intensity = p.ibl ? 0.45 : 1.25;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
    this.buildComposer(camera);
    this.resize(camera as THREE.PerspectiveCamera);
    for (const cb of this.onQuality) cb(p);
  }

  private buildComposer(camera: THREE.Camera): void {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    const p = this.preset;
    if (!p.bloom && p.aa === 'none') return;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: p.aa === 'msaa' ? 4 : 0 });
    const c = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, camera);
    c.addPass(this.renderPass);
    // Solo brilla lo muy luminoso (lámparas, LEDs, remolinos): umbral alto
    if (p.bloom) c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.05));
    c.addPass(new OutputPass());
    if (p.aa === 'fxaa') c.addPass(new FXAAPass());
    this.composer = c;
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.preset.renderScale;
  }

  resize(cam: THREE.PerspectiveCamera): void {
    const w = this.canvasHost.clientWidth || window.innerWidth;
    const h = this.canvasHost.clientHeight || window.innerHeight;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  render(cam: THREE.Camera): void {
    if (this.composer && this.renderPass) {
      this.renderPass.camera = cam;
      this.composer.render();
    } else this.renderer.render(this.scene, cam);
  }
}
