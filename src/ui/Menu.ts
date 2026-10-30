/**
 * Pantallas en DOM con el estilo de rebuilt-sim: menú principal (la cancha gira detrás), ajustes,
 * controles (reasignar), reglas, pausa y resultados.
 */
import { AUTO_ROUTINES } from '../auto/AutoRoutine';
import { routeRoutine, savedRoutes } from '../auto/recorded';
import { customById } from '../config/customRobots';
import { allRobotIds, robotSpec, type RobotId } from '../config/robotIds';
import { GRIP_MODES, MECHANISM_KINDS } from '../config/robot';
import { GAME } from '../config/game';
import { DEFAULT_SETTINGS, SETTINGS_RANGE, type Settings } from '../config/settings';
import { DAMAGE_LEVELS, type DamageLevel, type DamageTargets } from '../core/damage';
import { RULES } from '../core/fouls';
import type { Match } from '../core/match';
import type { DrillId } from '../core/training';
import { ALLIANCES, type Alliance } from '../core/types';
import { ACTIONS, assign, clearAction, cloneBindings, DEFAULT_BINDINGS, keyLabel, padLabel, saveBindings, type Action } from '../input/bindings';
import type { InputManager } from '../input/InputManager';
import { CAMERA_MODES, type CameraMode } from '../render/CameraRig';
import { padHelp } from './controlsHelp';
import { backBtn, brandbar, ic, kbds, langChips, robotSilhouette, UI_ALLIANCES, UI_SLOTS } from './chrome';
import { getLang, setLang, t, type Key } from './i18n';
import type { ScoutPlay } from './Scouting';
import { isIos, isStandalone, promptInstall, pwa } from '../pwa/register';

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface MenuChoice {
  /**
   * 'auto' = práctica de AUTO (`ui/AutoPractice.ts`): solo tu robot, grabar y probar rutas.
   * 'training' = un reto del entrenamiento (`ui/Training.ts`), el de `drill`.
   */
  mode: 'match' | 'practice' | 'auto' | 'training';
  player: number;
  drill?: DrillId;
  /** Match del calendario del Scouting (equipos y sus robots); su registro se guarda al terminar. */
  scout?: ScoutPlay;
  /** Ya pasó por "Preparar match" (o es una repetición de ese match): empieza directo. */
  ready?: boolean;
}

/** Lo que la pausa muestra y puede cambiar de la partida en curso. */
export interface PauseInfo {
  match: Match | null;
  timer: string;
  phase: string;
  camera: CameraMode;
  setCamera: (m: CameraMode) => void;
  onResume: () => void;
  /** Sin reiniciar (match del torneo: el resultado cuenta). */
  onRestart?: () => void;
  onMenu: () => void;
  /** Texto del botón de salir (p. ej. volver al torneo). */
  menuLabel?: string;
}


/** Medidas del chasis del robot (cm), para la vitrina del menú. */
const chassisSize = (id: RobotId): string => `${Math.round(robotSpec(id).length * 100)} × ${Math.round(robotSpec(id).width * 100)} cm`;
/** Nombre y descripción de un robot elegible (tipo de LabBot o robot propio). */
const robotName = (id: RobotId): string => robotSpec(id).label ?? t(`type_${id}` as Key);
function robotDesc(id: RobotId): string {
  const c = customById(id);
  if (c) {
    const s = robotSpec(id);
    return t('myRobotDesc', { type: t(`type_${s.mechanism}` as Key), mass: s.massKg.toFixed(1), speed: s.maxSpeed.toFixed(2) });
  }
  return t(`type_${id}_desc` as Key);
}
/** Lista de robots para elegir: el pivote, su variante de 180° y los robots propios del editor. */
const robotOptions = (sel: RobotId): string =>
  `<optgroup label="${t('grp_labbot')}">${MECHANISM_KINDS.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${robotName(m)}</option>`).join('')}</optgroup>${mineOptions(sel)}`;
/** Robots propios del editor (si hay). */
function mineOptions(sel: RobotId): string {
  const ids = allRobotIds().filter((id) => customById(id));
  return ids.length ? `<optgroup label="${t('grp_mine')}">${ids.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${robotName(id)}</option>`).join('')}</optgroup>` : '';
}
/** Al elegir un robot, la velocidad de los ajustes toma la suya. */
function adoptRobot(s: Settings, id: RobotId): void {
  const spec = robotSpec(id);
  s.robotType = id;
  s.maxSpeed = Math.min(SETTINGS_RANGE.maxSpeed.max, Math.round(spec.maxSpeed * 4) / 4);
}

