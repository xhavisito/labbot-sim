// Recorrido del Auto Designer en navegador real (requiere `npm run build`): abre el diseñador desde el menú,
// duplica una rutina incluida, agrega y arrastra un waypoint, reproduce, guarda y prueba en un match.
// Capturas en shots/. En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 4301;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('server timeout')), 30000);
  const on = (d) => String(d).includes(String(port)) && (clearTimeout(to), res());
  server.stdout.on('data', on);
  server.stderr.on('data', on);
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!(window.app && window.app.start));
await page.waitForTimeout(800);
// abrir desde el Taller (menú principal → Taller → Auto Designer)
await page.click('[data-hub="workshop"]');
await page.click('[data-go="autoDesigner"]');
await page.waitForSelector('.designer canvas');
// elegir una incluida, duplicarla y editarla
await page.selectOption('[data-sel="routine"]', 'score-2');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/ad-builtin.png' });
await page.click('[data-dup]');
await page.waitForTimeout(300);
const box = await page.locator('.designer canvas').boundingBox();
// toca el campo para agregar un waypoint en vacío (cerca de la salida) y lo configura
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.45);
await page.waitForTimeout(200);
await page.click('[data-seg="intake"] button[data-v="on"]');
await page.click('[data-seg="arm"] button[data-v="1"]');
await page.waitForTimeout(200);
// arrastrar el waypoint recién puesto
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.33, box.y + box.height * 0.5, { steps: 5 });
await page.mouse.up();
await page.click('[data-play]');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/ad-edit.png' });
await page.click('[data-save]');
await page.waitForTimeout(300);
const saved = await page.evaluate(() => localStorage.getItem('labbot.autoDesigns.v1'));
console.log('guardado:', saved && JSON.parse(saved).length, 'rutina(s)', saved && JSON.parse(saved)[0].waypoints.length, 'waypoints');
// Probar: arranca un match con la rutina
await page.selectOption('[data-sel="robot"]', 'cad:axiom');
await page.click('[data-test]');
await page.waitForTimeout(500);
const probe = await page.evaluate(() => ({ n: window.app.session.robots.length, label: window.app.session.player.spec.label, mine: window.app.settings.robotType }));
console.log('prueba:', JSON.stringify(probe));
if (probe.n !== 1 || probe.label !== 'Axiom 2785' && !/axiom/i.test(String(probe.label))) { console.log('FALLA: la prueba no usa el robot elegido solo en la cancha'); process.exit(1); }
console.log('estado:', await page.evaluate(() => window.app.state), 'auto:', await page.evaluate(() => window.app.settings.playerAuto));
await page.waitForTimeout(6000);
await page.evaluate(() => window.app.cam.setMode('top'));
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/ad-match.png' });
// el periodo AUTO (15 s + 3 s de gracia) acaba y termina la prueba, sin jugar el TELEOP
await page.evaluate(() => { const s = window.app.session; for (let i = 0; i < 4000 && s.match.t < 18.5; i++) s.step(); });
await page.waitForFunction(() => window.app.state === 'menu' && !!document.querySelector('.designer canvas'), null, { timeout: 60000 });
console.log('terminó en el diseñador');
await page.screenshot({ path: 'shots/ad-regreso.png' });
console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores de consola.');
await browser.close(); server.kill(); process.exit(errors.length ? 1 : 0);
