/**
 * "Preparar match": antes de cada match se elige (y se recuerda para el siguiente):
 * - tu posición inicial: arrastra tu robot dentro de su Zona de Inicio y gíralo. Solo deja lugares
 *   donde el chasis completo queda dentro de la zona (§3.2.1, §4.1; `config/startSpot.ts`), como el
 *   mapa de la configuración del match de rebuilt-sim;
 * - por cada robot de la IA: tipo (en el Scouting y el torneo lo fija su equipo), estrategia
 *   (`ai/strategy.ts`), dificultad (`ai/difficulty.ts`) y rutina de AUTO;
 * - tu rutina de AUTO.
 */
import { AI_LEVELS, type AiLevel } from '../ai/difficulty';
import { STRATEGIES, type StrategyId } from '../ai/strategy';
import { AUTO_ROUTINES } from '../auto/AutoRoutine';
import { routeRoutine, savedRoutes } from '../auto/recorded';
import * as F from '../config/field';
import { MECHANISM_KINDS, type MechanismKind, type RobotSpec } from '../config/robot';
import type { MatchRobot, Settings } from '../config/settings';
import { CENTER_SPOT, clampSpot, spotValid, type StartSpot } from '../config/startSpot';
import { backBtn, brandbar, ic, UI_ALLIANCES, UI_SLOTS } from './chrome';
import { t, type Key } from './i18n';

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface SetupInput {
  /** Robot que manejas (0–1 rojo, 2–3 azul). */
  player: number;
  /** Tu robot (tipo del menú o del equipo en el Scouting). */
  playerSpec: RobotSpec;
  playerName: string;
  /** Tipos fijos de los 4 robots (Scouting y torneo: los de sus equipos); sin ellos, se eligen aquí. */
  kinds?: readonly MechanismKind[];
  /** Nombres de los equipos (Scouting y torneo). */
  teams?: readonly string[];
  /** Se puede cambiar de estación (match rápido; en el Scouting la fija el calendario). */
  canMove: boolean;
}

export interface SetupActions {
  back: () => void;
  /** Empieza con lo elegido (ya guardado en los ajustes); `player` por si cambió de estación. */
  start: (player: number) => void;
  save: () => void;
}

/** Área del mapa (marco rojo, m): de la línea X = 2.3 a la pared de la alianza, y |Z| ≤ 1.5. */
const MAP = { x0: 2.3, x1: F.HALF_L, z: 1.5 };
/** Mapa en cm: la pared de tu alianza abajo y el centro de la cancha arriba; a la derecha, tu derecha (−Z del rojo). */
const sx = (z: number) => (MAP.z - z) * 100;
const sy = (x: number) => (x - MAP.x0) * 100;
const W = MAP.z * 200;
const H = (MAP.x1 - MAP.x0) * 100;

const stationName = (i: number): string => `${t(i < 2 ? 'red' : 'blue')} ${(i % 2) + 1}`;

export class MatchSetup {
  constructor(
    private root: HTMLElement,
    private settings: Settings,
    private act: SetupActions,
  ) {}

