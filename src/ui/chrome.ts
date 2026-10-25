/**
 * Piezas comunes de las pantallas (estilo "pit console", como rebuilt-sim): barra de la marca,
 * íconos de línea propios (24×24, en lugar de emojis que se ven distinto en cada sistema) y la
 * silueta de cada tipo de robot para el menú.
 */
import type { MechanismKind } from '../config/robot';
import { getLang, t } from './i18n';

const svg = (d: string, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ic = {
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  reset: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>'),
  home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/>'),
  download: svg('<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>'),
  camera: svg('<path d="M3 7.5h3l2-2.5h8l2 2.5h3v11.5H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  gamepad: svg('<path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 3.6a2.3 2.3 0 0 1-4 1L15 16H9l-2.1 1.6a2.3 2.3 0 0 1-4-1L2.1 13A5 5 0 0 1 7 7z"/><path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M7.5 14.5h9"/>'),
  touch: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10.5V9a1.5 1.5 0 0 1 3 0v2M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.9-2.5L4.3 15a1.5 1.5 0 0 1 2.4-1.8L9 15.5"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  book: svg('<path d="M4 4.5h6a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z"/>'),
  field: svg('<rect x="2.5" y="5" width="19" height="14" rx="1"/><path d="M12 5v14M2.5 9.5h3v5h-3M21.5 9.5h-3v5h3"/>'),
  cube: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m4.5 12.5 5 5 10-11"/>'),
  phone: svg('<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/>'),
  offline: svg('<path d="M7 18.5h10a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.5 1.5A3.8 3.8 0 0 0 7 18.5z"/><path d="m9.5 13.5 2 2 3.5-4"/>'),
};

/** Barra superior con la marca; `right` = botones a la derecha. */
export function brandbar(ctx = '', right = ''): string {
  return `<div class="brandbar"><div class="brand"><i class="logo" aria-hidden="true"></i>LABBOT<span>RESCUE</span></div>${ctx ? `<div class="ctx">${ctx}</div>` : ''}<div class="grow"></div>${right}</div>`;
}

/** Selector de idioma (ES/EN) para la barra de la marca. */
export function langChips(): string {
  return `<button class="chipbtn ${getLang() === 'es' ? 'on' : ''}" data-lang="es">ES</button><button class="chipbtn ${getLang() === 'en' ? 'on' : ''}" data-lang="en">EN</button>`;
}

/** Botón "Volver" de la barra de acciones. */
export function backBtn(attrs = 'data-back'): string {
  return `<button class="btn" ${attrs}>${ic.back}<span>${t('back')}</span></button>`;
}

/** `<kbd>` por cada tecla/botón. */
export const kbds = (labels: string[]): string => labels.map((l) => `<kbd>${l}</kbd>`).join('') || '<span class="none">–</span>';

/**
 * Silueta lateral (frente a la derecha) de cada tipo de robot, como plano: chasis 65 cm, ruedas
 * y su mecanismo (`config/robot.ts`). Solo ilustra; no es a escala exacta.
 */
export function robotSilhouette(kind: MechanismKind): string {
  const base = `<rect x="40" y="96" width="130" height="26" rx="3"/><circle cx="62" cy="126" r="11"/><circle cx="148" cy="126" r="11"/>
    ${kind === 'chassis' ? '' : '<path class="intake" d="M170 112h14l8 10"/>'}`;
  const mech: Record<MechanismKind, string> = {
    // Elevador con depósito que suelta al frente
    generic: `<path d="M130 96V30M146 96V30"/><path class="hot" d="M126 52h44l8-8"/><rect class="soft" x="60" y="72" width="56" height="24"/>`,
    // Plataforma que sube y empuja por atrás
    elevator: `<path d="M64 96V26M80 96V26"/><path class="hot" d="M34 46h50"/><path class="soft" d="M90 96V70h56v26"/>`,
    // Brazo pivotante con garra
    pivot: `<path d="M100 96V70"/><circle cx="100" cy="66" r="6"/><path class="hot" d="M100 66 178 34"/><path class="hot" d="M178 34l10 2M178 34l4 10"/>`,
    // Torre fija de ruedas (saca por atrás a N3) y pala al frente
    tower: `<rect x="48" y="22" width="40" height="74"/><circle cx="68" cy="40" r="7"/><circle cx="68" cy="62" r="7"/><path class="hot" d="M48 30H32"/><path class="soft" d="M170 96l14-16h12"/>`,
    // Chasis solo (base común): caja de la batería con la precarga encima y la rueda central baja
    chassis: `<rect class="soft" x="76" y="78" width="40" height="18"/><rect class="hot" x="122" y="72" width="24" height="24"/><circle cx="105" cy="128" r="11"/>`,
  };
  return `<svg class="silhouette" viewBox="0 0 220 150" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path class="floor" d="M10 137h200"/>${base}${mech[kind]}</svg>`;
}
