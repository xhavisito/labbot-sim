// Genera los íconos PNG de la PWA desde public/icons/icon.svg (192, 512 y 180 para iOS).
// Uso: node scripts/icons.mjs   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const out = 'public/icons';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const s of [192, 512, 180]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: `${out}/icon-${s}.png` });
}
await b.close();