/** Posición inicial por defecto al abrir la app: Azul 1 (índice 2; UI_SLOTS la muestra primero). */
export const DEFAULT_PLAYER = 2;

const stationLabel = (i: number): string => `${t(i < 2 ? 'red' : 'blue')} ${(i % 2) + 1}`;

export class Menu {
  /** Abre la pantalla de Repeticiones y el editor de robot (los conecta App). */
  onReplays: () => void = () => undefined;
  onEditor: () => void = () => undefined;
  readonly root: HTMLElement;
  player = DEFAULT_PLAYER;
  /** Abre la pantalla de Scouting (la conecta App). */
  onScouting: () => void = () => undefined;
  /** Abre el modo torneo (lo conecta App). */
  onTournament: () => void = () => undefined;
  /** Abre la lista de retos del entrenamiento (la conecta App). */
  onTraining: () => void = () => undefined;

  constructor(
    host: HTMLElement,
    private onStart: (c: MenuChoice) => void,
    private settings: Settings,
    private onSettings: (s: Settings) => void,
    private input: InputManager,
  ) {
    this.root = document.createElement('div');
    host.appendChild(this.root);
  }

  hide(): void {
    this.input.cancelCapture();
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  /** Pantalla completa (`screen`) o diálogo sobre el juego (`overlay`). */
  private open(html: string, cls = 'screen'): void {
    this.root.className = cls;
    this.root.innerHTML = cls.startsWith('screen') ? `<div class="inner">${html}</div>` : html;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    // Los diálogos se desplazan por dentro: que abran desde arriba, con el título visible
    this.root.querySelector('.dialog')?.scrollTo(0, 0);
  }

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
  }

