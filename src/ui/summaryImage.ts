/** Resumen del match como imagen (PNG): marcador, RP y faltas con su § del manual. */
import { RULES } from '../core/fouls';
import type { Match } from '../core/match';
import { t } from './i18n';

type Alliance = 'red' | 'blue';
const ALLIANCES: Alliance[] = ['red', 'blue'];

export interface SummaryRow { label: string; red: string; blue: string; bold?: boolean; section?: boolean }
export interface Summary { title: string; rows: SummaryRow[]; fouls: string[] }

const MAX_FOULS = 12;

/** Datos del resumen (puro, sin DOM): lo mismo que muestra la pantalla de resultados. */
export function buildSummary(m: Match): Summary {
  const b = { red: m.breakdown('red'), blue: m.breakdown('blue') };
  const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') };
  const yes = (v: boolean) => (v ? '✓' : '–');
  const row = (label: string, f: (a: Alliance) => string | number, bold = false): SummaryRow =>
    ({ label, red: String(f('red')), blue: String(f('blue')), bold });
  const title = b.red.total === b.blue.total ? t('tie') : `${t('winner')}: ${t(b.red.total > b.blue.total ? 'red' : 'blue')}`;
  const rows: SummaryRow[] = [
    row(t('autoLine'), (a) => b[a].autoLine),
    row(t('samplesAuto'), (a) => b[a].samplesAuto),
    row(t('samplesTeleop'), (a) => b[a].samplesTeleop),
    row(t('platform'), (a) => b[a].platform),
    row(t('criticalSample'), (a) => b[a].critical),
    row(t('penalties'), (a) => b[a].penalties),
  ];
  if (ALLIANCES.some((a) => b[a].redCard)) rows.push(row(t('redCard'), (a) => yes(b[a].redCard)));
  rows.push(row(t('total'), (a) => b[a].total, true));
  rows.push({ label: t('rp'), red: '', blue: '', section: true });
  rows.push(
    row(t('rpWin'), (a) => rp[a].win),
    row(t('rpAuto'), (a) => yes(rp[a].autoLine)),
    row(t('rpCritical'), (a) => yes(rp[a].critical)),
    row(t('rpDominance'), (a) => `${yes(rp[a].dominance)} (${m.samplesIn(a)})`),
    row(t('rp'), (a) => rp[a].total, true),
  );
  const all = m.fouls.map(
    (f) => `${Math.max(0, Math.floor(f.time))} s · ${f.kind === 'TECH' ? 'Tech Foul' : 'Foul'} · ${t(f.offender)} ${f.robot + 1}: ${RULES[f.rule].es} (${RULES[f.rule].section})${RULES[f.rule].supuesto ? ' · SUPUESTO' : ''}`,
  );
  const fouls = all.length ? all.slice(0, MAX_FOULS) : [t('noFouls')];
  if (all.length > MAX_FOULS) fouls.push(t('summaryMoreFouls', { n: all.length - MAX_FOULS }));
  return { title, rows, fouls };
}

/** Dibuja el resumen en un canvas 2D con el estilo de la pantalla de resultados. */
export function renderSummary(s: Summary): HTMLCanvasElement {
  const W = 960, pad = 40, rowH = 38;
  const H = pad * 2 + 110 + s.rows.length * rowH + 60 + s.fouls.length * 28 + 30;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const font = (px: number, w = 400) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillStyle = '#101319'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  g.fillStyle = '#f2b632'; g.font = font(30, 700); g.textAlign = 'left';
  g.fillText(`${t('title')} · ${t('results')}`, pad, pad + 14);
  g.fillStyle = '#e8ecf3'; g.font = font(24, 600);
  g.fillText(s.title, pad, pad + 56);
  const cx = { label: pad, red: W - pad - 190, blue: W - pad };
  let y = pad + 110;
  g.font = font(20, 700); g.textAlign = 'right';
  g.fillStyle = '#ff8a8f'; g.fillText(t('red'), cx.red, y);
  g.fillStyle = '#8fb0ff'; g.fillText(t('blue'), cx.blue, y);
  y += rowH;
  for (const r of s.rows) {
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, y + rowH / 2); g.lineTo(W - pad, y + rowH / 2); g.stroke();
    g.textAlign = 'left'; g.fillStyle = r.section ? '#e8ecf3' : '#9aa1ad';
    g.font = font(20, r.section || r.bold ? 700 : 400);
    g.fillText(r.label, cx.label, y);
    g.textAlign = 'right'; g.font = font(22, r.bold ? 700 : 400);
    g.fillStyle = '#ff8a8f'; g.fillText(r.red, cx.red, y);
    g.fillStyle = '#8fb0ff'; g.fillText(r.blue, cx.blue, y);
    y += rowH;
  }
  y += 24;
  g.textAlign = 'left'; g.fillStyle = '#e8ecf3'; g.font = font(22, 700);
  g.fillText(t('fouls'), pad, y);
  y += 34;
  g.fillStyle = '#9aa1ad'; g.font = font(17);
  for (const f of s.fouls) { g.fillText(f.length > 88 ? `${f.slice(0, 87)}…` : f, pad, y); y += 28; }
  return c;
}

/** Comparte el PNG con el menú del sistema; si no se puede, lo descarga. Devuelve cómo salió. */
export async function shareSummary(m: Match): Promise<'shared' | 'downloaded'> {
  const canvas = renderSummary(buildSummary(m));
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('No se pudo generar la imagen');
  const file = new File([blob], 'labbot-rescue-resumen.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: t('title') });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'; // la persona canceló
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
