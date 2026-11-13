import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPrecacheList, renderServiceWorker } from '../src/pwa/precache';

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
const template = readFileSync('src/pwa/sw-template.js', 'utf8');

describe('precache', () => {
  it('une build y public, sin duplicados, ordenado, sin sw.js ni mapas', () => {
    const list = buildPrecacheList(['assets/a-1.js', 'assets/a-1.js.map', 'sw.js', 'index.html'], ['icons\\icon.svg', 'sounds/start.wav', 'sw.js']);
    expect(list).toEqual(['./', 'assets/a-1.js', 'icons/icon.svg', 'index.html', 'sounds/start.wav']);
  });
  it('siempre incluye la página para abrir sin conexión', () => {
    expect(buildPrecacheList([], [])).toEqual(['./', 'index.html']);
  });
});

describe('service worker', () => {
  it('rellena versión y lista, y queda como JS válido', () => {
    const src = renderServiceWorker(template, '0.1.0-abc', ['./', 'index.html']);
    expect(src).not.toContain('__CACHE_VERSION__');
    expect(src).not.toContain('__PRECACHE__');
    expect(src).toContain("'labbot-sim-0.1.0-abc'");
    expect(() => new Function(src)).not.toThrow();
  });
  it('falla si la plantilla pierde un marcador', () => {
    expect(() => renderServiceWorker('const x = 1;', 'v', [])).toThrow();
  });
  it('la navegación sin red cae a index.html en caché', () => {
    expect(template).toMatch(/mode === 'navigate'/);
    expect(template).toContain('index.html');
  });
});

describe('manifest', () => {
  it('es instalable: nombre, start_url, display e íconos 192/512/maskable', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('./');
    expect(manifest.id).toBe('./');
    expect(['standalone', 'fullscreen']).toContain(manifest.display);
    expect(manifest.lang).toBe('es-MX');
    const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? ''}`);
    expect(sizes).toContain('192x192:any');
    expect(sizes).toContain('512x512:any');
    expect(sizes).toContain('512x512:maskable');
  });
  it('cada ícono existe en public/', () => {
    for (const i of manifest.icons) expect(existsSync(`public/${i.src}`), i.src).toBe(true);
  });
  it('colores con el branding del equipo', () => {
    expect(manifest.theme_color).toBe('#722585');
    expect(manifest.background_color).toBe('#0b0610');
  });
  it('index.html enlaza manifest, theme-color e ícono de iOS', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="manifest" href="manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="apple-touch-icon"');
  });
});
