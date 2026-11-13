/**
 * Estrategias de alianza guardadas en el navegador (localStorage, `labbot.plans`): funcionan sin
 * conexión y se reutilizan entre matches. Todo pasa por `sanitizePlans` (`core/plan.ts`).
 */
import { sanitizePlans, type StrategyPlan } from '../core/plan';

const KEY = 'labbot.plans';

export function loadPlans(): StrategyPlan[] {
  try {
    return sanitizePlans(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function savePlans(list: readonly StrategyPlan[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
}

export const planById = (id: string): StrategyPlan | undefined => (id ? loadPlans().find((p) => p.id === id) : undefined);
