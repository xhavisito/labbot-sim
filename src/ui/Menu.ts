/** Menú principal, ajustes, pausa y resultados (DOM). */
import { AUTO_ROUTINES } from '../auto/AutoRoutine';
import { MECHANISM_KINDS } from '../config/robot';
import { DEFAULT_SETTINGS, SETTINGS_RANGE, type Settings } from '../config/settings';
import { RULES } from '../core/fouls';
import { ACTIONS, assign, clearAction, cloneBindings, DEFAULT_BINDINGS, keyLabel, padLabel, saveBindings, type Action } from '../input/bindings';
import type { InputManager } from '../input/InputManager';
import { keyboardHelp, padHelp } from './controlsHelp';
import type { Match } from '../core/match';
import { ALLIANCES, type Alliance } from '../core/types';
import { getLang, setLang, t, type Key } from './i18n';

export interface MenuChoice {
  mode: 'match' | 'practice';
  player: number;
}

/** Qué ve la cámara de fondo: la cancha girando o el robot elegido de cerca. */
export interface MenuHooks {
  view(v: 'orbit' | 'robot'): void;
  /** Reconstruye la cancha de fondo con el robot elegido (sin empezar match). */
  preview(player: number): void;
}

const ICON = (inner: string) => `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect x="12" y="30" width="40" height="22" rx="3" fill="#c0262d" stroke="#fff" stroke-width="2"/>${inner}</svg>`;
const ROBOT_ICON: Record<string, string> = {
  generic: ICON('<rect x="18" y="14" width="28" height="16" rx="2" fill="#9aa1ad"/><rect x="8" y="48" width="48" height="5" rx="2" fill="#f2b632"/>'),
  elevator: ICON('<rect x="28" y="6" width="8" height="26" fill="#9aa1ad"/><rect x="22" y="10" width="20" height="6" fill="#f2b632"/>'),
  pivot: ICON('<path d="M32 34 L48 12" stroke="#9aa1ad" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="34" r="5" fill="#f2b632"/><path d="M44 8 l10 6" stroke="#f2b632" stroke-width="4"/>'),
};

export class Menu {
  readonly root: HTMLElement;
  player = 0;

