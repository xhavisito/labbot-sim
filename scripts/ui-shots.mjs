// Capturas de todas las pantallas de la UI en escritorio y celular (horizontal y vertical).
// Uso: npm run build && node scripts/ui-shots.mjs [--out shots/ui] [--only desktop,landscape,portrait]
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = opt('out', 'shots/ui');
const only = opt('only', 'desktop,landscape,portrait').split(',');
const port = 4298;
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const devices = {
  desktop: { viewport: { width: 1600, height: 900 } },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  portrait: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
const errors = [];
for (const d of only) {
  const page = await browser.newPage(devices[d]);
  page.on('console', (m) => m.type() === 'error' && errors.push(`${d}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${d}: ${e}`));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const shot = async (n) => page.screenshot({ path: `${out}/${d}-${n}.png` });
  const click = async (sel) => {
    await page.click(sel);
    await page.waitForTimeout(400);
  };
  await shot('1-menu');
  await click('[data-go="settings"]');
  await shot('2-settings');
  await click('[data-act="cancel"]');
  await click('[data-go="controls"]');
  await shot('3-controls');
  await click('[data-act="back"]');
  await click('[data-go="rules"]');
  await shot('4-rules');
  await click('[data-act="back"]');
  // Scouting: calendario, simular (solo el escritorio simula todo; en celular, 2 matches), tabla y alianzas
  await click('[data-go="scouting"]');
  await shot('4b-scout-empty');
  await click('[data-act="gen"]');
  if (d === 'desktop') await click('[data-act="simAll"]');
  else {
    await click('[data-sim="Q1"]');
    await page.waitForFunction(() => !document.querySelector('[data-prog]') || document.querySelector('[data-prog]').hidden, null, { timeout: 120000 });
    await click('[data-sim="Q2"]');
  }
  await page.waitForFunction(() => !document.querySelector('[data-prog]') || document.querySelector('[data-prog]').hidden, null, { timeout: 900000 });
  await page.waitForTimeout(300);
  await shot('4c-scout-schedule');
  await click('[data-tab="table"]');
  await shot('4d-scout-table');
  await click('[data-tab="alliances"]');
  await shot('4e-scout-alliances');
  await click('[data-tab="record"]');
  await click('[data-step="t3"] [data-d="1"]');
  await shot('4f-scout-record');
  await click('[data-tab="teams"]');
  await shot('4g-scout-teams');
  await click('[data-act="back"]');
  // Práctica libre: solo el robot propio
  await click('[data-slot="2"]');
  await click('[data-act="practice"]');
  await page.waitForTimeout(1500);
  const robots = await page.evaluate(() => window.app.session.robots.length);
  if (robots !== 1) errors.push(`${d}: práctica con ${robots} robots`);
  await shot('5-practice');
  await page.evaluate(() => window.app.togglePause());
  await page.waitForTimeout(400);
  await shot('6-pause-practice');
  await page.evaluate(() => window.app.toMenu());
  await page.waitForTimeout(300);
  await click('[data-act="match"]');
  await page.waitForTimeout(3000);
  await shot('7-match');
  await page.evaluate(() => {
    const m = window.app.session.match;
    m.t = 130;
    m.tick(0);
  });
  await page.waitForTimeout(1500);
  await shot('8-endgame');
  await page.evaluate(() => window.app.togglePause());
  await page.waitForTimeout(400);
  await shot('9-pause-match');
  await page.evaluate(() => {
    window.app.togglePause();
    const m = window.app.session.match;
    m.t = 149.95;
    m.tick(0);
  });
  await page.waitForTimeout(1500);
  await shot('10-results');
  await page.close();
}
await browser.close();
server.kill();
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : 'Sin errores de consola');