  show(inp: SetupInput): void {
    const s = this.settings;
    const m = s.match;
    let player = inp.player;
    const spec = inp.playerSpec;
    m.start = clampSpot(spec.length, spec.width, m.start);
    const opt = (v: string, label: string, sel: string) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
    const autoOpts = (sel: string, mine: boolean) =>
      AUTO_ROUTINES.map((r) => opt(r.id, t(`auto_${r.id}` as Key), sel)).join('') +
      (mine && savedRoutes.length ? `<optgroup label="${t('grp_routes')}">${savedRoutes.map((r) => opt(routeRoutine(r).id, esc(r.name), sel)).join('')}</optgroup>` : '');
    const kindCell = (i: number, r: MatchRobot) => {
      if (inp.kinds) return `<span class="ms-fixed">${t(`type_${inp.kinds[i]}` as Key)}</span>`;
      return `<select data-kind="${i}">${opt('random', t('ms_random'), r.kind)}${MECHANISM_KINDS.map((k) => opt(k, t(`type_${k}` as Key), r.kind)).join('')}</select>`;
    };
    // Dificultad: un solo control con la actual; al tocarlo se despliega la lista (antes eran 3 botones que no cabían)
    const aiOpts = (cur: string) => AI_LEVELS.map((l) => opt(l, t(`ai_${l}`), cur)).join('');
    const aiSel = (i: number, cur: AiLevel) => `<select data-ai="${i}" aria-label="${t('ms_difficulty')}">${aiOpts(cur)}</select>`;
    /** "Toda la IA": muestra la dificultad común o "Mixta" si los robots de la IA no coinciden. */
    const allAiOpts = () => {
      const levels = new Set(m.robots.filter((_, i) => i !== player).map((r) => r.ai));
      const cur = levels.size === 1 ? [...levels][0] : 'mixed';
      return (cur === 'mixed' ? `<option value="mixed" selected disabled hidden>${t('ms_mixed')}</option>` : '') + aiOpts(cur);
    };
    const row = (i: number) => {
      const r = m.robots[i];
      const team = inp.teams?.[i] ? `<small>${esc(inp.teams[i])}</small>` : '';
      const head = `<div class="ms-who ${i < 2 ? 'red' : 'blue'}"><b>${stationName(i)}</b>${i === player ? `<span class="ms-you">${t('you')}</span>` : ''}${team}</div>`;
      if (i === player)
        return `<div class="ms-row me">${head}
          <div class="ms-f"><span>${t('ms_type')}</span><span class="ms-fixed">${esc(inp.playerName)}</span></div>
          <div class="ms-f"><span>${t('ms_strategy')}</span><span class="ms-fixed">${t('ms_youDrive')}</span></div>
          <div class="ms-f"><span>AUTO</span><select data-pauto>${autoOpts(s.playerAuto, true)}</select></div></div>`;
      return `<div class="ms-row">${head}
        <div class="ms-f"><span>${t('ms_type')}</span>${kindCell(i, r)}</div>
        <div class="ms-f"><span>${t('ms_strategy')}</span><select data-strat="${i}">${STRATEGIES.map((x) => opt(x, t(`strat_${x}` as Key), r.strategy)).join('')}</select></div>
        <div class="ms-f"><span>${t('ms_difficulty')}</span>${aiSel(i, r.ai)}</div>
        <div class="ms-f"><span>AUTO</span><select data-auto="${i}">${autoOpts(r.auto, false)}</select></div>
        <p class="ms-desc" data-desc="${i}">${t(`strat_${r.strategy}_desc` as Key)}</p></div>`;
    };
    const rows = () =>
      UI_ALLIANCES.map((a) => `<div class="ms-al ${a}"><h3>${t(a)}</h3>${[0, 1].map((j) => row((a === 'red' ? 0 : 2) + j)).join('')}</div>`)
        .join('');
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('ms_title'))}
      <h1>${t('ms_title')}</h1>
      <p class="sub">${t('ms_sub')}</p>
      ${s.ai ? '' : `<div class="msg">${ic.sliders}${t('ms_aiOff')}</div>`}
      <div class="ms">
        <div class="panel ms-start">
          <h3>${t('ms_start')}</h3>
          ${inp.canMove ? `<div class="stations ms-st">${UI_SLOTS.map((i) => `<button class="${i < 2 ? 'red' : 'blue'} ${i === player ? 'on' : ''}" data-slot="${i}"><i></i>${stationName(i)}</button>`).join('')}</div>` : ''}
          <div class="ms-map" data-map></div>
          <div class="ms-turn"><span>${t('ms_turn')}</span><input type="range" min="-180" max="180" step="5" data-turn><output data-turnout></output>
            <button class="chipbtn" data-center>${ic.reset}<span>${t('ms_center')}</span></button></div>
          <div class="msg ok" data-valid></div>
          <p class="ms-note">${t('ms_startNote')}</p>
        </div>
        <div class="panel ms-robots">
          <h3>${t('ms_robots')}</h3>
          <label class="ms-all"><span>${t('ms_allAi')}</span><select data-allai>${allAiOpts()}</select></label>
          <div data-rows>${rows()}</div>
        </div>
      </div>
      <div class="actionbar">${backBtn('data-act="back"')}<div class="grow"></div>
        <button class="btn primary" data-act="start">${ic.go}<span>${t('ms_go')}</span></button></div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    const map = q<HTMLElement>('[data-map]');
    const turn = q<HTMLInputElement>('[data-turn]');
    const draw = () => {
      map.innerHTML = fieldMap(player, spec, m.start);
      const deg = Math.round((m.start.turn * 180) / Math.PI);
      turn.value = String(deg);
      q<HTMLOutputElement>('[data-turnout]').textContent = `${deg}°`;
      const ok = spotValid(spec.length, spec.width, m.start);
      const v = q<HTMLElement>('[data-valid]');
      v.className = `msg ${ok ? 'ok' : ''}`;
      // Lo que se movió, desde el punto de vista del driver: adelante (hacia el centro) y a su derecha
      const fwd = Math.round(-m.start.dx * 100);
      const right = Math.round(-m.start.dz * 100);
      v.innerHTML = `${ok ? ic.check : ic.x}${t(ok ? 'ms_valid' : 'ms_invalid', { f: fwd, r: right, d: deg })}`;
    };
    const set = (spot: StartSpot) => {
      m.start = clampSpot(spec.length, spec.width, spot);
      draw();
    };
    // Arrastrar: el centro del robot sigue al dedo y se recorta a la zona
    let drag = false;
    const toSpot = (e: PointerEvent) => {
      const svg = map.querySelector('svg');
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      const c = zoneCenter(player % 2);
      set({ dx: py / 100 + MAP.x0 - c.x, dz: MAP.z - px / 100 - c.z, turn: m.start.turn });
    };
    map.addEventListener('pointerdown', (e) => {
      drag = true;
      map.setPointerCapture(e.pointerId);
      toSpot(e);
    });
    map.addEventListener('pointermove', (e) => drag && toSpot(e));
    const end = () => {
      if (!drag) return;
      drag = false;
      this.act.save();
    };
    map.addEventListener('pointerup', end);
    map.addEventListener('pointercancel', end);
    turn.addEventListener('input', () => set({ ...m.start, turn: (Number(turn.value) * Math.PI) / 180 }));
    turn.addEventListener('change', () => this.act.save());
    q('[data-center]').addEventListener('click', () => {
      set({ ...CENTER_SPOT });
      this.act.save();
    });
    const bindRows = () => {
      const box = q<HTMLElement>('[data-rows]');
      box.querySelectorAll<HTMLSelectElement>('[data-kind]').forEach((el) =>
        el.addEventListener('change', () => {
          m.robots[Number(el.dataset.kind)].kind = el.value as MatchRobot['kind'];
          this.act.save();
        }),
      );
      box.querySelectorAll<HTMLSelectElement>('[data-strat]').forEach((el) =>
        el.addEventListener('change', () => {
          const i = Number(el.dataset.strat);
          m.robots[i].strategy = el.value as StrategyId;
          box.querySelector(`[data-desc="${i}"]`)!.textContent = t(`strat_${m.robots[i].strategy}_desc` as Key);
          this.act.save();
        }),
      );
      box.querySelectorAll<HTMLSelectElement>('[data-auto]').forEach((el) =>
        el.addEventListener('change', () => {
          m.robots[Number(el.dataset.auto)].auto = el.value;
          this.act.save();
        }),
      );
      box.querySelector<HTMLSelectElement>('[data-pauto]')?.addEventListener('change', (e) => {
        s.playerAuto = (e.target as HTMLSelectElement).value;
        this.act.save();
      });
      box.querySelectorAll<HTMLSelectElement>('[data-ai]').forEach((el) =>
        el.addEventListener('change', () => {
          m.robots[Number(el.dataset.ai)].ai = el.value as AiLevel;
          allAi.innerHTML = allAiOpts();
          this.act.save();
        }),
      );
    };
    const allAi = q<HTMLSelectElement>('[data-allai]');
    const redrawRows = () => {
      q<HTMLElement>('[data-rows]').innerHTML = rows();
      allAi.innerHTML = allAiOpts();
      bindRows();
    };
    bindRows();
    allAi.addEventListener('change', () => {
      for (const r of m.robots) r.ai = allAi.value as AiLevel;
      this.act.save();
      redrawRows();
    });
    this.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        player = Number(b.dataset.slot);
        this.root.querySelectorAll('[data-slot]').forEach((x) => x.classList.toggle('on', x === b));
        draw();
        redrawRows();
      }),
    );
    q('[data-act="back"]').addEventListener('click', () => this.act.back());
    q('[data-act="start"]').addEventListener('click', () => {
      this.act.save();
      this.act.start(player);
    });
    draw();
    q<HTMLElement>('[data-act="start"]').focus({ preventScroll: true });
  }
}

