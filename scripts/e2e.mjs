// Prueba de extremo a extremo en navegador real: menú → preparar → match → pausa → resultados →
// volver al menú, en escritorio y en celular (horizontal y vertical, táctil).
// Uso: npm run build && npm run e2e   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 4298;
const shotsDir = process.argv.includes('--shots') ? 'shots/e2e' : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('vite preview no arrancó')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const devices = {
  escritorio: { viewport: { width: 1600, height: 900 } },
  'celular-horizontal': { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
  'celular-vertical': { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
};

let failed = 0;
const step = async (dev, name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${dev}: ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${dev}: ${name}\n      ${String(e.message).split('\n')[0]}`);
    throw e;
  }
};

for (const [dev, opts] of Object.entries(devices)) {
  console.log(`\n# ${dev}`);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const tap = (sel) => (opts.hasTouch ? page.tap(sel) : page.click(sel));
  const shot = (n) => shotsDir && page.screenshot({ path: `${shotsDir}/${dev}-${n}.png` });
  const state = () => page.evaluate(() => window.app.state);
  try {
    await step(dev, 'carga y muestra el menú en español', async () => {
      await page.goto(`http://localhost:${port}/?quality=low`);
      await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
      await page.waitForSelector('[data-act="match"]', { timeout: 15000 });
      if ((await state()) !== 'menu') throw new Error('no está en el menú');
      const txt = await page.evaluate(() => document.body.innerText);
      if (!/Match/i.test(txt) || /undefined|\[object/.test(txt)) throw new Error('texto del menú raro');
      await shot('1-menu');
    });
    await step(dev, 'Match abre la pantalla de preparar', async () => {
      await tap('[data-act="match"]');
      await page.waitForSelector('[data-act="start"]', { timeout: 10000 });
      if ((await state()) === 'playing') throw new Error('empezó sin preparar');
      await shot('2-preparar');
    });
    await step(dev, 'Empezar match arranca el AUTO', async () => {
      await tap('[data-act="start"]');
      await page.waitForFunction(() => window.app.state === 'playing' && window.app.session.match, null, { timeout: 15000 });
      await page.waitForFunction(() => window.app.session.match.t > 0.5, null, { timeout: 30000 });
      const ph = await page.evaluate(() => window.app.session.match.phase);
      if (ph !== 'AUTO') throw new Error(`fase ${ph}, esperaba AUTO`);
      await shot('3-match');
    });
    if (opts.hasTouch)
      await step(dev, 'se ven los controles táctiles', async () => {
        const on = await page.evaluate(() => document.body.classList.contains('touch-on'));
        if (!on) throw new Error('sin controles táctiles');
      });
    await step(dev, 'pausa y reanudar', async () => {
      await page.evaluate(() => window.app.togglePause());
      await page.waitForSelector('[data-act="resume"]', { timeout: 5000 });
      if ((await state()) !== 'paused') throw new Error('no pausó');
      await shot('4-pausa');
      await tap('[data-act="resume"]');
      await page.waitForFunction(() => window.app.state === 'playing', null, { timeout: 5000 });
    });
    await step(dev, 'el match avanza a TELEOP y termina en resultados', async () => {
      await page.evaluate(() => {
        const m = window.app.session.match;
        m.t = m.cfg.times.auto + 1;
      });
      await page.waitForFunction(() => window.app.session.match.phase === 'TELEOP', null, { timeout: 30000 });
      await page.evaluate(() => {
        const m = window.app.session.match;
        m.t = m.t + m.remaining - 0.5;
      });
      await page.waitForFunction(() => window.app.state === 'results', null, { timeout: 60000 });
      await page.waitForSelector('[data-act="menu"]', { timeout: 5000 });
      const txt = await page.evaluate(() => document.body.innerText);
      if (!/Gana|Empate/.test(txt) || !/Ranking Points|\bRP\b/.test(txt)) throw new Error('resultados sin ganador/empate ni RP en español');
      await shot('5-resultados');
    });
    await step(dev, 'volver al menú', async () => {
      await tap('[data-act="menu"]');
      await page.waitForSelector('[data-act="match"]', { timeout: 10000 });
      if ((await state()) !== 'menu') throw new Error('no volvió al menú');
    });
    await step(dev, 'sin errores de consola', async () => {
      if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
    });
  } catch {
    /* ya contado en step */
  }
  await ctx.close();
}
await browser.close();
server.kill();
console.log(failed ? `\n${failed} paso(s) fallaron` : '\nTodo bien.');
process.exit(failed ? 1 : 0);
