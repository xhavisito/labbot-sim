/**
 * Lo que la IA de tu compañero toma de una estrategia de alianza (`core/plan.ts`): en cada paso
 * (AUTO, turno del TELEOP, ENDGAME) su ruta, su zona de trabajo, de dónde junta y a qué nivel anota,
 * ya en coordenadas de la cancha para su alianza.
 */
import { COLLECT_HOME, DO_NOTHING, LEAVE_ZONE, SCORE_PRELOAD, type AutoRoutine } from '../auto/AutoRoutine';
import * as F from '../config/field';
import type { Phase } from '../core/clock';
import { activeStep, type StrategyPlan } from '../core/plan';
import type { Alliance, Level } from '../core/types';
import type { BotOptions, SampleSource } from './Bot';

export interface PlanDirective {
  /** Cambia al empezar otro paso (la IA vuelve a recorrer la ruta desde el primer punto). */
  key: string;
  route: Array<{ x: number; z: number }>;
  zone: F.Rect | null;
  source?: SampleSource;
  level?: Level;
}

export interface PlanDriver {
  at(phase: Phase, remaining: number): PlanDirective | null;
}

/** Guía del compañero para un plan y su alianza (los pasos se convierten una sola vez). */
export function planDriver(plan: StrategyPlan, alliance: Alliance): PlanDriver {
  const cache = new Map<string, PlanDirective>();
  return {
    at(phase, remaining) {
      const a = activeStep(plan, phase, remaining);
      if (!a) return null;
      let d = cache.get(a.key);
      if (!d) {
        const p = a.step.partner;
        d = {
          key: a.key,
          route: p.route.map((q) => F.forAlliance(alliance, q)),
          zone: p.zone ? F.rectFor(alliance, p.zone) : null,
          source: p.source === 'any' ? undefined : p.source,
          level: p.level === 0 ? undefined : p.level,
        };
        cache.set(a.key, d);
      }
      return d;
    },
  };
}

/**
 * AUTO del compañero según el plan. Con ruta, la recorre la IA (la rutina de pasos fijos no sabe
 * de rutas): "Cruzar la línea" y "Quedarse quieto" se vuelven recorrer la ruta y pararse (`autoIdle`).
 */
export function planAutoRoutine(plan: StrategyPlan): AutoRoutine {
  if (plan.auto === 'collect') return COLLECT_HOME;
  if (plan.auto === 'preload') return SCORE_PRELOAD;
  if (plan.steps.AUTO.partner.route.length) return { id: 'plan', name: plan.name, steps: [], bot: { scoreOnly: true } };
  return plan.auto === 'none' ? DO_NOTHING : LEAVE_ZONE;
}

/** Opciones de la IA del compañero que sigue el plan (su dificultad aparte). */
export function planBotOptions(plan: StrategyPlan, alliance: Alliance): Partial<BotOptions> {
  return { plan: planDriver(plan, alliance), endgame: plan.endgame, autoIdle: plan.auto === 'leave' || plan.auto === 'none' };
}
