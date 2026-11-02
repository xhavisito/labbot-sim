/**
 * Catálogo de faltas que el árbitro automático puede detectar, con su sección del manual.
 * Foul = 4 puntos al contrario (§4.5); Tech Foul = 8 (§4.6). Las faltas de conducta, seguridad
 * y del Human Player humano no se pueden detectar en el simulador y no están aquí.
 */
export type FoulKind = 'FOUL' | 'TECH';

export type RuleCode = 'CONTACT' | 'PIN' | 'ZONE_CONTACT' | 'OUT_OF_BOUNDS' | 'PLATFORM_EARLY' | 'CRITICAL_EARLY' | 'AUTO_CENTER' | 'OBSTRUCT' | 'CRITICAL_KNOCK';

export const RULES: Record<RuleCode, { kind: FoulKind; section: string; es: string; supuesto?: string }> = {
  CONTACT: { kind: 'FOUL', section: '§4.5', es: 'Contacto con un robot de la alianza contraria' },
  PIN: { kind: 'FOUL', section: '§4.5, §6.1', es: 'Pinning contra el equipo contrario', supuesto: 'D11: más de 3 s; otra cada 3 s más' },
  ZONE_CONTACT: { kind: 'TECH', section: '§4.6', es: 'Tocar a un robot en una zona del color de la alianza contraria', supuesto: 'D8: Zonas de Inicio y frente de la Campana' },
  OUT_OF_BOUNDS: { kind: 'TECH', section: '§4.6', es: 'El robot sale de los límites de la cancha' },
  PLATFORM_EARLY: { kind: 'TECH', section: '§4.6', es: 'Subir a la Plataforma de Contención antes del endgame' },
  CRITICAL_EARLY: { kind: 'TECH', section: '§4.6', es: 'Tomar la Muestra Crítica antes del endgame' },
  AUTO_CENTER: { kind: 'FOUL', section: '§4.2', es: 'Cruzar la línea central en AUTO', supuesto: 'D7: el manual no le asigna falta' },
  OBSTRUCT: { kind: 'TECH', section: '§4.6, §6.1', es: 'Bloquear u obstruir deliberadamente las zonas del equipo contrario', supuesto: 'D17: más de 3 s frente a la Cámara o la Campana rival, o en su rampa; otra cada 5 s más' },
  CRITICAL_KNOCK: { kind: 'TECH', section: '§4.6', es: 'Tirar la Muestra Crítica del equipo contrario de la Repisa de Seguridad', supuesto: 'D21: el sim no juzga la intención; cuenta si un robot rival la tocaba al caer' },
};

export interface FoulRecord {
  rule: RuleCode;
  kind: FoulKind;
  /** Alianza que la comete (los puntos van a la contraria). */
  offender: 'red' | 'blue';
  /** Robot que la cometió. */
  robot: number;
  time: number;
}

export type CardType = 'YELLOW' | 'RED';

export interface CardRecord {
  type: CardType;
  robot: number;
  alliance: 'red' | 'blue';
  time: number;
  reason: string;
}
