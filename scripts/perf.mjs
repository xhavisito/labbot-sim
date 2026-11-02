// Banco de rendimiento: abre la app (requiere `npm run build`), arranca un match con IA y mide FPS por
// calidad, en escritorio y/o celular (844×390 táctil). Con SwiftShader (nube) los números sirven para
// comparar versiones, no como FPS reales de un teléfono.
//
// Uso: node scripts/perf.mjs [--qualities low,medium,high] [--only mobile|desktop] [--secs 8]
//        [--throttle 4] (CPU más lenta, como un celular)
// En la nube: CHROMIUM_PATH=/opt/pw-browsers/chromium
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const qualities = opt('qualities', 'low,medium,high').split(',');
const only = opt('only', '');
const secs = Number(opt('secs', '8'));
const throttle = Number(opt('throttle', '1'));
const extra = opt('query', '');
const port = 4298;

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('server timeout')), 30000);
  const onData = (d) => String(d).includes(String(port)) && (clearTimeout(to), resolve());
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const devices = {
  desktop: { viewport: { width: 1600, height: 900 } },
  mobile: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
};
const rows = [];
try {
  for (const [dev, ctx] of Object.entries(devices)) {
    if (only && only !== dev) continue;
    for (const q of qualities) {
      const page = await browser.newPage(ctx);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      if (throttle > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      }
      await page.goto(`http://localhost:${port}/?quality=${q}${q === 'auto' ? '' : '&dynres=0'}&${extra}`);
      await page.waitForFunction(() => !!(window.app && window.app.start), null, { timeout: 60000 });
      await page.evaluate(() => window.app.start({ mode: 'match', player: 2, ready: true }));
      await page.waitForTimeout(2500);
      const r = await page.evaluate(
        (secs) =>
          new Promise((resolve) => {
            const times = [];
            let last = performance.now();
            const t0 = last;
            const prof = window.app.perf;
            prof?.reset?.();
            const step = (now) => {
              times.push(now - last);
              last = now;
              if (now - t0 < secs * 1000) requestAnimationFrame(step);
              else {
                const sorted = [...times].sort((a, b) => b - a);
                const low = sorted.slice(0, Math.max(1, Math.floor(times.length / 100)));
                const st = prof?.summary?.() ?? null;
                resolve({
                  fps: (times.length / (now - t0)) * 1000,
                  worst: sorted[0],
                  low1: 1000 / (low.reduce((a, b) => a + b, 0) / low.length),
                  sim: st?.simMs,
                  render: st?.renderMs,
                  calls: window.app.renderer.renderer.info.render.calls,
                  tris: window.app.renderer.renderer.info.render.triangles,
                  quality: window.app.renderer.quality,
                  scale: window.app.renderer.dynScale,
                });
              }
            };
            requestAnimationFrame(step);
          }),
        secs,
      );
      rows.push({ dev, q, ...r, errors: errors.length });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
const f = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '-');
console.log('device  quality  FPS    1%low  worst(ms) sim(ms) render(ms) calls  tris    final');
for (const r of rows)
  console.log(
    `${r.dev.padEnd(8)}${r.q.padEnd(9)}${f(r.fps).padEnd(7)}${f(r.low1).padEnd(7)}${f(r.worst).padEnd(10)}${f(r.sim, 2).padEnd(8)}${f(r.render, 2).padEnd(11)}${String(r.calls).padEnd(7)}${String(r.tris).padEnd(8)}${r.quality}${r.scale ? ' ' + Math.round(r.scale * 100) + '%' : ''}${r.errors ? ` ERR×${r.errors}` : ''}`,
  );
