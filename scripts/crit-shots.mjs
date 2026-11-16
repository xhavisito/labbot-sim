// Capturas de la garra de la Crítica de Psycho: abierta (Crítica en la rendija), tomada (dedos cerrados) y con hitboxes.
// Requiere `npm run build`. En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const port = 4299;
mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const hb of [false, true]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${e}`));
  await page.addInitScript(() => localStorage.setItem('labbot.settings', JSON.stringify({ robotType: 'cad:psycho' })));
  await page.goto(`http://localhost:${port}/${hb ? '?hitboxes=1' : ''}`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
  await page.evaluate(() => window.app.start({ mode: 'practice', player: 0 }));
  await page.waitForTimeout(2500);
  const view = (rx, ry, rz) =>
    page.evaluate(([x, y, z]) => {
      const a = window.app;
      const r = a.session.player;
      const t = r.phys.position();
      // El frente de Psycho (donde está la Garrita) apunta a su +x local: la cámara mira desde un costado-frente
      const h = r.phys.heading();
      const f = { x: Math.cos(h), z: -Math.sin(h) };
      const s = { x: Math.sin(h), z: Math.cos(h) };
      a.cam.setMode('free');
      a.cam.orbit.target.set(t.x + f.x * 0.3, 0.8, t.z + f.z * 0.3);
      a.cam.camera.position.set(t.x + f.x * x + s.x * z, y, t.z + f.z * x + s.z * z);
      a.cam.orbit.update();
    }, [rx, ry, rz]);
  // Psycho de frente a la rendija de su Campana (alianza roja: pared en −z), la Crítica a 55 cm
  await page.evaluate(() => {
    const a = window.app;
    const g = a.session;
    const r = g.player;
    r.phys.teleport(3.5, -2.5, Math.PI / 2);
    const c = g.pieces.critical(r.alliance);
    const at = r.phys.localToWorld(0.62, 0, 0);
    g.pieces.place(c, at.x, 0.71, at.z, 0);
  });
  await page.waitForTimeout(1500);
  await view(0.5, 1.1, -1.2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/crit-${hb ? 'hitbox-' : ''}1-abierta.png` });
  // Se acerca y la toma (el mismo paso que da el botón de la garra)
  await page.evaluate(() => {
    const g = window.app.session;
    const r = g.player;
    const c = g.pieces.critical(r.alliance);
    const at = r.phys.localToWorld(0.42, 0, 0);
    g.pieces.place(c, at.x, 0.71, at.z, 0);
    r.mech.grabCritical([]);
  });
  await page.waitForTimeout(1500);
  await view(0.5, 1.1, -1.2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/crit-${hb ? 'hitbox-' : ''}2-tomada.png` });
  await view(-0.3, 0.9, -1.5);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/crit-${hb ? 'hitbox-' : ''}3-lado.png` });
  await page.close();
}
console.log(errors.length ? `Errores de consola:\n${errors.join('\n')}` : 'Sin errores de consola.');
await browser.close();
server.kill();
