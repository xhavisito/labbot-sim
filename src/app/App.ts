/** Orquestador: renderer, cámara, entrada, sesión y bucle principal. */
import { GameSession } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig } from '../render/CameraRig';
import { Renderer } from '../render/Renderer';

export class App {
  readonly renderer: Renderer;
  readonly cam: CameraRig;
  readonly input = new InputManager();
  session: GameSession;
  private last = performance.now();

  constructor(host: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root);
    this.cam.setMode('follow');
    const onResize = () => this.renderer.resize(this.cam.camera);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') this.cycleCamera();
    });
    onResize();
    requestAnimationFrame(this.loop);
  }

  cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.cam.mode);
    this.cam.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session.setInput(this.input.poll());
    this.session.update(dt);
    const p = this.session.player.phys;
    const t = p.position();
    this.cam.update(dt, { x: t.x, y: t.y, z: t.z, heading: p.heading() });
    this.renderer.render(this.cam.camera);
    requestAnimationFrame(this.loop);
  };
}
