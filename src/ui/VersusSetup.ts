/**
 * "Preparar 2 jugadores": la misma idea que "Preparar match" (`ui/MatchSetup.ts`), pero para dos
 * personas en la misma pantalla. Cada jugador elige:
 * - sus controles: teclado WASD, teclado de flechas, o el 1.º o 2.º control conectado (`VersusDevice`);
 * - su robot y su rutina de AUTO (los de los ajustes, por jugador);
 * - su posición inicial dentro de SU Zona de Inicio (§3.2.1, §4.1), con el mapa de `MatchSetup`.
 * Además se elige el equipo: contra (alianzas contrarias) o mismo equipo (la IA rellena los otros
 * dos robots). SUPUESTO del simulador: el manual no habla de controles ni de equipos de dos personas.
 */
import { ROBOT_IDS, robotSpec, allRobotIds } from '../config/robotIds';
import { customById } from '../config/customRobots';
import { CENTER_SPOT, clampSpot, spotValid, type StartSpot } from '../config/startSpot';
import { VERSUS_DEVICES, type Settings, type VersusDevice, type VersusSide } from '../config/settings';
import { backBtn, brandbar, ic, UI_SLOTS } from './chrome';
import { autoOptionsHtml, bindStartMap, fieldMap, optionTag } from './MatchSetup';
import { t, type Key } from './i18n';

export interface VersusActions {
  back: () => void;
  /** Empieza con lo elegido (ya guardado); `player` = la estación del jugador 1. */
  start: (player: number) => void;
  save: () => void;
}

const stationName = (i: number): string => `${t(i < 2 ? 'red' : 'blue')} ${(i % 2) + 1}`;

/** Nombre de un robot en los menús (el de los robots propios, si lo es). */
const robotName = (id: string): string => {
  const c = customById(id);
  if (c) return c.name;
  const spec = robotSpec(id as (typeof ROBOT_IDS)[number]);
  return spec.label ?? t(`type_${spec.mechanism}` as Key);
};

/** Estación del jugador 2 según el equipo: la contraria (+2) o la compañera de la misma alianza. */
export function partnerStation(player: number, team: 'opp' | 'same'): number {
  return team === 'opp' ? (player + 2) % 4 : player ^ 1;
}

