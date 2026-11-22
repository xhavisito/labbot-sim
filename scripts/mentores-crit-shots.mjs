// Capturas de Mentores 3478 con la Crítica en la garra (piso, N1–N3), de lado y de frente-lado, con y sin hitboxes.
// node scripts/mentores-crit-shots.mjs [prefijo] (requiere `npm run build`; en la nube CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const tag = process.argv[2] ?? 'mentores-crit';
const port = 4297;
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
for (const hb of process.argv.includes('--hb') ? [false, true] : [false]) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/${hb ? '?hitboxes=1' : ''}`);
  await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 30000 });
  await page.evaluate(() => { app.menu.useRobot('cad:mentores-3478'); app.start({ mode: 'practice', player: 0 }); });
  await page.waitForTimeout(6000);
  const view = (fx, y, sz, ty = 0.3) =>
    page.evaluate(([fx, y, sz, ty]) => {
      const a = window.app;
      const r = a.session.player;
      const t = r.phys.position();
      const h = r.phys.heading();
      const f = { x: Math.cos(h), z: -Math.sin(h) };
      const s = { x: Math.sin(h), z: Math.cos(h) };
      a.cam.setMode('free');
      a.cam.orbit.target.set(t.x + f.x * 0.45, ty, t.z + f.z * 0.45);
      a.cam.camera.position.set(t.x + f.x * fx + s.x * sz, y, t.z + f.z * fx + s.z * sz);
      a.cam.orbit.update();
    }, [fx, y, sz, ty]);
  // Brazo al piso, la Crítica enfrente de la boca y la toma
  await page.evaluate(() => {
    const g = app.session;
    const r = g.player;
    // Sin la Muestra precargada (con una Muestra en la garra no toma la Crítica); se suelta y el robot se va de ahí
    if (r.mech.inClaw) r.mech.release('sample', [], true);
    r.phys.teleport(0, 2.0, 0);
    r.mech.target = 0;
    r.mech.stowed = false;
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const g = app.session;
    const r = g.player;
    const c = g.pieces.critical(r.alliance);
    const at = r.phys.localToWorld(r.mech.tipX() + 0.16, 0, 0);
    g.pieces.place(c, at.x, 0.1, at.z, 0);
  });
  await page.waitForTimeout(400);
  await view(0.45, 0.35, 1.3, 0.15);
  await page.screenshot({ path: `shots/${tag}${hb ? '-hb' : ''}-0-antes.png` });
  console.log('toma', await page.evaluate(() => { const r = app.session.player; return [r.mech.inClaw, r.mech.grabCritical([])]; }));
  await page.waitForTimeout(120);
  await page.screenshot({ path: `shots/${tag}${hb ? '-hb' : ''}-0-jalando.png` });
  await page.waitForTimeout(900);
  const info = [];
  for (const pos of [0, 1, 2, 3]) {
    await page.evaluate((p) => { app.session.player.mech.target = p; }, pos);
    await page.waitForTimeout(2600);
    info.push(await page.evaluate(() => { const m = app.session.player.mech; return { crit: !!m.critical, angle: m.angle }; }));
    await view(pos === 3 ? 0.2 : 0.45, [0.4, 0.4, 0.9, 1.3][pos], pos === 3 ? 1.9 : 1.4, [0.2, 0.2, 0.6, 0.95][pos]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `shots/${tag}${hb ? '-hb' : ''}-${pos}-lado.png` });
    if (pos === 0) {
      await view(1.6, 0.7, 0.9, 0.15);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `shots/${tag}${hb ? '-hb' : ''}-0-frente.png` });
    }
  }
  console.log(hb ? 'hitboxes' : 'normal', JSON.stringify(info));
  await page.close();
}
console.log(errors.length ? `Errores:\n${errors.join('\n')}` : 'Sin errores de consola.');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.kill();
process.exit(0);
