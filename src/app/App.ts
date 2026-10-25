/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { AUTO_ROUTINES, LEAVE_ZONE } from '../auto/AutoRoutine';
import { firstRobot, robotSpec } from '../config/firstRobots';
import { fixedCapacity } from '../config/robot';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { formatTimer, timerSeconds } from '../core/clock';
import { buildMatchLog } from '../core/matchLog';
import { GameSession, type SessionOptions } from '../game/GameSession';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Arena } from '../render/Arena';
import { Effects } from '../render/Effects';
import { guessQuality, QUALITIES, Renderer, type Quality } from '../render/Renderer';
import { pwa } from '../pwa/register';
import { Hud } from '../ui/Hud';
import { t, type Key } from '../ui/i18n';
import { Menu, type MenuChoice } from '../ui/Menu';
import { isTouchDevice, TouchControls } from '../ui/TouchControls';

type State = 'menu' | 'playing' | 'paused' | 'results';

export class App {
  readonly renderer: Renderer;
  readonly arena = new Arena();
  readonly effects = new Effects();
  /** Calidad elegida por "Automática" (baja un nivel si los FPS caen). */
  private autoQuality: Quality = guessQuality();
  private fps = { frames: 0, time: 0, drops: 0 };
  readonly cam: CameraRig;
  readonly input = new InputManager();
  readonly hud: Hud;
  readonly menu: Menu;
  session: GameSession;
  state: State = 'menu';
  private choice: MenuChoice = { mode: 'match', player: 0 };
  readonly settings: Settings = loadSettings(AUTO_ROUTINES.map((r) => r.id));
  private last = performance.now();
  readonly touch: TouchControls;
  /** `?touch=1` fuerza los controles touch (para probar en escritorio). */
  private touchForced = new URLSearchParams(location.search).get('touch') === '1';

