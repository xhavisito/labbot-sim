// Capturas de Mentores 3478 como B1 (alianza azul) con la Crítica en la garra: piso, N1–N3 y Repisa, con y sin hitboxes.
// Uso: npm run build && node scripts/mentores-crit-shots.mjs [--hb] [--tag x]. En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const hb = process.argv.includes('--hb');
const tag = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'mentores';
const port = 4297;
mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/${hb ? '?hitboxes=1' : ''}`);
await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
await page.evaluate(() => { app.menu.useRobot('cad:mentores-3478'); app.start({ mode: 'practice', player: 2 }); });
await page.waitForTimeout(6000);
// Brazo al piso, la Crítica enfrente y a comer
const got = await page.evaluate(async () => {
  const g = app.session; const r = g.player; const m = r.mech;
  // Sale con una Muestra precargada: la suelta y se aleja de ella
  m.target = 0;
  await new Promise((res) => setTimeout(res, 2000));
  if (m.inClaw) m.release('sample', []);
  await new Promise((res) => setTimeout(res, 500));
  r.phys.teleport(0, 2.2, Math.PI);
  await new Promise((res) => setTimeout(res, 2500));
  const c = g.pieces.critical(r.alliance);
  const at = r.phys.localToWorld(m.tipX() + 0.1, 0, 0);
  g.pieces.place(c, at.x, 0.1, at.z, 0);
  await new Promise((res) => setTimeout(res, 400));
  m.grabCritical([]);
  return { ok: m.critical === c, inClaw: m.inClaw };
});
console.log('agarrada:', JSON.stringify(got));
for (const pos of [0, 1, 2, 4]) {
  await page.evaluate((p) => {
    const m = app.session.player.mech;
    if (p === 'guardado') {
      // Pose de inicio (brazo guardado y muñeca doblada), como al empezar el match
      m.target = 0; m.stowed = true; m.wristFold = 1; m.angle = app.session.player.spec.arm.stowAngle;
    } else { m.stowed = false; m.target = p; }
  }, pos);
  await page.waitForTimeout(2500);
  for (const [name, side] of [['lado', 1], ['lado2', -1], ['tres-cuartos', 0.6]]) {
    await page.evaluate(([side]) => {
      const r = app.session.player; const p = r.phys.position(); const h = r.phys.heading();
      const f = { x: Math.cos(h), z: -Math.sin(h) }; const s = { x: Math.sin(h), z: Math.cos(h) };
      const c = app.cam; c.setMode('free');
      const k = 1 - side;
      const tp = app.session.player.mech.target; const ty = app.session.player.mech.stowed ? 0.35 : [0.2, 0.45, 0.6, 0.95, 0.6][tp];
      c.orbit.target.set(p.x + f.x * 0.45, ty, p.z + f.z * 0.45);
      c.camera.position.set(p.x + f.x * (0.45 + k * 0.8) + s.x * side * 1.0, ty + 0.1, p.z + f.z * (0.35 + k * 0.8) + s.z * side * 1.0);
      c.orbit.update();
    }, [side]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/${tag}${hb ? '-hb' : ''}-pos${pos}-${name}.png` });
  }
}
console.log(errors.length ? errors.join('\n') : 'ok');
await browser.close(); server.kill();