  // ------------------------------------------------------------------ principal
  main(): void {
    const s = this.settings;
    const fs = !!document.documentElement.requestFullscreen;
    // Atajos del taller: solo ícono y nombre (la descripción va en el title)
    const tool = (go: string, icon: string, label: Key, desc: Key) =>
      `<button class="mm-tool" data-go="${go}" title="${t(desc)}">${icon.replace('class="ic"', 'class="mi"')}<span class="mt-txt"><b>${t(label)}</b></span></button>`;
    this.open(`
      ${brandbar('', `<span class="pwa-chips" data-pwa></span>${langChips()}${fs ? `<button class="chipbtn" data-fs title="${t('fullscreen')}">${ic.expand}</button>` : ''}`)}
      <div class="mm">
        <div class="mm-left">
          <h1 class="mm-title">LabBot <span>Rescue 2026</span></h1>
          <button class="mm-hero" data-act="match">
            <b>${t('match')}</b>
            <small>${t('matchDesc')}</small>
            <span class="mh-go">${ic.go}</span>
          </button>
          <button class="mm-hero alt" data-act="practice">
            <b>${t('practice')}</b>
            <small>${t('practiceDesc')}</small>
            <span class="mh-go">${ic.go}</span>
          </button>
          <div class="mm-tools late">
            ${tool('training', ic.medal, 'tn_title', 'trainingDesc')}
            ${tool('replays', ic.film, 'replays', 'replaysDesc')}
            ${tool('editor', ic.cube, 'editor', 'editorDesc')}
            ${tool('autoPractice', ic.route, 'autoPractice', 'autoPracticeDesc')}
            ${tool('settings', ic.sliders, 'settings', 'settingsDesc')}
            ${tool('controls', ic.gamepad, 'controlsTitle', 'controlsDesc')}
            ${tool('rules', ic.book, 'rules', 'rulesDesc')}
            ${tool('scouting', ic.clipboard, 'scouting', 'scoutingDesc')}
            ${tool('tournament', ic.trophy, 'tournament', 'tournamentDesc')}
          </div>
        </div>
        <div class="mm-right">
          <div class="bay">
            <div class="bay-head"><span class="bay-label">${t('station')}</span></div>
            <div class="stations">${UI_SLOTS.map((i) => `<button class="${i < 2 ? 'red' : 'blue'} ${i === this.player ? 'on' : ''}" data-slot="${i}"><i></i>${stationLabel(i)}</button>`).join('')}</div>
            <div class="bay-head"><span class="bay-label">${t('yourRobot')}</span></div>
            <div class="showcase">${robotSilhouette(robotSpec(s.robotType).mechanism)}<span class="dim">${chassisSize(s.robotType)} · ${t('robotType')}</span></div>
            <div class="robotinfo" data-robotinfo></div>
          </div>
        </div>
      </div>
      <div class="mm-bottom">
        <div>${t('disclaimer')}</div>
      </div>`);
    this.robotInfo();
    this.pwaChips();
    this.on('[data-slot]', (el) => {
      this.player = Number(el.dataset.slot);
      this.main();
    });
    this.on('[data-act="match"]', () => this.onStart({ mode: 'match', player: this.player }));
    this.on('[data-act="practice"]', () => this.onStart({ mode: 'practice', player: this.player }));
    this.on('[data-go="training"]', () => this.onTraining());
    this.on('[data-go="replays"]', () => this.onReplays());
    this.on('[data-go="editor"]', () => this.onEditor());
    this.on('[data-go="autoPractice"]', () => this.onStart({ mode: 'auto', player: this.player }));
    this.on('[data-go="settings"]', () => this.settingsPanel());
    this.on('[data-go="controls"]', () => this.controlsPanel(() => this.main()));
    this.on('[data-go="rules"]', () => this.rulesPanel());
    this.on('[data-go="scouting"]', () => this.onScouting());
    this.on('[data-go="tournament"]', () => this.onTournament());
    this.on('[data-lang]', (el) => {
      if (el.dataset.lang === getLang()) return;
      setLang(el.dataset.lang === 'en' ? 'en' : 'es');
      location.reload();
    });
    this.on('[data-fs]', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    });
    (this.root.querySelector('[data-act="match"]') as HTMLElement).focus({ preventScroll: true });
  }

  /**
   * Chips de la PWA en la barra del menú: "Sin conexión" cuando todo quedó en caché y "Instalar"
   * (diálogo del navegador; en iPhone, cómo agregarlo a inicio). Se actualizan con `pwa.onChange`.
   */
  pwaChips(): void {
    const box = this.root.querySelector<HTMLElement>('[data-pwa]');
    if (!box) return;
    const canInstall = !isStandalone() && (pwa.installEvent || isIos());
    box.innerHTML = `${pwa.offlineReady ? `<span class="chipbtn static" title="${t('pwa_offlineTitle')}">${ic.offline}<span>${t('pwa_offline')}</span></span>` : ''}${
      canInstall ? `<button class="chipbtn" data-install title="${t('pwa_installTitle')}">${ic.phone}<span>${t('pwa_install')}</span></button>` : ''
    }`;
    box.querySelector('[data-install]')?.addEventListener('click', () => {
      if (pwa.installEvent) void promptInstall();
      else if (!box.querySelector('.pwa-tip')) box.insertAdjacentHTML('beforeend', `<div class="pwa-tip msg">${t('pwa_ios')}</div>`);
    });
  }

  /** Elige un robot como el tuyo (desde el editor) y vuelve al menú. */
  useRobot(id: RobotId): void {
    adoptRobot(this.settings, id);
    this.onSettings(this.settings);
    this.main();
  }

  /** Placa del robot elegido: nombre, descripción, barras y flechas para cambiar de tipo. */
  private robotInfo(): void {
    const s = this.settings;
    const id = s.robotType;
    const spec = robotSpec(id);
    const ids = allRobotIds();
    const i = Math.max(0, ids.indexOf(id));
    const n = ids.length;
    const levels = (['N1', 'N2', 'N3'] as const).slice(0, spec.maxLevel ?? 3).join(' · ');
    const bar = (label: string, v: number, txt: string) =>
      `<div class="sbar"><span>${label}</span><div><i style="width:${Math.round(Math.min(1, Math.max(0.04, v)) * 100)}%"></i></div><b>${txt}</b></div>`;
    const info = this.root.querySelector<HTMLElement>('[data-robotinfo]')!;
    info.innerHTML = `
      <div class="ri-plate"><div class="num">${robotName(id)}</div><p>${robotDesc(id)}</p></div>
      <div class="ri-stats">
        ${bar(t('statSpeed'), s.maxSpeed / SETTINGS_RANGE.maxSpeed.max, `${s.maxSpeed.toFixed(2).replace(/0$/, '')} m/s`)}
        <div class="ri-flags"><span>${t(spec.arm.pickBack ? 'picksBack' : 'scoresFront')}</span><span>${levels}</span></div>
      </div>
      <div class="nav"><button class="arrowbtn" data-step="-1" aria-label="‹">‹</button>
        <div class="track"><i style="width:${100 / n}%;margin-left:${(100 * i) / n}%"></i></div>
        <span class="count">${i + 1}/${n}</span><button class="arrowbtn" data-step="1" aria-label="›">›</button></div>`;
    info.querySelectorAll<HTMLElement>('[data-step]').forEach((b) =>
      b.addEventListener('click', () => {
        adoptRobot(s, ids[(i + Number(b.dataset.step) + n) % n]);
        this.onSettings(s);
        this.root.querySelector('.showcase')!.innerHTML = `${robotSilhouette(robotSpec(s.robotType).mechanism)}<span class="dim">${chassisSize(s.robotType)} · ${t('robotType')}</span>`;
        this.robotInfo();
      }),
    );
  }

  // ------------------------------------------------------------------ ajustes
  /** Ajustes: IA, rutinas de AUTO, tu robot y Human Player. Se guardan al volver. */
  settingsPanel(): void {
    const s = { ...this.settings };
    const autoOpts = (sel: string, routes = false) => {
      const opt = (id: string, label: string) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${label}</option>`;
      const fixed = AUTO_ROUTINES.map((r) => opt(r.id, t(`auto_${r.id}` as Key))).join('');
      const mine = routes ? savedRoutes.map((r) => opt(routeRoutine(r).id, esc(r.name))).join('') : '';
      return fixed + (mine ? `<optgroup label="${t('grp_routes')}">${mine}</optgroup>` : '');
    };
    const toggle = (k: 'ai' | 'hpEnabled' | 'hpSmart') => `<button class="toggle ${s[k] ? 'on' : ''}" data-tog="${k}"><i></i>${s[k] ? t('on_') : t('no_')}</button>`;
    const range = (k: keyof typeof SETTINGS_RANGE, unit: string) => {
      const r = SETTINGS_RANGE[k];
      return `<div class="range"><input type="range" data-k="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[k]}"><output data-unit="${unit}">${s[k]} ${unit}</output></div>`;
    };
    const robotSel = () => `<select data-robot>${robotOptions(s.robotType)}</select>`;
    const seg = (k: string, vals: readonly string[], cur: string, label: (v: string) => string) =>
      `<div class="seg" data-seg="${k}">${vals.map((v) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${label(v)}</button>`).join('')}</div>`;
    this.open(
      `${brandbar(t('settings'))}
      <h1>${t('settings')}</h1>
      <p class="sub">${t('settingsNote')}</p>
      <div class="panels">
        <div class="panel"><div class="form">
          <h3>${t('sec_match')}</h3>
          <label>${t('setAi')}</label>${toggle('ai')}
          <label>${t('setPlayerAuto')}</label><select data-k="playerAuto">${autoOpts(s.playerAuto, true)}</select>
          <p class="full sub">${t('aiNote')}</p>
          <h3>${t('sec_hp')}</h3>
          <label>${t('setHp')}</label>${toggle('hpEnabled')}
          <label>${t('setHpInterval')}</label>${range('hpInterval', 's')}
          <label>${t('setHpSmart')}</label>${toggle('hpSmart')}
          <p class="full sub">${t('hpSmartNote')}</p>
        </div></div>
        <div class="panel"><div class="form">
          <h3>${t('sec_robot')}</h3>
          <label>${t('robotType')}</label>${robotSel()}
          <p class="full sub" data-desc>${robotDesc(s.robotType)}</p>
          <label>${t('setSpeed')}</label>${range('maxSpeed', 'm/s')}
          <h3>${t('sec_realism')}</h3>
          <label>${t('setGrip')}</label>${seg('grip', GRIP_MODES, s.grip, (v) => t(`grip_${v}` as Key))}
          <label>${t('setDamage')}</label>${seg('damage.level', DAMAGE_LEVELS, s.damage.level, (v) => t(`damage_${v}` as Key))}
          <label>${t('setDamageWho')}</label>${seg('damage.targets', ['all', 'player'], s.damage.targets, (v) => t(`damageWho_${v}` as Key))}
          <label>${t('setDamageRandom')}</label><button class="toggle ${s.damage.random ? 'on' : ''}" data-tog-dmg><i></i>${s.damage.random ? t('on_') : t('no_')}</button>
          <p class="full sub">${t('realismNote')}</p>
          <h3>${t('sec_graphics')}</h3>
          <label>${t('setQuality')}</label><div class="seg" data-qseg>${(['auto', 'low', 'medium', 'high'] as const).map((q) => `<button class="${q === s.quality ? 'on' : ''}" data-v="${q}">${t(`quality_${q}`)}</button>`).join('')}</div>
          <p class="full sub">${t('qualityNote')}</p>
          <h3>${t('sec_sound')}</h3>
          <label>${t('setVolume')}</label>${range('volume', '%')}
          <p class="full sub">${t('soundNote')}</p>
        </div></div>
      </div>
      <div class="actionbar">${backBtn('data-act="cancel"')}<div class="grow"></div>
        <button class="btn" data-act="defaults">${ic.reset}<span>${t('defaults')}</span></button>
        <button class="btn primary" data-act="save">${ic.check}<span>${t('save')}</span></button></div>`,
      'screen solid',
    );
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
      el.addEventListener('input', () => {
        const k = el.dataset.k as keyof Settings;
        const v = el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
        (s as unknown as Record<string, unknown>)[k] = v;
        const out = el.nextElementSibling;
        if (out instanceof HTMLOutputElement) out.textContent = `${v} ${out.dataset.unit ?? ''}`;
      });
    });
    this.on('[data-tog]', (el) => {
      const k = el.dataset.tog as 'ai' | 'hpEnabled' | 'hpSmart';
      s[k] = !s[k];
      el.classList.toggle('on', s[k]);
      el.lastChild!.textContent = s[k] ? t('on_') : t('no_');
    });
    this.root.querySelectorAll<HTMLSelectElement>('[data-robot]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const id = sel.value as RobotId;
        adoptRobot(s, id);
        this.root.querySelector('[data-desc]')!.textContent = robotDesc(id);
        // El deslizador de velocidad muestra la del robot elegido
        for (const k of ['maxSpeed'] as const) {
          const r = this.root.querySelector<HTMLInputElement>(`input[data-k="${k}"]`);
          if (!r) continue;
          r.value = String(s[k]);
          const out = r.nextElementSibling;
          if (out instanceof HTMLOutputElement) out.textContent = `${s[k]} ${out.dataset.unit ?? ''}`;
        }
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-qseg] button').forEach((b) =>
      b.addEventListener('click', () => {
        s.quality = b.dataset.v as Settings['quality'];
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-seg] button').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.parentElement!.dataset.seg!;
        const v = b.dataset.v!;
        if (k === 'grip') s.grip = v as Settings['grip'];
        else if (k === 'damage.level') s.damage = { ...s.damage, level: v as DamageLevel };
        else if (k === 'damage.targets') s.damage = { ...s.damage, targets: v as DamageTargets };
        b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.on('[data-tog-dmg]', (el) => {
      s.damage = { ...s.damage, random: !s.damage.random };
      el.classList.toggle('on', s.damage.random);
      el.lastChild!.textContent = s.damage.random ? t('on_') : t('no_');
    });
    this.on('[data-act="save"]', () => {
      Object.assign(this.settings, s);
      this.onSettings(this.settings);
      this.main();
    });
    this.on('[data-act="cancel"]', () => this.main());
    this.on('[data-act="defaults"]', () => {
      Object.assign(this.settings, { ...structuredClone(DEFAULT_SETTINGS), touch: this.settings.touch, quality: this.settings.quality, volume: this.settings.volume });
      this.onSettings(this.settings);
      this.settingsPanel();
    });
  }

  // ------------------------------------------------------------------ controles
  /**
   * Controles: reasignar cada acción en teclado y control (toca la casilla y presiona), manejo con
   * el control y controles touch. Se guarda al momento.
   */
  controlsPanel(onBack: () => void): void {
    const inp = this.input;
    const b = inp.bindings;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    const cell = (dev: 'keys' | 'pad', a: Action) => {
      const list = dev === 'keys' ? b.keys[a].map(keyLabel) : b.pad[a].map(padLabel);
      return `<td><button class="bind" data-dev="${dev}" data-a="${a}">${kbds(list)}</button></td>
        <td><button class="x" title="${t('clear')}" aria-label="${t('clear')}" data-clear="${dev}" data-a="${a}">${ic.x}</button></td>`;
    };
    const seg = (k: string, cur: string, opts: Array<[string, string]>) =>
      `<div class="seg" data-seg="${k}">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    this.open(
      `${brandbar(t('controlsTitle'))}
      <h1>${t('controlsTitle')}</h1>
      <p class="sub">${t('controlsNote')}</p>
      <div class="panels">
        <div class="panel"><div class="form">
          <h3>${t('sec_bindings')}</h3>
          <table class="binds full">
            <tr><th></th><th>${t('keyboard')}</th><th></th><th>${t('gamepad')}</th><th></th></tr>
            ${ACTIONS.map((a) => `<tr><td>${t(`act_${a}` as Key)}</td>${cell('keys', a)}${cell('pad', a)}</tr>`).join('')}
          </table>
        </div></div>
        <div class="panel"><div class="form">
          <h3>${t('sec_options')}</h3>
          <div class="full msg ${pad ? 'ok' : ''}">${ic.gamepad}${pad ? t('padConnected', { name: pad.id.split('(')[0].trim() }) : t('padNone')}</div>
          <p class="full sub">${t('padMenus')}</p>
          <label>${t('padDriveLabel')}</label>${seg('padDrive', b.padDrive, [['left', t('padDriveLeft')], ['split', t('padDriveSplit')]])}
          <label>${t('invertForward')}</label><button class="toggle ${b.invertForward ? 'on' : ''}" data-tog="invert"><i></i>${b.invertForward ? t('on_') : t('no_')}</button>
          <label>${t('touchControls')}</label>${seg('touch', this.settings.touch, [['auto', t('touchAuto')], ['on', t('touchOn')], ['off', t('touchOff')]])}
        </div></div>
      </div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn" data-act="defaults">${ic.reset}<span>${t('defaults')}</span></button></div>`,
      'screen solid',
    );
    const apply = (nb: typeof b) => {
      inp.bindings = nb;
      saveBindings(nb);
      const y = this.root.scrollTop;
      this.controlsPanel(onBack);
      this.root.scrollTop = y;
    };
    this.root.querySelectorAll<HTMLButtonElement>('.bind').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.root.querySelectorAll('.bind.wait').forEach((x) => x.classList.remove('wait'));
        btn.classList.add('wait');
        btn.textContent = t('pressKey');
        const a = btn.dataset.a as Action;
        inp.captureNext((c) => {
          if (!c) return apply(inp.bindings);
          apply(c.device === 'keys' ? assign(inp.bindings, 'keys', a, c.code) : assign(inp.bindings, 'pad', a, c.button));
        });
      }),
    );
    this.on('[data-clear]', (el) => apply(clearAction(inp.bindings, el.dataset.clear as 'keys' | 'pad', el.dataset.a as Action)));
    this.root.querySelectorAll<HTMLElement>('[data-seg] button').forEach((btn) =>
      btn.addEventListener('click', () => {
        const k = (btn.parentElement as HTMLElement).dataset.seg;
        const v = btn.dataset.v!;
        if (k === 'padDrive') apply({ ...cloneBindings(inp.bindings), padDrive: v === 'split' ? 'split' : 'left' });
        else {
          this.settings.touch = v as Settings['touch'];
          this.onSettings(this.settings);
          btn.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
        }
      }),
    );
    this.on('[data-tog="invert"]', () => apply({ ...cloneBindings(inp.bindings), invertForward: !inp.bindings.invertForward }));
    this.on('[data-act="back"]', () => {
      inp.cancelCapture();
      onBack();
    });
    this.on('[data-act="defaults"]', () => {
      inp.cancelCapture();
      apply(cloneBindings(DEFAULT_BINDINGS));
    });
  }

  // ------------------------------------------------------------------ reglas
  /** Resumen de `config/game.ts` con la sección del manual de cada número. */
  rulesPanel(): void {
    const g = GAME;
    const p = g.points;
    const row = (label: string, value: string | number, sec: string) => `<tr><td>${label}</td><td>${value}</td><td>${sec}</td></tr>`;
    const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.open(
      `${brandbar(t('rules'))}
      <h1>${t('rules')}</h1>
      <p class="sub">${t('rulesNote')}</p>
      <div class="panels rules">
        <div class="panel"><h3>${t('rulesTimes')}</h3><table>
          ${row(t('ruleAuto'), mmss(g.times.auto), '§2 · §4.2')}
          ${row(t('ruleTeleop'), mmss(g.times.teleop), '§2 · §4.3')}
          ${row(t('ruleEndgame'), mmss(g.times.endgame), '§4.3.1')}
        </table></div>
        <div class="panel"><h3>${t('rulesPoints')}</h3><table>
          ${row(t('autoLine'), `${p.autoLine} c/robot`, '§4.4')}
          ${row(t('ruleSampleAuto'), `${p.sampleAuto[1]} / ${p.sampleAuto[2]} / ${p.sampleAuto[3]}`, '§4.4')}
          ${row(t('ruleSampleTeleop'), `${p.sampleTeleop[1]} / ${p.sampleTeleop[2]} / ${p.sampleTeleop[3]}`, '§4.4')}
          ${row(t('rulePlatform'), `${p.platformOne} / ${p.platformTwo}`, '§4.4')}
          ${row(t('criticalSample'), p.critical, '§4.4')}
        </table></div>
        <div class="panel"><h3>${t('rulesFouls')}</h3><table>
          ${row(t('ruleFoul'), g.fouls.foul, '§4.5')}
          ${row(t('ruleTech'), g.fouls.tech, '§4.6')}
          ${row(t('ruleCards'), '', '§4.3.3')}
        </table></div>
        <div class="panel"><h3>${t('rulesRp')}</h3><table>
          ${row(t('ruleRpWin'), `${g.rp.win} / ${g.rp.tie}`, '§4.4')}
          ${row(t('ruleRpLine'), g.rp.autoLine, '§4.4')}
          ${row(t('criticalSample'), g.rp.critical, '§4.4')}
          ${row(t('ruleRpDom', { n: g.rp.dominanceSamples }), g.rp.dominance, '§4.4')}
        </table></div>
      </div>
      <div class="actionbar">${backBtn('data-act="back"')}</div>`,
      'screen solid',
    );
    this.on('[data-act="back"]', () => this.main());
  }

  // ------------------------------------------------------------------ pausa
  pause(p: PauseInfo): void {
    const b = this.input.bindings;
    const m = p.match;
    const key = (a: Action) => (b.keys[a].length ? `<kbd>${keyLabel(b.keys[a][0])}</kbd>` : '');
    const keyRows: Action[] = ['forward', 'back', 'left', 'right', 'slow', 'intake', 'releaseSample', 'elevatorUp', 'elevatorDown', 'camera'];
    this.open(
      `<div class="pause">
        <div class="ps-main">
          <div class="kicker"><span></span>${t(m ? 'pauseKick' : 'pauseKickPractice')}</div>
          <h2>${t('paused')}</h2>
          ${
            m
              ? `<div class="ps-score"><div class="blue"><span>${t('blue')}</span><b>${m.score('blue')}</b></div>
                 <div class="mid"><b>${p.timer}</b><span>${p.phase}</span></div>
                 <div class="red"><b>${m.score('red')}</b><span>${t('red')}</span></div></div>`
              : ''
          }
          <div class="ps-menu">
            <button class="primary" data-act="resume">${ic.play}<span>${t('resume')}</span>${key('pause')}</button>
            ${p.onRestart ? `<button data-act="restart">${ic.reset}<span>${t('restart')}</span></button>` : ''}
            <button data-act="controls">${ic.gamepad}<span>${t('controlsTitle')}</span></button>
            <button class="quit" data-act="menu">${ic.home}<span>${p.menuLabel ?? t('backToMenu')}</span></button>
          </div>
        </div>
        <div class="ps-side">
          <h3>${t('camerasTitle')}</h3>
          <div class="ps-cams">${CAMERA_MODES.map((c) => `<button class="chipbtn ${c === p.camera ? 'on' : ''}" data-cam="${c}">${t(`cam_${c}` as Key)}</button>`).join('')}</div>
          <h3 class="ps-keys-title">${t('keysTitle')}</h3>
          <div class="ps-keys">${keyRows.map((a) => `<div>${t(`act_${a}` as Key)}<span class="k">${kbds(b.keys[a].map(keyLabel))}</span></div>`).join('')}</div>
          <h3 class="ps-keys-title">${t('padTitle')}</h3>
          <div class="ps-pad">${padHelp(b)}<br>${t('padMenus')}</div>
        </div>
      </div>`,
      'overlay',
    );
    this.on('[data-cam]', (el) => {
      p.setCamera(el.dataset.cam as CameraMode);
      p.camera = el.dataset.cam as CameraMode;
      this.root.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === el));
    });
    this.on('[data-act="controls"]', () => this.controlsPanel(() => this.pause(p)));
    this.on('[data-act="resume"]', p.onResume);
    if (p.onRestart) this.on('[data-act="restart"]', p.onRestart);
    this.on('[data-act="menu"]', p.onMenu);
    (this.root.querySelector('[data-act="resume"]') as HTMLElement).focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ resultados
  /**
   * `note`: aviso arriba de las acciones (p. ej. que el match se guardó en el scouting). `cont`: match
   * del torneo, sin "Jugar de nuevo" (el resultado ya cuenta) y el botón principal es este.
   */
  results(m: Match, onRestart: () => void, onMenu: () => void, onDownload: () => void, player: number, note = '', cont?: string): void {
    const b = { red: m.breakdown('red'), blue: m.breakdown('blue') };
    const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') };
    const winner: Alliance | null = b.red.total === b.blue.total ? null : b.red.total > b.blue.total ? 'red' : 'blue';
    const mine: Alliance | null = player < 0 ? null : player < 2 ? 'red' : 'blue';
    // Gráfica de barras encontradas: cada categoría compara Azul (izquierda) contra Rojo (derecha),
    // a escala de la categoría; el número de cada barra va siempre escrito.
    const bar = (label: string, v: Record<Alliance, number>, cls = '') => {
      const max = Math.max(v.blue, v.red, 1);
      const side = (a: Alliance) =>
        `<span class="bc-val ${a}">${v[a]}</span><span class="bc-track ${a}"><i style="width:${((v[a] / max) * 100).toFixed(1)}%"></i></span>`;
      return `<div class="bc-row ${cls}" title="${label}: ${t('blue')} ${v.blue} · ${t('red')} ${v.red}"><span class="bc-lbl">${label}</span>${side('blue')}${side('red')}</div>`;
    };
    const cat = (k: keyof (typeof b)['red']) => ({ blue: Number(b.blue[k]), red: Number(b.red[k]) });
    const rpMax = GAME.rp.win + GAME.rp.autoLine + GAME.rp.critical + GAME.rp.dominance;
    const chip = (on: boolean, label: string) => `<span class="rpchip ${on ? 'on' : ''}">${label}</span>`;
    const rpCell = (a: Alliance) =>
      `<div class="rpcard ${a}"><div class="rptotal"><b>${rp[a].total}</b> / ${rpMax} RP</div>` +
      `<div class="rpmeter">${Array.from({ length: rpMax }, (_, i) => `<i class="${i < rp[a].total ? 'on' : ''}"></i>`).join('')}</div>` +
      `<div class="rprow">${chip(rp[a].win > 0, `${t('rpWin')} +${rp[a].win}`)}${chip(rp[a].autoLine, t('rpAuto'))}${chip(rp[a].critical, t('rpCritical'))}${chip(rp[a].dominance, `${t('dominance')} ${m.samplesIn(a)}/${GAME.rp.dominanceSamples}`)}</div></div>`;
    const fouls = m.fouls.length
      ? m.fouls
          .map(
            (f) =>
              `<li><span class="tag ${f.offender}">${t(f.offender).toUpperCase()} ${f.robot % 2 + 1}</span>${f.kind === 'TECH' ? 'Tech Foul' : 'Foul'} · ${RULES[f.rule].es}<em>${RULES[f.rule].section} · ${Math.max(0, Math.floor(f.time))} s</em></li>`,
          )
          .join('')
      : `<li class="none">${t('noFouls')}</li>`;
    this.open(
      `<div class="dialog results">
        <div class="kicker"><span></span>${t('resultsKick')}${player >= 0 ? ` · ${t('yourRobot')}: ${stationLabel(player)}` : ''}</div>
        <h2 class="${winner ?? ''}">${winner ? `${t('winner')} ${t(winner)}` : t('tie')}</h2>
        <div class="final">
          <div class="blue ${winner === 'blue' ? 'win' : ''}"><small>${t('blue')}${mine === 'blue' ? ` · ${t('you')}` : ''}</small>${b.blue.total}</div>
          <div class="dash">–</div>
          <div class="red ${winner === 'red' ? 'win' : ''}"><small>${t('red')}${mine === 'red' ? ` · ${t('you')}` : ''}</small>${b.red.total}</div>
        </div>
        <h3>${t('breakdown')}</h3>
        <div class="bchart">
          <div class="bc-head"><span class="blue">${t('blue')}</span><span class="red">${t('red')}</span></div>
          ${bar(t('autoPoints'), cat('auto'))}
          ${bar(t('samplesTeleop'), cat('samplesTeleop'))}
          ${bar(t('platform'), cat('platform'))}
          ${bar(t('criticalSample'), cat('critical'))}
          ${bar(t('penalties'), cat('penalties'))}
          ${bar(t('total'), cat('total'), 'tot')}
          ${ALLIANCES.some((a) => b[a].redCard) ? `<div class="bc-card">${UI_ALLIANCES.map((a) => `<span class="${a}">${b[a].redCard ? `✕ ${t('redCard')} (${b[a].subtotal} → 0)` : ''}</span>`).join('')}</div>` : ''}
        </div>
        <h3>${t('rp')}</h3>
        <div class="rpgrid">${UI_ALLIANCES.map(rpCell).join('')}</div>
        <h3>${t('fouls')}</h3><ul class="fouls">${fouls}</ul>
        ${note ? `<div class="msg ok">${ic.check}${note}</div>` : ''}
        <div class="actions">
          ${cont ? `<button class="btn primary" data-act="menu">${ic.go}<span>${cont}</span></button>` : `<button class="btn primary" data-act="restart">${ic.reset}<span>${t('playAgain')}</span></button>
          <button class="btn" data-act="menu">${ic.home}<span>${t('backToMenu')}</span></button>`}
          <button class="btn" data-act="log">${ic.download}<span>${t('downloadLog')}</span></button>
        </div>
      </div>`,
      'overlay',
    );
    this.on('[data-act="restart"]', onRestart);
    this.on('[data-act="menu"]', onMenu);
    this.on('[data-act="log"]', onDownload);
  }
}