/** Centro de la Zona de Inicio de una estación (marco rojo). */
function zoneCenter(station: number): { x: number; z: number } {
  const z = F.START_ZONES_RED[station];
  return { x: (z.x0 + z.x1) / 2, z: (z.z0 + z.z1) / 2 };
}

/**
 * Mapa (SVG) del extremo de tu alianza visto desde tu Driver Station: las dos Zonas de Inicio con la
 * cinta en L (§3.2.1), tu robot (con el frente marcado) y el lugar de tu compañero.
 */
export function fieldMap(player: number, spec: RobotSpec, spot: StartSpot): string {
  const station = player % 2;
  const red = player < 2;
  const col = red ? 'var(--red)' : 'var(--blue)';
  const zones = F.START_ZONES_RED.map((z, i) => {
    const x = sx(z.z1);
    const y = sy(z.x0);
    const mine = i === station;
    return `<rect x="${x}" y="${y}" width="${(z.z1 - z.z0) * 100}" height="${(z.x1 - z.x0) * 100}" class="ms-zone ${mine ? 'mine' : ''}"/>
      <text x="${x + ((z.z1 - z.z0) * 100) / 2}" y="${y + (z.x1 - z.x0) * 100 + 14}" class="ms-zl">${t('ms_zone')} ${i + 1}</text>`;
  }).join('');
  const tape = F.START_TAPE_RED.map(([x0, z0, x1, z1]) => `<line x1="${sx(z0)}" y1="${sy(x0)}" x2="${sx(z1)}" y2="${sy(x1)}" stroke="${col}" stroke-width="5" stroke-linecap="round"/>`).join('');
  const robot = (st: number, sp: StartSpot, ghost: boolean) => {
    const c = zoneCenter(st);
    const cx = sx(c.z + sp.dz);
    const cy = sy(c.x + sp.dx);
    const L = spec.length * 100;
    const Wd = spec.width * 100;
    const rot = (-sp.turn * 180) / Math.PI;
    return `<g transform="translate(${cx} ${cy}) rotate(${rot})" class="${ghost ? 'ms-ghost' : 'ms-bot'}">
      <rect x="${-Wd / 2}" y="${-L / 2}" width="${Wd}" height="${L}" rx="3" fill="${ghost ? 'none' : col}" stroke="${col}"/>
      <path d="M0 ${-L / 2 - 2} l-9 14 h18 z" fill="${ghost ? col : '#fff'}"/></g>`;
  };
  return `<svg viewBox="-10 -14 ${W + 20} ${H + 30}" class="ms-svg" role="img" aria-label="${t('ms_start')}">
    <text x="${W / 2}" y="-3" class="ms-zl">${t('ms_toCenter')}</text>
    <rect x="0" y="0" width="${W}" height="${H}" class="ms-carpet"/>
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" class="ms-wall"/>
    ${zones}${tape}
    ${robot(1 - station, CENTER_SPOT, true)}${robot(station, spot, false)}
  </svg>`;
}
