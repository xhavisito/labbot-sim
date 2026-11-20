// Prueba en navegador real del Modo Director: juega unos segundos, guarda un highlight con la
// tecla H, abre el Reveal Studio, cambia de cámara, activa efectos, exporta un video corto y
// verifica que el archivo no esté vacío. Requiere `npm run build`.
// Uso: node scripts/director-check.mjs   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 4298;
mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const fail = (msg) => {
  console.error('FALLÓ:', msg, errors);
  process.exit(1);
};
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
await page.evaluate(() => window.app.start({ mode: 'match', player: 0 }));
await page.waitForTimeout(6000);
// Tecla manual: guarda los últimos segundos
await page.keyboard.press('KeyH');
await page.waitForTimeout(300);
const n = await page.evaluate(() => window.app.director.clips.length);
if (n < 1) fail('H no guardó un clip');
console.log('clips tras H:', n, await page.evaluate(() => window.app.director.clips[0].duration.toFixed(1) + ' s'));
// Estudio
await page.evaluate(() => (window.app.togglePause(), window.app.openDirector('paused')));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/director-chase.png' });
for (const [name, cam] of [['orbit', 'orbit'], ['low', 'low']]) {
  await page.evaluate((c) => window.app.studio.cam.setPreset(c), cam);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `shots/director-${name}.png` });
}
await page.evaluate(() => {
  const s = window.app.studio;
  s.cam.setPreset('chase');
  s.ramp.slow = 0.5;
  s.setFx({ motionBlur: true, bloom: true, vignette: true });
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/director-fx.png' });
// Exportar 2 s
const res = await page.evaluate(async () => {
  const s = window.app.studio;
  s.trimIn = 0;
  s.trimOut = 2;
  const r = await s.export({ format: 'auto', height: 0 });
  return { size: r.blob.size, mime: r.mime };
});
console.log('video:', res);
if (!res.size) fail('el video salió vacío');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const st = await page.evaluate(() => window.app.state);
if (st !== 'paused') fail(`al salir del estudio el estado es ${st}`);
console.log(errors.length ? `Errores de consola:\n${errors.join('\n')}` : 'Sin errores de consola.');
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
