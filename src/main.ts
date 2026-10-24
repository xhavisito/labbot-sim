/** Punto de entrada: carga Rapier (WASM) y arranca la App. */
import './ui/styles.css';
import { App } from './app/App';
import { initRapier } from './physics/PhysicsWorld';

async function boot(): Promise<void> {
  await initRapier();
  const app = new App(document.getElementById('app')!);
  (window as unknown as { app: App }).app = app;
  document.getElementById('loading')?.remove();
}

boot().catch((e: unknown) => {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = `Error: ${String(e)}`;
  console.error(e);
});
