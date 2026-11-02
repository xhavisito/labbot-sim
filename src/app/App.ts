/**
 * Orquestador: renderer, cámara, entrada, sesión, HUD y menús; bucle principal.
 * Estados: menú (la cancha gira de fondo) → jugando ⇄ pausa → resultados.
 */
import { LEAVE_ZONE, type AutoRoutine } from '../auto/AutoRoutine';
import { aiLineup } from '../ai/lineup';
import { planAutoRoutine, planBotOptions } from '../ai/plan';
import { SECRET_AUTOS, SECRET_STRATEGIES, STRATEGY_OPTIONS, weighted, type StrategyId } from '../ai/strategy';
import { activeColorMode } from '../config/palette';
import { applyAccessibility } from '../ui/a11y';
import { allAutoRoutines, autoRoutineIds } from '../auto/recorded';
import { clampSpot } from '../config/startSpot';
import { FieldAudio } from '../audio/FieldAudio';
import { ROBOT_PRESETS, type MechanismKind, type RobotSpec } from '../config/robot';
import { robotSpec } from '../config/robotIds';
import { loadSettings, saveSettings, type Settings } from '../config/settings';
import { formatTimer, timerSeconds } from '../core/clock';
import { callForEvent, EndgameWatcher, type RefCall } from '../core/refCalls';
import { ALLIANCES } from '../core/types';
import { GAME } from '../config/game';
import { refText, voiceLang } from '../ui/refText';
import { buildMatchLog } from '../core/matchLog';
import type { Match } from '../core/match';
import { drillById } from '../core/training';
import { evaluate, recordScenario, scenarioById, type Scenario, type ScenarioProgress } from '../core/scenarios';
import { drillSessionOptions } from '../game/drills';
import { addEntry, weeklyChallenge } from '../core/weekly';
import { loadWeekly, saveWeekly } from '../game/weeklyStore';
import { WeeklyScreen } from '../ui/Weekly';
import { loadScenarios, loadTraining, saveScenarios } from '../game/trainingStore';
import { addPlaytime } from '../core/playtime';
import { loadPlaytime, savePlaytime } from '../game/playtimeStore';
import { GameSession, type SessionOptions } from '../game/GameSession';
import { loadScout } from '../game/scoutStore';
import { planById } from '../game/planStore';
import type { StrategyPlan } from '../core/plan';
import { InputManager } from '../input/InputManager';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../render/CameraRig';
import { Arena } from '../render/Arena';
import { Effects } from '../render/Effects';
import { guessQuality, QUALITIES, Renderer, type Quality } from '../render/Renderer';
import { PerfProfile, QualityGovernor } from '../render/perf';
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
import { partnerStation, VersusSetup } from '../ui/VersusSetup';
import { PadNav } from '../ui/padNav';
import { DEFAULT_PLAYER, Menu, type MenuChoice } from '../ui/Menu';
import { saveMatchEntries, ScoutingScreen, type ScoutPlay } from '../ui/Scouting';
import { isTouchDevice, TouchControls } from '../ui/TouchControls';
import { TournamentScreen, WATCH_CAMERA } from '../ui/TournamentScreen';
import { TrainingRun, TrainingScreen, type TrainingRobot } from '../ui/Training';
import { Practice1v1 } from '../ui/Practice1v1';
import { loadCycleBests } from '../game/cycleStore';
import { loadShotLog } from '../game/shotStore';
import { matchFacts, recordMatch, emptyAch, type AchProgress } from '../core/achievements';
import { loadAch, saveAch } from '../game/achievementStore';
import { AchievementsScreen } from '../ui/Achievements';
import { StrategyScreen } from '../ui/StrategyScreen';
import { AutoPathScreen } from '../ui/AutoPathScreen';
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
  private govWin = { frames: 0, time: 0 };
  /** Perfil de FPS y tiempos (F3, `?fps=1` o Ajustes). */
  readonly perf = new PerfProfile();
  private fpsEl: HTMLElement | null = null;
  private fpsShown = new URLSearchParams(location.search).get('fps') === '1';
  private fpsTick = 0;
  readonly cam: CameraRig;
  /** Segunda cámara de la pantalla dividida (multijugador local). */
  private cam2: CameraRig;
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
  private secret: Array<{ strategy: StrategyId; auto: string } | null> = [];
  /** Estrategia de alianza que sigue tu compañero en este match (se dibuja en la cancha y el HUD). */
  private activePlan: StrategyPlan | null = null;
  /** Rutas del paso de la estrategia en curso, sobre la cancha. */
  private planView = new PlanView();

  /** Pizarra de estrategia según Ajustes: líneas en la cancha y/o tarjeta del HUD. */
  private applyPlanBoard(): void {
    const b = this.settings.planBoard;
    this.planView.visible = b === 'all';
    this.hud.planCardOn = b !== 'off';
  }
  /** Pizarra táctica: trazos dibujados con el match en pausa (`core/board.ts`). */
  readonly board = new Board();
  private boardView = new BoardView();
  private boardRev = 0;
  private boardCam: CameraMode = 'free';
  readonly boardBar: BoardBar;
  readonly strategies: StrategyScreen;
  readonly autoPaths: AutoPathScreen;
  readonly settings: Settings = loadSettings(autoRoutineIds());
  /** Sonidos del campo (inicio, TELEOP, ENDGAME, fin). */
  readonly audio = new FieldAudio(this.settings.volume / 100);
  /** Avisos del árbitro de Plataforma y Muestra Crítica en el ENDGAME (`core/refCalls.ts`). */
  private endgameWatch = new EndgameWatcher(GAME);
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
  readonly scenarioProgress: ScenarioProgress = loadScenarios();
  /** Tiempo realmente jugado (solo en estado `playing`); se guarda cada ~5 s y al ocultar la página. */
  private playtime = loadPlaytime();
  private playtimeDirty = 0;
  readonly training: TrainingScreen;
  /** Resumen del escenario terminado (se muestra en los resultados). */
  private scenarioNote = '';
  trainingRun: TrainingRun | null = null;
  readonly weeklyBoard = loadWeekly();
  readonly weekly: WeeklyScreen;
  /** Práctica 1 contra 1 en curso (`ui/Practice1v1.ts`). */
  practice1v1: Practice1v1 | null = null;
  readonly cycleBests = loadCycleBests();
  /** Mapa de tiro acumulado por robot de la práctica por ciclos. */
  readonly shotLog = loadShotLog();
  /** Logros y progreso (localStorage) y su pantalla; `achNew` = logros del último match. */
  private ach: AchProgress = loadAch();
  private achNew: string[] = [];
  readonly achievements: AchievementsScreen;
  /** Aviso de resultados del último match del torneo (se guarda una vez; los resultados se reabren). */
  private tourNote = '';
  /** `?touch=1` fuerza los controles touch (para probar en escritorio). */
  private touchForced = new URLSearchParams(location.search).get('touch') === '1';

  constructor(host: HTMLElement, ui: HTMLElement) {
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
    this.menu = new Menu(ui, (c) => this.start(c), this.settings, (s) => {
      saveSettings(s);
      // El color de la cancha y los robots se arma al iniciar: con otro modo de colores se recarga
      if (s.colorMode !== activeColorMode()) location.reload();
      applyAccessibility(s.colorMode, s.textScale);
      this.applyQuality();
      this.audio.setVolume(s.volume / 100);
      this.audio.setRefMode(s.refAudio);
    }, this.input);
    this.audio.setRefMode(this.settings.refAudio);
    this.replayBar = new ReplayBar(ui, { camera: () => this.cycleCamera(), stats: () => this.replayStats(), exit: () => this.exitReplay() });
    this.replays = new ReplaysScreen(this.menu.root, {
      back: () => this.toMenu(),
      watch: (r) => this.watchReplay(r, () => this.openReplays()),
      stats: (r) => this.showStats(r, () => this.openReplays(), () => this.watchReplay(r, () => this.openReplays())),
    });
    this.menu.onReplays = () => this.openReplays();
    this.menu.perfInfo = () => this.perfText();
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
    this.training = new TrainingScreen(this.menu.root, this.trainingProgress, this.scenarioProgress, () => this.trainingRobot(), {
      back: () => this.toMenu(),
      play: (drill) => this.start({ mode: 'training', player: this.menu.player, drill }),
      playScenario: (scenario) => this.start({ mode: 'scenario', player: this.menu.player, scenario }),
    });
    this.menu.onTraining = () => this.training.show();
    this.weekly = new WeeklyScreen(this.menu.root, this.weeklyBoard, () => robotLabel(this.playerSpec()), {
      back: () => this.toMenu(),
      play: () => this.start({ mode: 'training', player: this.menu.player, drill: weeklyChallenge().drill.id, weekly: true }),
    });
    this.menu.onWeekly = () => this.weekly.show();
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
    this.autoPaths = new AutoPathScreen(this.menu.root, {
      back: () => this.toMenu(),
      spec: () => this.playerSpec(),
      use: (id) => {
        this.settings.playerAuto = id;
        saveSettings(this.settings);
      },
      currentAuto: () => this.settings.playerAuto,
      play: (id) => {
        this.settings.playerAuto = id;
        saveSettings(this.settings);
        this.start({ mode: 'match', player: this.menu.player });
      },
    });
    this.menu.onAutoPaths = () => this.autoPaths.show();
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
    const onResize = () => this.renderer.resize(this.cam.camera);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backspace' && !this.input.capturing) this.resetPractice();
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
          : { ...o, solo: c.mode !== 'match', ...(c.mode === 'auto' ? { hp: { enabled: false, interval: 3 } } : {}) },
    );
    this.renderer.scene.add(this.session.root);
    if (scenario) this.session.startScenario(scenario);
    else if (c.mode === 'match' || versus) this.session.startMatch();
    // La estrategia de alianza solo cuenta en el match (en práctica no hay compañero)
    const plan = (c.mode === 'match' || scenario) && !drill ? this.activePlan : null;
    this.planView.set(plan, this.session.player.alliance);
    this.hud.setPlan(plan);
    this.applyPlanBoard();
    // Cada match se graba para la repetición y las estadísticas
    this.recorder = c.mode === 'match' || versus ? new Recorder(this.session, this.session.robots.map((r) => robotLabel(r.spec))) : null;
    this.session.tap = this.recorder;
    // Práctica 1 contra 1 con otra persona: pantalla dividida y entrada de dos jugadores, como 2 jugadores
    const duo = p1 && this.session.player2 !== null;
    this.setVersus(c.mode === 'versus' || duo);
    this.menu.hide();
    this.hud.show(true);
    this.hud.setHelp(this.input.bindings);
    this.state = 'playing';
    this.updateTouch();
    this.cam.setMode(c.player < 2 ? 'driverRed' : 'driverBlue');
    if (c.mode === 'versus' || duo) {
      // Cada quien ve su robot desde atrás (pantalla dividida)
      this.cam.setMode('follow');
      this.cam2.setMode('follow');
      this.hud.toast(`${t('vs_p1')}: ${t('vs_keys1')}`, 'big');
      this.hud.toast(`${t('vs_p2')}: ${t('vs_keys2')}`, 'big');
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
        shots: this.shotLog,
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
        other: () => {
          this.toMenu();
          if (c.weekly) this.weekly.show();
          else this.training.show();
        },
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
    return { ...o, player2: p2, specs, autos, bots, starts };
  }

  /** Enciende o apaga el modo de 2 jugadores en la entrada y la pantalla dividida. */
  private setVersus(on: boolean): void {
    this.input.versus = on;
    const v = this.settings.versus;
    this.input.layout = { p1: v.p1.device, p2: v.p2.device };
    this.splitBar.style.display = on ? '' : 'none';
    if (!on) this.renderer.resize(this.cam.camera);
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
      if (sc.tour) this.tourney.open();
      else this.scouting.show('schedule');
    };
    const spec = sc && !sc.tour ? ROBOT_PRESETS[sc.kinds[c.player]] : this.playerSpec();
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
    // 2 contra 2: no eliges ni ves lo de los rivales (Xhavi, 30-oct). Su tipo, estrategia y AUTO los
    // elige la IA en secreto en cada match; de ellos solo se elige la dificultad
    const rival = (i: number) => player >= 0 && (i < 2) !== (player < 2);
    this.secret = [0, 1, 2, 3].map((i) => (rival(i) ? { strategy: weighted(SECRET_STRATEGIES), auto: weighted(SECRET_AUTOS) } : null));
    const strategy = (i: number) => this.secret[i]?.strategy ?? m.robots[i].strategy;
    // Tu compañero sigue la estrategia de alianza que elegiste para él (si la IA está prendida)
    const mate = player >= 0 ? player ^ 1 : -1;
    const plan = mate >= 0 && s.ai ? planById(m.robots[mate].plan) : undefined;
    this.activePlan = plan ?? null;
    const types = kinds ?? m.robots.map((r, i) => (r.kind === 'random' || rival(i) ? random[i] : r.kind));
    const botAuto = (i: number): AutoRoutine => {
      if (i === mate && plan) return planAutoRoutine(plan);
      const a = routine(this.secret[i]?.auto ?? m.robots[i].auto);
      // "Solo línea y Plataforma" no anota: con una rutina de la IA se quedaría quieto en AUTO
      return strategy(i) === 'park' && a.bot ? LEAVE_ZONE : a;
    };
    const bot = (i: number) => {
      const { ai, persona } = m.robots[i];
      if (i === mate && plan) return { ...planBotOptions(plan, i < 2 ? 'red' : 'blue'), ai, persona };
      return { ...STRATEGY_OPTIONS[strategy(i)], ai, persona };
    };
    const autos = [0, 1, 2, 3].map((i) => (i === player ? routine(s.playerAuto) : botAuto(i)));
    // Tu robot es el del menú (con tu velocidad y capacidad), salvo en el Scouting: el de tu equipo
    const specs = types.map((k, i) => (i === player && (!kinds || tour) ? this.playerSpec() : ROBOT_PRESETS[k]));
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
      this.govWin.frames = this.govWin.time = 0;
      return;
    }
    // Un cuadro enorme (pestaña en segundo plano) no cuenta
    if (dt >= 0.1) return;
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
    const want = !this.input.versus && (this.touchForced || s === 'on' || (s === 'auto' && isTouchDevice()));
    document.body.classList.toggle('touch-on', want);
    this.touch.show(want && this.state === 'playing');
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
    const sc = this.choice.scout;
    this.menu.results(
      m,
      () => this.start(this.choice),
      () => (sc ? this.toScouting() : this.toMenu()),
      () => this.downloadLog(),
      this.choice.player,
      sc?.tour ? this.tourNote : sc ? t('sc_saved', { match: sc.match }) : this.scenarioNote,
      sc?.tour ? t('tr_continue') : undefined,
      this.achNew,
    );
    this.revealRivals();
    const rep = this.lastReplay;
    const bar = this.menu.root.querySelector('.results .actions');
    if (!rep || !bar) return;
    bar.insertAdjacentHTML('afterbegin', `<button class="btn" data-act="replay">${ic.play}<span>${t('rp_watch')}</span></button><button class="btn" data-act="stats">${ic.chart}<span>${t('st_title')}</span></button>`);
    const back = () => this.showResults();
    bar.querySelector('[data-act="replay"]')!.addEventListener('click', () => this.watchReplay(rep, back));
    bar.querySelector('[data-act="stats"]')!.addEventListener('click', () => this.showStats(rep, back, () => this.watchReplay(rep, back)));
  }

  /**
   * Al terminar el match se revela qué estrategia y AUTO eligió la IA de cada rival (SUPUESTO: en un
   * evento real se ve jugando; durante el match no aparece en ningún lado: HUD, repetición ni gráficas).
   */
  private revealRivals(): void {
    const box = this.menu.root.querySelector('.results .fouls');
    const row = (x: { strategy: StrategyId; auto: string }, i: number): string => {
      const a = i < 2 ? 'red' : 'blue';
      return `<li><span class="tag ${a}">${t(a).toUpperCase()} ${(i % 2) + 1}</span>${t(`strat_${x.strategy}` as Key)}<em>AUTO: ${t(`auto_${x.auto}` as Key)}</em></li>`;
    };
    const rows = this.secret.map((x, i) => (x ? row(x, i) : '')).join('');
    if (!box || !rows) return;
    box.insertAdjacentHTML('afterend', `<h3>${t('res_rivals')}</h3><ul class="fouls rivals">${rows}</ul><p class="ms-note">${t('res_rivalsNote')}</p>`);
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

  /**
   * Avisos del árbitro del cuadro: faltas y tarjetas del match, y en el ENDGAME los robots sobre la
   * Plataforma y la Muestra Crítica en la Repisa. Cartel en el HUD y silbato/voz según Ajustes.
   */
  private refereeCalls(dt: number): void {
    const s = this.session;
    const m = s.match;
    if (!m) return;
    const calls: RefCall[] = [];
    for (const e of s.matchEvents) {
      const c = callForEvent(e, s.game);
      if (c) calls.push(c);
    }
    const platform = { red: 0, blue: 0 };
    const critical = { red: false, blue: false };
    if (m.phase === 'ENDGAME') {
      for (const r of s.robots) if (s.sensors.onPlatform(r)) platform[r.alliance]++;
      for (const a of ALLIANCES) critical[a] = s.sensors.criticalOnRepisa(a);
    }
    this.endgameWatch.cfg = s.game;
    calls.push(...this.endgameWatch.update(dt, m.phase, platform, critical));
    if (!calls.length) return;
    const texts = calls.map(refText);
    this.hud.referee(texts);
    calls.forEach((c, i) => this.audio.referee(c.sound, texts[i].voice, voiceLang()));
  }

  toMenu(): void {
    this.audio.stopVoice();
    this.flushPlaytime();
    this.closeAutoPractice();
    this.closeTraining();
    this.closePractice1v1();
    this.setVersus(false);
    this.state = 'menu';
    this.clearBoard();
    this.touch.show(false);
    this.hud.show(false);
    this.planView.set(null, 'red');
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
      onBoard: m ? () => this.openBoard() : undefined,
      onMenu: () => (this.choice.scout ? this.toScouting() : this.toMenu()),
      menuLabel: this.choice.scout?.tour ? t('tr_backTo') : undefined,
    });
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
    const t0 = performance.now();
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
      this.trackPlaytime(dt);
      if (this.input.camera && !this.session.player2) this.cycleCamera();
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
      for (const f of this.session.scoreFx) this.effects.burst(f.x, f.y, f.z, f.alliance);
      const m = this.session.match;
      if (m?.finished) {
        this.state = 'results';
        this.updateTouch();
        const sc = this.choice.scout;
        if (sc && !sc.tour) saveMatchEntries(this.scoutData, m, sc.teams, sc.match);
        // Torneo: el resultado va a su tabla
        this.tourNote = sc?.tour ? this.tourney.record(m, sc) : '';
        const scn = this.choice.mode === 'scenario' ? scenarioById(this.choice.scenario ?? '') : undefined;
        this.scenarioNote = scn ? this.finishScenario(m, scn) : '';
        this.recordAchievements(m);
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
    if (this.practice1v1) this.practice1v1.root.style.display = this.state === 'playing' ? '' : 'none';
    if (this.state !== 'paused' && this.state !== 'replay') this.session.update(this.state === 'playing' ? 0 : dt);
    this.watchFps(dt);
    this.effects.update(this.state === 'paused' ? 0 : dt);
    this.boardView.update(this.board, this.boardRev);
    this.boardView.group.visible = this.state !== 'replay';
    this.arena.update(now / 1000, this.cam.camera.position.y);
    const sm = this.session.match;
    const sb = this.replay?.scoreboard;
    if (sb) this.arena.setScreen(sb.timer, String(sb.red), String(sb.blue));
    else if (sm) this.arena.setScreen(formatTimer(timerSeconds(sm.t, this.session.game)), String(sm.score('red')), String(sm.score('blue')));
    else this.arena.setScreen(this.state === 'menu' ? 'LABBOT RESCUE' : t('practiceMode').toUpperCase(), '', '');
    const p = this.session.player.phys;
    const pt = p.position();
    const vr = this.replay ? this.replay.session.robots[this.replay.focus] : this.session.player;
    this.cam.update(dt, this.replay?.focusPose ?? { x: pt.x, y: pt.y, z: pt.z, heading: p.heading() }, { alliance: vr.alliance, station: vr.station, spec: vr.spec });
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
      if (p2 && this.state !== 'replay') this.renderer.renderSplit(this.cam.camera, this.cam2.camera);
      else this.renderer.render(this.cam.camera);
      const t2 = performance.now();
      this.perf.push(dt, t1 - t0, t2 - t1);
    }
    this.updateFpsOverlay();
    requestAnimationFrame(this.loop);
  };
}
