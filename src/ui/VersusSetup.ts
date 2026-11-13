/**
 * "2 jugadores": preparación para dos personas en la misma pantalla, en tres pasos:
 * 1. el modo (uno contra otro o mismo equipo; la IA rellena los otros robots),
 * 2. los lugares en la cancha (dónde va el jugador 1; el 2 se acomoda solo, o se intercambian),
 * 3. cada jugador: sus controles (teclado WASD o flechas, 1.º o 2.º control, o touch en su mitad),
 *    con prueba en vivo de las teclas, su robot, su AUTO, su cámara y su posición inicial dentro de
 *    SU Zona de Inicio (§3.2.1, §4.1), con el mapa de `MatchSetup`.
 * SUPUESTO del simulador: el manual no habla de controles ni de equipos de dos personas.
 */
import { ROBOT_IDS, robotSpec, allRobotIds } from '../config/robotIds';
import { customById } from '../config/customRobots';
import { CENTER_SPOT, clampSpot, spotValid, type StartSpot } from '../config/startSpot';
import { VERSUS_CAMERAS, VERSUS_DEVICES, type Settings, type VersusDevice, type VersusSide } from '../config/settings';
import type { Action, Bindings } from '../input/bindings';
import { backBtn, brandbar, ic, robotSilhouette, UI_ALLIANCES } from './chrome';
import { autoOptionsHtml, bindStartMap, fieldMap, optionTag } from './MatchSetup';
import { isTouchDevice } from './TouchControls';
import { t, type Key } from './i18n';
import { allianceOf, DEVICE_LABEL, deviceCodes, deviceHelp, devicesClash, lineup, partnerStation, stationName, swapStations, type VsRole } from './versus';

export { partnerStation } from './versus';

export interface VersusActions {
  back: () => void;
  /** Empieza con lo elegido (ya guardado); `player` = la estación del jugador 1. */
  start: (player: number) => void;
  save: () => void;
  /** Teclas de cada dispositivo de teclado y la asignación (para la ayuda y la prueba en vivo). */
  keys: (dev: VersusDevice) => Partial<Record<Action, string[]>>;
  bindings: () => Bindings;
}

/** Nombre de un robot en los menús (el de los robots propios, si lo es). */
const robotName = (id: string): string => {
  const c = customById(id);
  if (c) return c.name;
  const spec = robotSpec(id as (typeof ROBOT_IDS)[number]);
  return spec.label ?? t(`type_${spec.mechanism}` as Key);
};

const DEV_ICON: Record<VersusDevice, string> = { keys1: ic.keyboard, keys2: ic.keyboard, pad1: ic.gamepad, pad2: ic.gamepad, touch: ic.touch };
const roleTag = (r: VsRole): string => (r === 'ai' ? t('vs_ai') : t(r === 'p1' ? 'vs_p1short' : 'vs_p2short'));

const connectedPads = (): Gamepad[] =>
  typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected) : [];