export class VersusSetup {
  /** Estación del jugador 1 (0–3); la del jugador 2 la da `partnerStation`. */
  private player = 0;

  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private act: VersusActions,
  ) {}

  show(player: number): void {
    this.player = player;
    this.render();
  }

  private get sides(): { key: 'p1' | 'p2'; side: VersusSide; slot: number }[] {
    const v = this.settings.versus;
    return [
      { key: 'p1', side: v.p1, slot: this.player },
      { key: 'p2', side: v.p2, slot: partnerStation(this.player, v.team) },
    ];
  }

  private render(): void {
    const v = this.settings.versus;
    const ids = allRobotIds();
    const devices = (cur: VersusDevice, pads: number) => {
      const labels: Record<VersusDevice, string> = {
        keys1: t('vs_dev_keys1'),
        keys2: t('vs_dev_keys2'),
        pad1: t('vs_dev_pad1'),
        pad2: t('vs_dev_pad2'),
      };
      return VERSUS_DEVICES.filter((d) => (d === 'pad1' ? pads > 0 : d === 'pad2' ? pads > 1 : true) || d === cur)
        .map((d) => optionTag(d, labels[d], cur))
        .join('');
    };
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p?.connected).length : 0;
    const dup = v.p1.device === v.p2.device;
    const panel = (key: 'p1' | 'p2', slot: number) => {
      const side = key === 'p1' ? v.p1 : v.p2;
      const red = slot < 2;
      return `<div class="panel vs-side ${red ? 'red' : 'blue'}" data-side="${key}">
        <h3>${t(key === 'p1' ? 'vs_p1' : 'vs_p2')} · ${stationName(slot)}</h3>
        <div class="ms-f"><span>${t('vs_device')}</span><select data-dev="${key}">${devices(side.device, pads)}</select></div>
        <div class="ms-f"><span>${t('vs_robot')}</span><select data-robot="${key}">${ids.map((id) => optionTag(id, robotName(id), side.robot)).join('')}</select></div>
        <div class="ms-f"><span>AUTO</span><select data-auto="${key}">${autoOptionsHtml(side.auto, true)}</select></div>
        <h4>${t('vs_side')}</h4>
        <div class="ms-map" data-map="${key}"></div>
        <div class="ms-turn"><span>${t('ms_turn')}</span><input type="range" min="-180" max="180" step="5" data-turn="${key}"><output data-turnout="${key}"></output>
          <button class="chipbtn" data-center="${key}">${ic.reset}<span>${t('ms_center')}</span></button></div>
        <div class="msg" data-valid="${key}"></div>
      </div>`;
    };
    const first = this.sides[0];
    const second = this.sides[1];
    const team = (val: 'opp' | 'same') =>
      `<button class="${v.team === val ? 'on' : ''}" data-team="${val}">${t(val === 'opp' ? 'vs_opp' : 'vs_same')}</button>`;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('vs_setTitle'))}
      <h1>${t('vs_setTitle')}</h1>
      <p class="sub">${t('vs_setSub')}</p>
      <div class="panel vs-team">
        <h3>${t('vs_team')}</h3>
        <div class="seg">${team('opp')}${team('same')}</div>
        <p class="ms-desc">${t('vs_teamNote')}</p>
      </div>
      <div class="stations ms-st">${UI_SLOTS.map((i) => `<button class="${i < 2 ? 'red' : 'blue'} ${i === this.player ? 'on' : ''}" data-slot="${i}"><i></i>${stationName(i)}</button>`).join('')}</div>
      <div class="vs-grid">${panel(first.key, first.slot)}${panel(second.key, second.slot)}</div>
      <div class="msg" data-err>${dup ? `${ic.x}${t('vs_dupDevice')}` : pads === 0 ? t('vs_padsNone') : ''}</div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn primary" data-act="start" ${dup ? 'disabled' : ''}>${ic.go}<span>${t('vs_go')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    for (const { key, side, slot } of this.sides) this.bindSide(key, side, slot);
    this.root.querySelectorAll<HTMLElement>('[data-team]').forEach((b) =>
      b.addEventListener('click', () => {
        v.team = b.dataset.team === 'same' ? 'same' : 'opp';
        this.act.save();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        this.player = Number(b.dataset.slot);
        this.act.save();
        this.render();
      }),
    );
    q('[data-act="back"]').addEventListener('click', () => this.act.back());
    q('[data-act="start"]').addEventListener('click', () => {
      if (v.p1.device === v.p2.device) return;
      this.act.save();
      this.act.start(this.player);
    });
  }

  private bindSide(key: 'p1' | 'p2', side: VersusSide, slot: number): void {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    const spec = { ...robotSpec(side.robot) };
    const map = q<HTMLElement>(`[data-map="${key}"]`);
    const turn = q<HTMLInputElement>(`[data-turn="${key}"]`);
    const valid = q<HTMLElement>(`[data-valid="${key}"]`);
    const draw = () => {
      map.innerHTML = fieldMap(slot, spec, side.start);
      const deg = Math.round((side.start.turn * 180) / Math.PI);
      turn.value = String(deg);
      q<HTMLOutputElement>(`[data-turnout="${key}"]`).textContent = `${deg}°`;
      const ok = spotValid(spec.length, spec.width, side.start);
      valid.className = `msg ${ok ? 'ok' : ''}`;
      valid.innerHTML = `${ok ? ic.check : ic.x}${t(ok ? 'ms_valid' : 'ms_invalid', {
        f: Math.round(-side.start.dx * 100),
        r: Math.round(-side.start.dz * 100),
        d: deg,
      })}`;
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
    q<HTMLSelectElement>(`[data-dev="${key}"]`).addEventListener('change', (e) => {
      side.device = (e.target as HTMLSelectElement).value as VersusDevice;
      this.act.save();
      this.render();
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
}
