/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Base relativa ('./'): el mismo build sirve en cualquier subruta (p. ej. GitHub Pages).
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
