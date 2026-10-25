// Verificación visual con Playwright: levanta `vite preview` (requiere `npm run build` antes),
// abre la app a 1600×900, toma una captura por cámara en shots/ e imprime errores de consola.
//
// Uso: node scripts/screenshot.mjs [--query "a=1"] [--wait 3000] [--cams free,top,driverBlue]
//        [--keys "KeyW:1500,KeyD:500"] [--eval "app.algo()"] [--name prefijo]
//        [--mobile]  (844×390 horizontal, táctil)
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const query = opt('query', '');
const wait = Number(opt('wait', '3000'));
const cams = opt('cams', 'free,top,driverBlue').split(',');
const keys = opt('keys', '');
const evalJs = opt('eval', '');
const name = opt('name', 'shot');
const port = 4299;

mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(to);
      resolve();
    }
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const mobile = args.includes('--mobile');
const page = await browser.newPage(
  mobile ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1600, height: 900 } },
);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForFunction(() => 'app' in window, null, { timeout: 30000 });
if (evalJs) await page.evaluate(evalJs);
await page.waitForTimeout(wait);
for (const k of keys ? keys.split(',') : []) {
  const [code, ms] = k.split(':');
  await page.keyboard.down(code);
  await page.waitForTimeout(Number(ms));
  await page.keyboard.up(code);
}
for (const c of cams) {
  await page.evaluate((m) => window.app.cam.setMode(m), c);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `shots/${name}-${c}.png` });
  console.log(`shots/${name}-${c}.png`);
}
console.log(errors.length ? `Errores de consola:\n${errors.join('\n')}` : 'Sin errores de consola.');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
