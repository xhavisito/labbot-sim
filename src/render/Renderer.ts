/** WebGLRenderer, escena, luces y sombras. Sin post-proceso (ligero). */
import * as THREE from 'three';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  constructor(readonly canvasHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14171c);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -7;
    c.right = 7;
    c.top = 6;
    c.bottom = -6;
    c.near = 1;
    c.far = 25;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  resize(cam: THREE.PerspectiveCamera): void {
    const w = this.canvasHost.clientWidth || window.innerWidth;
    const h = this.canvasHost.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  render(cam: THREE.Camera): void {
    this.renderer.render(this.scene, cam);
  }
}
