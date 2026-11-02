// Genera los íconos PNG de la PWA desde public/icons/icon.svg:
// 192, 512 y 180 (iOS), y 512 maskable (el cubo ya cae dentro del círculo seguro del 80%).
// Uso: node scripts/icons.mjs   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const out = 'public/icons';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const jobs = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-maskable-512.png', size: 512 },
];
for (const { name, size } of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `${out}/${name}` });
}
await b.close();
