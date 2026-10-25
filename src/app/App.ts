/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { AUTO_ROUTINES, LEAVE_ZONE } from '../auto/AutoRoutine';
import { ROBOT_PRESETS } from '../config/robot';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { buildMatchLog } from '../core/matchLog';
import { GameSession } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Renderer } from '../render/Renderer';
import { Hud } from '../ui/Hud';
import { Menu, type MenuChoice } from '../ui/Menu';

type State = 'menu' | 'playing' | 'paused' | 'results';

export class App {
  readonly renderer: Renderer;
  readonly cam: CameraRig;
  readonly input = new InputManager();
  readonly hud: Hud;
  readonly menu: Menu;
  session: GameSession;
  state: State = 'menu';
  private choice: MenuChoice = { mode: 'match', player: 0 };
  readonly settings: Settings = loadSettings(AUTO_ROUTINES.map((r) => r.id));
  private last = performance.now();

  constructor(host: HTMLElement, ui: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root);
    this.hud = new Hud(ui);
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => saveSettings(s));
    this.toMenu();
    const onResize = () => this.renderer.resize(this.cam.camera);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && this.state === 'playing') this.cycleCamera();
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'Backspace' && this.state === 'playing' && !this.session.match) this.session.resetField();
    });
    onResize();
    requestAnimationFrame(this.loop);
  }

  /** Empieza un match o una práctica con el robot elegido. */
  start(c: MenuChoice): void {
    this.choice = c;
    this.renderer.scene.remove(this.session.root);
    this.session.dispose();
    this.session = new GameSession(this.sessionOptions(c.player));
    this.renderer.scene.add(this.session.root);
    if (c.mode === 'match') this.session.startMatch();
    this.menu.hide();
    this.hud.show(true);
    this.state = 'playing';
    this.cam.setMode(c.player < 2 ? 'driverRed' : 'driverBlue');
  }

  /** Opciones de la sesión según los ajustes: IA, rutinas de AUTO, tu robot y Human Player. */
  private sessionOptions(player: number): ConstructorParameters<typeof GameSession>[0] {
    const s = this.settings;
    const auto = (id: string) => AUTO_ROUTINES.find((r) => r.id === id) ?? LEAVE_ZONE;
    return {
      player,
      preload: true,
      ai: s.ai,
      autos: [0, 1, 2, 3].map((i) => auto(i === player ? s.playerAuto : s.botAuto)),
      specs: [0, 1, 2, 3].map((i) => {
        if (i !== player) return ROBOT_PRESETS[s.botRobotType];
        const base = ROBOT_PRESETS[s.robotType];
        // La garra del pivote lleva una sola pieza
        return { ...base, maxSpeed: s.maxSpeed, capacity: base.mechanism === 'pivot' ? 1 : s.capacity };
      }),
      hp: { enabled: s.hpEnabled, interval: s.hpInterval },
    };
  }

  /** Descarga el registro del match terminado como JSON. */
  downloadLog(): void {
    const m = this.session.match;
    if (!m) return;
    const log = buildMatchLog(m, this.session.log, { player: this.choice.player, settings: { ...this.settings } });
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `labbot-match-${log.createdAt.replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  toMenu(): void {
    this.state = 'menu';
    this.hud.show(false);
    this.cam.setMode('free');
    this.menu.main();
  }

  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.menu.pause(
        () => this.togglePause(),
        () => this.start(this.choice),
        () => this.toMenu(),
      );
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.menu.hide();
    }
  }

  cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.cam.mode);
    this.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  setCamera(m: CameraMode): void {
    this.cam.setMode(m);
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const inp = this.input.poll();
    if (this.input.padPause) this.togglePause();
    if (this.state === 'playing') {
      if (this.input.padCamera) this.cycleCamera();
      this.session.setInput(inp);
      this.session.update(dt);
      this.hud.events(this.session.matchEvents);
      this.hud.update(this.session, this.cam.mode);
      const m = this.session.match;
      if (m?.finished) {
        this.state = 'results';
        this.menu.results(
          m,
          () => this.start(this.choice),
          () => this.toMenu(),
          () => this.downloadLog(),
        );
      }
    } else if (this.state === 'menu') {
      // Vista de fondo: la cámara libre gira despacio alrededor de la cancha
      const a = now / 1000 / 20;
      this.cam.camera.position.set(Math.cos(a) * 9, 6.5, Math.sin(a) * 7.5);
      this.cam.orbit.target.set(0, 0, 0);
    }
    if (this.state !== 'paused') this.session.update(this.state === 'playing' ? 0 : dt);
    const p = this.session.player.phys;
    const t = p.position();
    this.cam.update(dt, { x: t.x, y: t.y, z: t.z, heading: p.heading() });
    this.renderer.render(this.cam.camera);
    requestAnimationFrame(this.loop);
  };
}
