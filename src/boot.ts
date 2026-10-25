/** Arranque pesado: estilos, Rapier (WASM) y la App. Lo carga `main.ts` cuando la página ya pintó. */
import './ui/styles.css';
import { App } from './app/App';
import { initRapier } from './physics/PhysicsWorld';

const status = (text: string): void => {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text;
};

export async function start(): Promise<void> {
  status('Iniciando la física…');
  await initRapier();
  status('Armando la cancha…');
  const app = new App(document.getElementById('app')!, document.getElementById('ui')!);
  (window as unknown as { app: App }).app = app;
  document.getElementById('loading')?.remove();
}
