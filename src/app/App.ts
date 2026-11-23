/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { addMatchHistory, matchHistoryEntry } from '../core/matchHistory';
import { LEAVE_ZONE, type AutoRoutine } from '../auto/AutoRoutine';
import { aiLineup } from '../ai/lineup';
import { planAutoRoutine, planBotOptions } from '../ai/plan';
import type { AiPersona } from '../ai/persona';
import { SECRET_AUTOS, SECRET_PERSONAS, SECRET_STRATEGIES, STRATEGY_OPTIONS, weighted, type StrategyId } from '../ai/strategy';
import { FOV } from '../config/cameras';
import { activeColorMode } from '../config/palette';
import { applyAccessibility } from '../ui/a11y';
import { allAutoRoutines, autoRoutineIds } from '../auto/recorded';
import { CENTER_SPOT, clampSpot, spawnCheck, spotPose } from '../config/startSpot';
import { emptyInput, type PlayerInput } from '../input/InputManager';
import { FieldAudio } from '../audio/FieldAudio';
import { type RobotSpec } from '../config/robot';
import { robotStats } from '../replay/stats';
import { robotSpec, type RobotId } from '../config/robotIds';
import { preloadRobotModels } from '../render/RobotView';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { bounds, formatTimer, timerSeconds } from '../core/clock';
import { callForEvent, EndgameWatcher, type RefCall } from '../core/refCalls';
import { ALLIANCES } from '../core/types';
import { GAME, gameWithDuration } from '../config/game';
import { refText, voiceLang } from '../ui/refText';
import { buildMatchLog } from '../core/matchLog';
import type { Match } from '../core/match';
import { drillById } from '../core/training';
import { evaluate, recordScenario, scenarioById, type Scenario, type ScenarioProgress } from '../core/scenarios';
import { drillSessionOptions } from '../game/drills';
import { addEntry, weeklyChallenge } from '../core/weekly';
import { loadWeekly, saveWeekly } from '../game/weeklyStore';
import { loadScenarios, loadTraining, saveScenarios } from '../game/trainingStore';
import { addPlaytime } from '../core/playtime';
import { loadPlaytime, savePlaytime } from '../game/playtimeStore';
import { GameSession, type SessionOptions } from '../game/GameSession';
import { loadScout } from '../game/scoutStore';
import { planById } from '../game/planStore';
import type { StrategyPlan } from '../core/plan';
import { InputManager } from '../input/InputManager';
import { rumblePad } from '../input/rumble';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Arena } from '../render/Arena';
import { Effects } from '../render/Effects';
import { guessQuality, QUALITIES, Renderer, type Quality } from '../render/Renderer';
import { PerfProfile, QualityGovernor } from '../render/perf';
import { pwa } from '../pwa/register';
import type { Replay } from '../replay/format';
import { Recorder } from '../replay/Recorder';
import { Director, tee } from '../director/Director';
import { Studio } from '../director/Studio';
import { clipFromReplay, type Clip } from '../director/clip';
import { StudioPanel } from '../ui/StudioPanel';
import { ReplayPlayer } from '../replay/ReplayPlayer';
import { storeReplay } from '../replay/store';
import { AutoPractice } from '../ui/AutoPractice';
import { ReplayBar } from '../ui/ReplayBar';
import { ReplaysScreen } from '../ui/ReplaysScreen';
import { StatsPanel } from '../ui/StatsPanel';
import { Hud } from '../ui/Hud';
import { t, type Key } from '../ui/i18n';
import { ic } from '../ui/chrome';
import { MatchSetup } from '../ui/MatchSetup';
import { VersusSetup } from '../ui/VersusSetup';
import { DEVICE_LABEL, deviceHelp, fillsAi, partnerStation, swapStations } from '../ui/versus';
import type { VersusSide } from '../config/settings';
import { PadNav } from '../ui/padNav';
import { DEFAULT_PLAYER, Menu, type MenuChoice, type PauseInfo, type VsResults } from '../ui/Menu';
import type { ScoutPlay } from '../ui/scoutPlay';
import { isTouchDevice, TouchControls } from '../ui/TouchControls';
import { TournamentScreen, WATCH_CAMERA } from '../ui/TournamentScreen';
import { TrainingRun, type TrainingRobot } from '../ui/Training';
import { Practice1v1 } from '../ui/Practice1v1';
import { loadCycleBests } from '../game/cycleStore';
import { loadGhosts } from '../game/ghostStore';
import { loadShotLog } from '../game/shotStore';
import { matchFacts, recordMatch, emptyAch, type AchProgress } from '../core/achievements';
import { loadAch, saveAch } from '../game/achievementStore';
import { addPerf } from '../core/robotCompare';
import { loadPerf, savePerf } from '../game/perfStore';
import { allRobotIds } from '../config/robotIds';
import { AchievementsScreen } from '../ui/Achievements';
import { StrategyScreen } from '../ui/StrategyScreen';
import { AutoDesigner } from '../ui/AutoDesigner';
import { PlanView } from '../render/PlanView';
import * as THREE from 'three';
import { Board } from '../core/board';
import { BoardView } from '../render/BoardView';
import { BoardBar } from '../ui/BoardBar';

type State = 'menu' | 'playing' | 'paused' | 'results' | 'replay';

/** Nombre del robot para la repetición y las estadísticas (robot propio o tipo). */
const robotLabel = (s: RobotSpec): string => s.label ?? t(`type_${s.mechanism}` as Key);

export class App {
  readonly renderer: Renderer;
  readonly arena = new Arena();
  readonly effects = new Effects();
  /** Calidad elegida por "Automática" (baja un nivel si los FPS caen). */
  private autoQuality: Quality = guessQuality();
  /** Gobernador de "Auto": baja resolución y luego calidad si los FPS caen. */
  private governor = new QualityGovernor(this.autoQuality);
  private govWin = { frames: 0, time: 0, warm: 0 };
  /** Perfil de FPS y tiempos (F3, `?fps=1` o Ajustes). */
  readonly perf = new PerfProfile();
  private fpsEl: HTMLElement | null = null;
  private fpsShown = new URLSearchParams(location.search).get('fps') === '1';
  private fpsTick = 0;
  readonly cam: CameraRig;
  /** Segunda cámara de la pantalla dividida (multijugador local). */
  private cam2: CameraRig;
  /** FOV guardado en Ajustes; solo se aplica dentro del match. */
  private matchFov: number = FOV.default;
  private splitBar: HTMLElement;
  readonly input = new InputManager();
  /** Menús con el control: foco, A elige, B regresa (`ui/padNav.ts`). */
  readonly padNav = new PadNav();
  readonly hud: Hud;
  readonly menu: Menu;
  session: GameSession;
  state: State = 'menu';
  private choice: MenuChoice = { mode: 'match', player: DEFAULT_PLAYER };
  /** Estrategia y AUTO que la IA eligió en secreto para cada rival del match (null = no es rival). */
  private secret: Array<{ strategy: StrategyId; auto: string; persona: AiPersona } | null> = [];
  /** Estrategia de alianza que sigue tu compañero en este match (se dibuja en la cancha y el HUD). */
  private activePlan: StrategyPlan | null = null;
  /** Rutas del paso de la estrategia en curso, sobre la cancha. */
  private planView = new PlanView();

