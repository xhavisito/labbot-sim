#!/usr/bin/env node
/**
 * Auditoría contra el manual del reto: extrae el texto del PDF y corre `tests/manual.test.ts`, que
 * además de revisar el simulador comprueba que cada cita de `tests/manual/clauses.ts` siga en el
 * manual. Si los organizadores cambian el manual (§11.2), lo que cambió sale como cita faltante.
 *
 *   npm run audit:manual -- "ruta/game manual copy 2026.pdf"
 *   npm run audit:manual                 # usa docs/manual.pdf o el docs/manual.txt de la última vez
 *
 * Requiere `pdftotext` (poppler-utils). El PDF y el texto no se versionan (.gitignore).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const pdf = process.argv[2] ?? (existsSync('docs/manual.pdf') ? 'docs/manual.pdf' : null);
const txt = 'docs/manual.txt';
if (pdf) {
  try {
    execFileSync('pdftotext', ['-layout', pdf, txt], { stdio: 'inherit' });
  } catch {
    console.error(`No pude extraer el texto de "${pdf}" (¿falta pdftotext? apt install poppler-utils).`);
    process.exit(1);
  }
  console.log(`Texto del manual en ${txt}`);
} else if (!existsSync(txt)) {
  console.error('Falta el manual: npm run audit:manual -- "ruta/al/manual.pdf"');
  process.exit(1);
}
const r = spawnSync('npx', ['vitest', 'run', 'tests/manual.test.ts'], { stdio: 'inherit', env: { ...process.env, LABBOT_MANUAL_TXT: txt } });
process.exit(r.status ?? 1);
