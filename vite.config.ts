/// <reference types="vitest/config" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

function listPublic(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listPublic(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/**
 * PWA mínima (como rebuilt-sim, sin Workbox): genera `sw.js` con todos los archivos del build para
 * precache, así el simulador se instala en el celular y juega sin conexión.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'labbot-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = new Set<string>(['./', 'index.html', ...Object.keys(bundle), ...listPublic('public')]);
      const source = readFileSync('src/pwa/sw-template.js', 'utf8')
        .replace('__CACHE_VERSION__', `${pkg.version}-${Date.now().toString(36)}`)
        .replace('__PRECACHE__', JSON.stringify([...files].sort()));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Base relativa ('./'): el mismo build sirve en cualquier subruta (p. ej. GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  plugins: [serviceWorkerPlugin()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
