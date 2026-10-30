/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { LEAVE_ZONE, type AutoRoutine } from '../auto/AutoRoutine';
import { aiLineup } from '../ai/lineup';
import { STRATEGY_OPTIONS } from '../ai/strategy';
import { allAutoRoutines, autoRoutineIds } from '../auto/recorded';
import { ROBOT_PRESETS, type MechanismKind, type RobotSpec } from '../config/robot';
import { robotSpec } from '../config/robotIds';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { formatTimer, timerSeconds } from '../core/clock';
import { buildMatchLog } from '../core/matchLog';
import { drillById } from '../core/training';
import { drillSessionOptions } from '../game/drills';
import { loadTraining } from '../game/trainingStore';
import { GameSession, type SessionOptions } from '../game/GameSession';
import { loadScout } from '../game/scoutStore';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Arena } from '../render/Arena';
import { Effects } from '../render/Effects';
import { guessQuality, QUALITIES, Renderer, type Quality } from '../render/Renderer';
import { pwa } from '../pwa/register';
import type { Replay } from '../replay/format';
import { Recorder } from '../replay/Recorder';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { storeReplay } from '../replay/store';
import { AutoPractice } from '../ui/AutoPractice';
import { ReplayBar } from '../ui/ReplayBar';
import { ReplaysScreen } from '../ui/ReplaysScreen';
import { RobotEditor } from '../ui/RobotEditor';
import { StatsPanel } from '../ui/StatsPanel';
import { Hud } from '../ui/Hud';
import { t, type Key } from '../ui/i18n';
import { ic } from '../ui/chrome';
import { MatchSetup } from '../ui/MatchSetup';
import { PadNav } from '../ui/padNav';
import { Menu, type MenuChoice } from '../ui/Menu';
import { saveMatchEntries, ScoutingScreen, type ScoutPlay } from '../ui/Scouting';
import { isTouchDevice, TouchControls } from '../ui/TouchControls';
import { TournamentScreen, WATCH_CAMERA } from '../ui/TournamentScreen';
import { TrainingRun, TrainingScreen, type TrainingRobot } from '../ui/Training';

type State = 'menu' | 'playing' | 'paused' | 'results' | 'replay';

/** Nombre del robot para la repetición y las estadísticas (robot propio o tipo). */
const robotLabel = (s: RobotSpec): string => s.label ?? t(`type_${s.mechanism}` as Key);

export class App {
  readonly renderer: Renderer;
  readonly arena = new Arena();
  readonly effects = new Effects();
  /** Calidad elegida por "Automática" (baja un nivel si los FPS caen). */
  private autoQuality: Quality = guessQuality();
  private fps = { frames: 0, time: 0, drops: 0 };
  readonly cam: CameraRig;
  readonly input = new InputManager();
  /** Menús con el control: foco, A elige, B regresa (`ui/padNav.ts`). */
  readonly padNav = new PadNav();
  readonly hud: Hud;
  readonly menu: Menu;
  session: GameSession;
  state: State = 'menu';
  private choice: MenuChoice = { mode: 'match', player: 0 };
  readonly settings: Settings = loadSettings(autoRoutineIds());
  private last = performance.now();
  /** Último cuadro dibujado detrás de una pantalla opaca (ver `loop`). */
  private lastBehind = 0;
  readonly touch: TouchControls;
  /** Repetición: grabadora del match en curso, la del último match y el reproductor abierto. */
  private recorder: Recorder | null = null;
  lastReplay: Replay | null = null;
  replay: ReplayPlayer | null = null;
  private replayBack: () => void = () => this.toMenu();
  readonly replayBar: ReplayBar;
  readonly replays: ReplaysScreen;
  readonly editor: RobotEditor;
  /** Práctica de AUTO abierta (panel y grabación sobre la sesión de práctica). */
  autoPractice: AutoPractice | null = null;
  readonly scoutData = loadScout();
  readonly scouting: ScoutingScreen;
  readonly tourney: TournamentScreen;
  /** Entrenamiento por retos: récords (localStorage), lista de retos y el reto en curso. */
  readonly trainingProgress = loadTraining();
  readonly training: TrainingScreen;
  trainingRun: TrainingRun | null = null;
  /** Aviso de resultados del último match del torneo (se guarda una vez; los resultados se reabren). */
  private tourNote = '';
  /** `?touch=1` fuerza los controles touch (para probar en escritorio). */
  private touchForced = new URLSearchParams(location.search).get('touch') === '1';

