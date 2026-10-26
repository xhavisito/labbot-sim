/** Récords del entrenamiento por retos, guardados en el navegador (localStorage). */
import { emptyProgress, parseProgress, type TrainingProgress } from '../core/training';

const KEY = 'labbot.training.v1';

export function loadTraining(): TrainingProgress {
  try {
    return parseProgress(localStorage.getItem(KEY));
  } catch {
    return emptyProgress();
  }
}

export function saveTraining(p: TrainingProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: el récord dura lo que la pestaña */
  }
}
