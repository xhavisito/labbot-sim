// Capturas de cerca de un robot del CAD: node scripts/robot-closeup.mjs <phoenix|psycho|axiom> [--hold KeyJ] (requiere build)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const id = process.argv[2] ?? 'phoenix';
const key = process.argv.includes('--key') ? process.argv[process.argv.indexOf('--key') + 1] : '';
const port = 4298;
mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
await page.evaluate((i) => { app.menu.useRobot(`cad:${i}`); app.start({ mode: 'practice', player: 0 }); }, id);
await page.waitForTimeout(7000);
const views = { lado: [1, 0.6, 0], frente: [0.2, 0.7, 1], arriba: [0.3, 1.4, 0.3], atras: [-0.9, 0.7, -0.9] };
for (const [name, v] of Object.entries(views)) {
  await page.evaluate(([v]) => {
    const r = app.session.robots[0];
    const p = r.phys.position();
    const c = app.cam; c.setMode('free');
    c.camera.position.set(p.x + v[0] * 1.4, v[1] * 1.4, p.z + v[2] * 1.4);
    c.orbit.target.set(p.x, 0.25, p.z); c.orbit.update();
  }, [v]);
  if (key) { await page.keyboard.down(key); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `shots/closeup-${id}${key ? '-' + key : ''}-${name}.png` });
  if (key) await page.keyboard.up(key);
}
console.log(errors.length ? errors.join('\n') : 'ok');
await browser.close(); server.kill();