  constructor(host: HTMLElement, ui: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root, this.arena.group, this.effects.points);
    this.renderer.onQuality.push((p) => {
      this.arena.setDensity(p.crowd);
      this.effects.amount = p.particles;
    });
    this.applyQuality();
    this.hud = new Hud(ui, { camera: () => this.cycleCamera(), pause: () => this.togglePause(), reset: () => this.resetPractice() });
    this.touch = new TouchControls(ui, this.input);
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => {
      saveSettings(s);
      this.applyQuality();
    }, this.input);
    pwa.onChange = () => {
      if (this.state === 'menu') this.menu.pwaChips();
    };
    this.toMenu();
    const onResize = () => this.renderer.resize(this.cam.camera);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backspace' && !this.input.capturing) this.resetPractice();
    });
    onResize();
    requestAnimationFrame(this.loop);
  }

  /** Empieza un match o una práctica con el robot elegido. */
  start(c: MenuChoice): void {
    this.choice = c;
    this.renderer.scene.remove(this.session.root);
    this.session.dispose();
    // Práctica libre: solo el robot del jugador en la cancha
    this.session = new GameSession({ ...this.sessionOptions(c.player), solo: c.mode === 'practice' });
    this.renderer.scene.add(this.session.root);
    if (c.mode === 'match') this.session.startMatch();
    this.menu.hide();
    this.hud.show(true);
    this.hud.setHelp(this.input.bindings);
    this.state = 'playing';
    this.updateTouch();
    this.cam.setMode(c.player < 2 ? 'driverRed' : 'driverBlue');
  }

  /** Opciones de la sesión según los ajustes: IA, rutinas de AUTO, tu robot y Human Player. */
  private sessionOptions(player: number): SessionOptions {
    const s = this.settings;
    const auto = (id: string) => AUTO_ROUTINES.find((r) => r.id === id) ?? LEAVE_ZONE;
    return {
      player,
      preload: true,
      ai: s.ai,
      autos: [0, 1, 2, 3].map((i) => auto(i === player ? s.playerAuto : s.botAuto)),
      specs: [0, 1, 2, 3].map((i) => {
        if (i !== player) return robotSpec(s.botRobotType);
        const base = robotSpec(s.robotType);
        // La garra del pivote lleva una sola pieza; el chasis, solo la precarga
        return { ...base, maxSpeed: s.maxSpeed, capacity: fixedCapacity(base.mechanism) ?? s.capacity };
      }),
      // Los robots de FIRST juegan con la estrategia que les funcionó (nivel, de dónde juntan, ENDGAME)
      bots: [0, 1, 2, 3].map((i) => firstRobot(i === player ? s.robotType : s.botRobotType)?.strategy),
      hp: { enabled: s.hpEnabled, interval: s.hpInterval },
    };
  }

  /** Calidad gráfica: `?quality=` manda; si no, el ajuste (o la automática). */
  applyQuality(): void {
    const forced = new URLSearchParams(location.search).get('quality') as Quality | null;
    const q = forced && QUALITIES.includes(forced) ? forced : this.settings.quality === 'auto' ? this.autoQuality : this.settings.quality;
    if (q !== this.renderer.quality || !this.qualityApplied) this.renderer.setQuality(q, this.cam.camera);
    this.qualityApplied = true;
  }

  private qualityApplied = false;

  /** "Automática": si el promedio de 4 s baja de 40 FPS jugando, un nivel menos (hasta 2 veces). */
  private watchFps(dt: number): void {
    if (this.settings.quality !== 'auto' || this.state !== 'playing' || this.fps.drops >= 2) return;
    this.fps.frames++;
    this.fps.time += dt;
    if (this.fps.time < 4) return;
    const avg = this.fps.frames / this.fps.time;
    this.fps.frames = this.fps.time = 0;
    const i = QUALITIES.indexOf(this.autoQuality);
    if (avg < 40 && i > 0) {
      this.autoQuality = QUALITIES[i - 1];
      this.fps.drops++;
      this.applyQuality();
    }
  }

  /** Reacomoda la cancha en práctica (Backspace o el botón del HUD). */
  resetPractice(): void {
    if (this.state === 'playing' && !this.session.match) this.session.resetField();
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

  /** Muestra los controles touch solo jugando (y según el ajuste). */
  private updateTouch(): void {
    const s = this.settings.touch;
    const want = this.touchForced || s === 'on' || (s === 'auto' && isTouchDevice());
    document.body.classList.toggle('touch-on', want);
    this.touch.show(want && this.state === 'playing');
  }

  toMenu(): void {
    this.state = 'menu';
    this.touch.show(false);
    this.hud.show(false);
    this.cam.setMode('free');
    this.menu.main();
  }

  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      const m = this.session.match;
      this.menu.pause({
        match: m,
        timer: m ? formatTimer(timerSeconds(m.t, this.session.game)) : '',
        phase: m ? t(`phase_${m.phase}` as Key) : '',
        camera: this.cam.mode,
        setCamera: (c) => this.setCamera(c),
        onResume: () => this.togglePause(),
        onRestart: () => this.start(this.choice),
        onMenu: () => this.toMenu(),
      });
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.menu.hide();
      // Al volver de la pausa la asignación pudo cambiar (Controles)
      this.hud.setHelp(this.input.bindings);
    }
    this.updateTouch();
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
    if (this.input.pause) this.togglePause();
    if (this.state === 'playing') {
      if (this.input.camera) this.cycleCamera();
      this.session.setInput(inp);
      this.session.update(dt);
      this.hud.events(this.session.matchEvents);
      this.hud.update(this.session, this.cam.mode);
      this.touch.setIntake(this.session.player.mech.intakeOn);
      for (const f of this.session.scoreFx) {
        this.effects.burst(f.x, f.y, f.z, f.alliance);
        this.arena.cheer(0.3);
      }
      const m = this.session.match;
      if (m?.finished) {
        this.arena.cheer(1);
        this.state = 'results';
        this.updateTouch();
        this.menu.results(
          m,
          () => this.start(this.choice),
          () => this.toMenu(),
          () => this.downloadLog(),
          this.choice.player,
        );
      }
    } else if (this.state === 'menu') {
      // Vista de fondo: la cámara libre gira despacio alrededor de la cancha
      const a = now / 1000 / 20;
      this.cam.camera.position.set(Math.cos(a) * 9, 6.5, Math.sin(a) * 7.5);
      this.cam.orbit.target.set(0, 0, 0);
    }
    if (this.state !== 'paused') this.session.update(this.state === 'playing' ? 0 : dt);
    this.watchFps(dt);
    this.effects.update(this.state === 'paused' ? 0 : dt);
    this.arena.update(dt, now / 1000, this.cam.camera.position.y);
    const sm = this.session.match;
    if (sm) this.arena.setScreen(formatTimer(timerSeconds(sm.t, this.session.game)), String(sm.score('red')), String(sm.score('blue')));
    else this.arena.setScreen(this.state === 'menu' ? 'LABBOT RESCUE' : t('practiceMode').toUpperCase(), '', '');
    const p = this.session.player.phys;
    const pt = p.position();
    this.cam.update(dt, { x: pt.x, y: pt.y, z: pt.z, heading: p.heading() });
    this.renderer.render(this.cam.camera);
    requestAnimationFrame(this.loop);
  };
}