  constructor(
    host: HTMLElement,
    private onStart: (c: MenuChoice) => void,
    private settings: Settings,
    private onSettings: (s: Settings) => void,
    private input: InputManager,
    private hooks: MenuHooks = { view: () => undefined, preview: () => undefined },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    host.appendChild(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  private view(v: 'orbit' | 'robot'): void {
    this.hooks.view(v);
  }

  /** Pantalla completa sobre la escena (sin panel central): menús estilo videojuego. */
  private openFull(html: string): void {
    this.root.className = 'overlay mo';
    this.root.innerHTML = `<div class="mo-overlay">${html}</div>`;
    this.root.style.display = '';
  }

  private open(html: string): void {
    this.root.className = 'overlay';
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    this.root.style.display = '';
  }

  /** Menú raíz: la cancha gira de fondo y las opciones van abajo a la izquierda. */
  main(): void {
    this.view('orbit');
    this.openFull(`
      <div class="mo-title"><h1>${t('title')}</h1><p>${t('subtitle')}</p></div>
      <nav class="mo-menu">
        <button data-act="play">${t('play')}</button>
        <button data-act="settings">${t('settings')}</button>
        <button data-act="lang">${t('language')}</button>
      </nav>`);
    this.on('play', () => this.playMenu());
    this.on('settings', () => this.settingsPanel());
    this.on('lang', () => {
      setLang(getLang() === 'es' ? 'en' : 'es');
      location.reload();
    });
  }

  /** Jugar: "Play" tenue de título y las dos formas de entrar. */
  playMenu(): void {
    this.view('orbit');
    this.openFull(`
      <div class="mo-title"><h1>${t('title')}</h1><p>${t('subtitle')}</p></div>
      <nav class="mo-menu">
        <span class="head">${t('play')}</span>
        <button data-act="single">${t('singleplayer')}</button>
        <button data-act="split">${t('splitscreen')}</button>
        <button data-act="back">${t('goBack')}</button>
      </nav>`);
    this.on('single', () => {
      this.hooks.preview(this.player);
      this.robotSelect(false);
    });
    this.on('split', () => {
      this.hooks.preview(this.player);
      this.robotSelect(true);
    });
    this.on('back', () => this.main());
  }

  private on(act: string, fn: () => void): void {
    this.root.querySelector(`[data-act="${act}"]`)!.addEventListener('click', fn);
  }

  /** Lista desplegable con el estilo del menú. */
  private select(k: string, opts: Array<[string, string]>, cur: string): string {
    return `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }

  /** Fila de ajuste: etiqueta a la izquierda y control a la derecha. `stub` = control visual sin efecto. */
  private row(label: string, control: string, stub = false): string {
    return `<div class="mo-row ${stub ? 'stub' : ''}" ${stub ? `title="${t('noEffect')}"` : ''}><span>${label}</span>${control}</div>`;
  }

  private slider(k: string, min: number, max: number, step: number, v: number, stub = false): string {
    return `<span class="mo-slide"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}" ${stub ? 'data-stub="1"' : ''}><output>${v}</output></span>`;
  }

  /** Muestra el valor de cada slider al moverlo. */
  private wireSliders(onInput?: (k: string, v: number) => void): void {
    this.root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) =>
      el.addEventListener('input', () => {
        const out = el.nextElementSibling;
        if (out instanceof HTMLOutputElement) out.textContent = el.value;
        onInput?.(el.dataset.k!, Number(el.value));
      }),
    );
  }

  private splitP2 = 0;
  private splitSlot2 = 2;
  private activePlayer: 1 | 2 = 1;
  private mode: MenuChoice['mode'] = 'match';

  /**
   * Selección de robot (un jugador o pantalla dividida): Match Settings, lista de robots y Empezar.
   * Rumble Strength, Outpost Range, Spawnpoint, Device y el Jugador 2 son controles visuales sin efecto.
   */
  robotSelect(split: boolean): void {
    this.view('robot');
    const s = this.settings;
    const slotLabel = (i: number) => `${t(i < 2 ? 'red' : 'blue')} ${(i % 2) + 1}`;
    const slotOpts = [0, 1, 2, 3].map((i) => [String(i), slotLabel(i)] as [string, string]);
    const camOpts: Array<[string, string]> = [
      ['follow', t('camThird')],
      ['driver', t('camDriver')],
      ['top', t('cam_top')],
      ['free', t('cam_free')],
    ];
    const deviceOpts: Array<[string, string]> = [['keyboard', t('keyboard')], ['gamepad', t('gamepad')]];
    const modeOpts: Array<[string, string]> = [['match', t('match')], ['practice', t('practice')]];
    const types = MECHANISM_KINDS.map((k) => {
      const sel = split && this.activePlayer === 2 ? this.splitP2 === MECHANISM_KINDS.indexOf(k) : k === s.robotType;
      return `<button class="card ${sel ? 'sel' : ''}" data-type="${k}">${ROBOT_ICON[k]}<span>${t(`type_${k}` as Key)}</span></button>`;
    }).join('');
    const common = `
      ${this.row(t('camera'), this.select('camera', camOpts, s.camera))}
      ${split ? this.row(t('device'), this.select('device', deviceOpts, 'keyboard'), true) : ''}
      ${this.row(t('spawnpoint'), `<button class="mo-btn" data-stub="1">${t('customize')}</button>`, true)}
      ${this.row(t('rumble'), this.slider('rumble', 0, 100, 1, 60, true).replace(/<output>.*<\/output>/, ''), true)}
      ${this.row(t('outpostRange'), this.slider('outpost', 0.5, 3, 0.1, 1, true), true)}`;
    const right = split
      ? `<aside class="mo-panel top"><h2>${t('matchSettings')}</h2>${common}</aside>`
      : `<aside class="mo-panel full"><h2>${t('matchSettings')}</h2>
          ${this.row(t('mode'), this.select('mode', modeOpts, this.mode))}
          ${this.row(t('alliance'), this.select('slot', slotOpts, String(this.player)))}
          ${common}
          <button class="mo-start" data-act="start">${t('start')}</button></aside>`;
    const bottomRight = split
      ? `<aside class="mo-panel bottom"><h2>${t('matchSettings')}<span class="tri">▾</span></h2>
          ${this.row(t('player1'), this.select('slot', slotOpts, String(this.player)))}
          ${this.row(t('player2'), this.select('slot2', slotOpts, String(this.splitSlot2)), true)}
          <p class="mo-note">${t('splitNote')}</p>
          <button class="mo-start" data-act="start">${t('start')}</button></aside>`
      : '';
    this.openFull(`
      <button class="mo-back" data-act="back"><span>←</span> ${t('goBack')}</button>
      ${right}
      <section class="mo-robots">
        <header><h2>${t('robotsTitle')}</h2>
          ${split ? `<span class="p-toggle"><b>P1</b><button class="tog ${this.activePlayer === 2 ? 'on' : ''}" data-act="toggle" aria-label="P1/P2"><i></i></button><b>P2</b></span>` : ''}
          <select class="set" data-k="set"><option>${t('robotSet')}</option></select>
          <button class="mo-btn" data-act="tips">${t('tips')}</button></header>
        <div class="cards">${types}</div>
        <p class="mo-desc">${t(`type_${s.robotType}_desc` as Key)}</p>
      </section>
      ${bottomRight}`);
    this.root.querySelector('.mo-overlay')?.classList.toggle('split', split);
    this.wireSliders();
    this.root.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.type as Settings['robotType'];
        if (split && this.activePlayer === 2) this.splitP2 = MECHANISM_KINDS.indexOf(kind);
        else {
          s.robotType = kind;
          this.onSettings(s);
          this.hooks.preview(this.player);
        }
        this.robotSelect(split);
      }),
    );
    this.root.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((el) =>
      el.addEventListener('change', () => {
        if (el.dataset.k === 'camera') {
          s.camera = el.value as Settings['camera'];
          this.onSettings(s);
        } else if (el.dataset.k === 'slot') {
          this.player = Number(el.value);
          this.hooks.preview(this.player);
        } else if (el.dataset.k === 'mode') this.mode = el.value as MenuChoice['mode'];
        else if (el.dataset.k === 'slot2') this.splitSlot2 = Number(el.value);
      }),
    );
    this.root.querySelector('[data-act="toggle"]')?.addEventListener('click', () => {
      this.activePlayer = this.activePlayer === 1 ? 2 : 1;
      this.robotSelect(split);
    });
    this.root.querySelector('[data-act="tips"]')!.addEventListener('click', () => this.tips(() => this.robotSelect(split)));
    this.on('back', () => this.playMenu());
    this.on('start', () => this.onStart({ mode: split ? 'match' : this.mode, player: this.player }));
  }

  /** Consejos: qué hace el robot elegido y los controles actuales. */
  private tips(onBack: () => void): void {
    this.open(`
      <h2>${t('tips')}: ${t(`type_${this.settings.robotType}` as Key)}</h2>
      <p class="help">${t(`type_${this.settings.robotType}_desc` as Key)}</p>
      <p class="help">${keyboardHelp(this.input.bindings)}</p>
      <p class="help">${padHelp(this.input.bindings)}</p>
      <div class="row"><button class="primary" data-act="back">${t('back')}</button></div>`);
    this.on('back', onBack);
  }

  private tab: 'gfx' | 'audio' | 'keybinds' | 'misc' = 'gfx';

  /** Ajustes con pestañas: Gráficos, Audio, Teclas y Varios (lo que ya existía). */
  settingsPanel(onBack: () => void = () => this.main()): void {
    this.view('orbit');
    const s = this.settings;
    const tabs = (['gfx', 'audio', 'keybinds', 'misc'] as const).map((k) => `<button class="mo-tab ${k === this.tab ? 'on' : ''}" data-tab="${k}">${t(k)}</button>`).join('');
    let body = '';
    if (this.tab === 'gfx') {
      const fpsOpts: Array<[string, string]> = [['0', t('vsync')], ['30', '30'], ['60', '60'], ['120', '120']];
      body = `<h2>${t('display')}</h2><div class="mo-grid">
        <div>
          ${this.row(t('windowMode'), this.select('winMode', [['full', t('fullscreen')], ['win', t('windowed')]], document.fullscreenElement ? 'full' : 'win'))}
          ${this.row(t('resolution'), this.select('res', [['auto', t('resAuto')]], 'auto'), true)}
          ${this.row(t('fov'), this.slider('fov', SETTINGS_RANGE.fov.min, SETTINGS_RANGE.fov.max, 1, s.fov))}
        </div><div>
          ${this.row(t('preset'), this.select('preset', [['high', t('presetHigh')], ['med', t('presetMed')], ['low', t('presetLow')]], 'high'), true)}
          ${this.row(t('fpsLimit'), this.select('fpsLimit', fpsOpts, String(s.fpsLimit)))}
        </div></div>`;
    } else if (this.tab === 'audio') {
      body = `<h2>${t('audio')}</h2><div class="mo-grid"><div>
          ${this.row(t('volMaster'), this.slider('v1', 0, 100, 1, 80, true), true)}
          ${this.row(t('volFx'), this.slider('v2', 0, 100, 1, 80, true), true)}
          ${this.row(t('volMusic'), this.slider('v3', 0, 100, 1, 50, true), true)}
        </div></div>`;
    } else if (this.tab === 'keybinds') {
      body = this.controlsHtml();
    } else {
      body = `<h2>${t('gameTitle')}</h2>${this.gameForm()}<p class="help">${t('settingsNote')}</p>`;
    }
    this.openFull(`
      <div class="mo-set">
        <div class="mo-tabs"><button class="mo-back inline" data-act="back"><span>←</span> ${t('goBack')}</button>${tabs}</div>
        <div class="mo-body">${body}<button class="mo-start reset" data-act="reset">${t('reset')} ↺</button></div>
      </div>`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.input.cancelCapture();
        this.tab = b.dataset.tab as typeof this.tab;
        this.settingsPanel(onBack);
      }),
    );
    this.on('back', () => {
      this.input.cancelCapture();
      onBack();
    });
    this.wireSliders((k, v) => {
      if (k === 'fov') {
        s.fov = v;
        this.onSettings(s);
      }
    });
    this.root.querySelector<HTMLSelectElement>('[data-k="winMode"]')?.addEventListener('change', (e) => {
      const full = (e.target as HTMLSelectElement).value === 'full';
      if (full && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (!full && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    });
    this.root.querySelector<HTMLSelectElement>('[data-k="fpsLimit"]')?.addEventListener('change', (e) => {
      s.fpsLimit = Number((e.target as HTMLSelectElement).value) as Settings['fpsLimit'];
      this.onSettings(s);
    });
    if (this.tab === 'keybinds') this.wireControls(() => this.settingsPanel(onBack));
    if (this.tab === 'misc') this.wireGameForm(() => this.settingsPanel(onBack));
    this.on('reset', () => {
      if (this.tab === 'gfx') Object.assign(s, { fov: DEFAULT_SETTINGS.fov, fpsLimit: DEFAULT_SETTINGS.fpsLimit });
      else if (this.tab === 'keybinds') {
        this.input.cancelCapture();
        this.input.bindings = cloneBindings(DEFAULT_BINDINGS);
        saveBindings(this.input.bindings);
        s.touch = DEFAULT_SETTINGS.touch;
      } else if (this.tab === 'misc') {
        const keep = { fov: s.fov, fpsLimit: s.fpsLimit, camera: s.camera, touch: s.touch, robotType: s.robotType };
        Object.assign(s, DEFAULT_SETTINGS, keep);
      }
      this.onSettings(s);
      this.settingsPanel(onBack);
    });
  }

  /** Formulario de juego (IA, AUTO, velocidad, Human Player): se guarda al instante. */
  private gameForm(): string {
    const s = this.settings;
    const autoOpts = (sel: string) => AUTO_ROUTINES.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${t(`auto_${r.id}` as Key)}</option>`).join('');
    const range = (k: keyof typeof SETTINGS_RANGE, unit: string) => {
      const r = SETTINGS_RANGE[k];
      return `<input type="range" data-g="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[k]}"><output data-unit="${unit}">${s[k]} ${unit}</output>`;
    };
    return `<div class="form">
        <label><input type="checkbox" data-g="ai" ${s.ai ? 'checked' : ''}> ${t('setAi')}</label>
        <label>${t('setPlayerAuto')} <select data-g="playerAuto">${autoOpts(s.playerAuto)}</select></label>
        <label>${t('setBotAuto')} <select data-g="botAuto">${autoOpts(s.botAuto)}</select></label>
        <label>${t('setBotType')} <select data-g="botRobotType">${MECHANISM_KINDS.map((k) => `<option value="${k}" ${k === s.botRobotType ? 'selected' : ''}>${t(`type_${k}` as Key)}</option>`).join('')}</select></label>
        <label>${t('setSpeed')} ${range('maxSpeed', 'm/s')}</label>
        <label>${t('setCapacity')} ${range('capacity', '')}</label>
        <label><input type="checkbox" data-g="hpEnabled" ${s.hpEnabled ? 'checked' : ''}> ${t('setHp')}</label>
        <label>${t('setHpInterval')} ${range('hpInterval', 's')}</label>
      </div>`;
  }

  private wireGameForm(_rerender: () => void): void {
    const s = this.settings;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-g]').forEach((el) => {
      const k = el.dataset.g as keyof Settings;
      el.addEventListener('input', () => {
        const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
        (s as unknown as Record<string, unknown>)[k] = v;
        const out = el.nextElementSibling;
        if (out instanceof HTMLOutputElement) out.textContent = `${v} ${out.dataset.unit ?? ''}`;
        this.onSettings(s);
      });
    });
  }

  /**
   * Controles: reasignar cada acción en teclado y control (toca la casilla y presiona), manejo con
   * el control y controles touch. Se guarda al momento.
   */
  controlsPanel(onBack: () => void): void {
    this.view('orbit');
    this.open(`
      <h2>${t('controlsTitle')}</h2>
      ${this.controlsHtml()}
      <div class="row">
        <button class="primary" data-act="back">${t('back')}</button>
        <button data-act="defaults">${t('defaults')}</button>
      </div>`);
    this.wireControls(() => this.controlsPanel(onBack));
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      this.input.cancelCapture();
      onBack();
    });
    this.root.querySelector('[data-act="defaults"]')!.addEventListener('click', () => {
      this.input.cancelCapture();
      this.input.bindings = cloneBindings(DEFAULT_BINDINGS);
      saveBindings(this.input.bindings);
      this.controlsPanel(onBack);
    });
  }

  /** Tabla de asignación de teclas y control, y opciones de manejo. */
  private controlsHtml(): string {
    const b = this.input.bindings;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    const cell = (dev: 'keys' | 'pad', a: Action) => {
      const list = dev === 'keys' ? b.keys[a].map(keyLabel) : b.pad[a].map(padLabel);
      return `<td><button class="bind" data-dev="${dev}" data-a="${a}">${list.map((x) => `<span class="chip">${x}</span>`).join('') || '–'}</button></td>
        <td><button class="x" title="${t('clear')}" data-clear="${dev}" data-a="${a}">×</button></td>`;
    };
    const opt = (v: string, cur: string, label: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    return `
      <p class="help">${t('controlsNote')}</p>
      <p class="help">${pad ? t('padConnected', { name: pad.id.split('(')[0].trim() }) : t('padNone')}</p>
      <table class="binds">
        <tr><th></th><th>${t('keyboard')}</th><th></th><th>${t('gamepad')}</th><th></th></tr>
        ${ACTIONS.map((a) => `<tr><th>${t(`act_${a}` as Key)}</th>${cell('keys', a)}${cell('pad', a)}</tr>`).join('')}
      </table>
      <div class="form">
        <label>${t('padDriveLabel')} <select data-k="padDrive">${opt('left', b.padDrive, t('padDriveLeft'))}${opt('split', b.padDrive, t('padDriveSplit'))}</select></label>
        <label><input type="checkbox" data-k="invert" ${b.invertForward ? 'checked' : ''}> ${t('invertForward')}</label>
        <label>${t('touchControls')} <select data-k="touch">${opt('auto', this.settings.touch, t('touchAuto'))}${opt('on', this.settings.touch, t('touchOn'))}${opt('off', this.settings.touch, t('touchOff'))}</select></label>
      </div>`;
  }

  private wireControls(rerender: () => void): void {
    const inp = this.input;
    const apply = (nb: typeof inp.bindings) => {
      inp.bindings = nb;
      saveBindings(nb);
      rerender();
    };
    this.root.querySelectorAll<HTMLButtonElement>('.bind').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.root.querySelectorAll('.bind.wait').forEach((x) => x.classList.remove('wait'));
        btn.classList.add('wait');
        btn.textContent = t('pressKey');
        const a = btn.dataset.a as Action;
        inp.captureNext((c) => {
          if (!c) return rerender();
          apply(c.device === 'keys' ? assign(inp.bindings, 'keys', a, c.code) : assign(inp.bindings, 'pad', a, c.button));
        });
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach((btn) =>
      btn.addEventListener('click', () => apply(clearAction(inp.bindings, btn.dataset.clear as 'keys' | 'pad', btn.dataset.a as Action))),
    );
    this.root.querySelector<HTMLSelectElement>('[data-k="padDrive"]')!.addEventListener('change', (e) =>
      apply({ ...cloneBindings(inp.bindings), padDrive: (e.target as HTMLSelectElement).value === 'split' ? 'split' : 'left' }),
    );
    this.root.querySelector<HTMLInputElement>('[data-k="invert"]')!.addEventListener('change', (e) =>
      apply({ ...cloneBindings(inp.bindings), invertForward: (e.target as HTMLInputElement).checked }),
    );
    this.root.querySelector<HTMLSelectElement>('[data-k="touch"]')!.addEventListener('change', (e) => {
      this.settings.touch = (e.target as HTMLSelectElement).value as Settings['touch'];
      this.onSettings(this.settings);
    });
  }

  pause(onResume: () => void, onRestart: () => void, onMenu: () => void): void {
    this.open(`
      <h2>${t('paused')}</h2>
      <div class="col">
        <button class="primary" data-act="resume">${t('resume')}</button>
        <button data-act="restart">${t('restart')}</button>
        <button data-act="controls">${t('controlsTitle')}</button>
        <button data-act="menu">${t('backToMenu')}</button>
      </div>
      <p class="help">${keyboardHelp(this.input.bindings)}</p>
      <p class="help">${padHelp(this.input.bindings)}</p>`);
    this.root.querySelector('[data-act="controls"]')!.addEventListener('click', () => this.controlsPanel(() => this.pause(onResume, onRestart, onMenu)));
    this.root.querySelector('[data-act="resume"]')!.addEventListener('click', onResume);
    this.root.querySelector('[data-act="restart"]')!.addEventListener('click', onRestart);
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu);
  }

  results(m: Match, onRestart: () => void, onMenu: () => void, onDownload: () => void): void {
    const b = { red: m.breakdown('red'), blue: m.breakdown('blue') };
    const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') };
    const row = (label: string, f: (a: Alliance) => string | number) => `<tr><th>${label}</th>${ALLIANCES.map((a) => `<td class="${a}">${f(a)}</td>`).join('')}</tr>`;
    const yes = (v: boolean) => (v ? '✓' : '–');
    const winner = b.red.total === b.blue.total ? t('tie') : `${t('winner')}: ${t(b.red.total > b.blue.total ? 'red' : 'blue')}`;
    const fouls = m.fouls.length
      ? m.fouls
          .map((f) => `<li>${Math.max(0, Math.floor(f.time))} s · ${f.kind === 'TECH' ? 'Tech Foul' : 'Foul'} · ${t(f.offender)} ${f.robot + 1}: ${RULES[f.rule].es} (${RULES[f.rule].section})</li>`)
          .join('')
      : `<li>${t('noFouls')}</li>`;
    this.open(`
      <h2>${t('results')} · ${winner}</h2>
      <table class="results">
        <tr><th></th><th class="red">${t('red')}</th><th class="blue">${t('blue')}</th></tr>
        ${row(t('autoLine'), (a) => b[a].autoLine)}
        ${row(t('samplesAuto'), (a) => b[a].samplesAuto)}
        ${row(t('samplesTeleop'), (a) => b[a].samplesTeleop)}
        ${row(t('platform'), (a) => b[a].platform)}
        ${row(t('criticalSample'), (a) => b[a].critical)}
        ${row(t('penalties'), (a) => b[a].penalties)}
        ${ALLIANCES.some((a) => b[a].redCard) ? row(t('redCard'), (a) => yes(b[a].redCard)) : ''}
        ${row(`<b>${t('total')}</b>`, (a) => `<b>${b[a].total}</b>`)}
        <tr><th colspan="3" class="sep">${t('rp')}</th></tr>
        ${row(t('rpWin'), (a) => rp[a].win)}
        ${row(t('rpAuto'), (a) => yes(rp[a].autoLine))}
        ${row(t('rpCritical'), (a) => yes(rp[a].critical))}
        ${row(t('rpDominance'), (a) => `${yes(rp[a].dominance)} (${m.samplesIn(a)})`)}
        ${row(`<b>${t('rp')}</b>`, (a) => `<b>${rp[a].total}</b>`)}
      </table>
      <h3>${t('fouls')}</h3><ul class="fouls">${fouls}</ul>
      <div class="row">
        <button class="primary" data-act="restart">${t('restart')}</button>
        <button data-act="menu">${t('backToMenu')}</button>
        <button data-act="log">${t('downloadLog')}</button>
      </div>`);
    this.root.querySelector('[data-act="restart"]')!.addEventListener('click', onRestart);
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu);
    this.root.querySelector('[data-act="log"]')!.addEventListener('click', onDownload);
  }
}
