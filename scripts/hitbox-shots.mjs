// Capturas de los colisionadores de cada robot (`?hitboxes=1`) en sus poses del brazo: guardado, piso, N1, N2, N3.
// Requiere `npm run build`. Uso: node scripts/hitbox-shots.mjs [axiom phoenix ...]  (ids sin `cad:`; por defecto los 3 del CAD)
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['phoenix', 'psycho', 'axiom'];
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
const errors = [];
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${id}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${id}: ${e}`));
  await page.addInitScript((rid) => localStorage.setItem('labbot.settings', JSON.stringify({ robotType: `cad:${rid}` })), id);
  await page.goto(`http://localhost:${port}/?hitboxes=1`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
  await page.evaluate(() => window.app.start({ mode: 'practice', player: 0 }));
  await page.waitForTimeout(2500);
  for (const [label, pos] of [['guardado', 'stow'], ['piso', 0], ['N1', 1], ['N2', 2], ['N3', 3]]) {
    await page.evaluate(([p]) => {
      const a = window.app;
      const r = a.session.player;
      if (p !== 'stow') {
        r.mech.stowed = false;
        r.mech.target = p;
      }
      // Cámara libre, vista lateral cercana al robot
      const t = r.phys.position();
      a.cam.setMode('free');
      a.cam.orbit.target.set(t.x + 0.1, 0.3, t.z);
      a.cam.camera.position.set(t.x + 0.25, 0.55, t.z + 1.5);
      a.cam.orbit.update();
    }, [pos]);
    await page.waitForTimeout(1800);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `shots/hitbox-${id}-${label}.png` });
    console.log(`shots/hitbox-${id}-${label}.png`);
  }
  await page.close();
}
console.log(errors.length ? `Errores de consola:\n${errors.join('\n')}` : 'Sin errores de consola.');
await browser.close();
server.kill();