  /** Pizarra de estrategia según Ajustes: líneas en la cancha y/o tarjeta del HUD. */
  private applyPlanBoard(): void {
    const b = this.settings.planBoard;
    this.planView.visible = b === 'all';
    this.hud.planCardOn = b !== 'off';
    this.hud.applySettings(this.settings);
  }
  /** Pizarra táctica: trazos dibujados con el match en pausa (`core/board.ts`). */
  readonly board = new Board();
  private boardView = new BoardView();
  private boardRev = 0;
  private boardCam: CameraMode = 'free';
  readonly boardBar: BoardBar;
  readonly strategies: StrategyScreen;
  readonly designer: AutoDesigner;
  readonly settings: Settings = loadSettings(autoRoutineIds());
  /** Sonidos del campo (inicio, TELEOP, ENDGAME, fin). */
  readonly audio = new FieldAudio(this.settings.volume / 100);
  /** Avisos del árbitro de Plataforma y Muestra Crítica en el ENDGAME (`core/refCalls.ts`). */
  private endgameWatch = new EndgameWatcher(GAME);
  private last = performance.now();
  /** Último cuadro dibujado detrás de una pantalla opaca (ver `loop`). */
  private lastBehind = 0;
  readonly touch: TouchControls;
  /** Controles touch del jugador 2 (2 jugadores con touch: cada quien en su mitad). */
  private touch2: TouchControls;
  /** Pantalla dividida arriba/abajo (celular en vertical) en lugar de izquierda/derecha. */
  private stacked = false;
  /** Repetición: grabadora del match en curso, la del último match y el reproductor abierto. */
  private recorder: Recorder | null = null;
  /** Modo Director: highlights del match en curso (siempre grabando) y el estudio abierto sobre el reproductor. */
  readonly director = new Director();
  private livePlan: Parameters<PlanView['set']>[0] = null;
  private studio: Studio | null = null;
  private studioPanel: StudioPanel | null = null;
  lastReplay: Replay | null = null;
  replay: ReplayPlayer | null = null;
  private replayBack: () => void = () => this.toMenu();
  readonly replayBar: ReplayBar;
  readonly replays: ReplaysScreen;
  /** Práctica de AUTO abierta (panel y grabación sobre la sesión de práctica). */
  autoPractice: AutoPractice | null = null;
  readonly scoutData = loadScout();
  readonly tourney: TournamentScreen;
  /** Entrenamiento por retos: récords (localStorage), lista de retos y el reto en curso. */
  readonly trainingProgress = loadTraining();
  readonly scenarioProgress: ScenarioProgress = loadScenarios();
  /** Tiempo realmente jugado (solo en estado `playing`); se guarda cada ~5 s y al ocultar la página. */
  private playtime = loadPlaytime();
  private playtimeDirty = 0;
  /** Resumen del escenario terminado (se muestra en los resultados). */
  private scenarioNote = '';
  trainingRun: TrainingRun | null = null;
  readonly weeklyBoard = loadWeekly();
  /** Práctica 1 contra 1 en curso (`ui/Practice1v1.ts`). */
  practice1v1: Practice1v1 | null = null;
  readonly cycleBests = loadCycleBests();
  readonly ghosts = loadGhosts();
  /** Mapa de tiro acumulado por robot de la práctica por ciclos. */
  readonly shotLog = loadShotLog();
  /** Rendimiento acumulado por robot (puntos por minuto y ciclos) para comparar robots. */
  readonly robotPerf = loadPerf();
  /** Logros y progreso (localStorage) y su pantalla; `achNew` = logros del último match. */
  private ach: AchProgress = loadAch();
  private achNew: string[] = [];
  readonly achievements: AchievementsScreen;
  /** Aviso de resultados del último match del torneo (se guarda una vez; los resultados se reabren). */
  private tourNote = '';
  /** `?touch=1` fuerza los controles touch (para probar en escritorio). */
  private touchForced = new URLSearchParams(location.search).get('touch') === '1';

