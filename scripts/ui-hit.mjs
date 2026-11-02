// Revisa que cada botón/control visible de las pantallas se pueda presionar: hace scroll hasta él y
// mira qué elemento hay en su centro (si otro lo tapa, no se puede tocar). Escritorio y celular.
// Uso: npm run build && node scripts/ui-hit.mjs [--shots dir]   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const port = 4299;
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
  laptop: { viewport: { width: 1280, height: 680 } },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  portrait: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
let bad = 0;
const check = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.screen:not([style*="display: none"])') || document.body;
    const els = [...root.querySelectorAll('button, select, input, .toggle')].filter((e) => e.offsetParent !== null && !e.closest('[hidden]'));
    const out = [];
    for (const e of els) {
      e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === e || e.contains(hit) || hit.contains(e) && hit.tagName === 'LABEL')) {
        const name = (e.textContent || e.getAttribute('aria-label') || e.outerHTML.slice(0, 60)).trim().slice(0, 40);
        const by = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')} "${(hit.textContent || '').trim().slice(0, 30)}"` : 'nada (fuera de la pantalla)';
        out.push(`${name} @(${Math.round(x)},${Math.round(y)}) tapado por ${by}`);
      }
    }
    return { n: els.length, out };
  });
for (const [d, dev] of Object.entries(devices)) {
  const page = await browser.newPage(dev);
  await page.goto(`http://localhost:${port}/?quality=low`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const screens = [
    ['menu', async () => {}],
    ['ajustes', async () => page.click('[data-go="settings"]')],
    ['controles', async () => (await page.click('[data-act="cancel"]'), page.click('[data-go="controls"]'))],
    ['preparar', async () => (await page.click('[data-act="back"]'), page.click('[data-act="match"]'))],
  ];
  for (const [name, go] of screens) {
    await go();
    await page.waitForTimeout(500);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${d}-${name}.png` });
    const r = await check(page);
    bad += r.out.length;
    console.log(`${d} ${name}: ${r.n} controles, ${r.out.length} tapados`);
    for (const o of r.out) console.log(`   ✗ ${o}`);
  }
  await page.close();
}
await browser.close();
server.kill();
process.exit(bad ? 1 : 0);
