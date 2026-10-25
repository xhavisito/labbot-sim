/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { AUTO_ROUTINES, COLLECT_HOME, LEAVE_ZONE } from '../auto/AutoRoutine';
import { fixedCapacity, ROBOT_PRESETS } from '../config/robot';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { formatTimer, timerSeconds } from '../core/clock';
import { buildMatchLog } from '../core/matchLog';
import { GameSession, type SessionOptions } from '../game/GameSession';
import { loadScout } from '../game/scoutStore';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Renderer } from '../render/Renderer';
import { Hud } from '../ui/Hud';
import { t, type Key } from '../ui/i18n';
import { Menu, type MenuChoice } from '../ui/Menu';
import { saveMatchEntries, ScoutingScreen, type ScoutPlay } from '../ui/Scouting';
import { isTouchDevice, TouchControls } from '../ui/TouchControls';
import { allianceRoles } from '../sim/quickSim';

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
  readonly touch: TouchControls;
  readonly scoutData = loadScout();
  readonly scouting: ScoutingScreen;
  /** `?touch=1` fuerza los controles touch (para probar en escritorio). */
  private touchForced = new URLSearchParams(location.search).get('touch') === '1';

  constructor(host: HTMLElement, ui: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root);
    this.hud = new Hud(ui, { camera: () => this.cycleCamera(), pause: () => this.togglePause(), reset: () => this.resetPractice() });
    this.touch = new TouchControls(ui, this.input);
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => saveSettings(s), this.input);
    this.scouting = new ScoutingScreen(this.menu.root, this.scoutData, () => this.toMenu(), (p) => this.start({ mode: 'match', player: p.player, scout: p }));
    this.menu.onScouting = () => this.scouting.show();
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
    this.session = new GameSession(c.scout ? this.scoutOptions(c.scout) : { ...this.sessionOptions(c.player), solo: c.mode === 'practice' });
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
        if (i !== player) return ROBOT_PRESETS[s.botRobotType];
        const base = ROBOT_PRESETS[s.robotType];
        // La garra del pivote lleva una sola pieza; el chasis, solo la precarga
        return { ...base, maxSpeed: s.maxSpeed, capacity: fixedCapacity(base.mechanism) ?? s.capacity };
      }),
      hp: { enabled: s.hpEnabled, interval: s.hpInterval },
    };
  }

  /**
   * Match del calendario del Scouting: cada robot es el tipo de su equipo; la IA maneja los otros 3
   * con los papeles de su alianza (`allianceRoles`) y tu robot usa tu rutina de AUTO.
   */
  private scoutOptions(p: ScoutPlay): SessionOptions {
    const s = this.settings;
    const auto = AUTO_ROUTINES.find((r) => r.id === s.playerAuto) ?? LEAVE_ZONE;
    return {
      player: p.player,
      preload: true,
      ai: true,
      specs: p.kinds.map((k) => ROBOT_PRESETS[k]),
      autos: p.kinds.map((k, i) => (i === p.player ? auto : k === 'chassis' ? LEAVE_ZONE : COLLECT_HOME)),
      bots: [...allianceRoles(p.kinds[0], p.kinds[1]), ...allianceRoles(p.kinds[2], p.kinds[3])],
      hp: { enabled: s.hpEnabled, interval: s.hpInterval },
    };
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

  /** De vuelta al calendario del Scouting (después de jugar uno de sus matches). */
  toScouting(): void {
    this.toMenu();
    this.scouting.show('schedule');
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
        onMenu: () => (this.choice.scout ? this.toScouting() : this.toMenu()),
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
      const m = this.session.match;
      if (m?.finished) {
        this.state = 'results';
        this.updateTouch();
        const sc = this.choice.scout;
        if (sc) saveMatchEntries(this.scoutData, m, sc.teams, sc.match);
        this.menu.results(
          m,
          () => this.start(this.choice),
          () => (sc ? this.toScouting() : this.toMenu()),
          () => this.downloadLog(),
          this.choice.player,
          sc ? t('sc_saved', { match: sc.match }) : '',
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
    const pos = p.position();
    this.cam.update(dt, { x: pos.x, y: pos.y, z: pos.z, heading: p.heading() });
    this.renderer.render(this.cam.camera);
    requestAnimationFrame(this.loop);
  };
}
