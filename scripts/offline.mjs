// Prueba real sin conexión: sirve dist/, deja que el service worker guarde todo, corta la red y recarga.
// Uso: npm run build && npm run e2e:offline   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(join('dist', path.endsWith('/') ? path + 'index.html' : path));
    res.writeHead(200, { 'content-type': types[extname(path.endsWith('/') ? 'index.html' : path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let ok = false;
try {
  await page.goto(url);
  await page.waitForFunction(() => window.app?.menu, null, { timeout: 60000 });
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 30000 });
  await page.waitForTimeout(3000); // precache completo
  const m = await page.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json()));
  if (!m.icons?.length) throw new Error('manifest sin íconos');
  await ctx.setOffline(true);
  server.close(); // ni siquiera el servidor local: todo sale de la caché
  await page.reload();
  await page.waitForFunction(() => window.app?.menu, null, { timeout: 60000 });
  if (errors.length) throw new Error('errores: ' + errors.join(' | '));
  ok = true;
  console.log('OK: el simulador abre sin conexión');
} catch (e) {
  console.error('FALLÓ:', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(ok ? 0 : 1);