  constructor(host: HTMLElement, ui: HTMLElement) {
    // Los modelos de los robots se bajan desde el arranque: al elegir uno ya están listos
    preloadRobotModels(allRobotIds().flatMap((id) => { const u = robotSpec(id).model?.url; return u ? [u] : []; }));
    this.renderer = new Renderer(host);
    this.cam = new CameraRig(this.renderer.renderer.domElement);
    this.cam2 = new CameraRig(this.renderer.renderer.domElement);
    this.splitBar = document.createElement('div');
    this.splitBar.className = 'split-bar';
    this.splitBar.style.display = 'none';
    ui.appendChild(this.splitBar);
    this.session = new GameSession();
    this.renderer.scene.add(this.session.root, this.arena.group, this.effects.points);
    this.renderer.onQuality.push((p) => {
      this.effects.amount = p.particles;
    });
    this.applyQuality();
    this.hud = new Hud(ui, { camera: () => this.cycleCamera(), pause: () => this.togglePause(), reset: () => this.resetPractice() });
    this.touch = new TouchControls(ui, this.input);
    this.touch2 = new TouchControls(ui, this.input, 'p2', 'vs-touch p2');
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => {
      saveSettings(s);
      // El color de la cancha y los robots se arma al iniciar: con otro modo de colores se recarga
      if (s.colorMode !== activeColorMode()) location.reload();
      applyAccessibility(s.colorMode, s.textScale);
      this.applyQuality();
      this.audio.setVolume(s.volume / 100);
      this.audio.setRefMode(s.refAudio);
      this.matchFov = s.fov;
    }, this.input, { view: (v) => this.setMenuView(v), preview: (p, r) => this.previewRobot(p, true, r), spawn: (c) => this.spawnCmd(c) });
    this.audio.setRefMode(this.settings.refAudio);
    this.matchFov = this.settings.fov;
    this.replayBar = new ReplayBar(ui, { camera: () => this.cycleCamera(), stats: () => this.replayStats(), exit: () => this.exitReplay() });
    this.replays = new ReplaysScreen(this.menu.root, {
      back: () => this.toMenu(),
      watch: (r) => this.watchReplay(r, () => this.openReplays()),
      director: (r) => this.openDirector(() => this.openReplays(), clipFromReplay(r)),
      stats: (r) => this.showStats(r, () => this.openReplays(), () => this.watchReplay(r, () => this.openReplays())),
    });
    this.menu.onReplays = () => this.openReplays();
    this.menu.directorClips = () => this.director.clips.length;
    this.menu.onDirector = () => this.openDirector(() => { this.toMenu(); this.menu.hub('replays'); });
    this.menu.perfInfo = () => this.perfText();
    this.tourney = new TournamentScreen(this.menu.root, this.scoutData, this.settings, {
      back: () => this.toMenu(),
      play: (p, watch) => {
        this.start({ mode: 'match', player: p.player, scout: p });
        if (watch) this.setCamera(WATCH_CAMERA[watch]);
      },
    });
    this.menu.onTournament = () => this.tourney.open();
    this.achievements = new AchievementsScreen(this.menu.root, () => this.ach, {
      back: () => this.toMenu(),
      reset: () => {
        this.ach = emptyAch();
        saveAch(this.ach);
      },
    });
    this.menu.onAchievements = () => this.achievements.show();
    this.strategies = new StrategyScreen(this.menu.root);
    this.menu.onStrategies = () => this.strategies.show(() => this.toMenu());
    this.designer = new AutoDesigner(this.menu.root, {
      back: () => this.toMenu(),
      spec: () => this.playerSpec(),
      // "Probar": un match con la rutina como tu AUTO, saliendo de la Zona de Inicio elegida (estación del jugador en tu alianza)
      test: (id, station, robot) => {
        this.settings.playerAuto = id;
        saveSettings(this.settings);
        this.menu.player = (this.menu.player < 2 ? 0 : 2) + station;
        this.start({ mode: 'match', player: this.menu.player, ready: true, autoTest: true, robot });
      },
    });
    this.menu.onAutoDesigner = () => this.designer.open(this.settings.playerAuto);
    this.renderer.scene.add(this.planView.group, this.boardView.group);
    this.boardBar = new BoardBar(ui, this.renderer.renderer.domElement, this.board, {
      pick: (x, y) => this.pickField(x, y),
      changed: () => this.boardRev++,
      done: () => this.closeBoard(),
    });
    pwa.onChange = () => {
      if (this.state === 'menu') this.menu.pwaChips();
    };
    this.toMenu();
    const onResize = () => {
      this.renderer.resize(this.cam.camera);
      this.studio?.resize();
      // 2 jugadores: al girar el celular la pantalla se parte del otro lado
      if (this.input.versus) this.applySplit();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backspace' && !this.input.capturing) this.resetPractice();
      // Resultados: R juega otro match con la misma configuración (si hay botón "Jugar otra vez")
      if (e.code === 'KeyR' && this.state === 'results' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.menu.root.querySelector<HTMLButtonElement>('[data-act="restart"]')?.click();
      }
      if (e.code === 'F3') {
        e.preventDefault();
        this.fpsShown = !this.fpsShown;
      }
    });
    onResize();
    document.addEventListener('visibilitychange', () => document.hidden && this.flushPlaytime());
    addEventListener('pagehide', () => this.flushPlaytime());
    requestAnimationFrame(this.loop);
  }

  /**
   * Empieza un match o una práctica con el robot elegido. Un match en el que manejas un robot pasa
   * antes por "Preparar match" (`ui/MatchSetup.ts`); "Jugar de nuevo" repite lo mismo sin preguntar.
   */
  start(c: MenuChoice): void {
    if (c.mode === 'match' && !c.ready && c.player >= 0) return this.openSetup(c);
    if (c.mode === 'versus' && !c.ready) return this.openVersusSetup(c);
    this.choice = c;
    this.testRobot = c.autoTest ? (c.robot ?? null) : null;
    // Botones por defecto del robot del jugador (`ROBOT_PAD_DEFAULTS`, p. ej. Mentores 3478)
    this.input.robot = this.testRobot ?? this.settings.robotType;
    this.closeAutoPractice();
    this.closeTraining();
    this.closePractice1v1();
    this.clearBoard();
    this.renderer.scene.remove(this.session.root);
    this.session.dispose();
    // Práctica libre y de AUTO: solo el robot del jugador en la cancha (en la de AUTO, sin Human Player)
    const o = c.scout ? this.scoutOptions(c.scout) : this.sessionOptions(c.player);
    const drill = c.mode === 'training' ? (c.weekly ? weeklyChallenge().drill : drillById(c.drill ?? '')) : undefined;
    const versus = c.mode === 'versus';
    if (c.mode === 'training' && !drill) return this.toMenu();
    const scenario = c.mode === 'scenario' ? scenarioById(c.scenario ?? '') : undefined;
    if (c.mode === 'scenario' && !scenario) return this.toMenu();
    this.scenarioNote = '';
    const p1 = c.mode === 'practice1v1';
    this.session = new GameSession(
      p1
        ? this.practice1v1Options(c.player)
        : drill
        ? { ...drillSessionOptions(drill, c.player, this.playerSpec(), this.settings.hpInterval), grip: this.settings.grip }
        : versus
          ? this.versusOptions(c.player)
          : c.scout
          ? o
          : scenario
          ? { ...o, ai: true }
          : { ...o, solo: c.mode !== 'match' && c.mode !== 'practice', ...(c.mode === 'practice' ? { stations: [c.player], ai: false } : {}), ...(c.autoTest ? { stations: [c.player] } : {}), ...(c.mode === 'auto' ? { hp: { enabled: false, interval: 3 } } : {}) },
    );
    this.renderer.scene.add(this.session.root);
    if (scenario) this.session.startScenario(scenario);
    // Práctica libre = match normal (reloj, marcador, reglas, resultados) con tu robot solo en la cancha
    else if (c.mode === 'match' || c.mode === 'practice' || versus) this.session.startMatch();
    // La estrategia de alianza solo cuenta en el match (en práctica no hay compañero)
    const plan = (c.mode === 'match' || scenario) && !drill ? this.activePlan : null;
    this.livePlan = plan;
    this.planView.set(plan, this.session.player.alliance);
    this.hud.setPlan(plan);
    this.applyPlanBoard();
    // Cada match se graba para la repetición y las estadísticas
    this.recorder = ((c.mode === 'match' || c.mode === 'practice') && !c.autoTest) || versus ? new Recorder(this.session, this.session.robots.map((r) => robotLabel(r.spec)), { duration: Math.round(bounds(this.session.game).teleopEnd) }) : null;
    this.director.attach(this.session, this.session.robots.map((r) => robotLabel(r.spec)), Math.round(bounds(this.session.game).teleopEnd));
    this.session.tap = tee(this.recorder, c.autoTest ? null : this.director);
    // Práctica 1 contra 1 con otra persona: pantalla dividida y entrada de dos jugadores, como 2 jugadores
    const duo = p1 && this.session.player2 !== null;
    this.setVersus(c.mode === 'versus' || duo);
    this.menu.hide();
    this.hud.show(true);
    this.hud.setHelp(this.input.bindings);
    this.state = 'playing';
    this.updateTouch();
    const camPref = this.settings.camera;
    this.cam.setMode(camPref === 'follow' || camPref === 'top' || camPref === 'free' ? camPref : c.player < 2 ? 'driverRed' : 'driverBlue');
    if (c.mode === 'versus' || duo) {
      // Cada quien ve su robot con la cámara que eligió (pantalla dividida); la presentación de cada
      // mitad dice quién es quién y sus controles (`Hud.setVersus`)
      this.cam.setMode(this.settings.versus.p1.camera);
      this.cam2.setMode(this.settings.versus.p2.camera);
    }
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
    if (p1)
      this.practice1v1 = new Practice1v1(this.hud.root.parentElement ?? document.body, {
        session: () => this.session,
        settings: () => this.settings.practice,
        change: (p) => {
          this.settings.practice = p;
          saveSettings(this.settings);
          this.start(c);
        },
        bests: this.cycleBests,
        ghosts: this.ghosts,
        showGhost: () => this.settings.showGhost,
        shots: this.shotLog,
        perf: this.robotPerf,
        robot: { id: this.settings.robotType, name: robotLabel(this.session.player.spec) },
        exit: () => this.toMenu(),
      });
    if (drill)
      this.trainingRun = new TrainingRun(this.hud.root.parentElement ?? document.body, drill, {
        session: () => this.session,
        progress: this.trainingProgress,
        robot: this.trainingRobot(),
        weekly: c.weekly
          ? {
              ch: weeklyChallenge(),
              submit: (points) => {
                const res = addEntry(this.weeklyBoard, weeklyChallenge(), { points, robot: robotLabel(this.session.player.spec), at: new Date().toISOString() });
                saveWeekly(this.weeklyBoard);
                return res;
              },
            }
          : undefined,
        other: () => this.toMenu(),
        exit: () => this.toMenu(),
      });
  }

  /**
   * Multijugador local: tú (`player`) y una segunda persona en el mismo puesto de la otra alianza.
   * Ambos usan tu robot y tu AUTO de los ajustes (SUPUESTO); los otros dos robots son de la IA.
   * Sin rivales secretos ni estrategia de alianza: nadie es "rival de la computadora".
   */
  private versusOptions(player: number): SessionOptions {
    const o = this.sessionOptions(player);
    const v = this.settings.versus;
    const p2 = partnerStation(player, v.team);
    this.secret = [null, null, null, null];
    this.activePlan = null;
    const routine = (id: string) => allAutoRoutines().find((r) => r.id === id) ?? LEAVE_ZONE;
    // Cada persona: su robot, su AUTO y su lugar de inicio (`ui/VersusSetup.ts`)
    const side = (i: number, s: typeof v.p1) => ({ spec: { ...robotSpec(s.robot), maxSpeed: this.settings.maxSpeed }, auto: routine(s.auto), start: s.start, i });
    const sides = [side(player, v.p1), side(p2, v.p2)];
    const specs = [...(o.specs ?? [])];
    const autos = [...(o.autos ?? [])];
    const bots = [...(o.bots ?? [])];
    const starts = [...(o.starts ?? [])];
    for (const x of sides) {
      specs[x.i] = x.spec;
      autos[x.i] = x.auto;
      bots[x.i] = undefined;
      starts[x.i] = x.start;
    }
    // 1 contra 1: solo existen los dos robots; el reloj puede durar lo que se eligió (SUPUESTO, `gameWithDuration`)
    const game = gameWithDuration(v.duration);
    this.endgameWatch.cfg = game;
    return { ...o, player2: p2, specs, autos, bots, starts, game, ...(!fillsAi(v.team, v.fillAi) ? { stations: [player, p2], ai: false } : {}) };
  }

  /** Enciende o apaga el modo de 2 jugadores en la entrada y la pantalla dividida. */
  private setVersus(on: boolean): void {
    this.input.versus = on;
    const v = this.settings.versus;
    this.input.layout = { p1: v.p1.device, p2: v.p2.device };
    this.splitBar.style.display = on ? '' : 'none';
    this.touch.root.classList.toggle('vs-touch', on);
    this.touch.root.classList.toggle('p1', on);
    document.body.classList.toggle('vs-split', on);
    this.applySplit();
    const p2 = this.session.player2;
    this.hud.setVersus(
      on && p2
        ? {
            stacked: this.stacked,
            team: this.session.player.alliance === p2.alliance ? 'same' : 'opp',
            players: [
              { r: this.session.player, side: v.p1 },
              { r: p2, side: v.p2 },
            ].map(({ r, side }) => {
              const help = deviceHelp(side.device, this.input.deviceKeys(side.device), this.input.bindings);
              return { station: r.index, robot: robotLabel(r.spec), keys: help.map((h) => h.keys), help: help.map((h) => h.what) };
            }),
          }
        : null,
    );
    if (!on) this.renderer.resize(this.cam.camera);
  }

  /** Lado a lado en horizontal; arriba/abajo cuando la pantalla es más alta que ancha. */
  private applySplit(): void {
    this.stacked = this.input.versus && window.innerHeight > window.innerWidth;
    this.splitBar.classList.toggle('stacked', this.stacked);
    document.body.classList.toggle('vs-stacked', this.stacked);
    this.hud.setStacked(this.stacked);
  }

  /** Sesión de la práctica 1 contra 1: tu robot y, enfrente, el rival elegido (mismo tipo de robot; SUPUESTO). */
  private practice1v1Options(player: number): SessionOptions {
    const spec = this.playerSpec();
    const rival = player < 2 ? player + 2 : player - 2;
    const specs: RobotSpec[] = [];
    specs[player] = spec;
    specs[rival] = spec;
    return { player, preload: true, solo: true, ai: false, specs, rival: this.settings.practice.rival, aiPersona: this.settings.practice.persona, hp: { enabled: true, interval: this.settings.hpInterval }, grip: this.settings.grip };
  }

  private closePractice1v1(): void {
    this.practice1v1?.dispose();
    this.practice1v1 = null;
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
  /** "Preparar 2 jugadores": controles, robot, AUTO y posición de cada persona; luego empieza el match. */
  private openVersusSetup(c: MenuChoice): void {
    new VersusSetup(this.menu.root, this.settings, {
      back: () => this.toMenu(),
      save: () => saveSettings(this.settings),
      keys: (d) => this.input.deviceKeys(d),
      bindings: () => this.input.bindings,
      start: (player) => {
        this.menu.player = player;
        this.start({ ...c, player, ready: true });
      },
    }).show(c.player);
  }

  private openSetup(c: MenuChoice): void {
    const sc = c.scout;
    const back = () => {
      if (!sc) return this.toMenu();
      this.toMenu();
      this.tourney.open();
    };
    const spec = sc && !sc.tour ? robotSpec(sc.robots[c.player] as RobotId) : this.playerSpec();
    new MatchSetup(this.menu.root, this.settings, {
      back,
      save: () => saveSettings(this.settings),
      plans: (id) => this.strategies.show(() => this.openSetup(c), id),
      start: (player) => {
        if (!sc) this.menu.player = player;
        this.start({ ...c, player, ready: true });
      },
    }).show({
      player: c.player,
      playerSpec: spec,
      playerName: robotLabel(spec),
      kinds: sc?.robots.map((k) => robotLabel(robotSpec(k as RobotId))),
      teams: sc?.teams.map((id) => this.scoutData.teams.find((x) => x.id === id)?.name ?? id),
      canMove: !sc,
    });
  }

  /**
   * Opciones de la sesión según los ajustes y "Preparar match": tu robot, tu lugar en la Zona de
   * Inicio y tu AUTO; tipo, estrategia, dificultad y AUTO de cada robot de la IA; Human Player.
   * `kinds` fija los tipos (Scouting y torneo); sin él, los de "Al azar" salen de `aiLineup`.
   */
  private sessionOptions(player: number, kinds?: readonly string[], tour = false): SessionOptions {
    const s = this.settings;
    const m = s.match;
    const routine = (id: string) => allAutoRoutines().find((r) => r.id === id) ?? LEAVE_ZONE;
    const random = aiLineup(player, this.settings.robotType);
    // 2 contra 2: no eliges ni ves lo de los rivales (Xhavi, 30-oct). Su tipo, estrategia y AUTO los
    // elige la IA en secreto en cada match; de ellos solo se elige la dificultad
    const rival = (i: number) => m.secret && player >= 0 && (i < 2) !== (player < 2);
    this.secret = [0, 1, 2, 3].map((i) => (rival(i) ? { strategy: weighted(SECRET_STRATEGIES), auto: weighted(SECRET_AUTOS), persona: weighted(SECRET_PERSONAS) } : null));
    const strategy = (i: number) => this.secret[i]?.strategy ?? m.robots[i].strategy;
    // Tu compañero sigue la estrategia de alianza que elegiste para él (si la IA está prendida)
    const mate = player >= 0 ? player ^ 1 : -1;
    const plan = mate >= 0 && s.ai ? planById(m.robots[mate].plan) : undefined;
    this.activePlan = plan ?? null;
    // Solo los robots CAD son elegibles en partido: un preset de LabBot guardado cae a "Al azar"
    const types: string[] = kinds ? [...kinds] : m.robots.map((r, i) => (r.kind === 'random' || rival(i) || !r.kind.startsWith('cad:') ? random[i] : r.kind));
    const botAuto = (i: number): AutoRoutine => {
      if (i === mate && plan) return planAutoRoutine(plan);
      const a = routine(this.secret[i]?.auto ?? m.robots[i].auto);
      // "Solo línea y Plataforma" no anota: con una rutina de la IA se quedaría quieto en AUTO
      return strategy(i) === 'park' && a.bot ? LEAVE_ZONE : a;
    };
    const bot = (i: number) => {
      const ai = m.robots[i].ai;
      const persona = this.secret[i]?.persona ?? m.robots[i].persona;
      if (i === mate && plan) return { ...planBotOptions(plan, i < 2 ? 'red' : 'blue'), ai, persona };
      return { ...STRATEGY_OPTIONS[strategy(i)], ai, persona };
    };
    const autos = [0, 1, 2, 3].map((i) => (i === player ? routine(s.playerAuto) : botAuto(i)));
    // Tu robot es el del menú (con tu velocidad y capacidad), salvo en el Scouting: el de tu equipo
    const specs = types.map((k, i) => (i === player && (!kinds || tour) ? this.playerSpec() : robotSpec(k as RobotId)));
    // Una rutina dibujada arranca donde se dibujó si el robot está en esa Zona de Inicio (§4.1)
    const pathStart = (i: number) => {
      const p = autos[i].path;
      return p && p.station === i % 2 ? clampSpot(specs[i].length, specs[i].width, p.start) : undefined;
    };
    return {
      player,
      preload: true,
      ai: s.ai,
      specs,
      autos,
      bots: [0, 1, 2, 3].map((i) => (i === player ? undefined : bot(i))),
      starts: [0, 1, 2, 3].map((i) => pathStart(i) ?? (i === player ? m.start : undefined)),
      hp: { enabled: s.hpEnabled, interval: s.hpInterval, smart: s.hpSmart },
      grip: s.grip,
      damage: { ...s.damage },
      seed: (Math.random() * 2 ** 32) >>> 0,
    };
  }

  /** Match del calendario del Scouting o del torneo: cada robot es el tipo de su equipo; la IA maneja los otros 3. */
  private scoutOptions(p: ScoutPlay): SessionOptions {
    return { ...this.sessionOptions(p.player, p.robots, p.tour), ai: true };
  }

  /** Tu robot según los ajustes (tipo, velocidad y capacidad). */
  /** Robot de la prueba de AUTO en curso (si la hay). */
  private testRobot: RobotId | null = null;

  private playerSpec(): RobotSpec {
    const s = this.settings;
    // "Probar" con el robot elegido en el diseñador (no cambia tus ajustes)
    if (this.testRobot) return { ...robotSpec(this.testRobot), maxSpeed: s.maxSpeed };
    return { ...robotSpec(s.robotType), maxSpeed: s.maxSpeed };
  }

  /** Calidad gráfica: `?quality=` manda; si no, el ajuste (o la automática). */
  applyQuality(): void {
    const forced = new URLSearchParams(location.search).get('quality') as Quality | null;
    const auto = !forced && this.settings.quality === 'auto';
    const q = forced && QUALITIES.includes(forced) ? forced : auto ? this.autoQuality : (this.settings.quality as Quality);
    if (q !== this.renderer.quality || !this.qualityApplied) this.renderer.setQuality(q, this.cam.camera);
    this.qualityApplied = true;
    // Resolución dinámica: solo en Auto (`?dynres=0` la apaga)
    const dyn = auto && new URLSearchParams(location.search).get('dynres') !== '0';
    this.renderer.setDynScale(dyn ? this.governor.state.scale : 1, this.cam.camera);
  }

  private qualityApplied = false;

  /**
   * "Automática": cada 2 s jugando mide los FPS y deja que el gobernador baje la resolución y, si no
   * alcanza, un nivel de calidad (`render/perf.ts`).
   */
  private watchFps(dt: number): void {
    if (this.settings.quality !== 'auto' || this.state !== 'playing') {
      this.govWin.frames = this.govWin.time = this.govWin.warm = 0;
      return;
    }
    // Un cuadro de más de 1 s (pestaña en segundo plano, bloqueo) no cuenta. Antes el corte era 0.1 s y
    // un celular a menos de 10 FPS, justo el que más necesita bajar la calidad, nunca se medía.
    if (dt >= 1) return;
    // Los primeros 3 s de juego (compilar shaders, cargar CAD) no cuentan: no bajar calidad por el arranque.
    if (this.govWin.warm < 3) {
      this.govWin.warm += dt;
      return;
    }
    this.govWin.frames++;
    this.govWin.time += dt;
    if (this.govWin.time < 2) return;
    const avg = this.govWin.frames / this.govWin.time;
    this.govWin.frames = this.govWin.time = 0;
    if (this.governor.step(avg)) {
      this.autoQuality = this.governor.state.quality;
      this.applyQuality();
      this.perf.reset();
    }
  }

  /** Texto del perfil de rendimiento para Ajustes (null si no se ha medido). */
  perfText(): string | null {
    const s = this.perf.summary();
    if (!s.frames) return null;
    const res = Math.round(this.renderer.preset.renderScale * this.renderer.dynScale * 100);
    return (
      t('perfLive', { fps: s.fps.toFixed(0), low: s.low1.toFixed(0), sim: s.simMs.toFixed(1), draw: s.renderMs.toFixed(1) }) +
      '\n' +
      t('perfUsing', { q: t(`quality_${this.renderer.quality}` as Key), res })
    );
  }

  /** Marcador de FPS en pantalla (F3, `?fps=1` o Ajustes). */
  private updateFpsOverlay(): void {
    const on = this.fpsShown || this.settings.showFps;
    if (!on) {
      if (this.fpsEl) this.fpsEl.style.display = 'none';
      return;
    }
    if (!this.fpsEl) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'fps-overlay';
      document.body.appendChild(this.fpsEl);
    }
    this.fpsEl.style.display = '';
    if (++this.fpsTick % 15 !== 0) return;
    const s = this.perf.summary();
    this.fpsEl.textContent = `${s.fps.toFixed(0)} FPS · 1% ${s.low1.toFixed(0)} · sim ${s.simMs.toFixed(1)} · dibujo ${s.renderMs.toFixed(1)} ms · ${this.renderer.quality} ${Math.round(this.renderer.dynScale * 100)}%`;
  }

  /** Reacomoda la cancha en práctica (Backspace o el botón del HUD). */
  resetPractice(): void {
    if (this.state !== 'playing' || this.session.match) return;
    if (this.autoPractice) this.autoPractice.reset();
    else if (this.trainingRun) this.trainingRun.reset();
    else if (this.practice1v1) this.practice1v1.reset();
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
    // 2 jugadores: touch solo para quien lo eligió, cada juego de controles en su mitad
    const vs = this.input.versus;
    const want = vs ? this.input.layout.p1 === 'touch' : this.touchForced || s === 'on' || (s === 'auto' && isTouchDevice());
    const want2 = vs && this.input.layout.p2 === 'touch';
    document.body.classList.toggle('touch-on', want || want2);
    this.touch.show(want && (this.state === 'playing' || this.spawnOn));
    this.touch2.show(want2 && this.state === 'playing');
  }

  /** Evalúa y guarda el escenario terminado; devuelve el aviso para los resultados. */
  private finishScenario(m: Match, s: Scenario): string {
    const me = this.session.player.alliance;
    const o = evaluate(m, s, me);
    const r = recordScenario(this.scenarioProgress, s, this.settings.robotType, o);
    saveScenarios(this.scenarioProgress);
    const medal = r.medal ? t(`medal_${r.medal}` as Key) : t('tn_noMedal');
    return `${t(`sn_${s.id}` as Key)}: ${t(o.met ? 'sn_met' : 'sn_missed')} (${o.diff >= 0 ? '+' : ''}${o.diff}) · ${medal}${r.improved ? ` · ${t('tn_newRecord')}` : ''}`;
  }

  /** Suma al rendimiento del robot propio lo que hizo en el match (de su repetición; `core/robotCompare.ts`). */
  private recordPerf(m: Match, rp: Replay | null): void {
    if (this.choice.mode !== 'match' || this.choice.player < 0 || !rp) return;
    const i = rp.header.robots.findIndex((r) => r.index === rp.header.player);
    const st = robotStats(rp)[i];
    if (!st) return;
    addPerf(this.robotPerf, this.settings.robotType, {
      seconds: m.cfg.times.auto + m.cfg.times.teleop,
      points: st.samplePoints,
      cycles: st.cycles.length,
      cycleSeconds: st.cycles.reduce((a, c) => a + c, 0),
    });
    savePerf(this.robotPerf);
  }

  /** Suma el match terminado al progreso de logros (solo si manejas un robot en un match). */
  private recordAchievements(m: Match): void {
    this.achNew = [];
    if (this.choice.mode !== 'match' || this.choice.player < 0) return;
    const r = recordMatch(this.ach, matchFacts(m, this.choice.player, m.cfg));
    this.ach = r.progress;
    saveAch(this.ach);
    this.achNew = r.earned.map((a) => t(`ach_${a.id}` as Key));
  }

  /** Resultados del match terminado, con botones para la repetición y las estadísticas. */
  private showResults(): void {
    const m = this.session.match;
    if (!m) return this.toMenu();
    this.state = 'results';
    this.clearBoard();
    if (!this.choice.autoTest) addMatchHistory(matchHistoryEntry(m, this.choice.player, this.settings.robotType, '', this.choice.mode));
    const sc = this.choice.scout;
    this.menu.results(
      m,
      () => this.start(this.choice),
      () => (sc ? this.toTournament() : this.toMenu()),
      () => this.downloadLog(),
      this.choice.player,
      sc?.tour ? this.tourNote : this.scenarioNote,
      sc?.tour ? t('tr_continue') : undefined,
      this.achNew,
      this.vsResults(),
      this.teamNumbers(),
    );
    this.revealRivals();
    const rep = this.lastReplay;
    const bar = this.menu.root.querySelector('.results .actions');
    if (!rep || !bar) return;
    bar.insertAdjacentHTML('afterbegin', `<button class="btn" data-act="replay">${ic.play}<span>${t('rp_watch')}</span></button><button class="btn" data-act="stats">${ic.chart}<span>${t('st_title')}</span></button><button class="btn" data-act="director"${this.director.clips.length ? '' : ' disabled'}>${ic.film}<span>${t('dirOpen')} · ${t('dirClipsCount', { n: this.director.clips.length })}</span></button>`);
    bar.querySelector('[data-act="director"]')!.addEventListener('click', () => this.openDirector(back));
    const back = () => this.showResults();
    bar.querySelector('[data-act="replay"]')!.addEventListener('click', () => this.watchReplay(rep, back));
    bar.querySelector('[data-act="stats"]')!.addEventListener('click', () => this.showStats(rep, back, () => this.watchReplay(rep, back)));
  }

  /** De la pausa o los resultados a "Preparar 2 jugadores" (el match en curso se deja). */
  private versusSetupAgain(): void {
    const c = this.choice;
    this.toMenu();
    this.start({ ...c, ready: false });
  }

  /** Resultados de 2 jugadores: lo que hizo cada quien (de la repetición) y las revanchas. */
  /** Número de equipo de cada estación (el de su robot; en el torneo, el nombre del equipo). */
  private teamNumbers(): string[] {
    const nums: Record<string, string> = { axiom: '2785', phoenix: '2378', psycho: '2548', hazmat: '704', mentores: '3478' };
    const tour = this.choice.scout?.tour ? this.choice.scout.teams : null;
    // Por estación (`r.index`): en práctica solo hay dos robots y su lugar en la lista no es su estación (el número salía en R1 siendo Blue 1)
    const out: string[] = [];
    for (const r of this.session.robots) {
      const i = r.index;
      if (tour?.[i]) {
        out[i] = this.scoutData.teams.find((x) => x.id === tour[i])?.name ?? tour[i];
        continue;
      }
      const label = robotLabel(r.spec);
      const key = Object.keys(nums).find((k) => label.toLowerCase().includes(k));
      out[i] = key ? nums[key] : label;
    }
    return out;
  }

  private vsResults(): VsResults | undefined {
    const p2 = this.session.player2;
    if (this.choice.mode !== 'versus' || !p2) return undefined;
    const rep = this.lastReplay;
    const all = rep ? robotStats(rep) : [];
    const stats = (index: number) => (rep ? (all[rep.header.robots.findIndex((r) => r.index === index)] ?? null) : null);
    const me = this.session.player;
    return {
      team: me.alliance === p2.alliance ? 'same' : 'opp',
      stations: [me.index, p2.index],
      players: [me, p2].map((r) => {
        const st = stats(r.index);
        // Lo que aportó cada quien: sus Muestras y su Línea de Autónomo (§4.4); la Plataforma es de la alianza
        const line = rep?.header.endgame.autoLine.includes(r.index) ? GAME.points.autoLine : 0;
        return { robot: robotLabel(r.spec), points: (st?.samplePoints ?? 0) + line, stats: st };
      }),
      onSwap: () => {
        const player = swapStations(this.choice.player, this.settings.versus.team);
        this.menu.player = player;
        this.start({ ...this.choice, player, ready: true });
      },
      onSetup: () => this.versusSetupAgain(),
    };
  }

  /**
   * Al terminar el match se revela qué estrategia y AUTO eligió la IA de cada rival (SUPUESTO: en un
   * evento real se ve jugando; durante el match no aparece en ningún lado: HUD, repetición ni gráficas).
   */
  private revealRivals(): void {
    const box = this.menu.root.querySelector('.results .fouls');
    const row = (x: { strategy: StrategyId; auto: string; persona: AiPersona }, i: number): string => {
      const a = i < 2 ? 'red' : 'blue';
      return `<li><span class="tag ${a}">${t(a).toUpperCase()} ${(i % 2) + 1}</span>${t(`strat_${x.strategy}` as Key)}<em>AUTO: ${t(`auto_${x.auto}` as Key)} · ${t(`persona_${x.persona}` as Key)}</em></li>`;
    };
    const rows = this.secret.map((x, i) => (x ? row(x, i) : '')).join('');
    if (!box || !rows) return;
    box.insertAdjacentHTML('afterend', `<h3>${t('res_rivals')}</h3><ul class="fouls rivals">${rows}</ul><p class="ms-note">${t('res_rivalsNote')}</p>`);
  }

  /** Pantalla de estadísticas de una repetición. */
  showStats(r: Replay, back: () => void, watch: (() => void) | null): void {
    this.hud.show(false);
    this.touch.show(false);
    this.touch2.show(false);
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
    this.touch2.show(false);
    // La estrategia de alianza es tuya: no va en la repetición
    this.planView.set(null, 'red');
    this.replay = new ReplayPlayer(r);
    this.renderer.scene.remove(this.session.root);
    this.renderer.scene.add(this.replay.session.root);
    this.replayBack = back;
    this.state = 'replay';
    this.replayBar.show(this.replay);
    const focus = r.header.robots[this.replay.focus];
    this.cam.setMode(focus?.alliance === 'blue' ? 'driverBlue' : 'driverRed');
  }

  /** Desde la pausa: al salir del estudio se vuelve a la pausa (cámara, HUD y estrategia como estaban). */
  private openDirectorFromPause(): void {
    const cam = this.cam.mode;
    this.openDirector(() => {
      this.state = 'paused';
      this.cam.setMode(cam);
      this.planView.set(this.livePlan, this.session.player.alliance);
      this.hud.show(true);
      this.pauseMenu();
      this.updateTouch();
    });
  }

  /** Modo Director: abre el Reveal Studio sobre los clips guardados. `back` = adónde volver al salir. */
  openDirector(back: () => void, only?: Clip): void {
    this.director.flush();
    const clip = only ?? this.director.clips[this.director.clips.length - 1];
    if (!clip) return;
    this.watchReplay(clip.replay, back);
    const player = this.replay;
    if (!player) return;
    // El reproductor trae su propia barra; el estudio usa la suya
    this.replayBar.show(null);
    this.cam.orbit.enabled = false;
    const studio = new Studio(player, this.renderer, this.cam.camera);
    studio.cam.fromCamera();
    this.studio = studio;
    studio.open(clip);
    this.studioPanel = new StudioPanel(
      document.getElementById('ui')!,
      studio,
      () => (only ? [only] : this.director.clips),
      () => this.input.bindings.keys.highlight[0] ?? 'KeyH',
      () => this.exitReplay(),
      () => undefined,
    );
  }

  private closeStudio(): void {
    if (!this.studio) return;
    this.studioPanel?.dispose();
    this.studio.dispose();
    this.studioPanel = null;
    this.studio = null;
  }

  private closeReplay(): void {
    this.closeStudio();
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

  /**
   * Avisos del árbitro del cuadro: faltas y tarjetas del match, y en el ENDGAME los robots sobre la
   * Plataforma y la Muestra Crítica en la Repisa. Cartel en el HUD y silbato/voz según Ajustes.
   */
  private refereeCalls(dt: number): void {
    const s = this.session;
    const m = s.match;
    // Práctica 1 contra 1: el árbitro también cobra faltas y tarjetas (sin ENDGAME; D50)
    if (!m && !this.practice1v1) return;
    const calls: RefCall[] = [];
    for (const e of s.matchEvents) {
      const c = callForEvent(e, s.game);
      if (c) calls.push(c);
    }
    const platform = { red: 0, blue: 0 };
    const critical = { red: false, blue: false };
    if (m) {
      if (m.phase === 'ENDGAME') {
        for (const r of s.robots) if (s.sensors.onPlatform(r)) platform[r.alliance]++;
        for (const a of ALLIANCES) critical[a] = s.sensors.criticalOnRepisa(a);
      }
      this.endgameWatch.cfg = s.game;
      calls.push(...this.endgameWatch.update(dt, m.phase, platform, critical));
    }
    this.rumbleEvents(s, calls);
    if (!calls.length) return;
    const texts = calls.map(refText);
    this.hud.referee(texts);
    calls.forEach((c, i) => this.audio.referee(c.sound, texts[i].voice, voiceLang()));
  }

  /** Vibración del control (`input/rumble.ts`): al anotar tu alianza y con faltas o tarjetas en tu contra. */
  private rumbleEvents(s: GameSession, calls: readonly RefCall[]): void {
    if (!this.settings.rumble) return;
    const mine = s.robots.find((r) => r.index === s.opts.player)?.alliance;
    if (!mine) return;
    if (s.matchEvents.some((e) => e.type === 'sample' && e.alliance === mine)) rumblePad(this.input.pad(), 'score');
    if (calls.some((c) => c.alliance === mine && (c.kind === 'foul' || c.kind === 'tech' || c.kind === 'yellow' || c.kind === 'red'))) rumblePad(this.input.pad(), 'foul');
  }

  /** En el menú: la cancha completa de fondo (`orbit`) o el robot elegido de cerca (`robot`). */
  private menuView: 'orbit' | 'robot' | 'spawn' = 'orbit';
  /** Acercamiento de la cámara del menú al elegir robot (≈0.5 s); `menuBlend` 0 = cancha completa, 1 = robot de cerca. */
  private static readonly MENU_ZOOM = 0.5;
  private menuBlend = 0;
  private menuPose = { px: 0, py: 1.35, pz: 2, tx: 0, ty: 0.3, tz: 0 };
  private orbitPose() {
    const a = 0.9;
    return { px: Math.cos(a) * 7.8, py: 5.6, pz: Math.sin(a) * 6.5, tx: 0, ty: 0, tz: 0 };
  }
  private applyMenuPose(near: App['menuPose'], far: App['menuPose'], k: number): void {
    const e = k * k * (3 - 2 * k);
    const m = (a: number, b: number) => b + (a - b) * e;
    this.cam.camera.position.set(m(near.px, far.px), m(near.py, far.py), m(near.pz, far.pz));
    const tx = m(near.tx, far.tx), ty = m(near.ty, far.ty), tz = m(near.tz, far.tz);
    this.cam.orbit.target.set(tx, ty, tz);
    if (k > 0) this.cam.camera.lookAt(tx, ty, tz);
  }
  private setMenuView(v: 'orbit' | 'robot'): void {
    if (this.state === 'menu' && !this.spawnOn) this.menuView = v;
  }

  /** Reconstruye la cancha de fondo con el robot elegido (sin empezar match); con `animate`, el robot llega rodando. */
  private previewRobot(player: number, animate = true, robot?: RobotId): void {
    if (this.state !== 'menu') return;
    this.renderer.scene.remove(this.session.root);
    this.session.dispose();
    const o = { ...this.sessionOptions(player), solo: true };
    // Pantalla dividida: el robot de P1 o P2, no el de un jugador
    if (robot) {
      const specs = [...(o.specs ?? [])];
      specs[player] = { ...robotSpec(robot), maxSpeed: this.settings.maxSpeed };
      o.specs = specs;
    }
    this.session = new GameSession(o);
    // Selección: Axiom llega con la garra en el piso (pose de piso de su CAD); la partida no cambia
    const pl = this.session.player;
    if (pl.spec.name === robotSpec('cad:axiom').name) pl.mech.lowerForSelection();
    this.renderer.scene.add(this.session.root);
    this.arrive = null;
    if (animate) this.startArrival();
    else this.faceCamera();
  }

  // ------------------------------------------------------------------ llegada del robot (selección de robot)
  /** Llegada en curso: curva de Bézier desde un lado de la pantalla hasta su lugar; frena suave y se estaciona. */
  private arrive: { t: number; p0: { x: number; z: number }; p1: { x: number; z: number }; p2: { x: number; z: number }; h: number } | null = null;
  private static readonly ARRIVE_TIME = 1.7;
  /** Dirección horizontal de la cámara de la selección (de la cancha al robot, unitaria) y su derecha en pantalla. */
  private pickCam(r: { x: number; z: number }): { cx: number; cz: number; rx: number; rz: number } {
    const len = Math.hypot(r.x, r.z) || 1;
    const dx = -r.x / len;
    const dz = -r.z / len;
    const ang = 0.7;
    const cx = dx * Math.cos(ang) - dz * Math.sin(ang);
    const cz = dx * Math.sin(ang) + dz * Math.cos(ang);
    // Mira hacia −(cx, cz); su derecha en pantalla es (−dz', dx') con d = −c
    return { cx, cz, rx: cz, rz: -cx };
  }

  /** Rumbo con el que el robot queda en la selección: el intake (lado que recoge) mira a la cámara, para todos los robots. */
  private pickHeading(p: { x: number; z: number }): number {
    const cam = this.pickCam(p);
    return Math.atan2(-cam.cz, cam.cx);
  }

  /** Sin animación (al volver de Personalizar): el robot se queda en su lugar, con el intake hacia la cámara. */
  private faceCamera(): void {
    if (this.menuView !== 'robot') return;
    const pl = this.session.player;
    const p = pl.phys.position();
    pl.phys.teleport(p.x, p.z, this.pickHeading(p) + (pl.spec.arm.pickBack ? Math.PI : 0));
  }

  private startArrival(): void {
    const pl = this.session.player;
    const p = pl.phys.position();
    // El rumbo de reposo apunta el intake a la cámara (antes quedaba mirando a la cancha, de espaldas al jugador)
    const h = this.pickHeading(p);
    const cam = this.pickCam(p);
    const f = { x: Math.cos(h), z: -Math.sin(h) };
    // Entra por la izquierda de la pantalla; la esquina de la curva queda detrás del lugar final
    const p0 = { x: p.x - cam.rx * 2.6, z: p.z - cam.rz * 2.6 };
    const p1 = { x: p.x - f.x * 0.6, z: p.z - f.z * 0.6 };
    this.arrive = { t: 0, p0, p1, p2: { x: p.x, z: p.z }, h };
    pl.phys.teleport(p0.x, p0.z, h + (pl.spec.arm.pickBack ? Math.PI : 0));
  }

  private arriveStep(dt: number): void {
    const a = this.arrive;
    if (!a) return;
    const pl = this.session.player;
    a.t += dt;
    const k = Math.min(1, a.t / App.ARRIVE_TIME);
    // Frenado suave: la velocidad baja a cero justo en el lugar
    const u = 1 - (1 - k) ** 3;
    const w0 = (1 - u) ** 2;
    const w1 = 2 * u * (1 - u);
    const w2 = u * u;
    const x = w0 * a.p0.x + w1 * a.p1.x + w2 * a.p2.x;
    const z = w0 * a.p0.z + w1 * a.p1.z + w2 * a.p2.z;
    // Con el intake atrás (Psycho, Pivote 180°) llega de reversa y termina igual, con la garra al frente: sin giro final
    const back = pl.spec.arm.pickBack ? Math.PI : 0;
    if (k >= 1) {
      pl.phys.teleport(a.p2.x, a.p2.z, a.h + back);
      this.arrive = null;
      return;
    }
    const tx = 2 * (1 - u) * (a.p1.x - a.p0.x) + 2 * u * (a.p2.x - a.p1.x);
    const tz = 2 * (1 - u) * (a.p1.z - a.p0.z) + 2 * u * (a.p2.z - a.p1.z);
    pl.phys.teleport(x, z, Math.atan2(-tz, tx) + back);
  }

  // ------------------------------------------------------------------ punto de aparición (Personalizar)
  /** Modo "Personalizar": manejas tu robot en la cancha; guardar solo si está en su zona y toca la línea. */
  private spawnOn = false;
  private spawnKey = '';

  private spawnCmd(c: 'enter' | 'save' | 'reset' | 'cancel'): boolean {
    if (this.state !== 'menu') return false;
    const pl = () => this.session.player;
    if (c === 'enter') {
      this.previewRobot(this.menuPlayer(), false);
      this.spawnOn = true;
      this.spawnKey = '';
      this.menuView = 'spawn';
      this.cam.setMode('top');
      this.updateTouch();
      return true;
    }
    if (c === 'save') {
      const r = this.spawnStatus();
      if (!r.ok) return false;
      this.settings.match.start = r.spot;
      saveSettings(this.settings);
    } else if (c === 'reset') {
      // Vuelve al lugar de siempre (el centro de su zona) y lo deja guardado
      this.settings.match.start = { ...CENTER_SPOT };
      saveSettings(this.settings);
      const p = spotPose(pl().alliance, pl().station, CENTER_SPOT);
      pl().phys.teleport(p.x, p.z, p.heading);
      this.spawnKey = '';
      return true;
    }
    // Guardar o Cancelar: salir del modo
    this.spawnOn = false;
    this.menuView = 'robot';
    this.cam.setMode('free');
    this.updateTouch();
    this.previewRobot(this.menuPlayer(), false);
    return true;
  }

  private menuPlayer(): number {
    return this.session.opts.player;
  }

  private spawnStatus(): ReturnType<typeof spawnCheck> & { fwd: number; right: number; deg: number } {
    const pl = this.session.player;
    const p = pl.phys.position();
    const r = spawnCheck(pl.spec.length, pl.spec.width, pl.alliance, pl.station, { x: p.x, z: p.z, heading: pl.phys.heading() });
    return { ...r, fwd: Math.round(-r.spot.dx * 100), right: Math.round(-r.spot.dz * 100), deg: Math.round((r.spot.turn * 180) / Math.PI) };
  }

  /** Cada cuadro del modo: maneja el robot, dibuja desde arriba y avisa al menú si ya se puede guardar. */
  private spawnFrame(dt: number, inp: PlayerInput): void {
    const pl = this.session.player;
    this.session.setRobotsVisible(false, pl);
    this.session.setInput({ ...emptyInput(), forward: inp.forward, turn: inp.turn, slow: inp.slow, fieldCentric: inp.fieldCentric });
    this.session.update(dt);
    // Cámara fija desde arriba sobre la zona de inicio, con la pared de tu alianza abajo
    const c = spotPose(pl.alliance, pl.station, CENTER_SPOT);
    const up = pl.alliance === 'red' ? -1 : 1;
    const cam = this.cam.camera;
    cam.up.set(up, 0, 0);
    cam.position.set(c.x + up * 0.9, 4.6, c.z + 0.001);
    cam.lookAt(c.x + up * 0.9, 0, c.z);
    const st = this.spawnStatus();
    const key = `${st.ok}|${st.reason}|${st.fwd}|${st.right}|${st.deg}`;
    if (key !== this.spawnKey) {
      this.spawnKey = key;
      this.menu.spawnStatus(st);
    }
  }

  toMenu(): void {
    this.menuView = 'orbit';
    this.spawnOn = false;
    this.arrive = null;
    this.audio.stopVoice();
    this.flushPlaytime();
    this.closeAutoPractice();
    this.closeTraining();
    this.closePractice1v1();
    this.setVersus(false);
    this.state = 'menu';
    this.clearBoard();
    this.touch.show(false);
    this.touch2.show(false);
    this.hud.show(false);
    this.planView.set(null, 'red');
    this.cam.setMode('free');
    // Cancha reiniciada: Muestras y Críticas en su lugar de inicio, sin restos del match anterior
    this.previewRobot(Math.max(0, this.menu.player), false);
    this.menu.main();
  }

  /** De vuelta a la pantalla del torneo (después de jugar uno de sus matches). */
  toTournament(): void {
    this.toMenu();
    this.tourney.open();
  }

  togglePause(): void {
    if (this.boardBar.isOpen) return this.closeBoard();
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.stopVoice();
      this.pauseMenu();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.menu.hide();
      // Al volver de la pausa la asignación pudo cambiar (Controles)
      this.hud.setHelp(this.input.bindings);
    }
    this.updateTouch();
  }

  private pauseMenu(): void {
    const m = this.session.match;
    this.menu.pause({
      match: m,
      timer: m ? formatTimer(timerSeconds(m.t, this.session.game)) : '',
      phase: m ? t(`phase_${m.phase}` as Key) : '',
      camera: this.cam.mode,
      setCamera: (c) => this.setCamera(c),
      onResume: () => this.togglePause(),
      onRestart: this.choice.scout?.tour ? undefined : () => this.start(this.choice),
      // En pantalla dividida la pizarra (cámara superior y trazos) no aplica
      onBoard: m && !this.input.versus ? () => this.openBoard() : undefined,
      onDirector: () => this.openDirectorFromPause(),
      directorClips: this.director.clips.length,
      onMenu: () => (this.choice.scout ? this.toTournament() : this.toMenu()),
      menuLabel: this.choice.scout?.tour ? t('tr_backTo') : undefined,
      versus: this.vsPause(),
    });
  }

  /** Pausa de 2 jugadores: cámara y controles de cada quien (la cámara elegida se guarda). */
  private vsPause(): PauseInfo['versus'] {
    const p2 = this.session.player2;
    if (!this.input.versus || !p2) return undefined;
    const v = this.settings.versus;
    const player = (i: 0 | 1, side: VersusSide, station: number) => ({
      station,
      camera: side.camera,
      device: t(DEVICE_LABEL[side.device].name),
      help: deviceHelp(side.device, this.input.deviceKeys(side.device), this.input.bindings),
      setCamera: (c: VersusSide['camera']) => {
        side.camera = c;
        (i === 0 ? this.cam : this.cam2).setMode(c);
        saveSettings(this.settings);
      },
    });
    return {
      players: [player(0, v.p1, this.session.player.index), player(1, v.p2, p2.index)],
      onSetup: this.choice.mode === 'versus' ? () => this.versusSetupAgain() : undefined,
    };
  }

  /** Pizarra táctica: cámara superior y trazos con el puntero; el match sigue en pausa. */
  private openBoard(): void {
    if (this.state !== 'paused') return;
    this.boardCam = this.cam.mode;
    this.setCamera('top');
    this.menu.hide();
    this.renderer.renderer.domElement.classList.add('board-drawing');
    this.boardBar.show(true);
  }

  private closeBoard(): void {
    if (!this.boardBar.isOpen) return;
    this.boardBar.show(false);
    this.renderer.renderer.domElement.classList.remove('board-drawing');
    this.setCamera(this.boardCam);
    if (this.state === 'paused') this.pauseMenu();
  }

  private clearBoard(): void {
    this.boardBar.show(false);
    this.renderer.renderer.domElement.classList.remove('board-drawing');
    this.board.clear();
    this.boardRev++;
  }

  /** Punto de la cancha (plano y=0) bajo un punto de la pantalla; null si cae fuera de ella. */
  private pickField(cx: number, cy: number): { x: number; z: number } | null {
    const r = this.renderer.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.cam.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** La UI que el control navega ahora; jugando (manejando el robot) ninguna. */
  private padScope(): HTMLElement | null {
    if (this.state === 'playing') {
      if (this.autoPractice?.wantsUi) return this.autoPractice.root;
      if (this.trainingRun?.wantsUi) return this.trainingRun.root;
      if (this.practice1v1?.wantsUi) return this.practice1v1.root;
      return null;
    }
    if (this.menu.root.style.display !== 'none') return this.menu.root;
    if (this.state === 'replay' && this.replay) return this.studioPanel?.root ?? this.replayBar.root;
    return null;
  }

  cycleCamera(): void {
    const i = CAMERA_MODES.indexOf(this.cam.mode);
    this.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  setCamera(m: CameraMode): void {
    this.cam.setMode(m);
  }

  /** Suma el cuadro al tiempo jugado del modo en curso (nunca en pausa, menús ni resultados). */
  private trackPlaytime(dt: number): void {
    addPlaytime(this.playtime, this.choice.mode === 'versus' ? 'match' : this.choice.mode === 'scenario' ? 'training' : this.choice.mode, dt);
    this.playtimeDirty += dt;
    if (this.playtimeDirty >= 5) this.flushPlaytime();
  }

  private flushPlaytime(): void {
    if (this.playtimeDirty <= 0) return;
    this.playtimeDirty = 0;
    savePlaytime(this.playtime);
  }

  private loop = (now: number): void => {
    // Límite de FPS de Ajustes (0 = VSync): salta el cuadro si aún no toca
    const cap = this.settings.fpsLimit;
    if (cap > 0 && now - this.last < 1000 / cap - 2) {
      requestAnimationFrame(this.loop);
      return;
    }
    const t0 = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const inp = this.input.poll();
    if (this.input.pause) {
      if (this.state === 'replay') this.exitReplay();
      else this.togglePause();
    }
    if (this.state === 'playing') {
      this.trackPlaytime(dt);
      if (this.input.camera && !this.session.player2) this.cycleCamera();
      if (this.input.highlight) this.director.markManual();
      this.session.setInput(this.autoPractice ? this.autoPractice.filter(inp) : this.trainingRun ? this.trainingRun.filter(inp) : this.practice1v1 ? this.practice1v1.filter(inp) : inp);
      if (this.session.player2) this.session.setInput2(this.practice1v1 ? this.practice1v1.filter2(this.input.poll2()) : this.input.poll2());
      this.session.update(dt);
      this.autoPractice?.update(dt);
      this.trainingRun?.update(dt);
      this.practice1v1?.update(dt);
      this.hud.events(this.session.matchEvents);
      this.audio.events(this.session.matchEvents);
      this.refereeCalls(dt);
      this.hud.damage(this.session);
      this.hud.update(this.session, this.cam.mode);
      const sm = this.session.match;
      if (sm) {
        this.planView.update(sm.phase, sm.remaining);
        this.hud.planStep(sm.phase, sm.remaining);
      }
      this.touch.setIntake(this.session.player.mech.intakeOn);
      if (this.session.player2) this.touch2.setIntake(this.session.player2.mech.intakeOn);
      const m = this.session.match;
      // Probar el AUTO: al acabar el periodo (y su gracia de 3 s) termina, sin jugar el TELEOP
      if (m && !m.finished && this.choice.autoTest && m.t >= bounds(this.session.game).teleopStart) this.session.endNow();
      if (m?.finished && this.choice.autoTest) {
        // Acabó el AUTO de la prueba: de vuelta al diseñador, con la misma rutina
        this.toMenu();
        this.designer.open(this.settings.playerAuto);
      } else if (m?.finished) {
        this.state = 'results';
        this.updateTouch();
        const sc = this.choice.scout;
        // Torneo: el resultado va a su tabla
        this.tourNote = sc?.tour ? this.tourney.record(m, sc) : '';
        const scn = this.choice.mode === 'scenario' ? scenarioById(this.choice.scenario ?? '') : undefined;
        this.scenarioNote = scn ? this.finishScenario(m, scn) : '';
        // Una prueba de AUTO no cuenta para logros, rendimiento ni historial
        if (!this.choice.autoTest) this.recordAchievements(m);
        this.lastReplay = this.recorder?.build(this.session) ?? null;
        if (!this.choice.autoTest) this.recordPerf(m, this.lastReplay);
        if (this.lastReplay) void storeReplay(this.lastReplay);
        this.showResults();
      }
    } else if (this.state === 'replay' && this.replay) {
      if (this.input.camera && !this.studio) this.cycleCamera();
      if (this.replayBar.root.style.display !== 'none') this.replay.update(dt);
      this.replayBar.update();
      this.studioPanel?.update();
    } else if (this.state === 'menu') {
      if (this.menuView === 'spawn') {
        this.spawnFrame(dt, inp);
      } else if (this.menuView === 'robot') {
        // Selección de robot: solo se ve el que vas a elegir. Llega rodando, frena y se estaciona; la cámara
        // fija, de frente y un poco arriba, queda cerca (como MoSim) con el robot a la izquierda del panel
        const pl = this.session.player;
        this.session.setRobotsVisible(false, pl);
        this.arriveStep(dt);
        this.session.update(dt);
        const r = pl.phys.position();
        const k = this.pickCam({ x: this.arrive ? this.arrive.p2.x : r.x, z: this.arrive ? this.arrive.p2.z : r.z });
        const R = this.arrive ? this.arrive.p2 : r;
        const shift = 0.5;
        const tx = R.x + k.rx * shift;
        const tz = R.z + k.rz * shift;
        this.menuPose = { px: tx + k.cx * 2.1, py: 1.35, pz: tz + k.cz * 2.1, tx, ty: 0.3, tz };
        this.menuBlend = Math.min(1, this.menuBlend + dt / App.MENU_ZOOM);
        this.applyMenuPose(this.menuPose, this.orbitPose(), this.menuBlend);
      } else {
        this.session.setRobotsVisible(false);
        // Vista fija (el menú es estático: nada se mueve)
        // Al volver (Atrás) la cámara se aleja con la animación inversa
        this.menuBlend = Math.max(0, this.menuBlend - dt / App.MENU_ZOOM);
        this.applyMenuPose(this.menuPose, this.orbitPose(), this.menuBlend);
      }
    }
    // Después del estado: si A reanuda la pausa, el robot no recibe esa A (ya no es pulsación nueva)
    this.padNav.update(now, this.input.pad(), this.padScope(), this.input.capturing);
    if (this.autoPractice) this.autoPractice.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.trainingRun) this.trainingRun.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.practice1v1) this.practice1v1.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.state !== 'paused' && this.state !== 'replay') this.session.update(this.state === 'playing' || this.state === 'menu' ? 0 : dt);
    this.watchFps(dt);
    this.effects.update(this.state === 'paused' ? 0 : dt);
    this.boardView.update(this.board, this.boardRev);
    this.boardView.group.visible = this.state !== 'replay';
    this.arena.update(now / 1000, this.cam.camera.position.y, this.state === 'menu');
    const sm = this.session.match;
    const sb = this.replay?.scoreboard;
    if (sb) this.arena.setScreen(sb.timer, String(sb.red), String(sb.blue));
    else if (sm) this.arena.setScreen(formatTimer(timerSeconds(sm.t, this.session.game)), String(sm.score('red')), String(sm.score('blue')));
    else this.arena.setScreen(this.state === 'menu' ? 'LABBOT RESCUE' : t('practiceMode').toUpperCase(), '', '');
    const p = this.session.player.phys;
    const pt = p.position();
    const vr = this.replay ? this.replay.session.robots[this.replay.focus] : this.session.player;
    // El FOV de Ajustes solo aplica dentro del match; en el menú/lobby la cámara usa el FOV por defecto
    const fovNow = this.state === 'menu' ? FOV.default : this.matchFov;
    this.cam.fovDefault = fovNow;
    this.cam2.fovDefault = fovNow;
    if (this.studio) this.studio.update(dt);
    else this.cam.update(dt, this.replay?.focusPose ?? { x: pt.x, y: pt.y, z: pt.z, heading: p.heading() }, { alliance: vr.alliance, station: vr.station, spec: vr.spec });
    const p2 = this.state === 'menu' ? null : this.session.player2;
    if (p2) {
      const q = p2.phys.position();
      this.cam2.update(dt, { x: q.x, y: q.y, z: q.z, heading: p2.phys.heading() }, { alliance: p2.alliance, station: p2.station, spec: p2.spec });
    }
    // Detrás de una pantalla opaca (Scouting, Torneo, Editor, Estadísticas…) la cancha casi no se ve:
    // 8 cuadros por segundo bastan y la pantalla responde mejor en celulares
    const behind = this.menu.root.style.display !== 'none' && this.menu.root.classList.contains('solid');
    if (!behind || now - this.lastBehind > 125) {
      this.lastBehind = now;
      const t1 = performance.now();
      if (this.studio) this.studio.render(dt);
      else if (p2 && this.state !== 'replay') this.renderer.renderSplit(this.cam.camera, this.cam2.camera, this.stacked);
      else this.renderer.render(this.cam.camera);
      const t2 = performance.now();
      this.perf.push(dt, t1 - t0, t2 - t1);
    }
    this.updateFpsOverlay();
    requestAnimationFrame(this.loop);
  };
}
