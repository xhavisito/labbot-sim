// Capturas del flujo de 2 jugadores (menú → preparar → match → pausa → resultados) en escritorio y celular.
// Uso: npm run build && node scripts/versus-shots.mjs [--out shots/versus] [--only desktop,landscape,portrait]
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = opt('out', 'shots/versus');
const only = opt('only', 'desktop,landscape,portrait').split(',');
const port = 4299;
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
  const shot = async (n, full = false) => page.screenshot({ path: `${out}/${d}-${n}.png`, fullPage: full });
  const click = async (sel) => {
    await page.click(sel);
    await page.waitForTimeout(500);
  };
  await shot('0-menu');
  await click('[data-hub="compete"]');
  await shot('0b-hub');
  await click('[data-go="versus"]');
  await shot('1-setup');
  // Vista completa de la pantalla (scroll dentro de la pantalla)
  const h = await page.evaluate(() => document.querySelector('.screen .inner')?.scrollHeight ?? 0);
  if (h) {
    await page.setViewportSize({ width: devices[d].viewport.width, height: Math.min(4000, h + 40) });
    await page.waitForTimeout(400);
    await shot('1b-setup-full');
    await page.setViewportSize(devices[d].viewport);
    await page.waitForTimeout(300);
  }
  await click('[data-team="same"]');
  await shot('2-setup-same');
  await click('[data-team="opp"]');
  await click('[data-act="start"]');
  await page.waitForFunction(() => window.app.session.time > 1, null, { timeout: 30000 });
  await shot('3a-intro');
  // La presentación se va a los 4 s de juego; en SwiftShader eso tarda: se adelanta el reloj de la sesión
  await page.evaluate(() => (window.app.session.time = 6));
  await page.waitForTimeout(1200);
  await shot('3-match-auto');
  await page.evaluate(() => {
    const m = window.app.session.match;
    m.t = 60;
    m.tick(0);
  });
  await page.waitForTimeout(1500);
  await shot('4-match-teleop');
  await page.evaluate(() => window.app.togglePause());
  await page.waitForTimeout(500);
  await shot('5-pause');
  await page.evaluate(() => {
    window.app.togglePause();
    const m = window.app.session.match;
    m.t = 149.95;
    m.tick(0);
  });
  await page.waitForTimeout(2000);
  await shot('6-results');
  await page.close();
}
await browser.close();
server.kill();
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : 'Sin errores de consola');
