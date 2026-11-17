// Recorrido del Auto Designer en navegador real (requiere `npm run build`): abre el diseñador desde el menú,
// duplica una rutina incluida, agrega y arrastra un waypoint, reproduce, guarda y prueba en un match.
// Capturas en shots/. En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 4301;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res) => { server.stdout.on('data', (d) => String(d).includes(String(port)) && res()); });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!(window.app && window.app.start));
await page.waitForTimeout(800);
// abrir desde el botón del menú principal
await page.click('[data-act="designer"]');
await page.waitForSelector('.ad canvas');
// elegir una incluida, duplicarla y editarla
await page.selectOption('[data-sel="routine"]', 'path-collect-1');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/ad-builtin.png' });
await page.click('[data-dup]');
await page.waitForTimeout(300);
const box = await page.locator('.ad canvas').boundingBox();
// toca el campo para agregar un waypoint (sobre la ruta y en vacío)
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.62);
await page.waitForTimeout(200);
await page.click('[data-seg="score"] button[data-v="3"]');
await page.click('[data-seg="intake"] button[data-v="on"]');
await page.waitForTimeout(200);
// arrastrar el waypoint recién puesto
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.62);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.7, { steps: 5 });
await page.mouse.up();
await page.click('[data-play]');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shots/ad-edit.png' });
await page.click('[data-save]');
await page.waitForTimeout(300);
const saved = await page.evaluate(() => localStorage.getItem('labbot.autos.v1'));
console.log('guardado:', saved && JSON.parse(saved).length, 'rutina(s)', saved && JSON.parse(saved)[0].waypoints.length, 'waypoints');
// Probar: arranca un match con la rutina
await page.click('[data-test]');
await page.waitForTimeout(500);
console.log('estado:', await page.evaluate(() => window.app.state), 'auto:', await page.evaluate(() => window.app.settings.playerAuto));
await page.waitForTimeout(6000);
await page.evaluate(() => window.app.cam.setMode('top'));
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/ad-match.png' });
console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores de consola.');
await browser.close(); server.kill(); process.exit(errors.length ? 1 : 0);
