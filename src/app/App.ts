/** Orquestador: renderer, cámara, sesión y bucle principal. */
import { GameSession } from '../game/GameSession';
import { CameraRig } from '../render/CameraRig';
import { Renderer } from '../render/Renderer';

export class App {
  readonly renderer: Renderer;
  readonly cam: CameraRig;
  session: GameSession;
  private last = performance.now();

  constructor(host: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root);
    const onResize = () => this.renderer.resize(this.cam.camera);
    window.addEventListener('resize', onResize);
    onResize();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.session.update(dt);
    this.cam.update(dt);
    this.renderer.render(this.cam.camera);
    requestAnimationFrame(this.loop);
  };
}