  constructor(host: HTMLElement, ui: HTMLElement) {
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root, this.arena.group, this.effects.points);
    this.renderer.onQuality.push((p) => {
      this.effects.amount = p.particles;
    });
    this.applyQuality();
    this.hud = new Hud(ui, { camera: () => this.cycleCamera(), pause: () => this.togglePause(), reset: () => this.resetPractice() });
    this.touch = new TouchControls(ui, this.input);
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => {
      saveSettings(s);
      this.applyQuality();
    }, this.input);
    this.replayBar = new ReplayBar(ui, { camera: () => this.cycleCamera(), stats: () => this.replayStats(), exit: () => this.exitReplay() });
    this.replays = new ReplaysScreen(this.menu.root, {
      back: () => this.toMenu(),
      watch: (r) => this.watchReplay(r, () => this.openReplays()),
      stats: (r) => this.showStats(r, () => this.openReplays(), () => this.watchReplay(r, () => this.openReplays())),
    });
    this.menu.onReplays = () => this.openReplays();
    this.editor = new RobotEditor(this.menu.root, () => this.toMenu(), (id) => this.menu.useRobot(id));
    this.menu.onEditor = () => this.editor.show(null);
    this.scouting = new ScoutingScreen(this.menu.root, this.scoutData, () => this.toMenu(), (p) => this.start({ mode: 'match', player: p.player, scout: p }));
    this.menu.onScouting = () => this.scouting.show();
    this.tourney = new TournamentScreen(this.menu.root, this.scoutData, this.settings, {
      back: () => this.toMenu(),
      play: (p, watch) => {
        this.start({ mode: 'match', player: p.player, scout: p });
        if (watch) this.setCamera(WATCH_CAMERA[watch]);
      },
      scouting: () => this.scouting.show('teams'),
      history: () => this.scouting.show('history'),
    });
    this.menu.onTournament = () => this.tourney.open();
    this.training = new TrainingScreen(this.menu.root, this.trainingProgress, () => this.trainingRobot(), {
      back: () => this.toMenu(),
      play: (drill) => this.start({ mode: 'training', player: this.menu.player, drill }),
    });
    this.menu.onTraining = () => this.training.show();
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

  /**
   * Empieza un match o una práctica con el robot elegido. Un match en el que manejas un robot pasa
   * antes por "Preparar match" (`ui/MatchSetup.ts`); "Jugar de nuevo" repite lo mismo sin preguntar.
   */
  start(c: MenuChoice): void {
    if (c.mode === 'match' && !c.ready && c.player >= 0) return this.openSetup(c);
    this.choice = c;
    this.closeAutoPractice();
    this.closeTraining();
    this.renderer.scene.remove(this.session.root);
    this.session.dispose();
    // Práctica libre y de AUTO: solo el robot del jugador en la cancha (en la de AUTO, sin Human Player)
    const o = c.scout ? this.scoutOptions(c.scout) : this.sessionOptions(c.player);
    const drill = c.mode === 'training' ? drillById(c.drill ?? '') : undefined;
    if (c.mode === 'training' && !drill) return this.toMenu();
    this.session = new GameSession(
      drill
        ? { ...drillSessionOptions(drill, c.player, this.playerSpec(), this.settings.hpInterval), grip: this.settings.grip }
        : c.scout
          ? o
          : { ...o, solo: c.mode !== 'match', ...(c.mode === 'auto' ? { hp: { enabled: false, interval: 3 } } : {}) },
    );
    this.renderer.scene.add(this.session.root);
    if (c.mode === 'match') this.session.startMatch();
    // Cada match se graba para la repetición y las estadísticas
    this.recorder = c.mode === 'match' ? new Recorder(this.session, this.session.robots.map((r) => robotLabel(r.spec))) : null;
    this.session.tap = this.recorder;
    this.menu.hide();
    this.hud.show(true);
    this.hud.setHelp(this.input.bindings);
    this.state = 'playing';
    this.updateTouch();
    this.cam.setMode(c.player < 2 ? 'driverRed' : 'driverBlue');
    if (c.mode === 'auto')
      this.autoPractice = new AutoPractice(this.hud.root.parentElement ?? document.body, {
        session: () => this.session,
        robotName: robotLabel(this.session.player.spec),
        exit: () => this.toMenu(),
        useRoute: (id) => {
          this.settings.playerAuto = id;
          saveSettings(this.settings);
        },
        currentAuto: () => this.settings.playerAuto,
      });
    if (drill)
      this.trainingRun = new TrainingRun(this.hud.root.parentElement ?? document.body, drill, {
        session: () => this.session,
        progress: this.trainingProgress,
        robot: this.trainingRobot(),
        other: () => {
          this.toMenu();
          this.training.show();
        },
        exit: () => this.toMenu(),
      });
  }

  private closeTraining(): void {
    this.trainingRun?.dispose();
    this.trainingRun = null;
  }

  /** Robot con el que se entrena (el del menú; los récords son por robot). */
  private trainingRobot(): TrainingRobot {
    const s = this.playerSpec();
    return { id: this.settings.robotType, name: robotLabel(s), mech: s.mechanism };
  }

  private closeAutoPractice(): void {
    this.autoPractice?.dispose();
    this.autoPractice = null;
  }

  /**
   * "Preparar match": tu posición inicial y la estrategia, dificultad, tipo y AUTO de cada robot de
   * la IA. En el Scouting y el torneo los tipos y la estación los fija el calendario.
   */
  private openSetup(c: MenuChoice): void {
    const sc = c.scout;
    const back = () => {
      if (!sc) return this.toMenu();
      this.toMenu();
      if (sc.tour) this.tourney.open();
      else this.scouting.show('schedule');
    };
    const spec = sc && !sc.tour ? ROBOT_PRESETS[sc.kinds[c.player]] : this.playerSpec();
    new MatchSetup(this.menu.root, this.settings, {
      back,
      save: () => saveSettings(this.settings),
      start: (player) => {
        if (!sc) this.menu.player = player;
        this.start({ ...c, player, ready: true });
      },
    }).show({
      player: c.player,
      playerSpec: spec,
      playerName: robotLabel(spec),
      kinds: sc?.kinds,
      teams: sc?.teams.map((id) => this.scoutData.teams.find((x) => x.id === id)?.name ?? id),
      canMove: !sc,
    });
  }

  /**
   * Opciones de la sesión según los ajustes y "Preparar match": tu robot, tu lugar en la Zona de
   * Inicio y tu AUTO; tipo, estrategia, dificultad y AUTO de cada robot de la IA; Human Player.
   * `kinds` fija los tipos (Scouting y torneo); sin él, los de "Al azar" salen de `aiLineup`.
   */
  private sessionOptions(player: number, kinds?: readonly MechanismKind[], tour = false): SessionOptions {
    const s = this.settings;
    const m = s.match;
    const routine = (id: string) => allAutoRoutines().find((r) => r.id === id) ?? LEAVE_ZONE;
    const random = aiLineup(player, this.playerSpec().mechanism);
    const types = kinds ?? m.robots.map((r, i) => (r.kind === 'random' ? random[i] : r.kind));
    const botAuto = (i: number): AutoRoutine => {
      const a = routine(m.robots[i].auto);
      // "Solo línea y Plataforma" no anota: con una rutina de la IA se quedaría quieto en AUTO
      return m.robots[i].strategy === 'park' && a.bot ? LEAVE_ZONE : a;
    };
    return {
      player,
      preload: true,
      ai: s.ai,
      // Tu robot es el del menú (con tu velocidad y capacidad), salvo en el Scouting: el de tu equipo
      specs: types.map((k, i) => (i === player && (!kinds || tour) ? this.playerSpec() : ROBOT_PRESETS[k])),
      autos: [0, 1, 2, 3].map((i) => (i === player ? routine(s.playerAuto) : botAuto(i))),
      bots: [0, 1, 2, 3].map((i) => (i === player ? undefined : { ...STRATEGY_OPTIONS[m.robots[i].strategy], ai: m.robots[i].ai })),
      starts: [0, 1, 2, 3].map((i) => (i === player ? m.start : undefined)),
      hp: { enabled: s.hpEnabled, interval: s.hpInterval },
      grip: s.grip,
      damage: { ...s.damage },
      seed: (Math.random() * 2 ** 32) >>> 0,
    };
  }

  /** Match del calendario del Scouting o del torneo: cada robot es el tipo de su equipo; la IA maneja los otros 3. */
  private scoutOptions(p: ScoutPlay): SessionOptions {
    return { ...this.sessionOptions(p.player, p.kinds, p.tour), ai: true };
  }

  /** Tu robot según los ajustes (tipo, velocidad y capacidad). */
  private playerSpec(): RobotSpec {
    const s = this.settings;
    return { ...robotSpec(s.robotType), maxSpeed: s.maxSpeed };
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
    if (this.state !== 'playing' || this.session.match) return;
    if (this.autoPractice) this.autoPractice.reset();
    else if (this.trainingRun) this.trainingRun.reset();
    else this.session.resetField();
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

  /** Resultados del match terminado, con botones para la repetición y las estadísticas. */
  private showResults(): void {
    const m = this.session.match;
    if (!m) return this.toMenu();
    this.state = 'results';
    const sc = this.choice.scout;
    this.menu.results(
      m,
      () => this.start(this.choice),
      () => (sc ? this.toScouting() : this.toMenu()),
      () => this.downloadLog(),
      this.choice.player,
      sc?.tour ? this.tourNote : sc ? t('sc_saved', { match: sc.match }) : '',
      sc?.tour ? t('tr_continue') : undefined,
    );
    const rep = this.lastReplay;
    const bar = this.menu.root.querySelector('.results .actions');
    if (!rep || !bar) return;
    bar.insertAdjacentHTML('afterbegin', `<button class="btn" data-act="replay">${ic.play}<span>${t('rp_watch')}</span></button><button class="btn" data-act="stats">${ic.chart}<span>${t('st_title')}</span></button>`);
    const back = () => this.showResults();
    bar.querySelector('[data-act="replay"]')!.addEventListener('click', () => this.watchReplay(rep, back));
    bar.querySelector('[data-act="stats"]')!.addEventListener('click', () => this.showStats(rep, back, () => this.watchReplay(rep, back)));
  }

  /** Pantalla de estadísticas de una repetición. */
  showStats(r: Replay, back: () => void, watch: (() => void) | null): void {
    this.hud.show(false);
    this.touch.show(false);
    new StatsPanel(this.menu.root, r, back, watch).show();
  }

  openReplays(): void {
    this.toMenu();
    void this.replays.show();
  }

  /** Abre el reproductor (la sesión en vivo se queda guardada detrás). `back` = adónde volver al salir. */
  watchReplay(r: Replay, back: () => void): void {
    this.closeReplay();
    this.menu.hide();
    this.hud.show(false);
    this.touch.show(false);
    this.replay = new ReplayPlayer(r);
    this.renderer.scene.remove(this.session.root);
    this.renderer.scene.add(this.replay.session.root);
    this.replayBack = back;
    this.state = 'replay';
    this.replayBar.show(this.replay);
    const focus = r.header.robots[this.replay.focus];
    this.cam.setMode(focus?.alliance === 'blue' ? 'driverBlue' : 'driverRed');
  }

  private closeReplay(): void {
    if (!this.replay) return;
    this.renderer.scene.remove(this.replay.session.root);
    this.replay.dispose();
    this.replay = null;
    this.renderer.scene.add(this.session.root);
    this.replayBar.show(null);
  }

  exitReplay(): void {
    this.closeReplay();
    this.replayBack();
  }

  /** Estadísticas desde la barra de la repetición (pausa; al volver sigue la repetición). */
  private replayStats(): void {
    const p = this.replay;
    if (!p) return;
    p.playing = false;
    this.replayBar.show(null);
    this.showStats(p.replay, () => {
      this.menu.hide();
      this.replayBar.show(p);
    }, null);
  }

  toMenu(): void {
    this.closeAutoPractice();
    this.closeTraining();
    this.state = 'menu';
    this.touch.show(false);
    this.hud.show(false);
    this.cam.setMode('free');
    this.menu.main();
  }

  /** De vuelta al calendario del Scouting (después de jugar uno de sus matches). */
  toScouting(): void {
    this.toMenu();
    // Match del torneo: de vuelta a su pantalla
    if (this.choice.scout?.tour) return this.tourney.open();
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
        onRestart: this.choice.scout?.tour ? undefined : () => this.start(this.choice),
        onMenu: () => (this.choice.scout ? this.toScouting() : this.toMenu()),
        menuLabel: this.choice.scout?.tour ? t('tr_backTo') : undefined,
      });
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.menu.hide();
      // Al volver de la pausa la asignación pudo cambiar (Controles)
      this.hud.setHelp(this.input.bindings);
    }
    this.updateTouch();
  }

  /** La UI que el control navega ahora; jugando (manejando el robot) ninguna. */
  private padScope(): HTMLElement | null {
    if (this.state === 'playing') {
      if (this.autoPractice?.wantsUi) return this.autoPractice.root;
      if (this.trainingRun?.wantsUi) return this.trainingRun.root;
      return null;
    }
    if (this.menu.root.style.display !== 'none') return this.menu.root;
    if (this.state === 'replay' && this.replay) return this.replayBar.root;
    return null;
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
    // Mientras el Scouting simula matches no se mueve ni se dibuja la cancha de fondo (la pantalla la
    // tapa): todo el tiempo es para la simulación
    if (this.scouting.busy) {
      requestAnimationFrame(this.loop);
      return;
    }
    const inp = this.input.poll();
    if (this.input.pause) {
      if (this.state === 'replay') this.exitReplay();
      else this.togglePause();
    }
    if (this.state === 'playing') {
      if (this.input.camera) this.cycleCamera();
      this.session.setInput(this.autoPractice ? this.autoPractice.filter(inp) : this.trainingRun ? this.trainingRun.filter(inp) : inp);
      this.session.update(dt);
      this.autoPractice?.update(dt);
      this.trainingRun?.update(dt);
      this.hud.events(this.session.matchEvents);
      this.hud.damage(this.session);
      this.hud.update(this.session, this.cam.mode);
      this.touch.setIntake(this.session.player.mech.intakeOn);
      for (const f of this.session.scoreFx) this.effects.burst(f.x, f.y, f.z, f.alliance);
      const m = this.session.match;
      if (m?.finished) {
        this.state = 'results';
        this.updateTouch();
        const sc = this.choice.scout;
        if (sc && !sc.tour) saveMatchEntries(this.scoutData, m, sc.teams, sc.match);
        // Torneo: el resultado va a su tabla
        this.tourNote = sc?.tour ? this.tourney.record(m, sc) : '';
        this.lastReplay = this.recorder?.build(this.session) ?? null;
        if (this.lastReplay) void storeReplay(this.lastReplay);
        this.showResults();
      }
    } else if (this.state === 'replay' && this.replay) {
      if (this.input.camera) this.cycleCamera();
      if (this.replayBar.root.style.display !== 'none') this.replay.update(dt);
      this.replayBar.update();
    } else if (this.state === 'menu') {
      // Vista de fondo: la cámara libre gira despacio alrededor de la cancha
      const a = now / 1000 / 20;
      this.cam.camera.position.set(Math.cos(a) * 9, 6.5, Math.sin(a) * 7.5);
      this.cam.orbit.target.set(0, 0, 0);
    }
    // Después del estado: si A reanuda la pausa, el robot no recibe esa A (ya no es pulsación nueva)
    this.padNav.update(now, this.input.pad(), this.padScope(), this.input.capturing);
    if (this.autoPractice) this.autoPractice.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.trainingRun) this.trainingRun.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.state !== 'paused' && this.state !== 'replay') this.session.update(this.state === 'playing' ? 0 : dt);
    this.watchFps(dt);
    this.effects.update(this.state === 'paused' ? 0 : dt);
    this.arena.update(now / 1000, this.cam.camera.position.y);
    const sm = this.session.match;
    const sb = this.replay?.scoreboard;
    if (sb) this.arena.setScreen(sb.timer, String(sb.red), String(sb.blue));
    else if (sm) this.arena.setScreen(formatTimer(timerSeconds(sm.t, this.session.game)), String(sm.score('red')), String(sm.score('blue')));
    else this.arena.setScreen(this.state === 'menu' ? 'LABBOT RESCUE' : t('practiceMode').toUpperCase(), '', '');
    const p = this.session.player.phys;
    const pt = p.position();
    this.cam.update(dt, this.replay?.focusPose ?? { x: pt.x, y: pt.y, z: pt.z, heading: p.heading() });
    // Detrás de una pantalla opaca (Scouting, Torneo, Editor, Estadísticas…) la cancha casi no se ve:
    // 8 cuadros por segundo bastan y la pantalla responde mejor en celulares
    const behind = this.menu.root.style.display !== 'none' && this.menu.root.classList.contains('solid');
    if (!behind || now - this.lastBehind > 125) {
      this.lastBehind = now;
      this.renderer.render(this.cam.camera);
    }
    requestAnimationFrame(this.loop);
  };
}
