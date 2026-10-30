// Menús con el control: simula un gamepad (Gamepad API falsa) y recorre el menú, la pausa, los
// ajustes y Controles solo con botones. Falla si algo no responde.
// Uso: npm run build && node scripts/pad-nav.mjs [--shots dir]   (en la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const port = 4298;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  const pad = { buttons: Array(17).fill(false), axes: [0, 0, 0, 0] };
  window.__pad = pad;
  navigator.getGamepads = () => [
    { id: 'Control de prueba (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [...pad.axes], buttons: pad.buttons.map((p) => ({ pressed: p, touched: p, value: p ? 1 : 0 })) },
  ];
});
await page.goto(`http://localhost:${port}/?quality=low`);
await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
await page.waitForTimeout(600);

const B = { A: 0, B: 1, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
/** Un cuadro presionado y uno suelto (la cancha de fondo puede ir lenta en la nube). */
const press = (i) =>
  page.evaluate(async (i) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    window.__pad.buttons[i] = true;
    await frame();
    window.__pad.buttons[i] = false;
    await frame();
  }, i);
const focused = () => page.evaluate(() => {
  const e = document.querySelector('.pad-focus');
  return e ? `${e.tagName.toLowerCase()}${[...e.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}=${a.value}]`).join('')}` : '';
});
const state = () => page.evaluate(() => window.app.state);
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails++;
};
const shot = async (name) => shotsDir && page.screenshot({ path: `${shotsDir}/${name}.png` });
/** Presiona `dir` hasta que el foco cumpla `want` (máx. n veces). */
const until = async (dir, want, n = 14) => {
  for (let k = 0; k < n; k++) {
    if (process.env.DEBUG) console.log('  ·', await focused());
    if (want(await focused())) return true;
    await press(dir);
  }
  return want(await focused());
};

// Menú principal
ok(!(await focused()), 'sin tocar el control no se ve el foco del control');
await press(B.DOWN);
ok((await focused()).includes('data-act=match'), `el primer toque solo muestra el foco en "Match" (${await focused()})`);
await shot('pad-menu');
await press(B.DOWN);
ok((await focused()).includes('data-act=practice'), `abajo → Práctica (${await focused()})`);
await press(B.DOWN);
ok((await focused()).includes('data-go=replays'), `abajo → Repeticiones, la misma columna (${await focused()})`);
await press(B.RIGHT);
ok((await focused()).includes('data-go=editor'), `derecha → Editor de robot (${await focused()})`);
await press(B.DOWN);
await press(B.LEFT);
ok((await focused()).includes('data-go=settings'), `abajo e izquierda → Ajustes (${await focused()})`);
await press(B.A);
ok(!!(await page.$('[data-act="save"]')), 'A abre Ajustes');
ok(await until(B.DOWN, (f) => f.startsWith('input') && f.includes('data-k')), `abajo llega a un slider (${await focused()})`);
const before = await page.evaluate(() => document.querySelector('.pad-focus').value);
await press(B.RIGHT);
const after = await page.evaluate(() => document.querySelector('.pad-focus').value);
ok(Number(after) > Number(before), `derecha sube el slider (${before} → ${after})`);
await shot('pad-ajustes');
await press(B.B);
ok(!!(await page.$('.mm-hero')) && !(await page.$('[data-act="save"]')), 'B regresa al menú');
await press(B.UP);
ok((await focused()).includes('data-go=replays'), `el foco volvió a Ajustes: arriba → Repeticiones (${await focused()})`);

// Práctica: el control maneja; Start pausa y A reanuda sin mover el intake
await page.evaluate(() => window.app.menu.main());
await page.waitForTimeout(200);
ok(await until(B.UP, (f) => f.includes('data-act=practice')), `arriba llega a Práctica (${await focused()})`);
await press(B.A);
ok((await state()) === 'playing', 'A en Práctica empieza a jugar');
const intake0 = await page.evaluate(() => window.app.session.player.mech.intakeOn);
await press(B.DOWN);
ok(!(await focused()), 'jugando, la cruceta no mueve ningún foco');
await press(B.START);
ok((await state()) === 'paused', 'Start pausa');
ok((await focused()).includes('data-act=resume'), `la pausa enfoca Reanudar (${await focused()})`);
await press(B.DOWN);
ok((await focused()).includes('data-act=restart'), `abajo → Reiniciar (${await focused()})`);
await press(B.UP);
await shot('pad-pausa');
await press(B.A);
await page.waitForTimeout(150);
ok((await state()) === 'playing', 'A en Reanudar regresa al juego');
ok((await page.evaluate(() => window.app.session.player.mech.intakeOn)) === intake0, 'esa A no prende/apaga el intake');
await press(B.START);
await press(B.B);
ok((await state()) === 'playing', 'B en la pausa reanuda');

// Controles: reasignar con el control (el botón capturado no navega)
await page.evaluate(() => (window.app.toMenu(), window.app.menu.controlsPanel(() => window.app.menu.main())));
await page.waitForTimeout(200);
await press(B.DOWN);
ok(await until(B.RIGHT, (f) => f.includes('data-dev=pad')), `derecha llega a una casilla del control (${await focused()})`);
const act = await page.evaluate(() => document.querySelector('.pad-focus').dataset.a);
await press(B.A);
ok(await page.evaluate(() => window.app.input.capturing), 'A en la casilla espera un botón');
await press(B.Y);
const bound = await page.evaluate((a) => window.app.input.bindings.pad[a], act);
ok(bound.includes(3), `Y quedó asignado a ${act} (${JSON.stringify(bound)})`);
ok(!(await page.evaluate(() => window.app.input.capturing)) && !!(await page.$('.binds')), 'sigue en Controles');
ok((await focused()).includes(`data-a=${act}`), `el foco se queda en la casilla (${await focused()})`);
await shot('pad-controles');
await press(B.B);
ok(!!(await page.$('.mm-hero')), 'B regresa al menú desde Controles');

// Scouting: LB/RB cambian de pestaña
await page.evaluate(() => window.app.scouting.show());
await page.waitForTimeout(200);
const tab = () => page.evaluate(() => document.querySelector('[data-tab].on')?.dataset.tab);
const t0 = await tab();
await press(B.RB);
const t1 = await tab();
ok(t0 && t1 && t0 !== t1, `RB cambia de pestaña (${t0} → ${t1})`);
await press(B.LB);
ok((await tab()) === t0, 'LB regresa a la pestaña anterior');
await press(B.B);
ok(!!(await page.$('.mm-hero')), 'B regresa al menú desde el Scouting');

// Entrenamiento: en las instrucciones A empieza el reto; corriendo, el control maneja
await page.evaluate(() => window.app.start({ mode: 'training', player: 0, drill: 'line' }));
await page.waitForTimeout(300);
await press(B.DOWN);
ok((await focused()).includes('data-a=start'), `las instrucciones enfocan Empezar (${await focused()})`);
await press(B.A);
ok(!!(await page.$('.tn-chip')), 'A empieza la cuenta del reto');
await shot('pad-reto');

ok(errors.length === 0, `sin errores en la página ${errors.join(' | ')}`);
await browser.close();
server.kill();
console.log(fails ? `${fails} fallas` : 'todo bien');
process.exit(fails ? 1 : 0);
