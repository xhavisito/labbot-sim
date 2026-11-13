// Capturas del menú de Estrategias, "Preparar match" con rivales en secreto y el HUD con la estrategia.
// Uso: npm run build && node scripts/plan-shots.mjs [--out shots/plan]
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'shots/plan';
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
for (const [d, dev] of Object.entries(devices)) {
  const page = await browser.newPage(dev);
  page.on('console', (m) => m.type() === 'error' && errors.push(`${d}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${d}: ${e}`));
  await page.goto(`http://localhost:${port}/?quality=low`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const shot = (n) => page.screenshot({ path: `${out}/${d}-${n}.png` });
  const click = async (sel) => {
    await page.click(sel);
    await page.waitForTimeout(300);
  };
  /** Toca la cancha del editor en (x, z) del marco de tu alianza (m). */
  const tap = async (x, z) => {
    const b = await page.locator('[data-map] svg').boundingBox();
    const vb = await page.evaluate(() => document.querySelector('[data-map] svg').viewBox.baseVal.width);
    const k = b.width / vb;
    const px = b.x + (12 + (4.5 - x) * 100) * k;
    const py = b.y + (12 + (3.5 - z) * 100) * k;
    if (dev.hasTouch) await page.touchscreen.tap(px, py);
    else await page.mouse.click(px, py);
    await page.waitForTimeout(150);
    return { px, py };
  };
  await shot('0-menu');
  await click('[data-go="strategies"]');
  await shot('1-lista-vacia');
  await click('[data-act="new"]');
  // AUTO: el compañero sale de la zona y va a las Muestras de su lado
  await tap(2.3, 1.0);
  await tap(1.5, 2.4);
  await page.selectOption('[data-auto]', 'collect');
  await click('[data-tool="me"]');
  await tap(2.4, -0.6);
  await tap(1.5, -1.4);
  await shot('2-auto');
  // TELEOP 1: compañero en el Laboratorio de la izquierda (zona) y tú en la Campana
  await click('[data-key="TELEOP0"]');
  await click('[data-tool="zone"]');
  {
    const b = await page.locator('[data-map] svg').boundingBox();
    const vb = await page.evaluate(() => document.querySelector('[data-map] svg').viewBox.baseVal.width);
    const k = b.width / vb;
    const at = (x, z) => [b.x + (12 + (4.5 - x) * 100) * k, b.y + (12 + (3.5 - z) * 100) * k];
    const [x0, y0] = at(2.2, 3.0);
    const [x1, y1] = at(-0.3, 1.0);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2);
    await page.mouse.move(x1, y1);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  await page.selectOption('[data-src]', 'lab');
  await page.selectOption('[data-lvl]', '3');
  await click('[data-tool="me"]');
  await tap(3.0, -2.6);
  await page.fill('[data-note]', 'Yo atiendo la Campana; tú el Laboratorio');
  await page.dispatchEvent('[data-note]', 'input');
  // Turno 2: rotan (copia el turno 1 y cambian)
  await click('[data-addturn]');
  await page.selectOption('[data-src]', 'hp');
  await click('[data-tool="zone"]');
  await click('[data-clear]');
  await click('[data-tool="me"]');
  await click('[data-clear]');
  await tap(1.0, 2.0);
  await page.fill('[data-note]', 'Cambio: yo al Laboratorio, tú a la Campana');
  await page.dispatchEvent('[data-note]', 'input');
  await shot('3-teleop2');
  await click('[data-key="ENDGAME"]');
  await page.selectOption('[data-end]', 'critical');
  await shot('4-endgame');
  await click('[data-act="list"]');
  await shot('5-lista');
  await click('[data-act="back"]');
  // Preparar match como azul 1: el compañero (azul 2) con la estrategia, los rivales en secreto
  await click('[data-slot="2"]');
  await click('[data-act="match"]');
  const planId = await page.evaluate(() => JSON.parse(localStorage.getItem('labbot.plans'))[0].id);
  await page.selectOption('[data-strat="3"]', `plan:${planId}`);
  await page.waitForTimeout(300);
  await shot('6-preparar');
  const rivalSelects = await page.locator('.ms-row.rival select').count();
  const rivalAi = await page.locator('.ms-row.rival select[data-ai]').count();
  if (rivalSelects !== rivalAi) errors.push(`${d}: los rivales tienen controles además de la dificultad`);
  const leak = await page.evaluate(() => [...document.querySelectorAll('.ms-row.rival')].map((r) => r.textContent).join(' '));
  if (/Anotar|Muestra Crítica|Human Player|Laboratorio|Pivote/.test(leak)) errors.push(`${d}: se ve algo del rival: ${leak}`);
  await click('[data-act="start"]');
  await page.waitForTimeout(6000);
  await shot('7-match-auto');
  // Que llegue al TELEOP (el reloj corre con el tiempo real)
  await page.waitForFunction(() => window.app.session.match && window.app.session.match.phase === 'TELEOP', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('8-match-teleop');
  const hudText = await page.evaluate(() => document.querySelector('.hud').textContent);
  if (/Secreta|strat_/.test(hudText)) errors.push(`${d}: HUD filtra algo`);
  // Resultados (sin esperar los 150 s): revela la estrategia de los rivales
  await page.evaluate(() => window.app.showResults());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.results h3:nth-last-of-type(1)')?.scrollIntoView());
  await shot('9-resultados');
  await page.close();
}
console.log(errors.length ? errors.join('\n') : 'sin errores');
await browser.close();
server.kill();
process.exit(0);