export class VersusSetup {
  /** Estación del jugador 1 (0–3); la del jugador 2 la da `partnerStation`. */
  private player = 0;
  /** Prueba de controles: el último instante en que cada quien tocó su teclado o su control. */
  private seen = { p1: 0, p2: 0 };
  private live = false;
  private padsKey = '';
  private openStart = { p1: false, p2: false };

  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private act: VersusActions,
  ) {}

  show(player: number): void {
    this.player = player;
    const v = this.settings.versus;
    // En tablet o celular sin teclado, lo natural es el touch (cada quien en su mitad)
    const kb = (d: VersusDevice) => d === 'keys1' || d === 'keys2';
    if (isTouchDevice() && !window.matchMedia?.('(pointer: fine)').matches && kb(v.p1.device) && kb(v.p2.device) && !connectedPads().length) {
      v.p1.device = 'touch';
      v.p2.device = 'touch';
      this.act.save();
    }
    this.render();
    this.root.scrollTop = 0;
    this.startLive();
  }

  private get sides(): { key: 'p1' | 'p2'; side: VersusSide; slot: number }[] {
    const v = this.settings.versus;
    return [
      { key: 'p1', side: v.p1, slot: this.player },
      { key: 'p2', side: v.p2, slot: partnerStation(this.player, v.team) },
    ];
  }

  // ---------------------------------------------------------------- dibujo
  private render(): void {
    const v = this.settings.versus;
    const roles = lineup(this.player, v.team);
    const dup = devicesClash(v.p1.device, v.p2.device);
    const [s1, s2] = this.sides;
    const a1 = allianceOf(s1.slot);
    const a2 = allianceOf(s2.slot);

    // Paso 1: el modo, con un mini acomodo de quién maneja qué
    const mini = (team: 'opp' | 'same') => {
      const r = lineup(this.player, team);
      const side = (a: 'red' | 'blue') =>
        `<span class="vs-mini-all ${a}">${(a === 'blue' ? [2, 3] : [0, 1]).map((i) => `<i class="${r[i]}">${roleTag(r[i])}</i>`).join('')}</span>`;
      return `<span class="vs-mini">${side('blue')}<em>${t('vs_versus')}</em>${side('red')}</span>`;
    };
    const mode = (team: 'opp' | 'same') =>
      `<button class="vs-mode ${v.team === team ? 'on' : ''}" data-team="${team}" aria-pressed="${v.team === team}">
        <span class="vs-mode-top"><span class="vs-mode-ic">${team === 'opp' ? ic.bolt : ic.users}</span><span class="vs-mode-txt"><b>${t(team === 'opp' ? 'vs_opp' : 'vs_same')}</b><small>${t(team === 'opp' ? 'vs_oppDesc' : 'vs_sameDesc')}</small></span><span class="vs-check">${ic.check}</span></span>
        ${mini(team)}
      </button>`;

    // Paso 2: las cuatro estaciones por alianza (azul primero, como en el resto de la UI)
    const slot = (i: number) =>
      `<button class="vs-slot ${allianceOf(i)} ${roles[i]}" data-slot="${i}" aria-label="${stationName(i)}: ${roleTag(roles[i])}">
        <span class="vs-who">${roleTag(roles[i])}</span><span class="vs-st">${stationName(i)}</span>
      </button>`;
    const alliance = (a: 'red' | 'blue') =>
      `<div class="vs-all ${a}"><span class="vs-all-name">${t(a === 'red' ? 'vs_allRed' : 'vs_allBlue')}</span><div class="vs-slots">${(a === 'blue' ? [2, 3] : [0, 1]).map(slot).join('')}</div></div>`;

    const summary =
      v.team === 'opp'
        ? `<span class="vs-sum-p ${a1}"><b>${t('vs_p1short')}</b>${stationName(s1.slot)}</span><em>${t('vs_versus')}</em><span class="vs-sum-p ${a2}"><b>${t('vs_p2short')}</b>${stationName(s2.slot)}</span>`
        : `<span class="vs-sum-p ${a1}"><b>${t('vs_p1short')} + ${t('vs_p2short')}</b>${t(a1 === 'red' ? 'vs_allRed' : 'vs_allBlue')}</span><em>${t('vs_versus')}</em><span class="vs-sum-p ai"><b>${t('vs_ai')}</b>${t(a1 === 'red' ? 'vs_allBlue' : 'vs_allRed')}</span>`;

    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner vs-setup">
      ${brandbar(t('vs_title'))}
      <div class="vs-hero">
        <h1>${t('vs_title')}</h1>
        <p class="sub">${t('vs_setSub')}</p>
      </div>
      <section class="vs-step">
        <div class="vs-step-h"><span class="vs-n">1</span><h2>${t('vs_stepMode')}</h2></div>
        <div class="vs-modes">${mode('opp')}${mode('same')}</div>
      </section>
      <section class="vs-step">
        <div class="vs-step-h"><span class="vs-n">2</span><h2>${t('vs_stepPlaces')}</h2>
          <button class="chipbtn" data-act="swap">${ic.swap}<span>${t('vs_swap')}</span></button></div>
        <div class="vs-field">${alliance(UI_ALLIANCES[0])}<span class="vs-vs">${t('vs_versus')}</span>${alliance(UI_ALLIANCES[1])}</div>
        <p class="ms-note">${t('vs_placesNote')}</p>
      </section>
      <section class="vs-step">
        <div class="vs-step-h"><span class="vs-n">3</span><h2>${t('vs_stepPlayers')}</h2><span class="vs-step-note">${t(this.stacked ? 'vs_screenStacked' : 'vs_screenSide')}</span></div>
        <div class="vs-grid">${this.card('p1', s1.side, s1.slot, dup)}${this.card('p2', s2.side, s2.slot, dup)}</div>
      </section>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="vs-summary">${summary}</div><div class="grow"></div>
        <button class="btn primary" data-act="start" ${dup ? 'disabled' : ''}>${ic.go}<span>${t('vs_go')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.bind();
    this.padsKey = this.padsNow();
  }

  /** En tablet o celular el touch va primero (lo más probable ahí); en la compu, los teclados. */
  private deviceOrder(): readonly VersusDevice[] {
    const touchFirst = isTouchDevice() && !window.matchMedia?.('(pointer: fine)').matches;
    return touchFirst ? ['touch', 'pad1', 'pad2', 'keys1', 'keys2'] : VERSUS_DEVICES;
  }

  /** En vertical la pantalla se parte arriba/abajo; en horizontal, izquierda/derecha. */
  private get stacked(): boolean {
    return typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  }

  /** Tarjeta de un jugador: controles (con prueba en vivo), robot, AUTO, cámara y lugar de inicio. */
  private card(key: 'p1' | 'p2', side: VersusSide, slot: number, dup: boolean): string {
    const a = allianceOf(slot);
    const pads = connectedPads().length;
    const where = t(this.stacked ? (key === 'p1' ? 'vs_halfTop' : 'vs_halfBottom') : key === 'p1' ? 'vs_halfLeft' : 'vs_halfRight');
    const dev = (d: VersusDevice) => {
      const isPad = d === 'pad1' || d === 'pad2';
      const ok = !isPad || pads > (d === 'pad1' ? 0 : 1);
      const taken = devicesClash(d, (key === 'p1' ? this.settings.versus.p2 : this.settings.versus.p1).device);
      const hint = isPad ? t(ok ? 'vs_padOn' : 'vs_padOff') : t(DEVICE_LABEL[d].hint);
      return `<button class="vs-dev ${side.device === d ? 'on' : ''} ${ok ? '' : 'off'} ${taken ? 'taken' : ''}" data-dev="${key}" data-val="${d}" aria-pressed="${side.device === d}">
        ${DEV_ICON[d]}<b>${t(DEVICE_LABEL[d].name)}</b><small>${taken ? t('vs_devTaken') : hint}</small></button>`;
    };
    const help = deviceHelp(side.device, this.act.keys(side.device), this.act.bindings())
      .map((r) => `<span class="vs-key">${r.keys.map((k) => (k.label === '–' ? '<i>–</i>' : `<kbd ${k.code ? `data-code="${k.code}"` : ''}>${k.label}</kbd>`)).join('')}<em>${r.what}</em></span>`)
      .join('');
    const padMissing = (side.device === 'pad1' && pads < 1) || (side.device === 'pad2' && pads < 2);
    const spec = robotSpec(side.robot);
    const ok = spotValid(spec.length, spec.width, side.start);
    const open = this.openStart[key] || !ok;
    return `<article class="vs-card ${a}" data-side="${key}">
      <header class="vs-card-h">
        <span class="vs-badge">${t(key === 'p1' ? 'vs_p1short' : 'vs_p2short')}</span>
        <div class="vs-card-t"><b>${t(key === 'p1' ? 'vs_p1' : 'vs_p2')}</b><small>${stationName(slot)} · ${where}</small></div>
        <span class="vs-live" data-live="${key}">${side.device === 'touch' ? `${ic.touch}<span>${t('vs_liveTouch')}</span>` : `<i></i><span>${t('vs_liveWait')}</span>`}</span>
      </header>
      <div class="vs-sec">
        <span class="vs-lbl">${t('vs_device')}</span>
        <div class="vs-devs">${this.deviceOrder().map(dev).join('')}</div>
        ${dup ? `<div class="msg warn">${ic.x}${t('vs_dupDevice')}</div>` : padMissing ? `<div class="msg">${ic.gamepad}${t('vs_padsNone')}</div>` : ''}
        <div class="vs-keys" data-keys="${key}">${help}</div>
      </div>
      <div class="vs-sec vs-robot">
        <div class="vs-sil">${robotSilhouette(spec.mechanism)}</div>
        <div class="vs-two">
          <label class="ms-f"><span>${t('vs_robot')}</span><select data-robot="${key}">${allRobotIds().map((id) => optionTag(id, robotName(id), side.robot)).join('')}</select></label>
          <label class="ms-f"><span>AUTO</span><select data-auto="${key}">${autoOptionsHtml(side.auto, true)}</select></label>
        </div>
      </div>
      <div class="vs-sec">
        <span class="vs-lbl">${t('vs_camera')}</span>
        <div class="seg vs-cams">${VERSUS_CAMERAS.map((c) => `<button class="${side.camera === c ? 'on' : ''}" data-cam="${key}" data-val="${c}">${t(`vs_cam_${c}` as Key)}</button>`).join('')}</div>
      </div>
      <details class="vs-start" data-start="${key}" ${open ? 'open' : ''}>
        <summary><span class="vs-lbl">${t('vs_side')}</span><span class="vs-start-sum ${ok ? 'ok' : 'bad'}" data-sum="${key}"></span><i class="chev">${ic.go}</i></summary>
        <div class="vs-start-body">
          <div class="ms-map" data-map="${key}"></div>
          <div class="ms-turn"><span>${t('ms_turn')}</span><input type="range" min="-180" max="180" step="5" data-turn="${key}"><output data-turnout="${key}"></output>
            <button class="chipbtn" data-center="${key}">${ic.reset}<span>${t('ms_center')}</span></button></div>
          <div class="msg" data-valid="${key}"></div>
        </div>
      </details>
    </article>`;
  }

  // ---------------------------------------------------------------- eventos
  private bind(): void {
    const v = this.settings.versus;
    const on = (sel: string, fn: (el: HTMLElement) => void) =>
      this.root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => fn(el)));
    const change = () => {
      this.act.save();
      this.render();
    };
    for (const { key, side, slot } of this.sides) this.bindSide(key, side, slot);
    on('[data-team]', (b) => {
      v.team = b.dataset.team === 'same' ? 'same' : 'opp';
      change();
    });
    on('[data-slot]', (b) => {
      this.player = Number(b.dataset.slot);
      change();
    });
    on('[data-act="swap"]', () => {
      this.player = swapStations(this.player, v.team);
      change();
    });
    on('[data-dev]', (b) => {
      const side = b.dataset.dev === 'p2' ? v.p2 : v.p1;
      const other = b.dataset.dev === 'p2' ? v.p1 : v.p2;
      const d = b.dataset.val as VersusDevice;
      // Si el otro ya lo usa, se intercambian (en lugar de dejar los dos con el mismo)
      if (devicesClash(d, other.device)) other.device = side.device;
      side.device = d;
      change();
    });
    on('[data-cam]', (b) => {
      (b.dataset.cam === 'p2' ? v.p2 : v.p1).camera = b.dataset.val as VersusSide['camera'];
      change();
    });
    on('[data-act="back"]', () => this.act.back());
    on('[data-act="start"]', () => {
      if (devicesClash(v.p1.device, v.p2.device)) return;
      this.act.save();
      this.act.start(this.player);
    });
    this.root.querySelectorAll<HTMLDetailsElement>('[data-start]').forEach((d) =>
      d.addEventListener('toggle', () => {
        this.openStart[d.dataset.start as 'p1' | 'p2'] = d.open;
      }),
    );
  }

  private bindSide(key: 'p1' | 'p2', side: VersusSide, slot: number): void {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    const spec = { ...robotSpec(side.robot) };
    const map = q<HTMLElement>(`[data-map="${key}"]`);
    const turn = q<HTMLInputElement>(`[data-turn="${key}"]`);
    const valid = q<HTMLElement>(`[data-valid="${key}"]`);
    const sum = q<HTMLElement>(`[data-sum="${key}"]`);
    const draw = () => {
      map.innerHTML = fieldMap(slot, spec, side.start);
      const deg = Math.round((side.start.turn * 180) / Math.PI);
      turn.value = String(deg);
      q<HTMLOutputElement>(`[data-turnout="${key}"]`).textContent = `${deg}°`;
      const ok = spotValid(spec.length, spec.width, side.start);
      const vars = { f: Math.round(-side.start.dx * 100), r: Math.round(-side.start.dz * 100), d: deg };
      valid.className = `msg ${ok ? 'ok' : ''}`;
      valid.innerHTML = `${ok ? ic.check : ic.x}${t(ok ? 'ms_valid' : 'ms_invalid', vars)}`;
      const centered = Math.abs(side.start.dx) < 0.005 && Math.abs(side.start.dz) < 0.005;
      sum.className = `vs-start-sum ${ok ? 'ok' : 'bad'}`;
      sum.innerHTML = `${ok ? ic.check : ic.x}<span>${ok ? (centered ? t('vs_startCenter', { d: deg }) : t('vs_startMoved', vars)) : t('vs_startBad')}</span>`;
    };
    const set = (s: StartSpot) => {
      side.start = clampSpot(spec.length, spec.width, s);
      draw();
    };
    bindStartMap(map, slot % 2, () => side.start, set, () => this.act.save());
    turn.addEventListener('input', () => set({ ...side.start, turn: (Number(turn.value) * Math.PI) / 180 }));
    turn.addEventListener('change', () => this.act.save());
    q<HTMLElement>(`[data-center="${key}"]`).addEventListener('click', () => {
      set({ ...CENTER_SPOT });
      this.act.save();
    });
    q<HTMLSelectElement>(`[data-robot="${key}"]`).addEventListener('change', (e) => {
      side.robot = (e.target as HTMLSelectElement).value as VersusSide['robot'];
      this.act.save();
      this.render();
    });
    q<HTMLSelectElement>(`[data-auto="${key}"]`).addEventListener('change', (e) => {
      side.auto = (e.target as HTMLSelectElement).value;
      this.act.save();
    });
    draw();
  }

  // ---------------------------------------------------------------- prueba de controles en vivo
  private padsNow(): string {
    return connectedPads()
      .map((p) => p.index)
      .join(',');
  }

  /**
   * Mientras la pantalla está abierta: las teclas de cada quien se iluminan al presionarlas y la
   * tarjeta dice "¡Te vemos!" cuando su teclado o su control responde. Si se conecta o desconecta un
   * control, las tarjetas se vuelven a dibujar. Se apaga sola cuando la pantalla se cierra.
   */
  private startLive(): void {
    if (this.live) return;
    this.live = true;
    const alive = () => !!this.root.querySelector('.vs-setup');
    const v = this.settings.versus;
    const who = (code: string): 'p1' | 'p2' | null => {
      for (const k of ['p1', 'p2'] as const) if (deviceCodes(this.act.keys(v[k].device)).has(code)) return k;
      return null;
    };
    const light = (code: string, down: boolean) => {
      this.root.querySelectorAll<HTMLElement>(`.vs-keys kbd[data-code="${code}"]`).forEach((k) => k.classList.toggle('hit', down));
    };
    const onDown = (e: KeyboardEvent) => {
      if (!alive()) return stop();
      const k = who(e.code);
      if (!k) return;
      light(e.code, true);
      this.seen[k] = performance.now();
    };
    const onUp = (e: KeyboardEvent) => alive() && light(e.code, false);
    const stop = () => {
      this.live = false;
      removeEventListener('keydown', onDown);
      removeEventListener('keyup', onUp);
    };
    addEventListener('keydown', onDown);
    addEventListener('keyup', onUp);
    const tick = () => {
      if (!alive()) return stop();
      const pads = connectedPads();
      if (this.padsNow() !== this.padsKey) {
        // Se conectó o desconectó un control: la tarjeta lo dice (sin perder el scroll)
        const y = this.root.scrollTop;
        this.render();
        this.root.scrollTop = y;
      }
      for (const k of ['p1', 'p2'] as const) {
        const d = v[k].device;
        if (d === 'pad1' || d === 'pad2') {
          const p = pads[d === 'pad1' ? 0 : 1];
          if (p && (p.buttons.some((b) => b.pressed) || p.axes.some((x) => Math.abs(x) > 0.5))) this.seen[k] = performance.now();
        }
        const chip = this.root.querySelector<HTMLElement>(`[data-live="${k}"]`);
        if (!chip || d === 'touch') continue;
        const hot = performance.now() - this.seen[k] < 1200;
        if (chip.classList.contains('hot') !== hot) {
          chip.classList.toggle('hot', hot);
          chip.querySelector('span')!.textContent = t(hot ? 'vs_liveHot' : 'vs_liveWait');
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
